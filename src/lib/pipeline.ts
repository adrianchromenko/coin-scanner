"use client";

import type { CapturedSide } from "@/components/CoinCapture";
import { canvasToJpeg, detectCoin, renderCrop, resizedJpeg, type CropCircle } from "@/lib/autoCrop";
import { normalizeListing, type CoinListing } from "@/lib/coinSchema";
import { enhanceCoinPhoto } from "@/lib/enhance";
import { firebaseEnabled, firebase } from "@/lib/firebase/client";
import { ISSUE_LABEL, type CoinBox, type LocateResult, type PhotoIssue } from "@/lib/locateSchema";
import { log } from "@/lib/log";
import type { Market } from "@/lib/market";
import { SAMPLE_LISTING } from "@/lib/sampleListing";

/**
 * The scan pipeline, shared by the single-coin home screen and batch mode:
 *   locateSides  -> ask the AI where the coin is in each photo (+ photo problems)
 *   cropSides    -> full-resolution circular crops (optionally enhanced)
 *   identifyCrops-> structured listing + market data from the AI
 */

export type SideKey = "front" | "back";
export const SIDES: SideKey[] = ["front", "back"];
export type SideCrop = { circle: CropCircle; full: string; small: string };
export type Crops = Record<SideKey, SideCrop>;
export type Sides = Record<SideKey, CapturedSide>;

export type LocateOutcome = {
  circles: Record<SideKey, CropCircle>;
  issues: Record<SideKey, PhotoIssue[]>;
  /** Human-readable issue labels per side (empty arrays when the photos are fine). */
  problems: Record<SideKey, string[]>;
};

export type IdentifyResult = {
  listing: CoinListing;
  market: Market | null;
  requestId?: string;
  model?: string;
  usage?: unknown;
  /** Scans left today for this user, when the server enforces a limit. */
  remaining?: number | null;
};

export type PipelineOptions = { demo: boolean; enhance?: boolean };

/** Firebase ID token for the signed-in user, if any. Sent so the server can attribute and limit scans. */
export async function authHeaders(): Promise<Record<string, string>> {
  if (!firebaseEnabled) return {};
  try {
    const u = firebase().auth.currentUser;
    if (!u) return {};
    return { Authorization: `Bearer ${await u.getIdToken()}` };
  } catch (e) {
    log.warn("auth", "Could not get an ID token; sending the request anonymously", e);
    return {};
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public requestId?: string,
  ) {
    super(message);
  }
}

export async function postJson<T>(url: string, body: unknown): Promise<T & { requestId?: string }> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify(body),
    });
  } catch (e) {
    log.error("api", `${url}: network failure`, e);
    throw new ApiError("No connection. Check your internet and try again.", 0, "offline");
  }
  let data: (T & { error?: string; code?: string; requestId?: string }) | null = null;
  try {
    data = await res.json();
  } catch (e) {
    log.error("api", `${url}: response ${res.status} was not JSON`, e);
  }
  if (!res.ok || !data) {
    log.error("api", `${url} failed with HTTP ${res.status}`, { error: data?.error, code: data?.code, requestId: data?.requestId });
    throw new ApiError(data?.error ?? `Request failed (${res.status})`, res.status, data?.code, data?.requestId);
  }
  return data;
}

/** Convert the AI's fractional bounding box into a circle in source-canvas pixels. */
export function circleFromBox(box: CoinBox, src: HTMLCanvasElement): CropCircle {
  const left = box.left * src.width;
  const right = box.right * src.width;
  const top = box.top * src.height;
  const bottom = box.bottom * src.height;
  return {
    cx: (left + right) / 2,
    cy: (top + bottom) / 2,
    r: Math.max(right - left, bottom - top) / 2,
    detected: true,
  };
}

/** Step 1: where is the coin, and is the photo good enough? */
export async function locateSides(sides: Sides, opts: PipelineOptions, tag = "locate"): Promise<LocateOutcome> {
  const t0 = performance.now();
  const issues: Record<SideKey, PhotoIssue[]> = { front: [], back: [] };
  let circles: Record<SideKey, CropCircle>;
  if (opts.demo) {
    log.info(tag, "Demo mode: using local detection instead of the API");
    await new Promise((r) => setTimeout(r, 1200));
    circles = { front: detectCoin(sides.front.src), back: detectCoin(sides.back.src) };
  } else {
    log.info(tag, "Asking the AI to locate the coin", {
      frontKB: Math.round(sides.front.locateUrl.length / 1365),
      backKB: Math.round(sides.back.locateUrl.length / 1365),
    });
    const loc = await postJson<LocateResult>("/api/locate", {
      front: sides.front.locateUrl,
      back: sides.back.locateUrl,
    });
    log.info(tag, `AI located the coin in ${Math.round(performance.now() - t0)} ms`, loc);
    circles = {
      front: loc.front.found ? circleFromBox(loc.front, sides.front.src) : detectCoin(sides.front.src),
      back: loc.back.found ? circleFromBox(loc.back, sides.back.src) : detectCoin(sides.back.src),
    };
    if (!loc.front.found) log.warn(tag, "AI did not find the front coin; using local fallback", loc.front.notes);
    if (!loc.back.found) log.warn(tag, "AI did not find the back coin; using local fallback", loc.back.notes);
    issues.front = loc.front.issues ?? [];
    issues.back = loc.back.issues ?? [];
  }
  const problems: Record<SideKey, string[]> = {
    front: issues.front.map((i) => ISSUE_LABEL[i]),
    back: issues.back.map((i) => ISSUE_LABEL[i]),
  };
  return { circles, issues, problems };
}

