import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { CoinListingSchema } from "@/lib/coinSchema";
import { gateScan, recordScan } from "@/lib/server/auth";
import { marketFor } from "@/lib/server/pricing";
import { requestId, slog } from "@/lib/serverLog";

export const maxDuration = 120;

const MODEL = "claude-opus-5-5";
const MAX_SEARCHES = 6;

/** Re-price an already identified coin from fresh sold-price data. */
const RevalueSchema = CoinListingSchema.pick({
  estimated_value_usd: true,
  suggested_price_usd: true,
  price_basis: true,
  price_sources: true,
});

const SYSTEM_PROMPT = `You are an expert numismatist and an experienced online coin seller. You re-price a coin that has already been identified and graded.

Use the web_search tool to find recent SOLD prices for this exact coin at the given grade: eBay sold/completed listings, the PCGS and NGC price guides, Heritage or GreatCollections archives. Use up to ${MAX_SEARCHES} searches; one or two well-chosen searches are usually enough.

- estimated_value_usd: the range you actually saw for comparable sold examples at this grade.
- suggested_price_usd: a realistic buy-it-now price inside or slightly above that range. Never below the melt value given to you.
- price_basis: one or two sentences on what the numbers rest on (how many comparables, which guide, how much the grade moves the price, today's date).
- price_sources: the pages you used with the price seen on each, most relevant first.`;

export async function POST(req: Request) {
  const rid = requestId();
  const t0 = Date.now();
  const step = `revalue#${rid}`;
  const fail = (status: number, error: string, data?: unknown) => {
    slog(status >= 500 ? "error" : "warn", step, `${status} ${error}`, data);
    return Response.json({ error, requestId: rid }, { status });
  };

  if (!process.env.ANTHROPIC_API_KEY) return fail(500, "ANTHROPIC_API_KEY is not set.");

  const gate = await gateScan(req, step);
  if (!gate.ok) return gate.response;
  const user = gate.user;

  let listing: z.infer<typeof CoinListingSchema>;
  try {
    const body = (await req.json()) as { listing?: unknown };
    const parsed = CoinListingSchema.safeParse(body.listing);
    if (!parsed.success) throw new Error("listing is missing or malformed");
    listing = parsed.data;
  } catch (err) {
    return fail(400, err instanceof Error ? err.message : "Invalid request body", err);
  }

  const market = await marketFor(listing);
  const summary = [
    `Coin: ${listing.title}`,
    `Country: ${listing.country}; Denomination: ${listing.denomination}; Year: ${listing.year}; Mint mark: ${listing.mint_mark}`,
    `Type: ${listing.coin_type}${listing.variety ? `; Variety: ${listing.variety}` : ""}`,
    `Grade: ${listing.grade_estimate}${listing.grading_service ? ` (${listing.grading_service} ${listing.cert_number} ${listing.slab_grade})` : " (raw, estimated from photos)"}`,
    listing.problems.length ? `Problems: ${listing.problems.join(", ")}` : "Problems: none noted",
    `Composition: ${listing.composition}; ${listing.precious_metal_content}`,
    market?.melt_value_usd
      ? `Melt value today: $${market.melt_value_usd.toFixed(2)} (${market.spot?.metal} at $${market.spot?.usd_per_oz.toFixed(2)}/oz)`
      : "Melt value: not applicable",
    `Previous estimate: $${listing.estimated_value_usd.low}–$${listing.estimated_value_usd.high}, listed at $${listing.suggested_price_usd}`,
    `Today: ${new Date().toISOString().slice(0, 10)}`,
  ].join("\n");

  slog("info", step, "Re-pricing", { user: user ? user.email ?? user.uid : "anonymous", title: listing.title, melt: market?.melt_value_usd ?? null });

  const client = new Anthropic();
  try {
    const tModel = Date.now();
    const response = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 8000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: MAX_SEARCHES }],
      output_config: { effort: "medium", format: betaZodOutputFormat(RevalueSchema) },
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: `Re-price this coin from current sold data.\n\n${summary}` }],
    });
    const searches = response.content.filter((b) => b.type === "server_tool_use").length;
    const usage = response.usage as unknown as Parameters<typeof recordScan>[2]["usage"];
    const ms = Date.now() - t0;
    slog("info", step, `Model responded in ${Date.now() - tModel} ms`, { stop_reason: response.stop_reason, searches, usage: response.usage });

    if (response.stop_reason === "refusal" || !response.parsed_output) {
      void recordScan(req, user, { kind: "revalue", model: response.model, usage, ms, ok: false });
      return fail(502, "The model could not re-price this coin. Try again.");
    }
    const out = response.parsed_output;
    if (market?.melt_value_usd && out.suggested_price_usd < market.melt_value_usd) {
      out.suggested_price_usd = Math.ceil(market.melt_value_usd);
    }
    void recordScan(req, user, { kind: "revalue", model: response.model, usage, ms, title: listing.title, ok: true });
    slog("info", step, `Done in ${ms} ms`, { range: out.estimated_value_usd, price: out.suggested_price_usd, sources: out.price_sources.length });
    return Response.json({ ...out, market, remaining: gate.remaining, requestId: rid });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return fail(429, "Rate limited by the Anthropic API. Wait a moment and retry.", err);
    if (err instanceof Anthropic.APIError) return fail(502, `Anthropic API error ${err.status}: ${err.message}`, err);
    if (err instanceof Anthropic.APIConnectionError) return fail(502, "Could not reach the Anthropic API.", err);
    return fail(500, "Unexpected server error.", err);
  }
}
