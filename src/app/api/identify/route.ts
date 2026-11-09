import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { CoinListingSchema, type CoinListing } from "@/lib/coinSchema";
import { gateScan, recordScan } from "@/lib/server/auth";
import { marketFor } from "@/lib/server/pricing";
import { requestId, slog } from "@/lib/serverLog";

export const maxDuration = 180;

const MODEL = "claude-opus-5-5";
/** Set PRICE_SEARCH=0 to skip web search for sold prices (faster, cheaper, less accurate). */
const PRICE_SEARCH = process.env.PRICE_SEARCH !== "0";
const MAX_SEARCHES = 6;

const SYSTEM_PROMPT = `You are an expert numismatist helping an online seller list coins on eBay and similar marketplaces.

You will receive two photos of the same coin: the obverse (front) and the reverse (back), and sometimes a third close-up of the date / mint mark area. Identify the coin as precisely as the photos allow and fill out every field of the listing.

Identification
- Read legends, dates, mint marks, denominations and design elements carefully. Say which ones you relied on in identification_notes.
- If you are unsure between candidates, pick the most likely one, lower the confidence score, and explain the alternatives in identification_notes.
- Varieties matter for value. When a date/mint combination has a known key variety (overdate, doubled die, repunched mint mark, small/large date, VAM) that you cannot confirm or rule out from these photos, set needs_closeup to true and say exactly what to photograph in closeup_reason. Otherwise needs_closeup is false.
- Slabs: if the coin is in a PCGS / NGC / ANACS / ICG / CACG holder, read the label: grading_service, cert_number (digits as printed) and slab_grade. Use the slab grade as grade_estimate and set certification to the service name. For a raw coin these three fields are empty strings and certification is "Uncertified".
- Metal: set metal to the primary precious metal and precious_metal_oz to the troy ounces of pure metal in one coin (standard figures, e.g. 0.7734 for a Morgan or Peace dollar, 0.1808 for a 90% silver quarter, 0.9675 for a $20 Saint-Gaudens). Base-metal coins: metal "none", precious_metal_oz null.

Grading and problems
- Grade conservatively. Photos hide hairlines and cleaning; never grade higher than the evidence supports. Put the reasoning in grade_reasoning.
- Flag anything that looks cleaned, damaged, altered, or possibly counterfeit in problems. Sellers get penalized for undisclosed problems.

Pricing
${
  PRICE_SEARCH
    ? `- You have a web_search tool. Once you know the coin, search for recent SOLD prices for this exact date, mint mark and approximate grade: eBay sold/completed listings, the PCGS and NGC price guides, Heritage or GreatCollections archives. Use up to ${MAX_SEARCHES} searches; one or two well-chosen searches are usually enough. Skip the search only when the coin is unidentifiable.
- estimated_value_usd is the range you actually saw for comparable sold examples at the estimated grade. suggested_price_usd is a realistic buy-it-now price inside or slightly above that range. Never price a precious-metal coin below its melt value.
- price_basis: one or two sentences on what the numbers rest on (how many comparables, which guide, and how much the grade moves the price). price_sources: the pages you used with the price seen on each; most relevant first.`
    : `- Value estimates are rough retail guidance for the estimated grade from your own knowledge. Describe the basis in price_basis and leave price_sources empty.`
}
- If the coin is common and low value, say so plainly.

Writing the listing
- The title must be 80 characters or fewer, read naturally, and front-load the most searched terms (year, mint mark, denomination, type, grade). No ALL CAPS, no exclamation marks, no "L@@K".
- The description is plain text, honest, and specific. Describe what the buyer will receive. Do not invent provenance.
- item_specifics should use eBay's Coins & Paper Money field names where they apply, for example: "Country/Region of Manufacture", "Year", "Denomination", "Composition", "Circulated/Uncirculated", "Certification", "Grade", "Mint Location", "Coin", "Variety", "KM Number", "Era", "Fineness", "Precious Metal Content per Unit", "Strike Type", "Modified Item".
- If the images do not show a coin or are unreadable, set identified to false, confidence to 0, and explain what is wrong in identification_notes. Fill the other fields with "Unknown" or sensible empty values.`;

type ImageMediaType = "image/jpeg" | "image/png" | "image/webp" | "image/gif";

