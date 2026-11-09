"use client";

import CoinCapture, { type CapturedSide } from "@/components/CoinCapture";
import ListingForm from "@/components/ListingForm";
import ListingPreview from "@/components/ListingPreview";
import type { CoinListing } from "@/lib/coinSchema";
import type { Market } from "@/lib/market";
import type { SideKey } from "@/lib/pipeline";

/**
 * One coin in a tray. Photos are held only until the scan finishes; after that
 * the (much smaller) crop data URLs are all that is kept, so a 20-coin tray
 * does not pin twenty full-size canvases in memory.
 */
export type SlotStatus = "idle" | "queued" | "locating" | "identifying" | "done" | "error";

export type SaveState = "idle" | "saving" | "saved" | "error";

export type Slot = {
  id: string;
  front: CapturedSide | null;
  back: CapturedSide | null;
  hints: string;
  status: SlotStatus;
  /** Full-size crop JPEG data URLs, once the coin has been located. */
  crops: Record<SideKey, string> | null;
  /** Photo problems the AI noticed, per side. Shown as chips; never blocking. */
  problems: Record<SideKey, string[]> | null;
  listing: CoinListing | null;
  market: Market | null;
  error: string | null;
  /** Wall-clock time of the last scan attempt. */
  ms: number | null;
  expanded: boolean;
  save: SaveState;
  savedId: string | null;
  saveError: string | null;
};

/**
 * The two starting slots get fixed ids so the server-rendered markup matches the
 * client's; slots added later only ever exist in the browser and get random ids.
 */
export function newSlot(id?: string): Slot {
  return {
    id: id ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    front: null,
    back: null,
    hints: "",
    status: "idle",
    crops: null,
    problems: null,
    listing: null,
    market: null,
    error: null,
    ms: null,
    expanded: false,
    save: "idle",
    savedId: null,
    saveError: null,
  };
}

export const STATUS_LABEL: Record<SlotStatus, string> = {
  idle: "",
  queued: "Queued",
  locating: "Locating…",
  identifying: "Identifying…",
  done: "Done",
  error: "Failed",
};

export function money(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n % 1 ? 2 : 0 });
}

type Props = {
  slot: Slot;
  index: number;
  /** True while any coin in the tray is being scanned; inputs lock. */
  busy: boolean;
  canRemove: boolean;
  onSide: (side: SideKey, value: CapturedSide | null) => void;
  onHints: (hints: string) => void;
  onRemove: () => void;
  onRetry: () => void;
  onToggle: () => void;
  onListing: (listing: CoinListing) => void;
};

