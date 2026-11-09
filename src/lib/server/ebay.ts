import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { CoinListing } from "@/lib/coinSchema";
import { slog } from "@/lib/serverLog";
import { SITE_URL } from "@/lib/siteUrl";

/**
 * Server-only eBay helpers: configuration, OAuth (authorization-code grant),
 * encrypted refresh-token cookie, and the "one-tap list" flow built on the
 * Sell Inventory / Account / Taxonomy REST APIs plus the Trading API picture upload.
 *
 * Nothing here is imported by client code. Routes under src/app/api/ebay/* are the only callers.
 */

/* ------------------------------------------------------------------ */
/* Configuration                                                        */
/* ------------------------------------------------------------------ */

export type EbayEnv = "sandbox" | "production";

export type EbayConfig = {
  clientId: string;
  clientSecret: string;
  ruName: string;
  env: EbayEnv;
  tokenSecret: string;
  marketplaceId: string;
  postalCode: string;
  /** auth.sandbox.ebay.com / auth.ebay.com */
  authHost: string;
  /** api.sandbox.ebay.com / api.ebay.com */
  apiHost: string;
  /** sandbox.ebay.com / www.ebay.com */
  webHost: string;
};

export type EbayConfigResult = { ok: true; cfg: EbayConfig } | { ok: false; env: EbayEnv; reason: string };

export const EBAY_SCOPES = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.account",
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
];

export const RT_COOKIE = "ebay_rt";
export const STATE_COOKIE = "ebay_oauth_state";
/** eBay refresh tokens live 18 months; keep the cookie for the same period. */
export const RT_COOKIE_MAX_AGE = 540 * 24 * 60 * 60;

export function ebayEnv(): EbayEnv {
  return process.env.EBAY_ENV === "production" ? "production" : "sandbox";
}

/** Reads env vars. Returns a reason string (safe to show in /status) when the feature is not usable. */
export function getEbayConfig(): EbayConfigResult {
  const env = ebayEnv();
  const clientId = process.env.EBAY_CLIENT_ID?.trim() ?? "";
  const clientSecret = process.env.EBAY_CLIENT_SECRET?.trim() ?? "";
  const ruName = process.env.EBAY_RU_NAME?.trim() ?? "";
  const tokenSecret = process.env.EBAY_TOKEN_SECRET ?? "";

  if (!clientId) return { ok: false, env, reason: "EBAY_CLIENT_ID is not set" };
  if (!clientSecret) return { ok: false, env, reason: "EBAY_CLIENT_SECRET is not set" };
  if (!ruName) return { ok: false, env, reason: "EBAY_RU_NAME is not set" };
  if (tokenSecret.length < 32) {
    return { ok: false, env, reason: "EBAY_TOKEN_SECRET is missing or shorter than 32 characters" };
  }

  const sandbox = env === "sandbox";
  return {
    ok: true,
    cfg: {
      clientId,
      clientSecret,
      ruName,
      env,
      tokenSecret,
      marketplaceId: process.env.EBAY_MARKETPLACE_ID?.trim() || "EBAY_US",
      postalCode: process.env.EBAY_POSTAL_CODE?.trim() || "10001",
      authHost: sandbox ? "https://auth.sandbox.ebay.com" : "https://auth.ebay.com",
      apiHost: sandbox ? "https://api.sandbox.ebay.com" : "https://api.ebay.com",
      webHost: sandbox ? "https://sandbox.ebay.com" : "https://www.ebay.com",
    },
  };
}

/** Cookies are only marked Secure when the public origin is https, so local dev on http keeps working. */
export function cookieSecure(): boolean {
  return SITE_URL.startsWith("https://");
}

/** The URL the RuName must redirect to; shown in the report and used for sanity logging. */
export function callbackUrl(): string {
  return `${SITE_URL}/api/ebay/callback`;
}

/* ------------------------------------------------------------------ */
/* Token encryption (AES-256-GCM, key = sha256(EBAY_TOKEN_SECRET))     */
/* ------------------------------------------------------------------ */

function deriveKey(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest();
}

/** Encrypts to base64url(iv[12] + tag[16] + ciphertext). */
export function encryptToken(plain: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(secret), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64url");
}

