"use client";

import { useState } from "react";
import { log } from "@/lib/log";
import { removeQueued, useOnline, useQueuedScans, type QueuedScan } from "@/lib/offlineQueue";

type Props = {
  /** Called with the saved scan; the parent restores the photos and starts the normal flow. */
  onRun: (item: QueuedScan) => void;
  /** True while a scan is already running; disables "Run now" on every item. */
  busy?: boolean;
};

function when(ts: number): string {
  const diffMin = Math.round((Date.now() - ts) / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin} min ago`;
  const h = Math.round(diffMin / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Lists scans that were saved while offline. Renders nothing when the queue is
 * empty. Each item can be run (when online) or deleted.
 */
export default function PendingScansBanner({ onRun, busy = false }: Props) {
  const { items } = useQueuedScans();
  const online = useOnline();
  const [deleting, setDeleting] = useState<string | null>(null);

  if (items.length === 0) return null;

  async function onDelete(item: QueuedScan) {
    setDeleting(item.id);
    log.info("queue", "User deleted a saved scan", { id: item.id });
    try {
      await removeQueued(item.id);
    } catch {
      // Already logged inside removeQueued; the list simply stays as is.
    } finally {
      setDeleting(null);
    }
  }

  function onRunClick(item: QueuedScan) {
    log.info("queue", "User ran a saved scan", { id: item.id, online });
    onRun(item);
  }

  const n = items.length;

  return (
    <section className="card flex animate-fade-up flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-display text-lg font-semibold">
            {n === 1 ? "1 scan waiting" : `${n} scans waiting`}
          </p>
          <p className="text-xs text-cream-500">
            {online
              ? "Saved while you were offline. Run them now or delete them."
              : "You're offline — they'll run when you're back."}
          </p>
        </div>
        <span
          aria-hidden
          className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${online ? "bg-emerald-400" : "bg-amber-400"}`}
        />
      </div>

      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-2"
          >
            <div className="flex shrink-0 -space-x-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.front.dataUrl}
                alt="Front"
                className="h-12 w-12 rounded-full border-2 border-ink-800 object-cover"
              />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.back.dataUrl}
                alt="Back"
                className="h-12 w-12 rounded-full border-2 border-ink-800 object-cover"
              />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-cream-100">
                {item.hints.trim() ? item.hints.trim() : "No notes"}
              </p>
              <p className="text-xs text-cream-500">Saved {when(item.createdAt)}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={() => onRunClick(item)}
                disabled={!online || busy || deleting === item.id}
                className="btn-primary rounded-full px-3 py-1.5 text-xs font-semibold"
              >
                Run now
              </button>
              <button
                type="button"
                onClick={() => onDelete(item)}
                disabled={deleting === item.id}
                className="btn-ghost rounded-full px-3 py-1.5 text-xs font-medium"
              >
                {deleting === item.id ? "…" : "Delete"}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
