"use client";

import { useEffect, useState } from "react";
import AccountButton from "@/components/AccountButton";
import CoinCapture, { type CapturedSide } from "@/components/CoinCapture";
import CropEditor from "@/components/CropEditor";
import DebugPanel from "@/components/DebugPanel";
import ListingForm from "@/components/ListingForm";
import ListingPreview from "@/components/ListingPreview";
import Logo from "@/components/Logo";
import SaveCoinButton from "@/components/SaveCoinButton";
import { canvasToJpeg, detectCoin, renderCrop, resizedJpeg, type CropCircle } from "@/lib/autoCrop";
import type { CoinListing } from "@/lib/coinSchema";
import { ISSUE_LABEL, type CoinBox, type LocateResult, type PhotoIssue } from "@/lib/locateSchema";
import { log } from "@/lib/log";
import { sharpness } from "@/lib/photoCheck";
import { SAMPLE_LISTING } from "@/lib/sampleListing";

type Status = "idle" | "loading" | "review" | "done" | "error";
type SideKey = "front" | "back";
type SideCrop = { circle: CropCircle; full: string; small: string };
type Crops = Record<SideKey, SideCrop>;
/** Human-readable photo problems per side, found after the coin was located. */
type Review = Record<SideKey, string[]>;
const SIDES: SideKey[] = ["front", "back"];

const LOADING_TIPS = [
  "Finding the coin in each photo…",
  "Cropping both sides…",
  "Reading the date and mint mark…",
  "Comparing against known varieties…",
  "Estimating grade and wear…",
  "Checking for cleaning or damage…",
  "Writing your eBay listing…",
];

/** Convert the AI's fractional bounding box into a circle in source-canvas pixels. */
function circleFromBox(box: CoinBox, src: HTMLCanvasElement): CropCircle {
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

/** Render the final listing photo (1200px) and the smaller copy sent to the AI. */
function renderSide(side: CapturedSide, circle: CropCircle): SideCrop {
  const full = renderCrop(side.src, circle, { size: 1200, maskBackground: true });
  return { circle, full: canvasToJpeg(full, 0.92), small: resizedJpeg(full, 896) };
}

function Steps({ front, back, done }: { front: boolean; back: boolean; done: boolean }) {
  const steps = [
    { label: "Front", on: front },
    { label: "Back", on: back },
    { label: "Listing", on: done },
  ];
  return (
    <ol className="grid grid-cols-3 gap-2" aria-label="Progress">
      {steps.map((s) => (
        <li key={s.label}>
          <div
            className={`h-1.5 rounded-full transition-all duration-500 ${
              s.on ? "bg-gold-400 shadow-[0_0_14px_rgba(236,193,79,0.6)]" : "bg-white/10"
            }`}
          />
          <span className={`eyebrow mt-2 block ${s.on ? "text-gold-300" : ""}`}>{s.label}</span>
        </li>
      ))}
    </ol>
  );
}

function LoadingOverlay({ phase }: { phase: number }) {
  // Tips advance on a timer but never lag behind the real phase of the pipeline.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => Math.min(n + 1, LOADING_TIPS.length - 1)), 3200);
    return () => clearInterval(t);
  }, []);
  const i = Math.max(tick, phase);
  return (
    <div
      role="status"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-ink-950/85 px-6 backdrop-blur-md"
    >
      <div className="perspective relative">
        <span className="absolute inset-0 animate-pulse-ring rounded-full bg-gold-400/30" />
        <Logo size={96} className="animate-coin-spin drop-shadow-[0_0_30px_rgba(236,193,79,0.45)]" />
      </div>
      <div className="text-center">
        <p className="font-display text-2xl font-semibold text-cream-100">Examining your coin</p>
        <p key={i} className="mt-2 animate-fade-up text-sm text-cream-500">
          {LOADING_TIPS[i]}
        </p>
      </div>
      <p className="text-xs text-cream-500/70">Usually under a minute</p>
    </div>
  );
}