/** Returns null when the payload is malformed, tampered with, or encrypted with another secret. */
export function decryptToken(token: string, secret: string): string | null {
  try {
    const buf = Buffer.from(token, "base64url");
    if (buf.length < 12 + 16 + 1) return null;
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const data = buf.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", deriveKey(secret), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Errors                                                               */
/* ------------------------------------------------------------------ */

export type EbayErrorDetail = { errorId?: number | string; message: string; longMessage?: string };

/** Any failure talking to eBay. `status` is the HTTP status our own API should answer with. */
export class EbayError extends Error {
  status: number;
  ebayStatus?: number;
  details: EbayErrorDetail[];
  step: string;

  constructor(step: string, status: number, message: string, details: EbayErrorDetail[] = [], ebayStatus?: number) {
    super(message);
    this.name = "EbayError";
    this.step = step;
    this.status = status;
    this.details = details;
    this.ebayStatus = ebayStatus;
  }

  /** JSON body for our API response. */
  toJSON() {
    return {
      error: this.message,
      step: this.step,
      ebayStatus: this.ebayStatus,
      details: this.details.map((d) => d.longMessage || d.message),
    };
  }
}

/** Pull human-readable messages out of whatever eBay returned (REST JSON, OAuth JSON or Trading XML). */
export function parseEbayErrors(body: unknown, text?: string): EbayErrorDetail[] {
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    if (Array.isArray(b.errors)) {
      return b.errors
        .map((e) => {
          const r = e as Record<string, unknown>;
          return {
            errorId: typeof r.errorId === "number" || typeof r.errorId === "string" ? r.errorId : undefined,
            message: String(r.message ?? r.longMessage ?? "Unknown eBay error"),
            longMessage: typeof r.longMessage === "string" ? r.longMessage : undefined,
          };
        })
        .filter((e) => e.message);
    }
    if (typeof b.error === "string") {
      return [{ errorId: b.error, message: String(b.error_description ?? b.error) }];
    }
    if (typeof b.message === "string") return [{ message: b.message }];
  }
  if (text) {
    const out: EbayErrorDetail[] = [];
    const re = /<Errors>([\s\S]*?)<\/Errors>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const block = m[1];
      const sev = /<SeverityCode>(.*?)<\/SeverityCode>/.exec(block)?.[1];
      if (sev && sev !== "Error") continue;
      out.push({
        errorId: /<ErrorCode>(.*?)<\/ErrorCode>/.exec(block)?.[1],
        message: xmlUnescape(/<ShortMessage>([\s\S]*?)<\/ShortMessage>/.exec(block)?.[1] ?? "eBay error"),
        longMessage: xmlUnescape(/<LongMessage>([\s\S]*?)<\/LongMessage>/.exec(block)?.[1] ?? ""),
      });
    }
    if (out.length) return out;
  }
  return [];
}

function statusFor(ebayStatus: number): number {
  if (ebayStatus === 401 || ebayStatus === 403) return 401;
  if (ebayStatus >= 400 && ebayStatus < 500) return ebayStatus;
  return 502;
}

function summarise(details: EbayErrorDetail[], fallback: string): string {
  if (!details.length) return fallback;
  return details
    .map((d) => d.longMessage || d.message)
    .filter(Boolean)
    .slice(0, 3)
    .join(" ");
}

/* ------------------------------------------------------------------ */
/* OAuth                                                                */
/* ------------------------------------------------------------------ */

export function authorizeUrl(cfg: EbayConfig, state: string): string {
  const u = new URL(`${cfg.authHost}/oauth2/authorize`);
  u.searchParams.set("client_id", cfg.clientId);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("redirect_uri", cfg.ruName);
  u.searchParams.set("scope", EBAY_SCOPES.join(" "));
  u.searchParams.set("state", state);
  u.searchParams.set("prompt", "login");
  return u.toString();
}

export type TokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  token_type: string;
};

