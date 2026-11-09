import type { CoinListing } from "./coinSchema";

/** Shared (client + server) types for spot prices and melt value. */

export type Metal = "silver" | "gold" | "platinum" | "palladium";

export const METALS: Metal[] = ["silver", "gold", "platinum", "palladium"];

export type SpotPrice = {
  metal: Metal;
  /** US dollars per troy ounce. */
  usd_per_oz: number;
  /** ISO timestamp of the quote. */
  as_of: string;
  source: string;
};

export type Market = {
  spot: SpotPrice | null;
  /** Intrinsic metal value of one coin at the spot price, or null for base metal / unknown content. */
  melt_value_usd: number | null;
};

export function isMetal(v: unknown): v is Metal {
  return typeof v === "string" && (METALS as string[]).includes(v);
}

/** Melt value = pure metal content (troy oz) x spot. */
export function meltValue(listing: Pick<CoinListing, "metal" | "precious_metal_oz">, spot: SpotPrice | null): number | null {
  if (!spot || !isMetal(listing.metal) || listing.metal !== spot.metal) return null;
  const oz = listing.precious_metal_oz;
  if (typeof oz !== "number" || !(oz > 0)) return null;
  return Math.round(oz * spot.usd_per_oz * 100) / 100;
}

export function money(n: number, digits = 2): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: digits, minimumFractionDigits: digits });
}
