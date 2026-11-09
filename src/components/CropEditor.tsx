"use client";

import { useEffect, useRef, useState } from "react";
import { renderCrop, type CropCircle } from "@/lib/autoCrop";

type Props = {
  title: string;
  src: HTMLCanvasElement;
  /** downscaled JPEG of src for display */
  srcUrl: string;
  initial: CropCircle;
  onDone: (circle: CropCircle) => void;
  onCancel: () => void;
};

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

/** Full-screen editor to move and resize the crop circle over the original photo. */
export default function CropEditor({ title, src, srcUrl, initial, onDone, onCancel }: Props) {
  const drag = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null);
  const [circle, setCircle] = useState<CropCircle>(initial);
  const [preview, setPreview] = useState<string | null>(null);
  const minDim = Math.min(src.width, src.height);

  useEffect(() => {
    const t = setTimeout(() => {
      setPreview(renderCrop(src, circle, { size: 320, maskBackground: true }).toDataURL("image/jpeg", 0.8));
    }, 50);
    return () => clearTimeout(t);
  }, [src, circle]);

  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    drag.current = { x: e.clientX, y: e.clientY, cx: circle.cx, cy: circle.cy };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!drag.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const k = src.width / rect.width;
    const d = drag.current;
    setCircle({
      ...circle,
      cx: clamp(d.cx + (e.clientX - d.x) * k, 0, src.width),
      cy: clamp(d.cy + (e.clientY - d.y) * k, 0, src.height),
    });
  }
  function onPointerUp() {
    drag.current = null;
  }

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-ink-950/95 backdrop-blur-sm">
      <div className="flex items-center justify-between px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <p className="font-display text-lg font-semibold">{title}</p>
        <button type="button" onClick={onCancel} className="btn-ghost rounded-full px-3 py-1 text-xs">
          Cancel
        </button>
      </div>
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <p className="text-sm text-cream-300">Drag the circle onto the coin, use the slider to resize.</p>
        <div className="relative w-full overflow-hidden rounded-2xl bg-black ring-1 ring-white/10">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={srcUrl} alt="" className="block w-full select-none" draggable={false} />
          <svg
            viewBox={`0 0 ${src.width} ${src.height}`}
            className="absolute inset-0 h-full w-full cursor-move"
            style={{ touchAction: "none" }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <defs>
              <mask id="crop-editor-dim">
                <rect width="100%" height="100%" fill="white" />
                <circle cx={circle.cx} cy={circle.cy} r={circle.r} fill="black" />
              </mask>
            </defs>
            <rect width="100%" height="100%" fill="rgba(5,7,12,0.6)" mask="url(#crop-editor-dim)" />
            <circle cx={circle.cx} cy={circle.cy} r={circle.r} fill="none" stroke="#4fd1b5" strokeWidth={Math.max(2, src.width / 300)} />
          </svg>
        </div>
        <label className="flex items-center gap-3 text-sm">
          <span className="eyebrow w-12 shrink-0">Size</span>
          <input
            type="range"
            min={Math.round(minDim * 0.05)}
            max={Math.round(minDim * 0.5)}
            value={Math.round(circle.r)}
            onChange={(e) => setCircle({ ...circle, r: Number(e.target.value) })}
            className="w-full accent-patina-400"
          />
        </label>
        <div className="flex items-center gap-3">
          {preview && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="Crop preview" className="coin-ring h-20 w-20 rounded-full" />
          )}
          <button
            type="button"
            onClick={() => onDone({ ...circle, detected: true })}
            className="btn-primary flex-1 rounded-xl px-4 py-3.5 text-base font-semibold"
          >
            Use this crop
          </button>
        </div>
      </div>
    </div>
  );
}
