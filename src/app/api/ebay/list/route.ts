import { NextResponse, type NextRequest } from "next/server";
import { normalizeListing, type CoinListing } from "@/lib/coinSchema";
import {
  createAndPublishListing,
  decryptToken,
  EbayError,
  getEbayConfig,
  parseImageDataUrl,
  refreshAccessToken,
  RT_COOKIE,
} from "@/lib/server/ebay";
import { requestId, slog } from "@/lib/serverLog";

export const maxDuration = 60;

type Body = { listing?: unknown; front?: unknown; back?: unknown; price?: unknown; sku?: unknown };

/**
 * One-tap listing: refresh token → access token, upload photos, pick a category,
 * ensure a location and business policies, create the inventory item + offer, publish.
 */
export async function POST(req: NextRequest) {
  const rid = requestId();
  const step = `ebay-list#${rid}`;
  const t0 = Date.now();
  const fail = (status: number, error: string, extra?: Record<string, unknown>) => {
    slog(status >= 500 ? "error" : "warn", step, `${status} ${error}`, extra);
    return NextResponse.json({ error, requestId: rid, ...extra }, { status });
  };

  const conf = getEbayConfig();
  if (!conf.ok) return fail(503, `eBay listing is not configured: ${conf.reason}`);
  const { cfg } = conf;

  const raw = req.cookies.get(RT_COOKIE)?.value;
  const refreshToken = raw ? decryptToken(raw, cfg.tokenSecret) : null;
  if (!refreshToken) return fail(401, "Connect your eBay account first", { reconnect: true });

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return fail(400, "Invalid JSON body");
  }

  const rawListing = body.listing;
  if (!rawListing || typeof rawListing !== "object") return fail(400, "listing is required");
  const listing: CoinListing = normalizeListing(rawListing as Partial<CoinListing>);
  if (typeof listing.title !== "string" || !listing.title.trim()) return fail(400, "listing.title is required");
  if (typeof listing.description !== "string") return fail(400, "listing.description must be a string");
  if (!Array.isArray(listing.item_specifics)) return fail(400, "listing.item_specifics must be an array");

  const price = typeof body.price === "number" && Number.isFinite(body.price) ? body.price : listing.suggested_price_usd;
  if (typeof price !== "number" || !Number.isFinite(price) || price < 0.99) {
    return fail(400, "Set a price of at least $0.99 before listing");
  }
  const sku = typeof body.sku === "string" ? body.sku : undefined;

  let front: ReturnType<typeof parseImageDataUrl>;
  let back: ReturnType<typeof parseImageDataUrl>;
  try {
    front = parseImageDataUrl(body.front, "Front");
    back = parseImageDataUrl(body.back, "Back");
  } catch (e) {
    return fail(400, e instanceof Error ? e.message : "Invalid photos");
  }

  slog("info", step, "Listing request", {
    env: cfg.env,
    marketplace: cfg.marketplaceId,
    title: listing.title,
    price,
    sku: sku ?? "(auto)",
    frontKb: Math.round(front.bytes.length / 1024),
    backKb: Math.round(back.bytes.length / 1024),
    specifics: listing.item_specifics.length,
  });

  try {
    const token = await refreshAccessToken(cfg, step, refreshToken);
    const result = await createAndPublishListing(cfg, token, step, { listing, front, back, price, sku });
    slog("info", step, `Done in ${Date.now() - t0} ms`, { listingId: result.listingId, url: result.url });
    return NextResponse.json({ ...result, env: cfg.env, requestId: rid });
  } catch (e) {
    if (e instanceof EbayError) {
      slog(e.status >= 500 ? "error" : "warn", step, `eBay error after ${Date.now() - t0} ms: ${e.message}`, {
        status: e.status,
        ebayStatus: e.ebayStatus,
        details: e.details,
      });
      const res = NextResponse.json({ ...e.toJSON(), requestId: rid, reconnect: e.status === 401 }, { status: e.status });
      if (e.status === 401) res.cookies.delete(RT_COOKIE);
      return res;
    }
    slog("error", step, `Unexpected error after ${Date.now() - t0} ms`, e);
    return fail(500, e instanceof Error ? e.message : "Listing failed");
  }
}
