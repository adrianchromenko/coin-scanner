import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { authorizeUrl, callbackUrl, cookieSecure, getEbayConfig, STATE_COOKIE } from "@/lib/server/ebay";
import { requestId, slog } from "@/lib/serverLog";
import { SITE_URL } from "@/lib/siteUrl";

/**
 * Starts the eBay OAuth authorization-code flow: stores a random state in an
 * httpOnly cookie and sends the browser to eBay's consent page. eBay then
 * redirects (via the RuName) to /api/ebay/callback.
 */
export async function GET() {
  const step = `ebay-connect#${requestId()}`;
  const conf = getEbayConfig();
  if (!conf.ok) {
    slog("warn", step, "eBay not configured", { reason: conf.reason });
    return NextResponse.redirect(`${SITE_URL}/?ebay=error&reason=${encodeURIComponent("eBay is not configured on this server")}`);
  }

  const state = randomBytes(16).toString("hex");
  const url = authorizeUrl(conf.cfg, state);
  slog("info", step, "Redirecting to eBay authorize", { env: conf.cfg.env, ruName: conf.cfg.ruName, callback: callbackUrl() });

  const res = NextResponse.redirect(url);
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: "lax",
    path: "/",
    maxAge: 10 * 60,
  });
  return res;
}
