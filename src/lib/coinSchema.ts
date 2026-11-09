import { z } from "zod";

/**
 * Structured listing data the AI fills out from the obverse/reverse photos.
 * Shared by the API route (as the output schema) and the UI (as the form shape).
 */
export const CoinListingSchema = z.object({
  identified: z
    .boolean()
    .describe(
      "False if the images do not clearly show a coin, or if it cannot be identified at all",
    ),
  confidence: z
    .number()
    .describe("Overall identification confidence between 0 and 1"),
  title: z
    .string()
    .describe(
      "eBay listing title, max 80 characters. Keyword-rich: year, mint mark, denomination, type, grade. No ALL CAPS, no exclamation marks",
    ),
  country: z.string().describe("Issuing country or region"),
  denomination: z
    .string()
    .describe('e.g. "1 Dollar", "50 Pence", "5 Reichsmark"'),
  year: z
    .string()
    .describe('Year as shown on the coin, e.g. "1921". "Unknown" if illegible'),
  mint_mark: z
    .string()
    .describe('Mint mark if visible, e.g. "S", "D", "CC". "None" or "Unknown" otherwise'),
  coin_type: z
    .string()
    .describe('Series or type name, e.g. "Morgan Dollar", "Lincoln Wheat Cent"'),
  variety: z
    .string()
    .describe("Known variety or sub-type if any, otherwise an empty string"),
  composition: z
    .string()
    .describe('Metal composition, e.g. "90% Silver, 10% Copper"'),
  diameter_mm: z.number().nullable().describe("Standard diameter in mm"),
  weight_g: z.number().nullable().describe("Standard weight in grams"),
  precious_metal_content: z
    .string()
    .describe('e.g. "0.7734 oz ASW" or "None"'),
  metal: z
    .enum(["silver", "gold", "platinum", "palladium", "none"])
    .describe("Primary precious metal in the coin, or none for base-metal coins"),
  precious_metal_oz: z
    .number()
    .nullable()
    .describe(
      "Troy ounces of pure precious metal in one coin (e.g. 0.7734 for a Morgan dollar). null for base-metal coins or if unknown",
    ),
  era: z
    .string()
    .describe('e.g. "Modern (1900-Now)", "Early (1800-1899)", "Ancient", "Medieval"'),
  circulated: z.boolean().describe("True if the coin shows wear from circulation"),
  grade_estimate: z
    .string()
    .describe(
      'Conservative grade estimate from the photos on the Sheldon scale, e.g. "VF-20", "AU-50", "MS-63"',
    ),
  grade_reasoning: z
    .string()
    .describe("What wear, luster, marks or problems drove the grade estimate"),
  problems: z
    .array(z.string())
    .describe(
      'Observed problems such as "cleaned", "scratched", "corrosion", "bent", "possible counterfeit". Empty if none',
    ),
  certification: z
    .string()
    .describe('"Uncertified" unless a grading slab (PCGS, NGC, etc.) is visible'),
  grading_service: z
    .string()
    .describe(
      'Grading service printed on a visible slab: "PCGS", "NGC", "ANACS", "ICG", "CACG". Empty string if the coin is raw (not slabbed)',
    ),
  cert_number: z
    .string()
    .describe(
      "Certification / serial number printed on the slab label, digits only as printed. Empty string if none is visible",
    ),
  slab_grade: z
    .string()
    .describe('Grade printed on the slab label, e.g. "MS 64", "AU 58 Details". Empty if raw'),
  km_number: z
    .string()
    .describe("Krause-Mishler (KM#) catalog number if known, otherwise empty"),
  description: z
    .string()
    .describe(
      "Plain-text listing description, 2 to 4 short paragraphs. Honest and specific. Mention the photos show the actual item. No HTML",
    ),
  item_specifics: z
    .array(z.object({ name: z.string(), value: z.string() }))
    .describe(
      "eBay item specifics for the Coins & Paper Money category, as name/value pairs",
    ),
  estimated_value_usd: z
    .object({ low: z.number(), high: z.number() })
    .describe("Rough retail value range in USD at the estimated grade. Use 0 and 0 if unknown"),
  suggested_price_usd: z
    .number()
    .describe("Suggested buy-it-now price in USD"),
  price_basis: z
    .string()
    .describe(
      "One or two sentences on how the price was set: which recent sold listings, price guides or spot price it rests on, and how much the grade matters",
    ),
  price_sources: z
    .array(
      z.object({
        title: z.string().describe("Short label, e.g. 'eBay sold: 1921 Morgan VF, Oct 2026'"),
        url: z.string().describe("Page URL the figure came from"),
        price_usd: z.number().nullable().describe("Price seen on that page, or null"),
      }),
    )
    .describe("Web pages used for pricing, most relevant first. Empty if no search was done"),
  needs_closeup: z
    .boolean()
    .describe(
      "True when a close-up of the date / mint mark area would change the identification or value materially (possible key date, overdate, doubled die, repunched mint mark, or an unreadable mint mark)",
    ),
  closeup_reason: z
    .string()
    .describe("If needs_closeup, what to photograph and why in one sentence. Otherwise empty"),
  identification_notes: z
    .string()
    .describe(
      "Which visible features (legends, portraits, dates, mint marks, design elements) were used to identify the coin, and anything that is uncertain",
    ),
});

export type CoinListing = z.infer<typeof CoinListingSchema>;

export type ItemSpecific = CoinListing["item_specifics"][number];

export type PriceSource = CoinListing["price_sources"][number];

/** Defaults for fields that older saved listings (before Nov 2026) did not have. */
const DEFAULTS: Pick<
  CoinListing,
  | "metal"
  | "precious_metal_oz"
  | "grading_service"
  | "cert_number"
  | "slab_grade"
  | "price_basis"
  | "price_sources"
  | "needs_closeup"
  | "closeup_reason"
> = {
  metal: "none",
  precious_metal_oz: null,
  grading_service: "",
  cert_number: "",
  slab_grade: "",
  price_basis: "",
  price_sources: [],
  needs_closeup: false,
  closeup_reason: "",
};

/** Fill in any field a stored listing is missing so the UI never sees undefined. */
export function normalizeListing(raw: Partial<CoinListing> | null | undefined): CoinListing {
  const l = { ...DEFAULTS, ...(raw ?? {}) } as CoinListing;
  l.problems ??= [];
  l.item_specifics ??= [];
  l.estimated_value_usd ??= { low: 0, high: 0 };
  l.suggested_price_usd ??= 0;
  return l;
}

/** Link to the grading service's certificate lookup for a slabbed coin, if we know the service. */
export function certLookupUrl(service: string, cert: string): string | null {
  const n = cert.replace(/[^0-9A-Za-z-]/g, "");
  if (!n) return null;
  switch (service.trim().toUpperCase()) {
    case "PCGS":
      return `https://www.pcgs.com/cert/${n}`;
    case "NGC":
      return `https://www.ngccoin.com/certlookup/${n}/`;
    case "ANACS":
      return `https://www.anacs.com/verify/?cert=${n}`;
    case "ICG":
      return `https://www.icgcoin.com/verify/?cert=${n}`;
    case "CACG":
    case "CAC":
      return `https://www.cacgrading.com/verify/${n}`;
    default:
      return null;
  }
}