async function tokenRequest(cfg: EbayConfig, step: string, params: URLSearchParams): Promise<TokenResponse> {
  const t0 = Date.now();
  const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`, "utf8").toString("base64");
  let res: Response;
  try {
    res = await fetch(`${cfg.apiHost}/identity/v1/oauth2/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basic}`,
      },
      body: params.toString(),
      cache: "no-store",
    });
  } catch (e) {
    slog("error", step, "Token endpoint unreachable", e);
    throw new EbayError(step, 502, "Could not reach eBay's token endpoint");
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON */
  }
  slog(res.ok ? "info" : "warn", step, `Token endpoint ${res.status} in ${Date.now() - t0} ms`, {
    grant: params.get("grant_type"),
    body: res.ok ? undefined : text.slice(0, 500),
  });
  if (!res.ok) {
    const details = parseEbayErrors(json, text);
    throw new EbayError(
      step,
      statusFor(res.status),
      summarise(details, `eBay token request failed (${res.status})`),
      details,
      res.status,
    );
  }
  const tok = json as TokenResponse;
  if (!tok || typeof tok.access_token !== "string") {
    throw new EbayError(step, 502, "eBay token response did not include an access token");
  }
  return tok;
}

/** Authorization-code exchange. The refresh_token is what we store (encrypted) in the cookie. */
export function exchangeCode(cfg: EbayConfig, step: string, code: string): Promise<TokenResponse> {
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: cfg.ruName,
  });
  return tokenRequest(cfg, step, params);
}

/** Short-lived (2 h) user access token minted from the stored refresh token. */
export async function refreshAccessToken(cfg: EbayConfig, step: string, refreshToken: string): Promise<string> {
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    scope: EBAY_SCOPES.join(" "),
  });
  const tok = await tokenRequest(cfg, step, params);
  return tok.access_token;
}

/* ------------------------------------------------------------------ */
/* REST helper                                                          */
/* ------------------------------------------------------------------ */

type Ctx = { cfg: EbayConfig; token: string; step: string };

type ApiResult<T> = { status: number; data: T; headers: Headers };

async function api<T = unknown>(
  ctx: Ctx,
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  opts: { body?: unknown; headers?: Record<string, string>; query?: Record<string, string>; label?: string } = {},
): Promise<ApiResult<T>> {
  const url = new URL(`${ctx.cfg.apiHost}${path}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);
  const label = opts.label ?? `${method} ${path}`;
  const t0 = Date.now();
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${ctx.token}`,
        Accept: "application/json",
        "Accept-Language": "en-US",
        "Content-Language": "en-US",
        "X-EBAY-C-MARKETPLACE-ID": ctx.cfg.marketplaceId,
        ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(opts.headers ?? {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      cache: "no-store",
    });
  } catch (e) {
    slog("error", ctx.step, `${label}: network error`, e);
    throw new EbayError(ctx.step, 502, `Could not reach eBay (${label})`);
  }
  const text = await res.text();
  let data: unknown = undefined;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  slog(res.ok ? "info" : "warn", ctx.step, `${label} → ${res.status} in ${Date.now() - t0} ms`, {
    body: res.ok ? undefined : text.slice(0, 800),
  });
  if (!res.ok) {
    const details = parseEbayErrors(data, text);
    throw new EbayError(
      ctx.step,
      statusFor(res.status),
      summarise(details, `eBay request failed (${label}: ${res.status})`),
      details,
      res.status,
    );
  }
  return { status: res.status, data: data as T, headers: res.headers };
}

/* ------------------------------------------------------------------ */
/* Pictures: Trading API UploadSiteHostedPictures                      */
/* ------------------------------------------------------------------ */

const IMAGE_RE = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/;

export function parseImageDataUrl(dataUrl: unknown, label: string): { mime: string; bytes: Buffer } {
  if (typeof dataUrl !== "string") throw new EbayError("images", 400, `${label} photo must be a data URL`);
  const m = IMAGE_RE.exec(dataUrl);
  if (!m) throw new EbayError("images", 400, `${label} photo must be a base64 JPEG/PNG/WebP/GIF data URL`);
  return { mime: m[1], bytes: Buffer.from(m[2], "base64") };
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function xmlUnescape(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

type Part = { name: string; filename?: string; type: string; body: Buffer | string };

/** Builds multipart/form-data by hand so the part order and content types are exactly what eBay expects. */
function multipart(parts: Part[]): { body: Uint8Array<ArrayBuffer>; contentType: string } {
  const boundary = `----CoinLens${randomBytes(12).toString("hex")}`;
  const chunks: Buffer[] = [];
  for (const p of parts) {
    let head = `--${boundary}\r\nContent-Disposition: form-data; name="${p.name}"`;
    if (p.filename) head += `; filename="${p.filename}"`;
    head += `\r\nContent-Type: ${p.type}\r\n\r\n`;
    chunks.push(Buffer.from(head, "utf8"));
    chunks.push(Buffer.isBuffer(p.body) ? p.body : Buffer.from(p.body, "utf8"));
    chunks.push(Buffer.from("\r\n", "utf8"));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`, "utf8"));
  // Copy into a Uint8Array backed by a real ArrayBuffer: fetch's BodyInit rejects Buffer<ArrayBufferLike> in TS 5.7+.
  const buf = Buffer.concat(chunks);
  const body = new Uint8Array(new ArrayBuffer(buf.byteLength));
  body.set(buf);
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

