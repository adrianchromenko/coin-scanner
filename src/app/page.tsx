"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import AccountButton from "@/components/AccountButton";
import { useAuth } from "@/components/AuthProvider";
import CoinCapture, { type CapturedSide } from "@/components/CoinCapture";
import CropEditor from "@/components/CropEditor";
import DebugPanel from "@/components/DebugPanel";
import EbayButton from "@/components/EbayButton";
import ListingForm from "@/components/ListingForm";
import ListingPreview from "@/components/ListingPreview";
import Wordmark from "@/components/Wordmark";
import PendingScansBanner from "@/components/PendingScansBanner";
import SaveCoinButton from "@/components/SaveCoinButton";
import { canvasToJpeg, loadToCanvas, type CropCircle } from "@/lib/autoCrop";
import type { CoinListing } from "@/lib/coinSchema";
import { log } from "@/lib/log";
import type { Market } from "@/lib/market";
import { queueScan, removeQueued, restoreSide, type QueuedScan } from "@/lib/offlineQueue";
import {
  ApiError,
  SIDES,
  cropSides,
  identifyCrops,
  locateSides,
  renderSide,
  type Crops,
  type SideKey,
} from "@/lib/pipeline";

type Status = "idle" | "loading" | "review" | "done" | "error";
/** Human-readable photo problems per side, found after the coin was located. */
type Review = Record<SideKey, string[]>;
type ScanInput = { front: CapturedSide; back: CapturedSide; hints: string };

/** Wrapper so the React Compiler purity rule does not flag timing inside event handlers. */
const now = () => performance.now();

