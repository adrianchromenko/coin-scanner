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
  identification_notes: z
    .string()
    .describe(
      "Which visible features (legends, portraits, dates, mint marks, design elements) were used to identify the coin, and anything that is uncertain",
    ),
});

export type CoinListing = z.infer<typeof CoinListingSchema>;

export type ItemSpecific = CoinListing["item_specifics"][number];