/** Uploads one picture to eBay Picture Services and returns its FullURL. */
export async function uploadPicture(ctx: Ctx, name: string, image: { mime: string; bytes: Buffer }): Promise<string> {
  const t0 = Date.now();
  const xml =
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<UploadSiteHostedPicturesRequest xmlns="urn:ebay:apis:eBLBaseComponents">` +
    `<WarningLevel>High</WarningLevel>` +
    `<PictureName>${xmlEscape(name)}</PictureName>` +
    `<PictureSet>Supersize</PictureSet>` +
    `</UploadSiteHostedPicturesRequest>`;
  const ext = image.mime.split("/")[1] === "jpeg" ? "jpg" : image.mime.split("/")[1];
  const { body, contentType } = multipart([
    { name: "XML Payload", type: "text/xml; charset=utf-8", body: xml },
    { name: "image", filename: `${name}.${ext}`, type: image.mime, body: image.bytes },
  ]);

  let res: Response;
  try {
    res = await fetch(`${ctx.cfg.apiHost}/ws/api.dll`, {
      method: "POST",
      headers: {
        "Content-Type": contentType,
        "X-EBAY-API-COMPATIBILITY-LEVEL": "1193",
        "X-EBAY-API-CALL-NAME": "UploadSiteHostedPictures",
        "X-EBAY-API-SITEID": "0",
        "X-EBAY-API-IAF-TOKEN": ctx.token,
      },
      body,
      cache: "no-store",
    });
  } catch (e) {
    slog("error", ctx.step, `UploadSiteHostedPictures(${name}): network error`, e);
    throw new EbayError(ctx.step, 502, "Could not reach eBay Picture Services");
  }
  const text = await res.text();
  const ack = /<Ack>(.*?)<\/Ack>/.exec(text)?.[1];
  const fullUrl = /<FullURL>(.*?)<\/FullURL>/.exec(text)?.[1];
  slog(fullUrl ? "info" : "warn", ctx.step, `UploadSiteHostedPictures(${name}) → ${res.status} ${ack ?? "?"} in ${Date.now() - t0} ms`, {
    kb: Math.round(image.bytes.length / 1024),
    url: fullUrl,
    body: fullUrl ? undefined : text.slice(0, 800),
  });
  if (!res.ok || !fullUrl) {
    const details = parseEbayErrors(null, text);
    throw new EbayError(
      ctx.step,
      res.ok ? 502 : statusFor(res.status),
      summarise(details, `eBay picture upload failed for the ${name} photo`),
      details,
      res.status,
    );
  }
  return xmlUnescape(fullUrl);
}

/* ------------------------------------------------------------------ */
/* Category, location, policies                                        */
/* ------------------------------------------------------------------ */

/** "Coins & Paper Money" department on eBay US; suggestions under it are preferred. */
const COINS_ROOT = "11116";
/** Department-level fallbacks (not leaves, so publish may still ask for a narrower category). */
const FALLBACK_US = "253"; // Coins & Paper Money > Coins: US
const FALLBACK_WORLD = "256"; // Coins & Paper Money > Coins: World

type Suggestion = {
  category?: { categoryId?: string; categoryName?: string };
  categoryTreeNodeAncestors?: { categoryId?: string; categoryName?: string }[];
};

function isUsCoin(listing: CoinListing): boolean {
  return /\b(united states|usa|u\.s\.a?\.?|us)\b/i.test(listing.country ?? "");
}

export async function suggestCategory(ctx: Ctx, listing: CoinListing): Promise<{ categoryId: string; name: string }> {
  const queries = [listing.title, `${listing.year ?? ""} ${listing.coin_type ?? ""} ${listing.denomination ?? ""} coin`.trim()]
    .map((q) => (q ?? "").trim().slice(0, 350))
    .filter((q, i, arr) => q && arr.indexOf(q) === i);

  for (const q of queries) {
    try {
      const { data } = await api<{ categorySuggestions?: Suggestion[] }>(ctx, "GET", "/commerce/taxonomy/v1/category_tree/0/get_category_suggestions", {
        query: { q },
        label: "Taxonomy get_category_suggestions",
      });
      const list = data?.categorySuggestions ?? [];
      const underCoins = list.find((s) => (s.categoryTreeNodeAncestors ?? []).some((a) => a.categoryId === COINS_ROOT));
      const pick = underCoins ?? list[0];
      if (pick?.category?.categoryId) {
        const out = { categoryId: pick.category.categoryId, name: pick.category.categoryName ?? "" };
        slog("info", ctx.step, "Category chosen", { ...out, query: q, underCoins: Boolean(underCoins) });
        return out;
      }
    } catch (e) {
      // A taxonomy hiccup must not block the listing; fall through to the next query / fallback.
      slog("warn", ctx.step, "Category suggestion failed, trying fallback", e instanceof Error ? e.message : e);
    }
  }
  const fallback = isUsCoin(listing) ? FALLBACK_US : FALLBACK_WORLD;
  slog("warn", ctx.step, "No category suggestion; using department fallback", { categoryId: fallback });
  return { categoryId: fallback, name: fallback === FALLBACK_US ? "Coins: US" : "Coins: World" };
}

const DEFAULT_LOCATION_KEY = "coinlens-default";

export async function ensureLocation(ctx: Ctx): Promise<string> {
  const { data } = await api<{ locations?: { merchantLocationKey?: string; merchantLocationStatus?: string }[] }>(
    ctx,
    "GET",
    "/sell/inventory/v1/location",
    { label: "Inventory getInventoryLocations" },
  );
  const locs = data?.locations ?? [];
  const enabled = locs.find((l) => l.merchantLocationStatus === "ENABLED" && l.merchantLocationKey) ?? locs.find((l) => l.merchantLocationKey);
  if (enabled?.merchantLocationKey) {
    slog("info", ctx.step, "Using existing merchant location", { key: enabled.merchantLocationKey, count: locs.length });
    return enabled.merchantLocationKey;
  }
  await api(ctx, "POST", `/sell/inventory/v1/location/${DEFAULT_LOCATION_KEY}`, {
    label: "Inventory createInventoryLocation",
    body: {
      name: "CoinLens default",
      merchantLocationStatus: "ENABLED",
      locationTypes: ["WAREHOUSE"],
      location: { address: { country: "US", postalCode: ctx.cfg.postalCode } },
    },
  });
  slog("info", ctx.step, "Created merchant location", { key: DEFAULT_LOCATION_KEY, postalCode: ctx.cfg.postalCode });
  return DEFAULT_LOCATION_KEY;
}

export type Policies = { fulfillmentPolicyId: string; paymentPolicyId: string; returnPolicyId: string };

export async function fetchPolicies(ctx: Ctx): Promise<Policies> {
  const q = { marketplace_id: ctx.cfg.marketplaceId };
  const [f, p, r] = await Promise.all([
    api<{ fulfillmentPolicies?: { fulfillmentPolicyId?: string; name?: string }[] }>(ctx, "GET", "/sell/account/v1/fulfillment_policy", { query: q, label: "Account getFulfillmentPolicies" }),
    api<{ paymentPolicies?: { paymentPolicyId?: string; name?: string }[] }>(ctx, "GET", "/sell/account/v1/payment_policy", { query: q, label: "Account getPaymentPolicies" }),
    api<{ returnPolicies?: { returnPolicyId?: string; name?: string }[] }>(ctx, "GET", "/sell/account/v1/return_policy", { query: q, label: "Account getReturnPolicies" }),
  ]);
  const fulfillment = f.data?.fulfillmentPolicies?.[0];
  const payment = p.data?.paymentPolicies?.[0];
  const ret = r.data?.returnPolicies?.[0];
  const missing = [
    !fulfillment?.fulfillmentPolicyId && "shipping",
    !payment?.paymentPolicyId && "payment",
    !ret?.returnPolicyId && "return",
  ].filter(Boolean);
  if (missing.length) {
    slog("warn", ctx.step, "Business policies missing", { missing });
    throw new EbayError(
      ctx.step,
      409,
      `Create your shipping, payment and return business policies in eBay Seller Hub first (missing: ${missing.join(", ")}).`,
    );
  }
  slog("info", ctx.step, "Business policies", {
    fulfillment: fulfillment!.name,
    payment: payment!.name,
    return: ret!.name,
  });
  return {
    fulfillmentPolicyId: fulfillment!.fulfillmentPolicyId!,
    paymentPolicyId: payment!.paymentPolicyId!,
    returnPolicyId: ret!.returnPolicyId!,
  };
}

/* ------------------------------------------------------------------ */
/* Inventory item + offer + publish                                    */
/* ------------------------------------------------------------------ */

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Plain-text description → simple HTML paragraphs (eBay renders listingDescription as HTML). */
export function descriptionHtml(listing: CoinListing): string {
  const paras = (listing.description ?? "")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`);
  if (listing.problems?.length) {
    paras.push(`<p><b>Noted problems:</b> ${escapeHtml(listing.problems.join(", "))}</p>`);
  }
  paras.push("<p>Photos show the actual item you will receive.</p>");
  return paras.join("\n").slice(0, 400_000);
}

