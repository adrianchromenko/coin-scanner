/**
 * Browser-side coin detection and cropping. Pure canvas, no dependencies.
 *
 * Pipeline:
 *   1. Load the photo honoring EXIF orientation, capped to a sane size.
 *   2. Estimate the background color from the image border.
 *   3. Threshold pixels by color distance from the background (Otsu).
 *   4. Take the largest connected blob and fit a circle to its bounding box.
 *   5. Render a square crop around that circle, optionally masking the
 *      background to white for a clean listing photo.
 */

export type CropCircle = {
  /** center x in source-canvas pixels */
  cx: number;
  /** center y in source-canvas pixels */
  cy: number;
  /** radius in source-canvas pixels */
  r: number;
  /** false when detection fell back to a centred guess */
  detected?: boolean;
};

export type RenderOptions = {
  /** extra space around the coin as a fraction of the radius */
  padding?: number;
  /** output square size in pixels */
  size?: number;
  /** paint everything outside the circle with `background` */
  maskBackground?: boolean;
  background?: string;
};

function viaImageElement(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      if (img.naturalWidth === 0) reject(new Error("Image decoded to zero size"));
      else resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Could not decode image (${file.type || "unknown type"}, ${Math.round(file.size / 1024)} KB)`));
    };
    img.src = url;
  });
}

async function fileToBitmap(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
      if (bmp.width > 0 && bmp.height > 0) return bmp;
      bmp.close();
    } catch {
      // Older Safari rejects the imageOrientation option or the format; fall through to <img>,
      // which honours EXIF orientation by default.
    }
  }
  return viaImageElement(file);
}

/** Decode a photo into a canvas, downscaled so its longest edge is at most maxDim. */
export async function loadToCanvas(
  file: Blob,
  maxDim = 2400,
): Promise<HTMLCanvasElement> {
  const bmp = await fileToBitmap(file);
  const w = bmp.width;
  const h = bmp.height;
  const scale = Math.min(1, maxDim / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D not supported");
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  if ("close" in bmp) bmp.close();
  return canvas;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** Otsu threshold over a 0..255 histogram. */
function otsu(hist: Uint32Array, total: number): number {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let bestVar = -1;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > bestVar) {
      bestVar = between;
      best = t;
    }
  }
  return best;
}

type Blob2D = { area: number; x0: number; y0: number; x1: number; y1: number };

/** Largest 4-connected component of a binary mask, by area. */
function largestComponent(mask: Uint8Array, w: number, h: number): Blob2D | null {
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let best: Blob2D | null = null;

  for (let start = 0; start < w * h; start++) {
    if (!mask[start] || seen[start]) continue;
    let sp = 0;
    stack[sp++] = start;
    seen[start] = 1;
    let area = 0;
    let x0 = w;
    let y0 = h;
    let x1 = -1;
    let y1 = -1;
    while (sp > 0) {
      const i = stack[--sp];
      const x = i % w;
      const y = (i - x) / w;
      area++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (x > 0 && mask[i - 1] && !seen[i - 1]) {
        seen[i - 1] = 1;
        stack[sp++] = i - 1;
      }
      if (x < w - 1 && mask[i + 1] && !seen[i + 1]) {
        seen[i + 1] = 1;
        stack[sp++] = i + 1;
      }
      if (y > 0 && mask[i - w] && !seen[i - w]) {
        seen[i - w] = 1;
        stack[sp++] = i - w;
      }
      if (y < h - 1 && mask[i + w] && !seen[i + w]) {
        seen[i + w] = 1;
        stack[sp++] = i + w;
      }
    }
    if (!best || area > best.area) best = { area, x0, y0, x1, y1 };
  }
  return best;
}

/**
 * Find the coin in a photo. Works best with the coin on a plain, contrasting
 * background. Falls back to a centered circle if nothing convincing is found.
 */
export function detectCoin(src: HTMLCanvasElement): CropCircle {
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

  // 1. Background color = median of a band around the image border.
  const band = Math.max(2, Math.round(Math.min(w, h) * 0.04));
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x < band || x >= w - band || y < band || y >= h - band) {
        const i = (y * w + x) * 4;
        rs.push(data[i]);
        gs.push(data[i + 1]);
        bs.push(data[i + 2]);
      }
    }
  }
  const bg = [median(rs), median(gs), median(bs)];

  // 2. Distance-from-background map, quantized to 0..255 for Otsu.
  const n = w * h;
  const dist = new Uint8Array(n);
  const hist = new Uint32Array(256);
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    const dr = data[i] - bg[0];
    const dg = data[i + 1] - bg[1];
    const db = data[i + 2] - bg[2];
    const d = Math.min(255, Math.round(Math.sqrt(dr * dr + dg * dg + db * db)));
    dist[p] = d;
    hist[d]++;
  }
  const thr = Math.max(18, otsu(hist, n));

  // 3. Binary mask and largest blob.
  const mask = new Uint8Array(n);
  for (let p = 0; p < n; p++) mask[p] = dist[p] > thr ? 1 : 0;
  const blob = largestComponent(mask, w, h);

  const fallback: CropCircle = {
    cx: src.width / 2,
    cy: src.height / 2,
    r: Math.min(src.width, src.height) * 0.4,
    detected: false,
  };
  if (!blob || blob.area < n * 0.02) return fallback;

  const bw = blob.x1 - blob.x0 + 1;
  const bh = blob.y1 - blob.y0 + 1;
  const cx = (blob.x0 + blob.x1 + 1) / 2;
  const cy = (blob.y0 + blob.y1 + 1) / 2;
  const r = Math.max(bw, bh) / 2;

  return {
    cx: cx / scale,
    cy: cy / scale,
    r: Math.min(r / scale, Math.min(src.width, src.height) / 2),
    detected: true,
  };
}

/** Render a square crop around the circle. Returns a new canvas. */
export function renderCrop(
  src: HTMLCanvasElement,
  circle: CropCircle,
  opts: RenderOptions = {},
): HTMLCanvasElement {
  const {
    padding = 0.06,
    size = 1200,
    maskBackground = true,
    background = "#ffffff",
  } = opts;
  const R = circle.r * (1 + padding);
  const out = document.createElement("canvas");
  out.width = size;
  out.height = size;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D not supported");

  ctx.fillStyle = background;
  ctx.fillRect(0, 0, size, size);

  if (maskBackground) {
    ctx.save();
    ctx.beginPath();
    // Clip slightly outside the detected rim so we never shave the edge.
    const rimR = ((circle.r * 1.015) / R) * (size / 2);
    ctx.arc(size / 2, size / 2, rimR, 0, Math.PI * 2);
    ctx.clip();
  }

  // The crop window may extend past the photo edges. Only draw the in-bounds
  // part and let the background fill show through elsewhere.
  const sx = circle.cx - R;
  const sy = circle.cy - R;
  const sw = R * 2;
  const ix0 = Math.max(0, sx);
  const iy0 = Math.max(0, sy);
  const ix1 = Math.min(src.width, sx + sw);
  const iy1 = Math.min(src.height, sy + sw);
  if (ix1 > ix0 && iy1 > iy0) {
    const k = size / sw;
    ctx.drawImage(
      src,
      ix0,
      iy0,
      ix1 - ix0,
      iy1 - iy0,
      (ix0 - sx) * k,
      (iy0 - sy) * k,
      (ix1 - ix0) * k,
      (iy1 - iy0) * k,
    );
  }

  if (maskBackground) ctx.restore();
  return out;
}

export function canvasToJpeg(canvas: HTMLCanvasElement, quality = 0.9): string {
  return canvas.toDataURL("image/jpeg", quality);
}

/** Downscale a square canvas to size and return a JPEG data URL. */
export function resizedJpeg(
  canvas: HTMLCanvasElement,
  size: number,
  quality = 0.85,
): string {
  const out = document.createElement("canvas");
  out.width = size;
  out.height = size;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D not supported");
  ctx.drawImage(canvas, 0, 0, size, size);
  return out.toDataURL("image/jpeg", quality);
}