const LOADING_TIPS = [
  "Finding the coin in each photo…",
  "Cropping both sides…",
  "Reading the date and mint mark…",
  "Comparing against known varieties…",
  "Estimating grade and wear…",
  "Checking recent sold prices…",
  "Writing your eBay listing…",
];

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
              s.on ? "bg-patina-400 shadow-[0_0_14px_rgba(79,209,181,0.6)]" : "bg-white/10"
            }`}
          />
          <span className={`eyebrow mt-2 block ${s.on ? "text-patina-300" : ""}`}>{s.label}</span>
        </li>
      ))}
    </ol>
  );
}

function LoadingOverlay({ phase, title = "Examining your coin" }: { phase: number; title?: string }) {
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
      <div className="perspective reticle relative">
        <span className="absolute inset-0 animate-pulse-ring rounded-full bg-patina-400/30" />
        <span
          aria-hidden="true"
          className="block h-24 w-24 animate-spin rounded-full border-2 border-dashed border-patina-400/80 shadow-[0_0_30px_rgba(79,209,181,0.35)]"
          style={{ animationDuration: "3s" }}
        />
      </div>
      <div className="text-center">
        <p className="font-display text-2xl font-semibold text-cream-100">{title}</p>
        <p key={i} className="mt-2 animate-fade-up text-sm text-cream-500">
          {LOADING_TIPS[i]}
        </p>
      </div>
      <p className="text-xs text-cream-500/70">Usually under a minute</p>
    </div>
  );
}

export default function Home() {
  const { enabled: authEnabled, user, openSignIn } = useAuth();
  const [front, setFront] = useState<CapturedSide | null>(null);
  const [back, setBack] = useState<CapturedSide | null>(null);
  const [hints, setHints] = useState("");
  const [enhance, setEnhance] = useState(true);
  const [status, setStatus] = useState<Status>("idle");
  const [phase, setPhase] = useState(0);
  const [listing, setListing] = useState<CoinListing | null>(null);
  const [market, setMarket] = useState<Market | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [crops, setCrops] = useState<Crops | null>(null);
  const [editing, setEditing] = useState<SideKey | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [closeupBusy, setCloseupBusy] = useState(false);
  const [offlineFail, setOfflineFail] = useState(false);
  /** id of the queued offline scan currently being run; removed from the queue once the listing exists. */
  const queuedRef = useRef<string | null>(null);

  const blocked = Boolean(front?.blocking || back?.blocking);
  const ready = Boolean(front && back) && !blocked && status !== "loading";
  const showListing = status === "done" && listing && crops;
  const showReview = status === "review" && review && crops;
  const sides: Record<SideKey, CapturedSide | null> = { front, back };
  const setSide: Record<SideKey, (v: CapturedSide | null) => void> = { front: setFront, back: setBack };
  const demo = () => new URLSearchParams(window.location.search).has("demo");

  function fail(e: unknown) {
    if (!(e instanceof Error && e.message)) log.error("identify", "Unexpected failure", e);
    setError(e instanceof Error ? e.message : "Something went wrong");
    setErrorCode(e instanceof ApiError ? (e.code ?? null) : null);
    setOfflineFail((e instanceof ApiError && e.code === "offline") || !navigator.onLine);
    setStatus("error");
  }

  function resetMessages() {
    setError(null);
    setErrorCode(null);
    setOfflineFail(false);
    setReview(null);
  }

  /** Step 3: send the crops to the AI and show the listing. */
  async function buildListing(next: Crops, t0: number, h = hints) {
    setStatus("loading");
    setPhase(2);
    const result = await identifyCrops(next, h, { demo: demo(), enhance });
    if (queuedRef.current) {
      void removeQueued(queuedRef.current);
      queuedRef.current = null;
    }
    setListing(result.listing);
    setMarket(result.market ?? null);
    setRemaining(result.remaining ?? null);
    log.info("identify", `Whole flow done in ${Math.round(now() - t0)} ms`);
    setStatus("done");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /** The user looked at the photo problems and wants the listing anyway. */
  async function continueAnyway() {
    if (!crops) return;
    log.warn("quality", "User kept photos with problems", review);
    try {
      await buildListing(crops, now());
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
    setMarket(null);
    resetMessages();
    setStatus("idle");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function identify(input?: ScanInput) {
    const f = input?.front ?? front;
    const b = input?.back ?? back;
    const h = input?.hints ?? hints;
    if (!f || !b) return;
    setStatus("loading");
    setPhase(0);
    resetMessages();
    const t0 = now();
    const opts = { demo: demo(), enhance };
    try {
      // 1. Ask the AI where the coin is in each photo (and whether the photos are good enough).
      const located = await locateSides({ front: f, back: b }, opts);

      // 2. Crop both sides at full resolution.
      setPhase(1);
      const next = cropSides({ front: f, back: b }, located.circles, opts);
      setCrops(next);

      // 2b. The AI's verdict on photo quality decides; the local focus number is only logged.
      if (located.problems.front.length || located.problems.back.length) {
        log.warn("quality", "Photo problems found; asking the user before building the listing", located.problems);
        setReview(located.problems);
        setStatus("review");
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }

      // 3. Identify from the crops.
      await buildListing(next, t0, h);
    } catch (e) {
      fail(e);
    }
  }

  /** Run a scan that was saved while offline. */
  async function runQueued(item: QueuedScan) {
    setStatus("loading");
    setPhase(0);
    resetMessages();
    try {
      log.info("queue", `Running queued scan ${item.id}`);
      const [f, b] = await Promise.all([restoreSide(item.front), restoreSide(item.back)]);
      setFront(f);
      setBack(b);
      setHints(item.hints);
      queuedRef.current = item.id;
      await identify({ front: f, back: b, hints: item.hints });
    } catch (e) {
      queuedRef.current = null;
      fail(e);
    }
  }

  /** Keep the photos on the device and run the scan when the connection is back. */
  async function saveForLater() {
    if (!front || !back) return;
    try {
      await queueScan({ front, back }, hints);
      startOver();
    } catch (e) {
      fail(e);
    }
  }

  /** The AI asked for a close-up of the date / mint mark; re-run identification with it. */
  async function addCloseup(file: File) {
    if (!crops || !listing) return;
    setCloseupBusy(true);
    const t0 = now();
    try {
      log.info("closeup", "Close-up photo selected", { name: file.name, sizeKB: Math.round(file.size / 1024) });
      const canvas = await loadToCanvas(file, 1400);
      const closeup = canvasToJpeg(canvas, 0.88);
      const result = await identifyCrops(crops, hints, { demo: demo(), enhance }, { closeup, previous: listing }, "closeup");
      setListing(result.listing);
      setMarket(result.market ?? null);
      setRemaining(result.remaining ?? null);
      log.info("closeup", `Re-identified with close-up in ${Math.round(now() - t0)} ms`, {
        title: result.listing.title,
        variety: result.listing.variety,
        price: result.listing.suggested_price_usd,
      });
    } catch (e) {
      log.error("closeup", "Close-up re-check failed", e);
      setError(e instanceof Error ? e.message : "Could not use that close-up");
    } finally {
      setCloseupBusy(false);
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
    setCrops({ ...crops, [side]: renderSide(captured, circle, enhance) });
    setEditing(null);
  }

  function startOver() {
    log.info("app", "Start over");
    queuedRef.current = null;
    setFront(null);
    setBack(null);
    setHints("");
    setListing(null);
    setMarket(null);
    setCrops(null);
    setEditing(null);
    resetMessages();
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
                className="btn-primary shrink-0 rounded-xl px-3.5 py-2 text-xs font-semibold"
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

  function errorBox() {
    if (!error) return null;
    const needsAccount = authEnabled && !user && (errorCode === "sign_in_required" || errorCode === "limit_reached");
    return (
      <div className="animate-fade-up rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
        <p>{error}</p>
        {needsAccount && (
          <button
            type="button"
            onClick={() =>
              openSignIn({
                reason: errorCode === "sign_in_required" ? "Sign in to scan coins" : "Sign in for your own daily scans",
                onDone: () => void identify(),
              })
            }
            className="btn-primary mt-3 rounded-full px-4 py-2 text-xs font-semibold"
          >
            Sign in and scan
          </button>
        )}
      </div>
    );
  }

  const editingSide = editing ? sides[editing] : null;

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-5 px-4 pb-44 pt-[max(1.25rem,env(safe-area-inset-top))]">
      {status === "loading" && <LoadingOverlay phase={phase} />}
      {closeupBusy && <LoadingOverlay phase={2} title="Checking the close-up" />}
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
        <h1 className="sr-only">CoinLens</h1>
        <Wordmark size={30} />
        <div className="flex items-center gap-2">
          {front || back || listing ? (
            <button
              type="button"
              onClick={startOver}
              className="btn-ghost rounded-full px-3.5 py-1.5 text-xs font-medium"
            >
              Start over
            </button>
          ) : (
            <Link href="/batch" className="btn-ghost rounded-full px-3.5 py-1.5 text-xs font-medium">
              Batch
            </Link>
          )}
          <AccountButton />
          <DebugPanel />
        </div>
      </header>

      <Steps front={Boolean(front)} back={Boolean(back)} done={Boolean(showListing)} />

      {showReview ? (
        <div className="flex animate-fade-up flex-col gap-5">
          {photoProblems()}
          {errorBox()}
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
          <SaveCoinButton listing={listing} hints={hints} front={crops.front.full} back={crops.back.full} market={market} />
          <EbayButton listing={listing} front={crops.front.full} back={crops.back.full} />
          {errorBox()}
          <ListingForm
            listing={listing}
            onChange={setListing}
            front={crops.front.full}
            back={crops.back.full}
            market={market}
            onCloseup={addCloseup}
            closeupBusy={closeupBusy}
          />
          {remaining !== null && (
            <p className="px-1 text-center text-xs text-cream-500">
              {remaining} scan{remaining === 1 ? "" : "s"} left today
            </p>
          )}
        </div>
      ) : (
        <>
          <PendingScansBanner onRun={runQueued} busy={status === "loading"} />
          {!front && !back && (
            <div className="animate-fade-up">
              <p className="eyebrow mb-3 text-patina-300">Pocket change to paid</p>
              <h2 className="font-display text-[36px] font-extrabold leading-[1.02] tracking-[-0.03em] text-cream-100">
                Two photos.
                <br />
                <span className="patina-text">One listing,</span>
                <br />
                <span className="gold-text">priced to sell.</span>
              </h2>
              <p className="mt-4 max-w-[34ch] text-[15px] leading-relaxed text-cream-300">
                Front and back of any coin. CoinLens finds it, grades it, checks what the same coin actually sold
                for, and writes the eBay listing for you.
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

          <section className="card flex flex-col gap-4 p-5">
            <label className="block">
              <span className="mb-2 flex items-baseline gap-2">
                <span className="font-display text-lg font-semibold">Anything you know?</span>
                <span className="text-xs text-cream-500">optional</span>
              </span>
              <textarea
                value={hints}
                onChange={(e) => setHints(e.target.value)}
                rows={2}
                placeholder="e.g. from Grandpa’s collection, weighs 26.7 g, came in a 2x2 marked “1921 S Morgan”"
                className="input-dark"
              />
            </label>
            <label className="flex cursor-pointer items-center justify-between gap-3 text-sm">
              <span>
                <span className="font-medium text-cream-100">Enhance listing photos</span>
                <span className="block text-xs text-cream-500">Neutral white balance and even contrast on both crops</span>
              </span>
              <input
                type="checkbox"
                checked={enhance}
                onChange={(e) => {
                  setEnhance(e.target.checked);
                  log.info("enhance", e.target.checked ? "Enhancement on" : "Enhancement off");
                }}
                className="h-5 w-5 accent-[#4fd1b5]"
              />
            </label>
          </section>

          {errorBox()}
          {offlineFail && front && back && (
            <button
              type="button"
              onClick={saveForLater}
              className="btn-ghost w-full rounded-xl px-4 py-3 text-sm font-medium"
            >
              Save for later and run it when you&apos;re back online
            </button>
          )}

          <div className="fixed inset-x-0 bottom-0 z-40 bg-gradient-to-t from-ink-900 via-ink-900/95 to-transparent px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-10">
            <div className="mx-auto max-w-lg">
              <button
                type="button"
                disabled={!ready}
                onClick={() => void identify()}
                className="btn-primary w-full rounded-2xl px-4 py-4 text-base font-semibold"
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