/** item_specifics → eBay aspects map (string arrays, clamped to eBay's 65-char limits). */
export function buildAspects(listing: CoinListing): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const { name, value } of listing.item_specifics ?? []) {
    const n = (name ?? "").trim().slice(0, 65);
    const v = (value ?? "").trim().slice(0, 65);
    if (!n || !v || /^(unknown|n\/a|none|-)$/i.test(v)) continue;
    if (!out[n]) out[n] = [v];
  }
  if (!out["Circulated/Uncirculated"] && typeof listing.circulated === "boolean") {
    out["Circulated/Uncirculated"] = [listing.circulated ? "Circulated" : "Uncirculated"];
  }
  if (!out["Year"] && listing.year && listing.year !== "Unknown") out["Year"] = [listing.year.slice(0, 65)];
  if (!out["Certification"] && listing.certification) out["Certification"] = [listing.certification.slice(0, 65)];
  return out;
}

/**
 * Inventory API condition. In the Coins & Paper Money department eBay maps LIKE_NEW → "Graded"
 * and USED_VERY_GOOD → "Ungraded". Some coin leaves do not take a condition at all; the publish
 * step retries without one when eBay complains about it.
 */
export function conditionFor(listing: CoinListing): "LIKE_NEW" | "USED_VERY_GOOD" {
  const slabbed = Boolean(listing.grading_service?.trim()) || /^(pcgs|ngc|anacs|icg|cacg?)\b/i.test(listing.certification ?? "");
  return slabbed ? "LIKE_NEW" : "USED_VERY_GOOD";
}

