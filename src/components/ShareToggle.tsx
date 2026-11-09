"use client";

import { useState, useSyncExternalStore } from "react";
import { setCoinPublic, shareUrl } from "@/lib/firebase/share";
import { log } from "@/lib/log";

type Props = {
  uid: string;
  coinId: string;
  isPublic: boolean;
  /** Called after the flag was saved successfully. */
  onChange: (isPublic: boolean) => void;
};

/**
 * "Public link" switch for a saved coin. When on, anyone with the link can
 * open a read-only page showing the listing and the two photos.
 */
export default function ShareToggle({ uid, coinId, isPublic, onChange }: Props) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // navigator.share only exists in some browsers. The server snapshot is
  // always false so hydration matches; the client snapshot is the real check.
  const canShare = useSyncExternalStore(
    () => () => {},
    () => typeof navigator.share === "function",
    () => false,
  );

  const url = shareUrl(uid, coinId);

  async function toggle() {
    const next = !isPublic;
    setSaving(true);
    setError(null);
    try {
      await setCoinPublic(uid, coinId, next);
      onChange(next);
    } catch (e) {
      log.error("share", `Could not set coin ${coinId} ${next ? "public" : "private"}`, e);
      setError((e as Error).message || "Could not update the link. Try again.");
    } finally {
      setSaving(false);
    }
  }

  async function copy() {
    setError(null);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
      log.info("share", "Copied share link");
    } catch (e) {
      log.warn("share", "Clipboard write failed", e);
      setError("Couldn't copy. Long-press the link to copy it.");
    }
  }

  async function share() {
    setError(null);
    try {
      await navigator.share({ title: "Coin on CoinLens", url });
      log.info("share", "Shared link via native share sheet");
    } catch (e) {
      // The user closing the share sheet is not an error worth showing.
      if ((e as Error).name !== "AbortError") {
        log.warn("share", "Native share failed", e);
        setError("Sharing didn't work. Copy the link instead.");
      }
    }
  }

  return (
    <section className="card flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-cream-100">Public link</p>
          <p className="mt-0.5 text-xs text-cream-500">
            Anyone with the link sees this listing and its photos, not your account or other coins.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={isPublic}
          aria-label="Public link"
          disabled={saving}
          onClick={toggle}
          className={`relative h-7 w-12 shrink-0 rounded-full transition disabled:opacity-60 ${
            isPublic ? "bg-patina-400" : "bg-white/15"
          }`}
        >
          <span
            className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-[left] ${
              isPublic ? "left-[1.375rem]" : "left-0.5"
            }`}
          />
        </button>
      </div>

      {isPublic && (
        <div className="flex flex-col gap-2">
          <p className="truncate rounded-xl bg-black/30 px-3 py-2 font-mono text-xs text-cream-300" title={url}>
            {url}
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={copy} className="btn-ghost rounded-full px-4 py-1.5 text-xs font-medium">
              {copied ? "Copied ✓" : "Copy link"}
            </button>
            {canShare && (
              <button type="button" onClick={share} className="btn-primary rounded-full px-4 py-1.5 text-xs font-semibold">
                Share…
              </button>
            )}
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto self-center text-xs text-cream-500 hover:text-cream-100"
            >
              Preview ↗
            </a>
          </div>
        </div>
      )}

      {saving && <p className="text-xs text-cream-500">Saving…</p>}
      {error && (
        <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">{error}</p>
      )}
    </section>
  );
}
