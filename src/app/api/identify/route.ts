import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { CoinListingSchema } from "@/lib/coinSchema";
import { requestId, slog } from "@/lib/serverLog";

export const maxDuration = 120;

const MODEL = "claude-opus-5-5";

const SYSTEM_PROMPT = `You are an expert numismatist helping an online seller list coins on eBay and similar marketplaces.

You will receive two photos of the same coin: the obverse (front) and the reverse (back). Identify the coin as precisely as the photos allow and fill out every field of the listing.

Guidelines:
- Read legends, dates, mint marks, denominations and design elements carefully. Say which ones you relied on in identification_notes.
- If you are unsure between candidates, pick the most likely one, lower the confidence score, and explain the alternatives in identification_notes.
- Grade conservatively. Photos hide hairlines and cleaning; never grade higher than the evidence supports. Put the reasoning in grade_reasoning.
- Flag anything that looks cleaned, damaged, altered, or possibly counterfeit in problems. Sellers get penalized for undisclosed problems.
- The title must be 80 characters or fewer, read naturally, and front-load the most searched terms (year, mint mark, denomination, type, grade). No ALL CAPS, no exclamation marks, no "L@@K".
- The description is plain text, honest, and specific. Describe what the buyer will receive. Do not invent provenance.
- item_specifics should use eBay's Coins & Paper Money field names where they apply, for example: "Country/Region of Manufacture", "Year", "Denomination", "Composition", "Circulated/Uncirculated", "Certification", "Grade", "Mint Location", "Coin", "Variety", "KM Number", "Era", "Fineness", "Precious Metal Content per Unit", "Strike Type", "Modified Item".
- Value estimates are rough retail guidance for the estimated grade, not appraisals. If the coin is common and low value, say so plainly.
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

export async function POST(req: Request) {
  const rid = requestId();
  const t0 = Date.now();
  const step = `identify#${rid}`;
  const fail = (status: number, error: string, data?: unknown) => {
    slog(status >= 500 ? "error" : "warn", step, `${status} ${error}`, data);
    return Response.json({ error, requestId: rid }, { status });
  };

  slog("info", step, "Request received", {
    ua: req.headers.get("user-agent"),
    contentLength: req.headers.get("content-length"),
  });

  if (!process.env.ANTHROPIC_API_KEY) {
    return fail(500, "ANTHROPIC_API_KEY is not set. Add it to .env.local and restart the dev server.");
  }

  let front: ReturnType<typeof parseDataUrl>;
  let back: ReturnType<typeof parseDataUrl>;
  let hints = "";
  try {
    const body = (await req.json()) as { front?: unknown; back?: unknown; hints?: unknown };
    front = parseDataUrl(body.front);
    back = parseDataUrl(body.back);
    if (typeof body.hints === "string") hints = body.hints.trim().slice(0, 1000);
  } catch (err) {
    return fail(400, err instanceof Error ? err.message : "Invalid request body", err);
  }

  slog("info", step, "Images parsed", {
    front: `${front.media_type} ${kb(front.data)} KB`,
    back: `${back.media_type} ${kb(back.data)} KB`,
    hints: hints.length ? `${hints.length} chars` : "none",
  });

  const client = new Anthropic();

  const content: Anthropic.Beta.BetaContentBlockParam[] = [
    { type: "text", text: "Photo 1 of 2: obverse (front) of the coin." },
    { type: "image", source: { type: "base64", media_type: front.media_type, data: front.data } },
    { type: "text", text: "Photo 2 of 2: reverse (back) of the same coin." },
    { type: "image", source: { type: "base64", media_type: back.media_type, data: back.data } },
    {
      type: "text",
      text:
        "Identify this coin and fill out the complete listing." +
        (hints ? `\n\nNotes from the seller: ${hints}` : ""),
    },
  ];

  try {
    slog("info", step, `Calling ${MODEL}`);
    const tModel = Date.now();
    const response = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      // Server-side fallback: if a safety classifier declines, the API re-runs
      // the request on a fallback model inside the same call.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: {
        effort: "high",
        format: betaZodOutputFormat(CoinListingSchema),
      },
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content }],
    });

    slog("info", step, `Model responded in ${Date.now() - tModel} ms`, {
      model: response.model,
      stop_reason: response.stop_reason,
      usage: response.usage,
    });

    if (response.stop_reason === "refusal") {
      const why = response.stop_details?.type === "refusal" ? response.stop_details.explanation : undefined;
      return fail(422, `The model declined this request${why ? `: ${why}` : "."}`, response.stop_details);
    }
    if (response.stop_reason === "max_tokens") {
      return fail(502, "The model ran out of output tokens. Try again.");
    }
    if (!response.parsed_output) {
      return fail(502, "The model returned an unparseable response. Try again.");
    }

    const listing = response.parsed_output;
    slog("info", step, `Done in ${Date.now() - t0} ms`, {
      identified: listing.identified,
      confidence: listing.confidence,
      title: listing.title,
      grade: listing.grade_estimate,
      price: listing.suggested_price_usd,
      problems: listing.problems,
    });

    return Response.json({
      listing,
      requestId: rid,
      model: response.model,
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
        cache_read_input_tokens: response.usage.cache_read_input_tokens,
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
