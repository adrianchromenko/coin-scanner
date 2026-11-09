"use client";

import { useRef, useState } from "react";
import { loadToCanvas } from "@/lib/autoCrop";
import { log } from "@/lib/log";
import { assessPhotoGlobal, type PhotoAssessment } from "@/lib/photoCheck";

/** A photo the user added. Nothing is cropped until Identify runs. */
export type CapturedSide = {
  src: HTMLCanvasElement;
  /** downscaled JPEG of the original for on-screen display */
  srcUrl: string;
  /** ~1024px JPEG sent to the AI to locate the coin */
  locateUrl: string;
  check: PhotoAssessment | null;
  /** true while a blocking problem (e.g. blur) has not been overridden by the user */
  blocking: boolean;
  fileName: string;
};

type Props = {
  step: number;
  label: string;
  sublabel?: string;
  hint: string;
  value: CapturedSide | null;
  onChange: (value: CapturedSide | null) => void;
  /**
   * Small square version for batch mode: one tap target (camera or gallery via
   * the OS picker), a thumbnail once a photo is in, no tips. Default rendering
   * is unchanged when this is omitted.
   */
  compact?: boolean;
};

const TIPS = [
  { icon: "◐", text: "Dark matte background for silver or light coins, white paper for copper or dark coins." },
  { icon: "☀", text: "Daylight from a window, flash off. Don't shoot in your own shadow." },
  { icon: "⌖", text: "Straight down, 15–20 cm away, coin filling the frame. Tap the coin to focus." },
];

/** Downscaled JPEG of a canvas. */
function scaledJpeg(src: HTMLCanvasElement, maxDim: number, quality: number): string {
  const scale = Math.min(1, maxDim / Math.max(src.width, src.height));
  if (scale === 1) return src.toDataURL("image/jpeg", quality);
  const c = document.createElement("canvas");
  c.width = Math.round(src.width * scale);
  c.height = Math.round(src.height * scale);
  c.getContext("2d")?.drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", quality);
}

function CameraIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
      <path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.1a1 1 0 0 0 .83-.45l.9-1.35A1 1 0 0 1 10.17 3.7h3.66a1 1 0 0 1 .83.45l.9 1.35a1 1 0 0 0 .83.45h1.1A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5v-8Z" strokeLinejoin="round" />
      <circle cx="12" cy="12.5" r="3.5" />
    </svg>
  );
}

function GalleryIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
      <rect x="4" y="5" width="16" height="14" rx="2.5" />
      <path d="m4 16 4.5-4.5a1.5 1.5 0 0 1 2.1 0L15 16m-2-2 1.5-1.5a1.5 1.5 0 0 1 2.1 0L20 15.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="15.5" cy="9.5" r="1.3" fill="currentColor" stroke="none" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className={className} aria-hidden="true">
      <path d="m5 12.5 4.5 4.5L19 7.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function CoinCapture({ step, label, sublabel, hint, value, onChange, compact }: Props) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File | undefined) {
    if (!file) {
      log.warn(`capture:${label}`, "File picker closed without a file");
      return;
    }
    setBusy(true);
    setError(null);
    const t0 = performance.now();
    log.info(`capture:${label}`, "Photo selected", {
      name: file.name,
      type: file.type,
      sizeKB: Math.round(file.size / 1024),
    });
    try {
      const src = await loadToCanvas(file);
      log.info(`capture:${label}`, `Decoded ${src.width}x${src.height} in ${Math.round(performance.now() - t0)} ms`);
      let check: PhotoAssessment | null = null;
      try {
        check = assessPhotoGlobal(src);
        const failed = check.checks.filter((c) => !c.ok).map((c) => c.key);
        if (failed.length) log.warn(`capture:${label}`, `Photo check: ${failed.join(", ")}`, check.metrics);
        else log.info(`capture:${label}`, "Photo check passed", check.metrics);
      } catch (e) {
        log.error(`capture:${label}`, "Photo check failed to run", e);
      }
      const blocking = check?.checks.some((c) => !c.ok && c.severity === "block") ?? false;
      if (blocking) log.warn(`capture:${label}`, "Photo blocked: blurry, asking for a retake");
      onChange({
        src,
        srcUrl: scaledJpeg(src, 1000, 0.8),
        locateUrl: scaledJpeg(src, 1024, 0.85),
        check,
        blocking,
        fileName: file.name,
      });
      log.info(`capture:${label}`, `Ready in ${Math.round(performance.now() - t0)} ms total`);
    } catch (e) {
      log.error(`capture:${label}`, "Could not read or process the photo", e);
      setError(e instanceof Error ? e.message : "Could not read that photo");
    } finally {
      setBusy(false);
      if (cameraRef.current) cameraRef.current.value = "";
      if (galleryRef.current) galleryRef.current.value = "";
    }
  }

  function reset() {
    log.info(`capture:${label}`, "Retake");
    setError(null);
    onChange(null);
  }

  function useAnyway() {
    if (!value) return;
    log.warn(`capture:${label}`, "User chose to keep a blurry photo");
    onChange({ ...value, blocking: false });
  }

  const warnings = value?.check?.checks.filter((c) => !c.ok) ?? [];
  const blocked = Boolean(value?.blocking);
  const done = Boolean(value) && !blocked;

  if (compact) {
    return (
      <div className="flex min-w-0 flex-col gap-1.5" data-capture={label.toLowerCase()}>
        {!value ? (
          <label
            aria-disabled={busy}
            className={`group flex aspect-square w-full cursor-pointer flex-col items-center justify-center gap-1.5 rounded-2xl border border-dashed border-patina-400/35 bg-gold-400/[0.04] px-2 transition-colors active:bg-patina-400/10 ${
              busy ? "pointer-events-none opacity-50" : ""
            }`}
          >
            {/* No `capture` attribute: the OS picker offers camera or gallery from this one tap. */}
            <input
              ref={galleryRef}
              type="file"
              accept="image/*"
              className="sr-only"
              disabled={busy}
              onClick={() => log.info(`capture:${label}`, "Compact picker opened")}
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-patina-400/15 text-patina-300 ring-1 ring-patina-400/30 transition-transform group-active:scale-95">
              <CameraIcon className="h-5 w-5" />
            </span>
            <span className="text-xs font-semibold text-cream-100">{busy ? "Processing…" : label}</span>
            {sublabel && <span className="text-[10px] text-cream-500">{sublabel}</span>}
          </label>
        ) : (
          <div className="relative aspect-square w-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={value.srcUrl}
              alt={`${label} photo`}
              className={`h-full w-full rounded-2xl object-cover ring-2 ${blocked ? "ring-red-400/70" : "ring-patina-400/50"}`}
            />
            <span
              className={`absolute bottom-1.5 left-1.5 flex h-6 w-6 items-center justify-center rounded-full ring-2 ring-ink-900 ${
                blocked ? "bg-red-500 text-white" : "bg-patina-400 text-ink-950"
              }`}
              aria-label={blocked ? `${label}: blurry` : `${label}: photo added`}
            >
              {blocked ? <span className="text-xs font-bold">!</span> : <CheckIcon className="h-3 w-3" />}
            </span>
            <span className="absolute bottom-1.5 right-1.5 rounded-full bg-ink-950/70 px-1.5 py-0.5 text-[10px] font-medium text-cream-100">
              {label}
            </span>
            <button
              type="button"
              onClick={reset}
              aria-label={`Retake ${label.toLowerCase()} photo`}
              className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-ink-950/75 text-sm leading-none text-cream-100 ring-1 ring-white/15 hover:bg-ink-950"
            >
              ×
            </button>
          </div>
        )}
        {error && <p className="text-[11px] leading-snug text-red-300">{error}</p>}
        {value && blocked && (
          <div className="flex items-center justify-between gap-1 text-[11px]">
            <span className="font-medium text-red-300">Blurry</span>
            <button type="button" onClick={useAnyway} className="text-cream-500 underline-offset-2 hover:text-cream-100 hover:underline">
              Use anyway
            </button>
          </div>
        )}
        {value && !blocked && warnings.length > 0 && (
          <p className="truncate text-[11px] text-amber-200/90" title={warnings.map((c) => c.label).join(" · ")}>
            {warnings.map((c) => c.label).join(" · ")}
          </p>
        )}
      </div>
    );
  }

  return (
    <section className="card p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span
            className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold transition-colors ${
              done ? "bg-patina-400 text-ink-950" : "border border-white/15 text-cream-300"
            }`}
          >
            {done ? <CheckIcon className="h-4 w-4" /> : step}
          </span>
          <h2 className="font-display text-lg font-semibold leading-tight">
            {label}
            {sublabel && <span className="ml-2 text-sm font-normal text-cream-500">{sublabel}</span>}
          </h2>
        </div>
        {value && (
          <button
            type="button"
            onClick={reset}
            className="text-xs font-medium text-cream-500 underline-offset-4 hover:text-cream-100 hover:underline"
          >
            Retake
          </button>
        )}
      </div>

      {error && (
        <p className="mb-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {error}
        </p>
      )}

      {/* State 1: nothing added yet */}
      {!value && (
        <div className="flex flex-col gap-3">
          {/* Labels wrapping the inputs: iOS Safari ignores programmatic clicks on hidden file inputs. */}
          <label
            aria-disabled={busy}
            className={`group flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-patina-400/35 bg-gold-400/[0.04] px-4 py-7 transition-colors active:bg-patina-400/10 ${
              busy ? "pointer-events-none opacity-50" : ""
            }`}
          >
            <input
              ref={cameraRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              disabled={busy}
              onClick={() => log.info(`capture:${label}`, "Camera picker opened")}
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-patina-400/15 text-patina-300 ring-1 ring-patina-400/30 transition-transform group-active:scale-95">
              <CameraIcon className="h-7 w-7" />
            </span>
            <span className="text-base font-semibold text-cream-100">
              {busy ? "Processing…" : "Take photo"}
            </span>
            <span className="max-w-[26ch] text-center text-xs leading-relaxed text-cream-500">{hint}</span>
          </label>
          <label
            aria-disabled={busy}
            className={`btn-ghost flex cursor-pointer items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-medium ${
              busy ? "pointer-events-none opacity-50" : ""
            }`}
          >
            <input
              ref={galleryRef}
              type="file"
              accept="image/*"
              className="sr-only"
              disabled={busy}
              onClick={() => log.info(`capture:${label}`, "Gallery picker opened")}
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
            <GalleryIcon className="h-4.5 w-4.5" />
            Choose from gallery
          </label>
          <ul className="mt-1 flex flex-col gap-1.5">
            {TIPS.map((t) => (
              <li key={t.text} className="flex gap-2.5 text-xs leading-relaxed text-cream-500">
                <span className="w-4 shrink-0 text-center text-patina-400">{t.icon}</span>
                {t.text}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* State 2: photo added, uncropped */}
      {value && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-4">
            <div className="relative shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={value.srcUrl}
                alt={`${label} photo`}
                className={`h-24 w-24 rounded-2xl object-cover ring-2 ${
                  blocked
                    ? "ring-red-400/70"
                    : "ring-patina-400/50 shadow-[0_12px_30px_-12px_rgba(79,209,181,0.45)]"
                }`}
              />
              <span
                className={`absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full ring-4 ring-ink-900 ${
                  blocked ? "bg-red-500 text-white" : "bg-patina-400 text-ink-950"
                }`}
              >
                {blocked ? <span className="text-sm font-bold">!</span> : <CheckIcon className="h-3.5 w-3.5" />}
              </span>
            </div>
            <div className="min-w-0">
              <p className="font-display text-lg font-semibold">{blocked ? "Blurry photo" : "Photo added"}</p>
              <p className="text-sm text-cream-500">
                {blocked
                  ? "Please retake it so your listing looks sharp."
                  : `${value.src.width}×${value.src.height} · cropped by AI when you identify`}
              </p>
            </div>
          </div>

          {warnings.length > 0 && (
            <div
              className={`rounded-xl border px-3.5 py-3 ${
                blocked ? "border-red-400/40 bg-red-500/10" : "border-gold-400/35 bg-gold-400/[0.07]"
              }`}
            >
              <p className={`eyebrow mb-1.5 ${blocked ? "text-red-300" : ""}`}>Photo check</p>
              <ul className="flex flex-col gap-1.5">
                {warnings.map((c) => (
                  <li key={c.key} className="flex gap-2 text-sm">
                    <span
                      className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                        c.severity === "block" ? "bg-red-500 text-white" : "bg-patina-400 text-ink-950"
                      }`}
                    >
                      !
                    </span>
                    <span>
                      <span className="font-semibold text-cream-100">{c.label}</span>
                      {c.advice && <span className="block text-xs text-cream-500">{c.advice}</span>}
                    </span>
                  </li>
                ))}
              </ul>
              {blocked ? (
                <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
                  <button type="button" onClick={reset} className="btn-primary rounded-xl px-4 py-2.5 text-sm font-semibold">
                    Retake photo
                  </button>
                  <button type="button" onClick={useAnyway} className="btn-ghost rounded-xl px-4 py-2.5 text-sm font-medium">
                    Use anyway
                  </button>
                </div>
              ) : (
                <button type="button" onClick={reset} className="btn-ghost mt-3 w-full rounded-xl px-4 py-2.5 text-sm font-semibold">
                  Retake for a better photo
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
