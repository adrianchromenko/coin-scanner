/**
 * Listing-photo enhancement for a cropped coin on a white background:
 * gray-world white balance on the coin pixels (kills the orange/blue cast
 * phone cameras leave under indoor light) and a gentle auto-levels stretch so
 * every coin in a seller's shop has the same clean look. The masked white
 * background is left untouched.
 */

type Stats = { r: number; g: number; b: number; n: number; lo: number; hi: number };

function coinStats(data: Uint8ClampedArray, w: number, h: number): Stats {
  const cx = w / 2;
  const cy = h / 2;
  const r2 = (Math.min(w, h) / 2) * 0.92;
  const lum: number[] = [];
  let r = 0, g = 0, b = 0, n = 0;
  // Sample every other pixel inside the coin circle; skip pure-white background.
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy > r2 * r2) continue;
      const i = (y * w + x) * 4;
      const R = data[i], G = data[i + 1], B = data[i + 2];
      if (R > 250 && G > 250 && B > 250) continue;
      r += R; g += G; b += B; n++;
      lum.push(0.299 * R + 0.587 * G + 0.114 * B);
    }
  }
  if (!n) return { r: 1, g: 1, b: 1, n: 0, lo: 0, hi: 255 };
  lum.sort((a, b2) => a - b2);
  return {
    r: r / n, g: g / n, b: b / n, n,
    lo: lum[Math.floor(lum.length * 0.005)],
    hi: lum[Math.floor(lum.length * 0.995)],
  };
}

export type EnhanceInfo = { gains: [number, number, number]; lo: number; hi: number; skipped: boolean };

/**
 * Returns a new canvas with the enhanced image, plus what was done (for logs).
 * Gains are clamped so a genuinely gold or copper coin stays warm instead of
 * being forced to neutral grey.
 */
export function enhanceCoinPhoto(src: HTMLCanvasElement): { canvas: HTMLCanvasElement; info: EnhanceInfo } {
  const w = src.width, h = src.height;
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const ctx = out.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas 2D not supported");
  ctx.drawImage(src, 0, 0);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const s = coinStats(d, w, h);
  if (s.n < 500) return { canvas: out, info: { gains: [1, 1, 1], lo: 0, hi: 255, skipped: true } };

  // Gray-world balance toward the mean luminance, limited to +/-12% so real metal colour survives.
  const mean = (s.r + s.g + s.b) / 3;
  const clamp = (v: number) => Math.min(1.12, Math.max(0.88, v));
  const gr = clamp(mean / s.r), gg = clamp(mean / s.g), gb = clamp(mean / s.b);

  // Levels: map the 0.5%..99.5% luminance range onto 8..247 (never clip to pure white: the
  // background is the only thing allowed to be 255).
  const lo = s.lo, hi = Math.max(s.hi, lo + 40);
  const scale = (247 - 8) / (hi - lo);

  const cx = w / 2, cy = h / 2, r2 = (Math.min(w, h) / 2) ** 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy > r2) continue; // outside the coin: keep the clean background
      const i = (y * w + x) * 4;
      const R = d[i], G = d[i + 1], B = d[i + 2];
      if (R > 250 && G > 250 && B > 250) continue; // masked background pixels inside the square
      let r = R * gr, g = G * gg, b = B * gb;
      r = (r - lo) * scale + 8; g = (g - lo) * scale + 8; b = (b - lo) * scale + 8;
      d[i] = r < 0 ? 0 : r > 255 ? 255 : r;
      d[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
      d[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
    }
  }
  ctx.putImageData(img, 0, 0);
  return {
    canvas: out,
    info: { gains: [+gr.toFixed(3), +gg.toFixed(3), +gb.toFixed(3)], lo: Math.round(lo), hi: Math.round(hi), skipped: false },
  };
}
