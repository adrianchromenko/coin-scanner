import { NextResponse } from "next/server";
import { RT_COOKIE, STATE_COOKIE } from "@/lib/server/ebay";
import { requestId, slog } from "@/lib/serverLog";

/** Forgets the stored eBay refresh token for this browser. */
export async function POST() {
  slog("info", `ebay-disconnect#${requestId()}`, "Clearing eBay cookie");
  const res = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  res.cookies.delete(RT_COOKIE);
  res.cookies.delete(STATE_COOKIE);
  return res;
}