export function makeSku(): string {
  return `coinlens-${Date.now().toString(36)}`;
}

export function listingUrl(cfg: EbayConfig, listingId: string): string {
  return `${cfg.webHost}/itm/${listingId}`;
}

type ItemBody = {
  availability: { shipToLocationAvailability: { quantity: number } };
  condition?: string;
  product: { title: string; description: string; aspects: Record<string, string[]>; imageUrls: string[] };
};

export type ListInput = {
  listing: CoinListing;
  front: { mime: string; bytes: Buffer };
  back: { mime: string; bytes: Buffer };
  price: number;
  sku?: string;
};

export type ListResult = { listingId: string; url: string; sku: string; offerId: string; categoryId: string; warnings: string[] };

/** The whole one-tap flow after we hold an access token. Throws EbayError. */
export async function createAndPublishListing(cfg: EbayConfig, token: string, step: string, input: ListInput): Promise<ListResult> {
  const ctx: Ctx = { cfg, token, step };
  const t0 = Date.now();
  const { listing } = input;
  const sku = (input.sku ?? "").trim().replace(/[^A-Za-z0-9_-]/g, "").slice(0, 50) || makeSku();

  // b. pictures (in parallel), c/d/e. category, location, policies (in parallel with pictures)
  const [imageUrls, category, locationKey, policies] = await Promise.all([
    Promise.all([uploadPicture(ctx, "front", input.front), uploadPicture(ctx, "back", input.back)]),
    suggestCategory(ctx, listing),
    ensureLocation(ctx),
    fetchPolicies(ctx),
  ]);
  slog("info", step, `Prerequisites ready in ${Date.now() - t0} ms`, { sku, imageUrls, categoryId: category.categoryId, locationKey });

  // f. inventory item
  const title = (listing.title ?? "").trim().slice(0, 80) || "Coin";
  const item: ItemBody = {
    availability: { shipToLocationAvailability: { quantity: 1 } },
    condition: conditionFor(listing),
    product: {
      title,
      description: (listing.description ?? "").trim().slice(0, 4000) || title,
      aspects: buildAspects(listing),
      imageUrls,
    },
  };
  await api(ctx, "PUT", `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`, {
    body: item,
    label: "Inventory createOrReplaceInventoryItem",
  });

  // g. offer
  const offerBody = {
    sku,
    marketplaceId: cfg.marketplaceId,
    format: "FIXED_PRICE",
    availableQuantity: 1,
    categoryId: category.categoryId,
    listingDescription: descriptionHtml(listing),
    merchantLocationKey: locationKey,
    pricingSummary: { price: { value: input.price.toFixed(2), currency: "USD" } },
    listingPolicies: policies,
  };
  let offerId: string;
  try {
    const { data } = await api<{ offerId?: string }>(ctx, "POST", "/sell/inventory/v1/offer", {
      body: offerBody,
      label: "Inventory createOffer",
    });
    if (!data?.offerId) throw new EbayError(step, 502, "eBay did not return an offerId");
    offerId = data.offerId;
  } catch (e) {
    // 25002 = an offer for this SKU already exists (e.g. a retry). Reuse and update it.
    const existing = e instanceof EbayError && e.details.some((d) => String(d.errorId) === "25002");
    if (!existing) throw e;
    const { data } = await api<{ offers?: { offerId?: string }[] }>(ctx, "GET", "/sell/inventory/v1/offer", {
      query: { sku, marketplace_id: cfg.marketplaceId },
      label: "Inventory getOffers",
    });
    const id = data?.offers?.[0]?.offerId;
    if (!id) throw e;
    offerId = id;
    slog("info", step, "Reusing existing offer for SKU", { sku, offerId });
    await api(ctx, "PUT", `/sell/inventory/v1/offer/${offerId}`, { body: offerBody, label: "Inventory updateOffer" });
  }

  // publish (retry once without condition when eBay rejects it for this category)
  const publish = () =>
    api<{ listingId?: string; warnings?: { message?: string; longMessage?: string }[] }>(ctx, "POST", `/sell/inventory/v1/offer/${offerId}/publish`, {
      label: "Inventory publishOffer",
    });
  let published: Awaited<ReturnType<typeof publish>>;
  try {
    published = await publish();
  } catch (e) {
    const conditionIssue = e instanceof EbayError && e.details.some((d) => /condition/i.test(d.longMessage || d.message));
    if (!conditionIssue) throw e;
    slog("warn", step, "Publish rejected the condition; retrying without one");
    delete item.condition;
    await api(ctx, "PUT", `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`, {
      body: item,
      label: "Inventory createOrReplaceInventoryItem (no condition)",
    });
    published = await publish();
  }
  const listingId = published.data?.listingId;
  if (!listingId) throw new EbayError(step, 502, "eBay published the offer but returned no listingId");
  const warnings = (published.data?.warnings ?? []).map((w) => w.longMessage || w.message || "").filter(Boolean);
  const result: ListResult = { listingId, url: listingUrl(cfg, listingId), sku, offerId, categoryId: category.categoryId, warnings };
  slog("info", step, `Listing published in ${Date.now() - t0} ms`, result);
  return result;
}
