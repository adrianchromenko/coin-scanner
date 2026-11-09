import { NextResponse, type NextRequest } from "next/server";
import {
  cookieSecure,
  EbayError,
  encryptToken,
  exchangeCode,
  getEbayConfig,
  RT_COOKIE,
  RT_COOKIE_MAX_AGE,
  STATE_COOKIE,
} from "@/lib/server/ebay";
import { requestId, slog } from "@/lib/serverLog";
import { SITE_URL } from "@/lib/siteUrl";

/**
 * OAuth redirect target. The eBay RuName's "Your auth accepted URL" must be
 * `${SITE_URL}/api/ebay/callback`. Verifies state, swaps the code for tokens and
 * stores the encrypted refresh token in the `ebay_rt` cookie.
 */
export async function GET(req: NextRequest) {
  const step = `ebay-callback#${requestId()}`;
  const t0 = Date.now();
  const params = req.nextUrl.searchParams;

  const home = (q: string) => NextResponse.redirect(`${SITE_URL}/?${q}`);
  const fail = (reason: string, data?: unknown) => {
    slog("warn", step, `OAuth callback failed: ${reason}`, data);
    const res = home(`ebay=error&reason=${encodeURIComponent(reason)}`);
    res.cookies.delete(STATE_COOKIE);
    return res;
  };

  const conf = getEbayConfig();
  if (!conf.ok) return fail("eBay is not configured on this server", { reason: conf.reason });

  // eBay sends ?error=access_denied when the user declines consent.
  const oauthError = params.get("error");
  if (oauthError) return fail(params.get("error_description") || oauthError);

  const code = params.get("code");
  const state = params.get("state");
  const expected = req.cookies.get(STATE_COOKIE)?.value;
  if (!code) return fail("eBay did not return an authorization code");
  if (!state || !expected || state !== expected) {
    return fail("Sign-in session expired or state mismatch. Try connecting again.", {
      hasState: Boolean(state),
      hasCookie: Boolean(expected),
    });
  }

  try {
    const tok = await exchangeCode(conf.cfg, step, code);
    if (!tok.refresh_token) return fail("eBay did not return a refresh token");

    const res = home("ebay=connected");
    res.cookies.delete(STATE_COOKIE);
    res.cookies.set(RT_COOKIE, encryptToken(tok.refresh_token, conf.cfg.tokenSecret), {
      httpOnly: true,
      secure: cookieSecure(),
      sameSite: "lax",
      path: "/",
      maxAge: Math.min(RT_COOKIE_MAX_AGE, tok.refresh_token_expires_in || RT_COOKIE_MAX_AGE),
    });
    slog("info", step, `eBay account connected in ${Date.now() - t0} ms`, {
      env: conf.cfg.env,
      refreshTokenExpiresIn: tok.refresh_token_expires_in,
    });
    return res;
  } catch (e) {
    const msg = e instanceof EbayError ? e.message : "Token exchange failed";
    slog("error", step, "Token exchange error", e);
    return fail(msg);
  }
}