function parseDataUrl(dataUrl: unknown): { media_type: ImageMediaType; data: string } {
  if (typeof dataUrl !== "string") throw new Error("Image must be a data URL string");
  const m = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) throw new Error("Image must be a base64 JPEG, PNG, WebP or GIF data URL");
  return { media_type: m[1] as ImageMediaType, data: m[2] };
}

function kb(base64: string) {
  return Math.round((base64.length * 3) / 4 / 1024);
}

type Image = ReturnType<typeof parseDataUrl>;

export async function POST(req: Request) {
  const rid = requestId();
  const t0 = Date.now();
  const step = `identify#${rid}`;
  const fail = (status: number, error: string, data?: unknown, code?: string) => {
    slog(status >= 500 ? "error" : "warn", step, `${status} ${error}`, data);
    return Response.json({ error, code, requestId: rid }, { status });
  };

  slog("info", step, "Request received", {
    ua: req.headers.get("user-agent"),
    contentLength: req.headers.get("content-length"),
  });

  if (!process.env.ANTHROPIC_API_KEY) {
    return fail(500, "ANTHROPIC_API_KEY is not set. Add it to .env.local and restart the dev server.");
  }

  const gate = await gateScan(req, step);
  if (!gate.ok) return gate.response;
  const user = gate.user;

  let front: Image;
  let back: Image;
  let closeup: Image | null = null;
  let previous: CoinListing | null = null;
  let hints = "";
  let search = PRICE_SEARCH;
  try {
    const body = (await req.json()) as {
      front?: unknown;
      back?: unknown;
      closeup?: unknown;
      previous?: unknown;
      hints?: unknown;
      search?: unknown;
    };
    front = parseDataUrl(body.front);
    back = parseDataUrl(body.back);
    if (body.closeup) closeup = parseDataUrl(body.closeup);
    if (body.previous && typeof body.previous === "object") {
      const parsed = CoinListingSchema.safeParse(body.previous);
      previous = parsed.success ? parsed.data : null;
    }
    if (typeof body.hints === "string") hints = body.hints.trim().slice(0, 1000);
    if (body.search === false) search = false;
  } catch (err) {
    return fail(400, err instanceof Error ? err.message : "Invalid request body", err);
  }

  slog("info", step, "Images parsed", {
    user: user ? `${user.email ?? user.uid} (${user.via})` : "anonymous",
    front: `${front.media_type} ${kb(front.data)} KB`,
    back: `${back.media_type} ${kb(back.data)} KB`,
    closeup: closeup ? `${closeup.media_type} ${kb(closeup.data)} KB` : "none",
    previous: previous ? previous.title : "none",
    hints: hints.length ? `${hints.length} chars` : "none",
    search,
  });

  const client = new Anthropic();

  const content: Anthropic.Beta.BetaContentBlockParam[] = [
    { type: "text", text: `Photo 1 of ${closeup ? 3 : 2}: obverse (front) of the coin.` },
    { type: "image", source: { type: "base64", media_type: front.media_type, data: front.data } },
    { type: "text", text: `Photo 2 of ${closeup ? 3 : 2}: reverse (back) of the same coin.` },
    { type: "image", source: { type: "base64", media_type: back.media_type, data: back.data } },
  ];
  if (closeup) {
    content.push(
      { type: "text", text: "Photo 3 of 3: close-up of the date and mint mark area of the same coin." },
      { type: "image", source: { type: "base64", media_type: closeup.media_type, data: closeup.data } },
    );
  }
  let ask = "Identify this coin and fill out the complete listing.";
  if (previous) {
    ask =
      "You identified this coin before from the first two photos; the seller has now added the close-up you asked for. " +
      "Re-examine the date, mint mark and any variety markers at this higher detail, then return the complete, corrected listing. " +
      "Keep what still holds, change what the close-up changes, and set needs_closeup to false unless something else is still unresolved.\n\n" +
      `Previous listing (JSON): ${JSON.stringify(previous)}`;
  }
  content.push({ type: "text", text: ask + (hints ? `\n\nNotes from the seller: ${hints}` : "") });

  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content }];
  const tools = search ? [{ type: "web_search_20260209" as const, name: "web_search" as const, max_uses: MAX_SEARCHES }] : undefined;

  try {
    slog("info", step, `Calling ${MODEL}${search ? " with web search" : ""}`);
    const tModel = Date.now();
    let response = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      // Server-side fallback: if a safety classifier declines, the API re-runs
      // the request on a fallback model inside the same call.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      tools,
      output_config: {
        effort: "high",
        format: betaZodOutputFormat(CoinListingSchema),
      },
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages,
    });

    // The server-side search loop pauses after ~10 iterations; resume by echoing the turn back.
    for (let resumes = 0; response.stop_reason === "pause_turn" && resumes < 2; resumes++) {
      slog("info", step, "pause_turn: resuming the search loop");
      messages.push({ role: "assistant", content: response.content });
      response = await client.beta.messages.parse({
        model: MODEL,
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        tools,
        output_config: { effort: "high", format: betaZodOutputFormat(CoinListingSchema) },
        system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        messages,
      });
    }

    const searches = response.content.filter((b) => b.type === "server_tool_use").length;
    slog("info", step, `Model responded in ${Date.now() - tModel} ms`, {
      model: response.model,
      stop_reason: response.stop_reason,
      searches,
      usage: response.usage,
    });

    const usage = response.usage as unknown as Parameters<typeof recordScan>[2]["usage"];
    const ms = Date.now() - t0;

    if (response.stop_reason === "refusal") {
      const why = response.stop_details?.type === "refusal" ? response.stop_details.explanation : undefined;
      void recordScan(req, user, { kind: "identify", model: response.model, usage, ms, ok: false });
      return fail(422, `The model declined this request${why ? `: ${why}` : "."}`, response.stop_details);
    }
    if (response.stop_reason === "max_tokens") {
      void recordScan(req, user, { kind: "identify", model: response.model, usage, ms, ok: false });
      return fail(502, "The model ran out of output tokens. Try again.");
    }
    if (!response.parsed_output) {
      void recordScan(req, user, { kind: "identify", model: response.model, usage, ms, ok: false });
      return fail(502, "The model returned an unparseable response. Try again.");
    }

    const listing = response.parsed_output;
    const market = await marketFor(listing);
    if (market?.melt_value_usd && listing.suggested_price_usd < market.melt_value_usd) {
      slog("warn", step, "Suggested price is below melt; raising to melt", {
        suggested: listing.suggested_price_usd,
        melt: market.melt_value_usd,
      });
      listing.suggested_price_usd = Math.ceil(market.melt_value_usd);
      listing.price_basis = `${listing.price_basis} Raised to the silver/gold melt value of $${market.melt_value_usd.toFixed(2)} at today's spot.`.trim();
    }

    void recordScan(req, user, { kind: "identify", model: response.model, usage, ms, title: listing.title, ok: true });
    slog("info", step, `Done in ${ms} ms`, {
      identified: listing.identified,
      confidence: listing.confidence,
      title: listing.title,
      grade: listing.grade_estimate,
      price: listing.suggested_price_usd,
      range: listing.estimated_value_usd,
      sources: listing.price_sources.length,
      melt: market?.melt_value_usd ?? null,
      needsCloseup: listing.needs_closeup,
      slab: listing.grading_service ? `${listing.grading_service} ${listing.cert_number}` : "raw",
      problems: listing.problems,
    });

    return Response.json({
      listing,
      market,
      remaining: gate.remaining,
      requestId: rid,
      model: response.model,
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
        cache_read_input_tokens: response.usage.cache_read_input_tokens,
        searches,
      },
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      return fail(500, "Anthropic rejected the API key. Check ANTHROPIC_API_KEY in .env.local.", err);
    }
    if (err instanceof Anthropic.RateLimitError) {
      return fail(429, "Rate limited by the Anthropic API. Wait a moment and retry.", err);
    }
    if (err instanceof Anthropic.BadRequestError) {
      return fail(400, `Bad request to the Anthropic API: ${err.message}`, err);
    }
    if (err instanceof Anthropic.APIError) {
      return fail(502, `Anthropic API error ${err.status}: ${err.message}`, err);
    }
    if (err instanceof Anthropic.APIConnectionError) {
      return fail(502, "Could not reach the Anthropic API.", err);
    }
    return fail(500, "Unexpected server error.", err);
  }
}
