"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import AccountButton from "@/components/AccountButton";
import { useAuth } from "@/components/AuthProvider";
import BatchCoin, { money, newSlot, type Slot } from "@/components/BatchCoin";
import type { CapturedSide } from "@/components/CoinCapture";
import Wordmark from "@/components/Wordmark";
import type { CoinListing } from "@/lib/coinSchema";
import { downloadText, ebayCsv } from "@/lib/csv";
import { saveCoin } from "@/lib/firebase/coins";
import { log } from "@/lib/log";
import { cropSides, identifyCrops, locateSides, type SideKey } from "@/lib/pipeline";

/** Trays are capped so twenty full-size crops (not photos) is the most we ever hold in memory. */
const MAX_COINS = 20;

/** Wall-clock stopwatch for log timings (module scope keeps the React Compiler purity rule happy). */
const now = () => performance.now();

type Progress = { index: number; total: number; id: string };

/** A slot that can be scanned right now: both photos in, neither flagged as blurry, not already done. */
function isReady(s: Slot): boolean {
  return s.status !== "done" && Boolean(s.front && s.back) && !s.front?.blocking && !s.back?.blocking;
}

function BatchTray() {
  const demo = useSearchParams().has("demo");
  const { enabled, user, openSignIn } = useAuth();
  const [slots, setSlots] = useState<Slot[]>(() => [newSlot("slot-1"), newSlot("slot-2")]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // The scan loop is async and must always see the latest slots (hints typed after "Scan" was tapped, etc.).
  const slotsRef = useRef(slots);
  useEffect(() => {
    slotsRef.current = slots;
  }, [slots]);

  function patch(id: string, fn: Partial<Slot> | ((s: Slot) => Partial<Slot>)) {
    setSlots((prev) => prev.map((s) => (s.id === id ? { ...s, ...(typeof fn === "function" ? fn(s) : fn) } : s)));
  }

  const done = useMemo(() => slots.filter((s) => s.status === "done" && s.listing && s.crops), [slots]);
  const pending = useMemo(() => slots.filter((s) => s.status !== "done"), [slots]);
  const readyCount = pending.filter(isReady).length;
  const allReady = pending.length > 0 && readyCount === pending.length;
  const anyBlurry = pending.some((s) => s.front?.blocking || s.back?.blocking);
  const totalValue = done.reduce((sum, s) => sum + (Number(s.listing?.suggested_price_usd) || 0), 0);
  const unsaved = done.filter((s) => s.save !== "saved");
  const hasAnything = slots.some((s) => s.front || s.back || s.status !== "idle");

  /* ---------------- Slots ---------------- */

  function addSlot() {
    if (slotsRef.current.length >= MAX_COINS) {
      setNotice(`A tray holds up to ${MAX_COINS} coins. Scan this one, export it, then start a new tray.`);
      return;
    }
    setNotice(null);
    setSlots((prev) => [...prev, newSlot()]);
    log.info("batch", `Coin slot added (${slotsRef.current.length + 1} in tray)`);
  }

  function removeSlot(id: string) {
    const i = slotsRef.current.findIndex((s) => s.id === id);
    setSlots((prev) => prev.filter((s) => s.id !== id));
    setNotice(null);
    log.info("batch", `Coin ${i + 1} removed from tray`);
  }

  function setSide(id: string, side: SideKey, value: CapturedSide | null) {
    const i = slotsRef.current.findIndex((s) => s.id === id);
    patch(id, (s) => ({
      [side]: value,
      // A fresh photo on a failed coin puts it back in the queue.
      status: s.status === "error" ? "idle" : s.status,
      error: s.status === "error" ? null : s.error,
    }));
    if (value) log.info("batch", `Coin ${i + 1}: ${side} photo added`, { file: value.fileName, blurry: value.blocking });
    else log.info("batch", `Coin ${i + 1}: ${side} photo removed`);
  }

  /* ---------------- Scanning ---------------- */

  /** Locate, crop and identify one coin. Returns true on success. Photo problems never stop it. */
  async function scanOne(id: string, label: string): Promise<boolean> {
    const s = slotsRef.current.find((x) => x.id === id);
    if (!s?.front || !s.back) return false;
    const sides = { front: s.front, back: s.back };
    const opts = { demo };
    const tag = `batch:${label}`;
    const t0 = now();
    log.info("batch", `${label}: scan started`, { hints: s.hints.trim() ? `${s.hints.trim().length} chars` : "none", demo });
    patch(id, { status: "locating", error: null, problems: null });
    try {
      const located = await locateSides(sides, opts, tag);
      const crops = cropSides(sides, located.circles, opts);
      const problems = located.problems;
      if (problems.front.length || problems.back.length) log.warn("batch", `${label}: photo problems`, problems);
      patch(id, {
        status: "identifying",
        crops: { front: crops.front.full, back: crops.back.full },
        problems,
      });
      const hints = slotsRef.current.find((x) => x.id === id)?.hints ?? s.hints;
      const result = await identifyCrops(crops, hints, opts, {}, tag);
      const ms = Math.round(now() - t0);
      // Drop the full-size canvases now; the crops are all the result view needs.
      patch(id, {
        status: "done",
        listing: result.listing,
        market: result.market,
        ms,
        front: null,
        back: null,
        save: "idle",
        savedId: null,
        saveError: null,
      });
      log.info("batch", `${label}: scan finished in ${ms} ms`, {
        title: result.listing.title,
        price: result.listing.suggested_price_usd,
        confidence: result.listing.confidence,
      });
      return true;
    } catch (e) {
      const ms = Math.round(now() - t0);
      const message = e instanceof Error && e.message ? e.message : "Something went wrong";
      log.error("batch", `${label}: scan failed after ${ms} ms`, e);
      patch(id, { status: "error", error: message, ms });
      return false;
    }
  }

  async function runTray() {
    const targets = slotsRef.current.filter(isReady);
    if (!targets.length || running) return;
    setRunning(true);
    setNotice(null);
    setSlots((prev) => prev.map((s) => (targets.some((t) => t.id === s.id) ? { ...s, status: "queued", error: null } : s)));
    const t0 = now();
    log.info("batch", `Tray scan started: ${targets.length} coins`, { demo });
    let ok = 0;
    for (let i = 0; i < targets.length; i++) {
      const id = targets[i].id;
      // Skip anything removed while earlier coins were scanning.
      if (!slotsRef.current.some((s) => s.id === id)) continue;
      setProgress({ index: i, total: targets.length, id });
      const n = slotsRef.current.findIndex((s) => s.id === id) + 1;
      if (await scanOne(id, `coin ${n}`)) ok++;
    }
    const ms = Math.round(now() - t0);
    log.info("batch", `Tray scan finished: ${ok}/${targets.length} coins in ${ms} ms`);
    setProgress(null);
    setRunning(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function retry(id: string) {
    if (running) return;
    const n = slotsRef.current.findIndex((s) => s.id === id) + 1;
    setRunning(true);
    setProgress({ index: 0, total: 1, id });
    log.info("batch", `Coin ${n}: retry`);
    await scanOne(id, `coin ${n}`);
    setProgress(null);
    setRunning(false);
  }

  /* ---------------- After the run ---------------- */

  async function saveAll(uid: string) {
    const targets = slotsRef.current.filter((s) => s.status === "done" && s.listing && s.crops && s.save !== "saved");
    if (!targets.length) return;
    setSaving(true);
    log.info("batch", `Saving ${targets.length} coins to the collection`);
    let ok = 0;
    for (const t of targets) {
      // Re-read: the listing may have been edited since the loop started.
      const s = slotsRef.current.find((x) => x.id === t.id);
      if (!s?.listing || !s.crops) continue;
      patch(s.id, { save: "saving", saveError: null });
      try {
        const id = await saveCoin(uid, { listing: s.listing, hints: s.hints, front: s.crops.front, back: s.crops.back });
        patch(s.id, { save: "saved", savedId: id });
        ok++;
      } catch (e) {
        log.error("batch", "Save failed", e);
        patch(s.id, { save: "error", saveError: (e as Error).message || "Could not save this coin." });
      }
    }
    log.info("batch", `Saved ${ok}/${targets.length} coins`);
    setSaving(false);
  }

  function onSaveAll() {
    if (user) {
      void saveAll(user.uid);
      return;
    }
    log.info("batch", "Save all requested while signed out; opening sign-in");
    openSignIn({
      reason: "Sign in to keep this tray in your collection",
      onDone: () => {
        import("@/lib/firebase/client").then(({ firebase }) => {
          const u = firebase().auth.currentUser;
          if (u) void saveAll(u.uid);
        });
      },
    });
  }

  function downloadCsv() {
    const rows = done.map((s) => ({ listing: s.listing as CoinListing }));
    if (!rows.length) return;
    const stamp = new Date().toISOString().slice(0, 10);
    downloadText(ebayCsv(rows), `coinlens-tray-${stamp}.csv`, "text/csv");
    log.info("batch", `CSV exported: ${rows.length} coins`);
  }

  function newTray() {
    if (!confirmReset && done.length) {
      setConfirmReset(true);
      setTimeout(() => setConfirmReset(false), 3500);
      return;
    }
    log.info("batch", "New tray", { discarded: slots.length });
    setConfirmReset(false);
    setNotice(null);
    setSlots([newSlot(), newSlot()]);
    window.scrollTo({ top: 0 });
  }

  /* ---------------- Render ---------------- */

  const current = progress ? slots.find((s) => s.id === progress.id) : null;
  const progressText = progress
    ? `Coin ${progress.index + 1} of ${progress.total} · ${
        current?.status === "identifying" ? "identifying…" : current?.status === "locating" ? "locating…" : "starting…"
      }`
    : "";
  const progressPct = progress
    ? Math.round(((progress.index + (current?.status === "identifying" ? 0.6 : current?.status === "locating" ? 0.2 : 0)) / progress.total) * 100)
    : 0;

  let hint: string | null = null;
  if (!running && pending.length && !allReady) {
    hint = anyBlurry
      ? "Retake or keep the blurry photo to continue"
      : readyCount === 0 && pending.every((s) => !s.front && !s.back)
        ? "Add both sides of every coin to continue"
        : `${pending.length - readyCount} ${pending.length - readyCount === 1 ? "coin is" : "coins are"} missing a photo`;
  }

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-5 px-4 pb-44 pt-[max(1.25rem,env(safe-area-inset-top))]">
      <header className="flex items-center justify-between gap-3">
        <Link href="/" className="flex flex-col gap-1.5">
          <Wordmark size={18} tagline={null} />
          <h1 className="font-display text-[24px] font-semibold leading-none tracking-tight">Batch scan</h1>
        </Link>
        <div className="flex items-center gap-2">
          {hasAnything && !running ? (
            <button
              type="button"
              onClick={newTray}
              className={`rounded-full px-3.5 py-1.5 text-xs font-medium ${
                confirmReset ? "bg-red-500/20 text-red-100" : "btn-ghost"
              }`}
            >
              {confirmReset ? "Discard tray?" : "New tray"}
            </button>
          ) : (
            <Link href="/" className="btn-ghost rounded-full px-3.5 py-1.5 text-xs font-medium">
              Single coin
            </Link>
          )}
          <AccountButton />
        </div>
      </header>

      {!hasAnything && (
        <div className="animate-fade-up">
          <h2 className="font-display text-[30px] font-medium leading-[1.05] tracking-tight text-cream-100">
            Many coins.
            <br />
            <span className="patina-text">One sitting.</span>
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-cream-300">
            Add the front and back of each coin on your tray. CoinLens scans them one after another, then
            you can save them all and download a single eBay CSV.
          </p>
        </div>
      )}

      {done.length > 0 && (
        <section className="card flex flex-wrap items-center justify-between gap-3 p-4" data-summary="1">
          <div>
            <p className="eyebrow">Tray so far</p>
            <p className="mt-1 text-sm text-cream-100">
              <span className="font-semibold">{done.length}</span> {done.length === 1 ? "coin" : "coins"} scanned
              {pending.length > 0 && <span className="text-cream-500"> · {pending.length} to go</span>}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[11px] uppercase tracking-wider text-cream-500">Total suggested</p>
            <p className="font-display text-xl font-semibold text-gold-300">{money(totalValue)}</p>
          </div>
        </section>
      )}

      <ul className="flex flex-col gap-3" aria-label="Coins in this tray">
        {slots.map((slot, i) => (
          <BatchCoin
            key={slot.id}
            slot={slot}
            index={i}
            busy={running}
            canRemove={slots.length > 1}
            onSide={(side, v) => setSide(slot.id, side, v)}
            onHints={(h) => patch(slot.id, { hints: h })}
            onRemove={() => removeSlot(slot.id)}
            onRetry={() => retry(slot.id)}
            onToggle={() => patch(slot.id, (s) => ({ expanded: !s.expanded }))}
            onListing={(l) => patch(slot.id, { listing: l })}
          />
        ))}
      </ul>

      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={addSlot}
          disabled={running || slots.length >= MAX_COINS}
          className="btn-ghost w-full rounded-2xl px-4 py-3 text-sm font-medium disabled:opacity-50"
        >
          + Add another coin
          <span className="ml-2 text-xs text-cream-500">
            {slots.length}/{MAX_COINS}
          </span>
        </button>
        {slots.length >= MAX_COINS && (
          <p className="text-center text-xs text-cream-500">
            A tray holds up to {MAX_COINS} coins. Scan this one, export it, then start a new tray.
          </p>
        )}
        {notice && <p className="text-center text-xs text-amber-200">{notice}</p>}
      </div>

      {/* Sticky bottom bar */}
      <div className="fixed inset-x-0 bottom-0 z-40 bg-gradient-to-t from-ink-900 via-ink-900/95 to-transparent px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-10">
        <div className="mx-auto flex max-w-lg flex-col gap-2">
          {running ? (
            <div className="card flex flex-col gap-2 px-4 py-3" role="status" aria-live="polite" data-progress="1">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-cream-100">{progressText}</p>
                <span aria-hidden="true" className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-patina-400/25 border-t-patina-400" />
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-patina-400 shadow-[0_0_14px_rgba(79,209,181,0.6)] transition-all duration-500"
                  style={{ width: `${Math.max(4, progressPct)}%` }}
                />
              </div>
            </div>
          ) : pending.length > 0 ? (
            <>
              <button
                type="button"
                disabled={!allReady}
                onClick={runTray}
                className="btn-primary w-full rounded-2xl px-4 py-4 text-base font-semibold"
              >
                Scan {pending.length} {pending.length === 1 ? "coin" : "coins"}
              </button>
              {hint && <p className="text-center text-xs text-cream-500">{hint}</p>}
            </>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-center text-xs text-cream-500" data-summary-line="1">
                {done.length} {done.length === 1 ? "coin" : "coins"} scanned · {money(totalValue)} total suggested
              </p>
              <div className={`grid gap-2 ${enabled ? "grid-cols-2" : "grid-cols-1"}`}>
                {enabled && (
                  <button
                    type="button"
                    onClick={onSaveAll}
                    disabled={saving || unsaved.length === 0}
                    className="btn-primary rounded-2xl px-4 py-3.5 text-sm font-semibold"
                  >
                    {saving
                      ? "Saving…"
                      : unsaved.length === 0
                        ? "All saved ✓"
                        : `Save ${unsaved.length === done.length ? "all" : unsaved.length} to my coins`}
                  </button>
                )}
                <button
                  type="button"
                  onClick={downloadCsv}
                  className={`rounded-2xl px-4 py-3.5 text-sm font-semibold ${enabled ? "btn-ghost" : "btn-primary"}`}
                  data-csv="1"
                >
                  Download CSV for all
                </button>
              </div>
              <button
                type="button"
                onClick={addSlot}
                disabled={slots.length >= MAX_COINS}
                className="text-center text-xs text-cream-500 underline-offset-4 hover:text-cream-100 hover:underline disabled:opacity-50"
              >
                Add more coins to this tray
              </button>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

/** useSearchParams() is request-time data, so the tray streams in behind a Suspense boundary. */
export default function BatchPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto w-full max-w-lg px-4 pt-6">
          <div className="card h-40 w-full animate-pulse rounded-3xl bg-white/5" aria-busy="true" />
        </main>
      }
    >
      <BatchTray />
    </Suspense>
  );
}