function Spinner({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={`animate-spin ${className ?? ""}`} aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
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

function ProblemChips({ problems }: { problems: Record<SideKey, string[]> }) {
  const chips = (["front", "back"] as SideKey[]).flatMap((side) =>
    problems[side].map((p) => ({ key: `${side}:${p}`, text: `${side === "front" ? "Front" : "Back"}: ${p}` })),
  );
  if (!chips.length) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Photo problems">
      {chips.map((c) => (
        <li
          key={c.key}
          className="rounded-full border border-amber-400/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-200"
        >
          {c.text}
        </li>
      ))}
    </ul>
  );
}

export default function BatchCoin({
  slot,
  index,
  busy,
  canRemove,
  onSide,
  onHints,
  onRemove,
  onRetry,
  onToggle,
  onListing,
}: Props) {
  const n = index + 1;
  const scanning = slot.status === "locating" || slot.status === "identifying" || slot.status === "queued";
  const inProgress = slot.status === "locating" || slot.status === "identifying";

  /* ---------- Finished: compact result row, tap to expand ---------- */
  if (slot.status === "done" && slot.listing && slot.crops) {
    const l = slot.listing;
    const pct = Math.round((Number(l.confidence) || 0) * 100);
    return (
      <li className="card overflow-hidden" data-slot={slot.id} data-status="done">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={slot.expanded}
          className="flex w-full items-center gap-3 p-3 text-left transition hover:bg-white/[0.03]"
        >
          <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-2xl bg-white">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={slot.crops.front} alt={`Coin ${n} front`} className="h-full w-full object-cover" />
            <span className="absolute left-1 top-1 rounded-full bg-ink-950/75 px-1.5 text-[10px] font-semibold text-cream-100">
              {n}
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 text-sm font-medium leading-snug text-cream-100">
              {l.title || "Untitled coin"}
            </p>
            <p className="mt-1 truncate text-xs text-cream-500">
              {[l.grade_estimate, l.identified ? `${pct}% confident` : "Not identified"].filter(Boolean).join(" · ")}
            </p>
            {slot.problems && (slot.problems.front.length > 0 || slot.problems.back.length > 0) && (
              <div className="mt-1.5">
                <ProblemChips problems={slot.problems} />
              </div>
            )}
          </div>
          <div className="shrink-0 text-right">
            <p className="font-display text-lg font-semibold text-gold-300">{money(Number(l.suggested_price_usd) || 0)}</p>
            <p className="text-[11px] text-cream-500">suggested</p>
            {slot.save === "saved" && (
              <p className="mt-1 flex items-center justify-end gap-1 text-[11px] font-medium text-emerald-300" data-saved="1">
                <CheckIcon className="h-3 w-3" /> Saved
              </p>
            )}
            {slot.save === "saving" && (
              <p className="mt-1 flex items-center justify-end gap-1 text-[11px] text-cream-500">
                <Spinner className="h-3 w-3" /> Saving
              </p>
            )}
            {slot.save === "error" && <p className="mt-1 text-[11px] text-red-300">Not saved</p>}
          </div>
          <span
            className={`ml-1 shrink-0 text-cream-500 transition-transform ${slot.expanded ? "rotate-180" : ""}`}
            aria-hidden="true"
          >
            ▾
          </span>
        </button>
        {slot.saveError && <p className="px-4 pb-3 text-xs text-red-300">{slot.saveError}</p>}
        {slot.expanded && (
          <div className="flex animate-fade-up flex-col gap-4 border-t border-white/8 p-3 pt-4" data-expanded="1">
            <ListingPreview listing={l} front={slot.crops.front} back={slot.crops.back} />
            <ListingForm listing={l} onChange={onListing} front={slot.crops.front} back={slot.crops.back} />
            <button
              type="button"
              onClick={onToggle}
              className="btn-ghost self-center rounded-full px-4 py-1.5 text-xs font-medium"
            >
              Collapse coin {n}
            </button>
          </div>
        )}
      </li>
    );
  }

  /* ---------- Setup / queued / scanning / error ---------- */
  const locked = busy || scanning;
  return (
    <li
      className={`card p-3 ${slot.status === "error" ? "border-red-400/30" : ""}`}
      data-slot={slot.id}
      data-status={slot.status}
    >
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold ${
              inProgress ? "bg-patina-400 text-ink-950" : "border border-white/15 text-cream-300"
            }`}
          >
            {inProgress ? <Spinner className="h-3.5 w-3.5" /> : n}
          </span>
          <p className="font-display text-base font-semibold leading-none">Coin {n}</p>
          {slot.status !== "idle" && (
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                slot.status === "error"
                  ? "bg-red-500/15 text-red-200"
                  : inProgress
                    ? "bg-patina-400/15 text-patina-300"
                    : "bg-white/10 text-cream-300"
              }`}
              role={inProgress ? "status" : undefined}
            >
              {STATUS_LABEL[slot.status]}
            </span>
          )}
        </div>
        {canRemove && !locked && (
          <button
            type="button"
            onClick={onRemove}
            className="text-xs font-medium text-cream-500 underline-offset-4 hover:text-cream-100 hover:underline"
          >
            Remove
          </button>
        )}
      </div>

      <div className={`grid grid-cols-[1fr_1fr_1.6fr] gap-2.5 ${locked ? "pointer-events-none opacity-70" : ""}`}>
        <CoinCapture
          compact
          step={1}
          label="Front"
          sublabel="obverse"
          hint=""
          value={slot.front}
          onChange={(v) => onSide("front", v)}
        />
        <CoinCapture
          compact
          step={2}
          label="Back"
          sublabel="reverse"
          hint=""
          value={slot.back}
          onChange={(v) => onSide("back", v)}
        />
        <label className="flex min-w-0 flex-col gap-1">
          <span className="text-[11px] text-cream-500">Hints (optional)</span>
          <input
            type="text"
            value={slot.hints}
            onChange={(e) => onHints(e.target.value)}
            placeholder="e.g. 1921 S, 27 g"
            disabled={locked}
            className="input-dark min-w-0 flex-1 py-2 text-xs"
          />
        </label>
      </div>

      {slot.problems && (slot.problems.front.length > 0 || slot.problems.back.length > 0) && (
        <div className="mt-2.5">
          <ProblemChips problems={slot.problems} />
        </div>
      )}

      {slot.status === "error" && (
        <div className="mt-3 flex items-center gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2">
          <p className="min-w-0 flex-1 text-xs text-red-200">{slot.error ?? "Something went wrong"}</p>
          <button
            type="button"
            onClick={onRetry}
            disabled={busy || !slot.front || !slot.back}
            className="btn-primary shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold"
          >
            Retry
          </button>
        </div>
      )}
    </li>
  );
}