export default function Home() {
  const [front, setFront] = useState<CapturedSide | null>(null);
  const [back, setBack] = useState<CapturedSide | null>(null);
  const [hints, setHints] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [phase, setPhase] = useState(0);
  const [listing, setListing] = useState<CoinListing | null>(null);
  const [crops, setCrops] = useState<Crops | null>(null);
  const [editing, setEditing] = useState<SideKey | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState<string | null>(null);

  const blocked = Boolean(front?.blocking || back?.blocking);
  const ready = Boolean(front && back) && !blocked && status !== "loading";
  const showListing = status === "done" && listing && crops;
  const showReview = status === "review" && review && crops;
  const sides: Record<SideKey, CapturedSide | null> = { front, back };
  const setSide: Record<SideKey, (v: CapturedSide | null) => void> = { front: setFront, back: setBack };

  async function postJson<T>(url: string, body: unknown): Promise<T & { requestId?: string }> {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    let data: (T & { error?: string; requestId?: string }) | null = null;
    try {
      data = await res.json();
    } catch (e) {
      log.error("api", `${url}: response ${res.status} was not JSON`, e);
    }
    if (!res.ok || !data) {
      log.error("api", `${url} failed with HTTP ${res.status}`, { error: data?.error, requestId: data?.requestId });
      throw new Error(data?.error ?? `Request failed (${res.status})`);
    }
    return data;
  }

  function fail(e: unknown) {
    if (!(e instanceof Error && e.message)) log.error("identify", "Unexpected failure", e);
    setError(e instanceof Error ? e.message : "Something went wrong");
    setStatus("error");
  }

  /** Step 3: send the crops to the AI and show the listing. */
  async function buildListing(next: Crops, demo: boolean, t0: number) {
    setStatus("loading");
    setPhase(2);
    if (demo) {
      log.info("identify", "Demo mode: using sample listing instead of calling the API");
      await new Promise((r) => setTimeout(r, 2000));
      setListing(SAMPLE_LISTING);
    } else {
      log.info("identify", "Sending both crops to /api/identify", {
        frontKB: Math.round(next.front.small.length / 1365),
        backKB: Math.round(next.back.small.length / 1365),
        hints: hints.trim().length ? `${hints.trim().length} chars` : "none",
      });
      const tId = performance.now();
      const data = await postJson<{ listing: CoinListing; usage?: unknown }>("/api/identify", {
        front: next.front.small,
        back: next.back.small,
        hints,
      });
      log.info("identify", `Listing received in ${Math.round(performance.now() - tId)} ms`, {
        requestId: data.requestId,
        usage: data.usage,
        identified: data.listing.identified,
        confidence: data.listing.confidence,
        title: data.listing.title,
      });
      setListing(data.listing);
    }
    log.info("identify", `Whole flow done in ${Math.round(performance.now() - t0)} ms`);
    setStatus("done");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /** The user looked at the photo problems and wants the listing anyway. */
  async function continueAnyway() {
    if (!crops) return;
    log.warn("quality", "User kept photos with problems", review);
    const demo = new URLSearchParams(window.location.search).has("demo");
    try {
      await buildListing(crops, demo, performance.now());
    } catch (e) {
      fail(e);
    }
  }

  /** Throw away one side's photo and go back to the capture screen for it. */
  function retake(side: SideKey) {
    log.info("quality", `Retake ${side} photo`);
    setSide[side](null);
    setCrops(null);
    setListing(null);
    setReview(null);
    setError(null);
    setStatus("idle");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function identify() {
    if (!front || !back) return;
    setStatus("loading");
    setPhase(0);
    setError(null);
    setReview(null);
    const t0 = performance.now();
    const demo = new URLSearchParams(window.location.search).has("demo");
    try {
      // 1. Ask the AI where the coin is in each photo.
      let circles: Record<SideKey, CropCircle>;
      const aiIssues: Record<SideKey, PhotoIssue[]> = { front: [], back: [] };
      if (demo) {
        log.info("locate", "Demo mode: using local detection instead of the API");
        await new Promise((r) => setTimeout(r, 1500));
        circles = { front: detectCoin(front.src), back: detectCoin(back.src) };
      } else {
        log.info("locate", "Asking the AI to locate the coin", {
          frontKB: Math.round(front.locateUrl.length / 1365),
          backKB: Math.round(back.locateUrl.length / 1365),
        });
        const loc = await postJson<LocateResult>("/api/locate", { front: front.locateUrl, back: back.locateUrl });
        log.info("locate", `AI located the coin in ${Math.round(performance.now() - t0)} ms`, loc);
        circles = {
          front: loc.front.found ? circleFromBox(loc.front, front.src) : detectCoin(front.src),
          back: loc.back.found ? circleFromBox(loc.back, back.src) : detectCoin(back.src),
        };
        if (!loc.front.found) log.warn("locate", "AI did not find the front coin; using local fallback", loc.front.notes);
        if (!loc.back.found) log.warn("locate", "AI did not find the back coin; using local fallback", loc.back.notes);
        aiIssues.front = loc.front.issues ?? [];
        aiIssues.back = loc.back.issues ?? [];
      }

      // 2. Crop both sides at full resolution.
      setPhase(1);
      const tCrop = performance.now();
      const next: Crops = { front: renderSide(front, circles.front), back: renderSide(back, circles.back) };
      setCrops(next);
      log.info("crop", `Cropped both sides in ${Math.round(performance.now() - tCrop)} ms`, {
        front: { cx: Math.round(circles.front.cx), cy: Math.round(circles.front.cy), r: Math.round(circles.front.r) },
        back: { cx: Math.round(circles.back.cx), cy: Math.round(circles.back.cy), r: Math.round(circles.back.r) },
      });

      // 2b. Photo quality, now that we know exactly where the coin is. The AI's
      // verdict decides (it reads the lettering); the local focus number over the
      // coin is logged only, because smooth or worn coins score low without being blurry.
      const problems: Review = { front: [], back: [] };
      for (const side of SIDES) {
        const captured = sides[side]!;
        const focus = Math.round(sharpness(captured.src, circles[side]));
        problems[side] = aiIssues[side].map((i) => ISSUE_LABEL[i]);
        log.info("quality", `${side}: coin focus ${focus}, AI issues ${aiIssues[side].join(", ") || "none"}`);
      }
      if (problems.front.length || problems.back.length) {
        log.warn("quality", "Photo problems found; asking the user before building the listing", problems);
        setReview(problems);
        setStatus("review");
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }

      // 3. Identify from the crops.
      await buildListing(next, demo, t0);
    } catch (e) {
      fail(e);
    }
  }

  function applyManualCrop(side: SideKey, circle: CropCircle) {
    const captured = sides[side];
    if (!captured || !crops) return;
    log.info("crop", `Manual re-crop of ${side}`, {
      cx: Math.round(circle.cx),
      cy: Math.round(circle.cy),
      r: Math.round(circle.r),
    });
    setCrops({ ...crops, [side]: renderSide(captured, circle) });
    setEditing(null);
  }

  function startOver() {
    log.info("app", "Start over");
    setFront(null);
    setBack(null);
    setHints("");
    setListing(null);
    setCrops(null);
    setEditing(null);
    setReview(null);
    setError(null);
    setStatus("idle");
    window.scrollTo({ top: 0 });
  }

  /** Card listing the problems found with each photo, with a retake button per side. */
  function photoProblems(compact = false) {
    if (!review || !crops) return null;
    const bad = SIDES.filter((s) => review[s].length);
    if (!bad.length) return null;
    return (
      <section className={`card border-red-400/30 ${compact ? "p-4" : "p-5"}`}>
        {!compact && (
          <>
            <p className="eyebrow text-red-300">Photo check</p>
            <h2 className="font-display mt-1 text-2xl font-semibold leading-tight">
              {bad.length === 2 ? "Both photos need another go" : `The ${bad[0]} photo needs another go`}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-cream-300">
              Buyers judge a coin by its photos. A blurry or dark picture gets fewer bids, so it is worth a retake
              before the listing is written.
            </p>
          </>
        )}
        {compact && <p className="eyebrow text-red-300">Photo warning</p>}
        <ul className={`flex flex-col gap-3 ${compact ? "mt-2" : "mt-4"}`}>
          {bad.map((side) => (
            <li key={side} className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={crops[side].full}
                alt={`${side} crop`}
                className={`shrink-0 rounded-full bg-white ring-2 ring-red-400/60 ${compact ? "h-12 w-12" : "h-16 w-16"}`}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold capitalize text-cream-100">{side}</p>
                <p className="text-xs text-cream-500">{review[side].join(" · ")}</p>
              </div>
              <button
                type="button"
                onClick={() => retake(side)}
                className="btn-gold shrink-0 rounded-xl px-3.5 py-2 text-xs font-semibold"
              >
                Retake {side}
              </button>
            </li>
          ))}
        </ul>
        {!compact && (
          <button
            type="button"
            onClick={continueAnyway}
            className="btn-ghost mt-4 w-full rounded-xl px-4 py-2.5 text-sm font-medium"
          >
            Use these photos anyway
          </button>
        )}
      </section>
    );
  }

  const editingSide = editing ? sides[editing] : null;

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-5 px-4 pb-44 pt-[max(1.25rem,env(safe-area-inset-top))]">
      {status === "loading" && <LoadingOverlay phase={phase} />}
      {editing && editingSide && crops && (
        <CropEditor
          title={`Fix ${editing} crop`}
          src={editingSide.src}
          srcUrl={editingSide.srcUrl}
          initial={crops[editing].circle}
          onDone={(c) => applyManualCrop(editing, c)}
          onCancel={() => setEditing(null)}
        />
      )}

      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Logo size={44} className="drop-shadow-[0_6px_18px_rgba(236,193,79,0.35)]" />
          <div>
            <h1 className="font-display text-[28px] font-semibold leading-none tracking-tight">
              <span className="gold-text">Coin</span>
              <span className="text-cream-100">Lens</span>
            </h1>
            <p className="mt-1 text-xs text-cream-500">Snap. Identify. List.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {(front || back || listing) && (
            <button
              type="button"
              onClick={startOver}
              className="btn-ghost rounded-full px-3.5 py-1.5 text-xs font-medium"
            >
              Start over
            </button>
          )}
          <AccountButton />
          <DebugPanel />
        </div>
      </header>

      <Steps front={Boolean(front)} back={Boolean(back)} done={Boolean(showListing)} />

      {showReview ? (
        <div className="flex animate-fade-up flex-col gap-5">
          {photoProblems()}
          {error && (
            <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</p>
          )}
        </div>
      ) : showListing ? (
        <div className="flex animate-fade-up flex-col gap-5">
          {photoProblems(true)}
          <ListingPreview
            listing={listing}
            front={crops.front.full}
            back={crops.back.full}
            onFixCrop={(side) => setEditing(side)}
          />
          <SaveCoinButton listing={listing} hints={hints} front={crops.front.full} back={crops.back.full} />
          <ListingForm listing={listing} onChange={setListing} front={crops.front.full} back={crops.back.full} />
        </div>
      ) : (
        <>
          {!front && !back && (
            <div className="animate-fade-up">
              <h2 className="font-display text-[34px] font-medium leading-[1.05] tracking-tight text-cream-100">
                Two photos.
                <br />
                <span className="italic gold-text">One ready-to-post listing.</span>
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-cream-300">
                Add the front and back of any coin. CoinLens finds and crops the coin, identifies it,
                grades it, and writes the title, description and item specifics for eBay.
              </p>
            </div>
          )}

          <CoinCapture
            step={1}
            label="Front"
            sublabel="obverse"
            hint="Plain, contrasting background, good light, fill the frame."
            value={front}
            onChange={setFront}
          />
          <CoinCapture
            step={2}
            label="Back"
            sublabel="reverse"
            hint="Flip it over and shoot the other side the same way."
            value={back}
            onChange={setBack}
          />

          <section className="card p-5">
            <label className="block">
              <span className="mb-2 flex items-baseline gap-2">
                <span className="font-display text-lg font-semibold">Anything you know?</span>
                <span className="text-xs text-cream-500">optional</span>
              </span>
              <textarea
                value={hints}
                onChange={(e) => setHints(e.target.value)}
                rows={2}
                placeholder="e.g. from a German estate lot, weighs 27 g, came in a 2x2 marked “1921 S”"
                className="input-dark"
              />
            </label>
          </section>

          {error && (
            <p className="animate-fade-up rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              {error}
            </p>
          )}

          <div className="fixed inset-x-0 bottom-0 z-40 bg-gradient-to-t from-ink-900 via-ink-900/95 to-transparent px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-10">
            <div className="mx-auto max-w-lg">
              <button
                type="button"
                disabled={!ready}
                onClick={identify}
                className="btn-gold w-full rounded-2xl px-4 py-4 text-base font-semibold"
              >
                Identify coin & build listing
              </button>
              {!ready && status !== "loading" && (
                <p className="mt-2 text-center text-xs text-cream-500">
                  {blocked
                    ? "Retake the blurry photo to continue"
                    : front || back
                      ? "One more side to go"
                      : "Add both sides to continue"}
                </p>
              )}
            </div>
          </div>
        </>
      )}
    </main>
  );
}