/** Render the final listing photo (1200px) and the smaller copy sent to the AI. */
export function renderSide(side: CapturedSide, circle: CropCircle, enhance = false): SideCrop {
  let full = renderCrop(side.src, circle, { size: 1200, maskBackground: true });
  if (enhance) {
    const { canvas, info } = enhanceCoinPhoto(full);
    full = canvas;
    log.info("enhance", info.skipped ? "Enhancement skipped (too few coin pixels)" : "Photo enhanced", info);
  }
  return { circle, full: canvasToJpeg(full, 0.92), small: resizedJpeg(full, 896) };
}

/** Step 2: crop both sides at full resolution. */
export function cropSides(sides: Sides, circles: Record<SideKey, CropCircle>, opts: PipelineOptions): Crops {
  const t0 = performance.now();
  const crops: Crops = {
    front: renderSide(sides.front, circles.front, opts.enhance),
    back: renderSide(sides.back, circles.back, opts.enhance),
  };
  log.info("crop", `Cropped both sides in ${Math.round(performance.now() - t0)} ms`, {
    front: { cx: Math.round(circles.front.cx), cy: Math.round(circles.front.cy), r: Math.round(circles.front.r) },
    back: { cx: Math.round(circles.back.cx), cy: Math.round(circles.back.cy), r: Math.round(circles.back.r) },
    enhanced: Boolean(opts.enhance),
  });
  return crops;
}

export type IdentifyExtras = {
  /** Optional third photo: close-up of the date / mint mark, as a JPEG data URL. */
  closeup?: string;
  /** Previous listing when re-identifying with a close-up, so the model refines rather than restarts. */
  previous?: CoinListing;
};

/** Step 3: identify from the crops and write the listing. */
export async function identifyCrops(
  crops: Crops,
  hints: string,
  opts: PipelineOptions,
  extras: IdentifyExtras = {},
  tag = "identify",
): Promise<IdentifyResult> {
  if (opts.demo) {
    log.info(tag, "Demo mode: using sample listing instead of calling the API");
    await new Promise((r) => setTimeout(r, 1500));
    return {
      listing: SAMPLE_LISTING,
      market: { spot: { metal: "silver", usd_per_oz: 33.1, as_of: new Date().toISOString(), source: "demo" }, melt_value_usd: 25.6 },
    };
  }
  log.info(tag, "Sending both crops to /api/identify", {
    frontKB: Math.round(crops.front.small.length / 1365),
    backKB: Math.round(crops.back.small.length / 1365),
    closeupKB: extras.closeup ? Math.round(extras.closeup.length / 1365) : 0,
    hints: hints.trim().length ? `${hints.trim().length} chars` : "none",
  });
  const t0 = performance.now();
  const data = await postJson<IdentifyResult>("/api/identify", {
    front: crops.front.small,
    back: crops.back.small,
    hints,
    closeup: extras.closeup,
    previous: extras.previous,
  });
  const listing = normalizeListing(data.listing);
  log.info(tag, `Listing received in ${Math.round(performance.now() - t0)} ms`, {
    requestId: data.requestId,
    usage: data.usage,
    identified: listing.identified,
    confidence: listing.confidence,
    title: listing.title,
    price: listing.suggested_price_usd,
    sources: listing.price_sources.length,
    melt: data.market?.melt_value_usd ?? null,
    needsCloseup: listing.needs_closeup,
    remaining: data.remaining,
  });
  return { ...data, listing };
}

/** Whole pipeline in one call (used by batch mode). Photo problems do not stop it; they are returned. */
export async function scanCoin(
  sides: Sides,
  hints: string,
  opts: PipelineOptions,
  tag = "scan",
): Promise<{ crops: Crops; located: LocateOutcome; result: IdentifyResult }> {
  const located = await locateSides(sides, opts, tag);
  const crops = cropSides(sides, located.circles, opts);
  const result = await identifyCrops(crops, hints, opts, {}, tag);
  return { crops, located, result };
}
