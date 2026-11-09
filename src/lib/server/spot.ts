import { METALS, type Metal, type SpotPrice } from "@/lib/market";
import { slog } from "@/lib/serverLog";

/**
 * Precious-metal spot prices from gold-api.com (free, no key). Cached in
 * memory for an hour per metal; a stale quote is served if the API is down.
 */

const SYMBOL: Record<Metal, string> = { silver: "XAG", gold: "XAU", platinum: "XPT", palladium: "XPD" };
const TTL_MS = 60 * 60 * 1000;
const cache = new Map<Metal, { quote: SpotPrice; fetchedAt: number }>();

export async function getSpot(metal: Metal): Promise<SpotPrice | null> {
  const hit = cache.get(metal);
  if (hit && Date.now() - hit.fetchedAt < TTL_MS) return hit.quote;
  try {
    const res = await fetch(`https://api.gold-api.com/price/${SYMBOL[metal]}`, {
      signal: AbortSignal.timeout(8000),
      headers: { accept: "application/json" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = (await res.json()) as { price?: number; updatedAt?: string };
    if (typeof j.price !== "number" || !(j.price > 0)) throw new Error("No price in response");
    const quote: SpotPrice = {
      metal,
      usd_per_oz: j.price,
      as_of: j.updatedAt ?? new Date().toISOString(),
      source: "gold-api.com",
    };
    cache.set(metal, { quote, fetchedAt: Date.now() });
    slog("info", "spot", `${metal} $${j.price.toFixed(2)}/oz`, { as_of: quote.as_of });
    return quote;
  } catch (e) {
    slog("warn", "spot", `Could not fetch ${metal} spot${hit ? " (serving stale quote)" : ""}`, e);
    return hit?.quote ?? null;
  }
}

export async function getAllSpots(): Promise<Record<Metal, SpotPrice | null>> {
  const entries = await Promise.all(METALS.map(async (m) => [m, await getSpot(m)] as const));
  return Object.fromEntries(entries) as Record<Metal, SpotPrice | null>;
}
