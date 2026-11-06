"use client";

import { useEffect, useState } from "react";
import { formatEntries, installGlobalErrorLogging, log, useLogEntries } from "@/lib/log";

/**
 * Floating "Logs" chip that opens a drawer with every logged step.
 * Always available; it turns red when an error has been logged.
 */
export default function DebugPanel() {
  const entries = useLogEntries();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    installGlobalErrorLogging();
  }, []);

  const errors = entries.filter((e) => e.level === "error").length;
  const warns = entries.filter((e) => e.level === "warn").length;

  async function copyAll() {
    try {
      await navigator.clipboard.writeText(formatEntries(entries));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      log.warn("debug", "Clipboard blocked when copying logs", e);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open logs"
        className={`shrink-0 rounded-full border px-2.5 py-1 font-mono text-[11px] ${
          errors
            ? "border-red-400/60 bg-red-500/20 text-red-200"
            : warns
              ? "border-gold-400/50 bg-gold-400/15 text-gold-200"
              : "border-white/10 bg-ink-800/70 text-cream-500"
        }`}
      >
        {errors ? `${errors} err` : "logs"} · {entries.length}
      </button>

      {open && (
        <div className="fixed inset-0 z-[70] flex flex-col bg-ink-950/95 backdrop-blur-sm">
          <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
            <p className="font-display text-lg font-semibold">Logs</p>
            <p className="text-xs text-cream-500">
              {entries.length} entries · {errors} errors · {warns} warnings
            </p>
            <div className="ml-auto flex gap-2">
              <button type="button" onClick={copyAll} className="btn-ghost rounded-full px-3 py-1 text-xs">
                {copied ? "Copied" : "Copy"}
              </button>
              <button type="button" onClick={() => log.clear()} className="btn-ghost rounded-full px-3 py-1 text-xs">
                Clear
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-full bg-gold-400 px-3 py-1 text-xs font-semibold text-ink-950"
              >
                Close
              </button>
            </div>
          </div>
          <ol className="flex-1 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-snug">
            {entries.length === 0 && <li className="p-3 text-cream-500">Nothing logged yet.</li>}
            {entries
              .slice()
              .reverse()
              .map((e) => (
                <li
                  key={e.id}
                  className={`border-b border-white/5 py-1.5 ${
                    e.level === "error" ? "text-red-300" : e.level === "warn" ? "text-gold-200" : "text-cream-300"
                  }`}
                >
                  <span className="text-cream-500">{new Date(e.t).toISOString().slice(11, 23)}</span>{" "}
                  <span className="font-semibold">{e.step}</span> {e.msg}
                  {e.data !== undefined && (
                    <pre className="mt-0.5 whitespace-pre-wrap break-all text-[10px] text-cream-500">
                      {JSON.stringify(e.data, null, 1)}
                    </pre>
                  )}
                </li>
              ))}
          </ol>
        </div>
      )}
    </>
  );
}
