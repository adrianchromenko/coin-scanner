import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { LocateSchema, type CoinBox } from "@/lib/locateSchema";
import { requestId, slog } from "@/lib/serverLog";

export const maxDuration = 60;

const MODEL = "claude-opus-5-5";

const SYSTEM_PROMPT = `You locate coins in photos so they can be cropped for a marketplace listing.

You will receive two photos: the front and the back of a coin. For each photo, return the tightest axis-aligned bounding box around the coin's outer rim, as fractions of the image size:
- left and right are fractions of the image WIDTH (0 = left edge, 1 = right edge)
- top and bottom are fractions of the image HEIGHT (0 = top edge, 1 = bottom edge)
Use three decimals. Measure the rim itself, not shadows, holders, flips, fingers or reflections. The box should touch the coin's edge on all four sides; do not add margin.

If the coin is partly outside the frame, still return the box clipped to 0..1 and set found to true.
If several coins are visible, choose the largest, most central one.
If there is no coin, set found to false and all edges to 0.`;

type ImageMediaType = "image/jpeg" | "image/png" | "image/webp" | "image/gif";

function parseDataUrl(dataUrl: unknown): { media_type: ImageMediaType; data: string } {
  if (typeof dataUrl !== "string") throw new Error("Image must be a data URL string");
  const m = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) throw new Error("Image must be a base64 JPEG, PNG, WebP or GIF data URL");
  return { media_type: m[1] as ImageMediaType, data: m[2] };
}

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

/** Clamp to 0..1 and reject boxes that are degenerate or absurdly small. */
function sanitise(box: CoinBox): CoinBox {
  const b = {
    ...box,
    left: clamp01(box.left),
    top: clamp01(box.top),
    right: clamp01(box.right),
    bottom: clamp01(box.bottom),
  };
  const w = b.right - b.left;
  const h = b.bottom - b.top;
  if (!b.found || w < 0.05 || h < 0.05) {
    return { ...b, found: false, notes: b.found ? `Rejected degenerate box (${b.notes})` : b.notes };
  }
  return b;
}

export async function POST(req: Request) {
  const rid = requestId();
  const t0 = Date.now();
  const step = `locate#${rid}`;
  const fail = (status: number, error: string, data?: unknown) => {
    slog(status >= 500 ? "error" : "warn", step, `${status} ${error}`, data);
    return Response.json({ error, requestId: rid }, { status });
  };

  if (!process.env.ANTHROPIC_API_KEY) {
    return fail(500, "ANTHROPIC_API_KEY is not set. Add it to .env.local and restart the dev server.");
  }

  let front: ReturnType<typeof parseDataUrl>;
  let back: ReturnType<typeof parseDataUrl>;
  try {
    const body = (await req.json()) as { front?: unknown; back?: unknown };
    front = parseDataUrl(body.front);
    back = parseDataUrl(body.back);
  } catch (err) {
    return fail(400, err instanceof Error ? err.message : "Invalid request body", err);
  }
  slog("info", step, "Locating coin in both photos", {
    front: `${Math.round((front.data.length * 3) / 4 / 1024)} KB`,
    back: `${Math.round((back.data.length * 3) / 4 / 1024)} KB`,
  });

  const client = new Anthropic();
  const content: Anthropic.Beta.BetaContentBlockParam[] = [
    { type: "text", text: "Photo 1 of 2: front of the coin." },
    { type: "image", source: { type: "base64", media_type: front.media_type, data: front.data } },
    { type: "text", text: "Photo 2 of 2: back of the coin." },
    { type: "image", source: { type: "base64", media_type: back.media_type, data: back.data } },
    { type: "text", text: "Return the bounding box of the coin in each photo." },
  ];

  try {
    const tModel = Date.now();
    const response = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 2000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: betaZodOutputFormat(LocateSchema) },
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content }],
    });

    if (response.stop_reason === "refusal" || !response.parsed_output) {
      return fail(502, "The model could not locate the coin. Try again.", response.stop_details);
    }

    const result = {
      front: sanitise(response.parsed_output.front),
      back: sanitise(response.parsed_output.back),
    };
    slog("info", step, `Done in ${Date.now() - t0} ms (model ${Date.now() - tModel} ms)`, {
      ...result,
      usage: { in: response.usage.input_tokens, out: response.usage.output_tokens },
    });
    return Response.json({ ...result, requestId: rid });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      return fail(500, "Anthropic rejected the API key. Check ANTHROPIC_API_KEY in .env.local.", err);
    }
    if (err instanceof Anthropic.RateLimitError) {
      return fail(429, "Rate limited by the Anthropic API. Wait a moment and retry.", err);
    }
    if (err instanceof Anthropic.APIError) {
      return fail(502, `Anthropic API error ${err.status}: ${err.message}`, err);
    }
    if (err instanceof Anthropic.APIConnectionError) {
      return fail(502, "Could not reach the Anthropic API.", err);
    }
    return fail(500, "Unexpected server error while locating the coin.", err);
  }
}
