import type { CoinListing } from "@/lib/coinSchema";
import { isMetal, meltValue, type Market } from "@/lib/market";
import { getSpot } from "./spot";

/** Melt value for the identified coin, if it contains precious metal. */
export async function marketFor(listing: Pick<CoinListing, "metal" | "precious_metal_oz">): Promise<Market | null> {
  if (!isMetal(listing.metal)) return null;
  const spot = await getSpot(listing.metal);
  return { spot, melt_value_usd: meltValue(listing, spot) };
}
