import type { CropCircle } from "./autoCrop";

/**
 * Quality checks on a coin photo, computed in the browser after detection.
 * Thresholds are deliberately forgiving; metrics are logged so they can be tuned
 * against real phone photos.
 */

export type PhotoCheck = {
  key: "found" | "inFrame" | "size" | "contrast" | "sharp" | "exposure" | "glare";
  ok: boolean;
  /** "block": the photo should not be used for a listing without an explicit override. */
  severity?: "block" | "warn";
  label: string;
  advice?: string;
};

/**
 * Laplacian-variance thresholds. Calibrated 2026-11-06: real iPhone coin photos
 * score 485–1821; the synthetic test image scores 183; a 1 px blur on a
 * 1600 px photo drops it to ~60 and 2 px to ~17.
 */
export const SHARP_BLOCK = 80;
export const SHARP_WARN = 150;

export type PhotoAssessment = {
  ok: boolean;
  checks: PhotoCheck[];
  metrics: Record<string, number | boolean>;
};

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** Variance of the Laplacian over a square canvas; higher = sharper. */
export function sharpness(src: HTMLCanvasElement, circle: CropCircle, size = 400): number {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return 0;
  const r = circle.r * 0.92;
  ctx.drawImage(src, circle.cx - r, circle.cy - r, r * 2, r * 2, 0, 0, size, size);
  const { data } = ctx.getImageData(0, 0, size, size);
  const g = new Float32Array(size * size);
  for (let p = 0; p < size * size; p++) {
    const i = p * 4;
    g[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  const R2 = (size / 2) * (size / 2) * 0.9;
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < size - 1; y++) {
    for (let x = 1; x < size - 1; x++) {
      const dx = x - size / 2;
      const dy = y - size / 2;
      if (dx * dx + dy * dy > R2) continue;
      const p = y * size + x;
      const lap = 4 * g[p] - g[p - 1] - g[p + 1] - g[p - size] - g[p + size];
      sum += lap;
      sumSq += lap * lap;
      n++;
    }
  }
  if (n === 0) return 0;
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

/**
 * Checks that make sense before the coin has been located: focus, lighting and
 * glare, measured over the central region of the photo.
 */
export function assessPhotoGlobal(src: HTMLCanvasElement): PhotoAssessment {
  const full = assessPhoto(src, {
    cx: src.width / 2,
    cy: src.height / 2,
    r: Math.min(src.width, src.height) * 0.4,
    detected: true,
  });
  const keep = new Set<PhotoCheck["key"]>(["sharp", "exposure", "glare"]);
  const checks = full.checks.filter((c) => keep.has(c.key));
  return { ok: checks.every((c) => c.ok), checks, metrics: full.metrics };
}

export function assessPhoto(src: HTMLCanvasElement, circle: CropCircle): PhotoAssessment {
  const ANALYSIS = 320;
  const scale = ANALYSIS / Math.max(src.width, src.height);
  const w = Math.max(1, Math.round(src.width * scale));
  const h = Math.max(1, Math.round(src.height * scale));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas 2D not supported");
  ctx.drawImage(src, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);

  const cx = circle.cx * scale;
  const cy = circle.cy * scale;
  const r = circle.r * scale;
  const rIn2 = r * 0.9 * (r * 0.9);

  // Background colour from the border band; coin colour and luminance from inside the circle.
  const band = Math.max(2, Math.round(Math.min(w, h) * 0.04));
  const bgR: number[] = [];
  const bgG: number[] = [];
  const bgB: number[] = [];
  const coinR: number[] = [];
  const coinG: number[] = [];
  const coinB: number[] = [];
  let lumSum = 0;
  let lumN = 0;
  let clipped = 0;
  let dark = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const R = data[i];
      const G = data[i + 1];
      const B = data[i + 2];
      if (x < band || x >= w - band || y < band || y >= h - band) {
        bgR.push(R);
        bgG.push(G);
        bgB.push(B);
      }
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= rIn2) {
        const lum = 0.299 * R + 0.587 * G + 0.114 * B;
        lumSum += lum;
        lumN++;
        if (lum >= 250) clipped++;
        if (lum <= 10) dark++;
        if ((x + y) % 3 === 0) {
          coinR.push(R);
          coinG.push(G);
          coinB.push(B);
        }
      }
    }
  }
  const bg = [median(bgR), median(bgG), median(bgB)];
  const coin = [median(coinR), median(coinG), median(coinB)];
  const contrast = Math.sqrt(
    (bg[0] - coin[0]) ** 2 + (bg[1] - coin[1]) ** 2 + (bg[2] - coin[2]) ** 2,
  );
  const meanLum = lumN ? lumSum / lumN : 0;
  const clippedFrac = lumN ? clipped / lumN : 0;
  const darkFrac = lumN ? dark / lumN : 0;

  const sizeRatio = (circle.r * 2) / Math.min(src.width, src.height);
  const margin = Math.min(src.width, src.height) * 0.01;
  const inFrame =
    circle.cx - circle.r >= -margin &&
    circle.cy - circle.r >= -margin &&
    circle.cx + circle.r <= src.width + margin &&
    circle.cy + circle.r <= src.height + margin;

  const sharp = sharpness(src, circle);
  const found = circle.detected !== false;

  const bgIsLight = 0.299 * bg[0] + 0.587 * bg[1] + 0.114 * bg[2] > 128;

  const checks: PhotoCheck[] = [
    {
      key: "found",
      ok: found,
      label: found ? "Coin found automatically" : "Couldn't find the coin",
      advice: found
        ? undefined
        : "Use a plain background that contrasts with the coin, then retake or drag the circle onto the coin.",
    },
    {
      key: "inFrame",
      ok: inFrame,
      label: inFrame ? "Whole coin in frame" : "Coin is cut off",
      advice: inFrame ? undefined : "Move the phone back a little so the full edge of the coin is visible.",
    },
    {
      key: "size",
      ok: sizeRatio >= 0.35,
      label: sizeRatio >= 0.35 ? "Coin fills the frame" : "Coin is small in the frame",
      advice: sizeRatio >= 0.35 ? undefined : "Get closer so the coin fills most of the photo. Detail matters for grading.",
    },
    {
      key: "contrast",
      ok: contrast >= 45,
      label: contrast >= 45 ? "Good background contrast" : "Background too similar to the coin",
      advice:
        contrast >= 45
          ? undefined
          : bgIsLight
            ? "Light coin on a light background. Try a dark matte cloth or black paper."
            : "Dark coin on a dark background. Try plain white paper.",
    },
    {
      key: "sharp",
      ok: sharp >= SHARP_WARN,
      severity: sharp < SHARP_BLOCK ? "block" : "warn",
      label:
        sharp >= SHARP_WARN ? "Sharp and in focus" : sharp >= SHARP_BLOCK ? "Could be sharper" : "Blurry photo",
      advice:
        sharp >= SHARP_WARN
          ? undefined
          : sharp >= SHARP_BLOCK
            ? "Fine detail looks soft. Tap the coin on screen to focus and hold still before you shoot."
            : "Buyers skip listings with blurry photos. Tap the coin on screen to focus, hold still, and keep the phone 15–20 cm away.",
    },
    {
      key: "exposure",
      ok: meanLum >= 55 && meanLum <= 210 && darkFrac < 0.3,
      label:
        meanLum < 55 || darkFrac >= 0.3
          ? "Too dark"
          : meanLum > 210
            ? "Too bright"
            : "Well lit",
      advice:
        meanLum < 55 || darkFrac >= 0.3
          ? "Move near a window or under a lamp. Avoid shooting in your own shadow."
          : meanLum > 210
            ? "Too much light is washing out the detail. Move away from direct light."
            : undefined,
    },
    {
      key: "glare",
      ok: clippedFrac < 0.06,
      label: clippedFrac < 0.06 ? "No glare" : "Glare on the coin",
      advice:
        clippedFrac < 0.06
          ? undefined
          : "Turn the flash off and tilt the coin slightly so the light doesn't reflect straight back.",
    },
  ];

  return {
    ok: checks.every((c) => c.ok),
    checks,
    metrics: {
      found,
      inFrame,
      sizeRatio: Math.round(sizeRatio * 100) / 100,
      contrast: Math.round(contrast),
      sharpness: Math.round(sharp),
      meanLum: Math.round(meanLum),
      clippedPct: Math.round(clippedFrac * 1000) / 10,
      darkPct: Math.round(darkFrac * 1000) / 10,
      bgLight: bgIsLight,
    },
  };
}
