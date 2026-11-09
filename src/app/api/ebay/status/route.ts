import { connection, NextResponse, type NextRequest } from "next/server";
import { decryptToken, getEbayConfig, RT_COOKIE } from "@/lib/server/ebay";

/** Mirrored by the `Status` type in src/components/EbayButton.tsx. */
type EbayStatus = {
  configured: boolean;
  connected: boolean;
  env: "sandbox" | "production";
  marketplaceId?: string;
  reason?: string;
};

/** Tells the client whether the eBay feature is configured and whether this browser holds a valid connection. */
export async function GET(req: NextRequest) {
  // Never prerender: the build box has no eBay keys, which would freeze "not configured".
  await connection();
  const conf = getEbayConfig();
  if (!conf.ok) {
    const body: EbayStatus = { configured: false, connected: false, env: conf.env, reason: conf.reason };
    return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
  }
  const raw = req.cookies.get(RT_COOKIE)?.value;
  const connected = Boolean(raw && decryptToken(raw, conf.cfg.tokenSecret));
  const body: EbayStatus = {
    configured: true,
    connected,
    env: conf.cfg.env,
    marketplaceId: conf.cfg.marketplaceId,
    ...(raw && !connected ? { reason: "Stored eBay connection could not be read; reconnect." } : {}),
  };
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
