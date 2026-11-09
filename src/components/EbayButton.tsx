"use client";

import { useEffect, useRef, useState } from "react";
import type { CoinListing } from "@/lib/coinSchema";
import { log } from "@/lib/log";

type Props = { listing: CoinListing; front: string; back: string; sku?: string };

type Status = {
  configured: boolean;
  connected: boolean;
  env: "sandbox" | "production";
  marketplaceId?: string;
  reason?: string;
};

type ListResult = { listingId: string; url: string; sku: string; offerId: string; warnings?: string[] };

type State =
  | { kind: "loading" }
  | { kind: "hidden" }
  | { kind: "disconnected" }
  | { kind: "ready" }
  | { kind: "listing" }
  | { kind: "listed"; result: ListResult }
  | { kind: "error"; message: string; details?: string[]; reconnect?: boolean };

function formatPrice(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
}

/**
 * "List on eBay" card for the result screen. Renders nothing until /api/ebay/status
 * says the feature is configured. Handles connect, one-tap listing, and disconnect.
 */
export default function EbayButton({ listing, front, back, sku }: Props) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [env, setEnv] = useState<Status["env"]>("sandbox");
  const [notice, setNotice] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const busy = useRef(false);
  // Always list the latest edits, even if props change while the request is in flight.
  const latest = useRef({ listing, front, back, sku });
  useEffect(() => {
    latest.current = { listing, front, back, sku };
  }, [listing, front, back, sku]);

  useEffect(() => {
    let cancelled = false;

    // One-line notice from the OAuth redirect (?ebay=connected | ?ebay=error&reason=...).
    // Read and strip it now; it is applied together with the status result below.
    let redirectNotice: { tone: "ok" | "warn"; text: string } | null = null;
    try {
      const url = new URL(window.location.href);
      const flag = url.searchParams.get("ebay");
      if (flag) {
        const reason = url.searchParams.get("reason");
        redirectNotice =
          flag === "connected"
            ? { tone: "ok", text: "eBay account connected." }
            : { tone: "warn", text: `eBay connection failed${reason ? `: ${reason}` : "."}` };
        log.info("ebay", "OAuth redirect notice", { flag, reason });
        url.searchParams.delete("ebay");
        url.searchParams.delete("reason");
        window.history.replaceState(null, "", url.pathname + url.search + url.hash);
      }
    } catch {
      /* ignore */
    }

    fetch("/api/ebay/status", { cache: "no-store" })
      .then((r) => r.json() as Promise<Status>)
      .then((s) => {
        if (cancelled) return;
        log.info("ebay", "Status", s);
        setEnv(s.env);
        if (redirectNotice) setNotice(redirectNotice);
        if (!s.configured) setState({ kind: "hidden" });
        else setState({ kind: s.connected ? "ready" : "disconnected" });
      })
      .catch((e) => {
        if (cancelled) return;
        log.warn("ebay", "Status check failed", e);
        setState({ kind: "hidden" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.kind === "loading" || state.kind === "hidden") return null;

  const price = Number.isFinite(listing.suggested_price_usd) ? listing.suggested_price_usd : 0;
  const sandbox = env === "sandbox";

  async function disconnect() {
    if (busy.current) return;
    busy.current = true;
    try {
      await fetch("/api/ebay/disconnect", { method: "POST" });
      log.info("ebay", "Disconnected");
      setState({ kind: "disconnected" });
      setNotice(null);
    } catch (e) {
      log.warn("ebay", "Disconnect failed", e);
    } finally {
      busy.current = false;
    }
  }

  async function list() {
    if (busy.current) return;
    busy.current = true;
    setNotice(null);
    setState({ kind: "listing" });
    const cur = latest.current;
    const t0 = performance.now();
    log.info("ebay", "Listing — start", { title: cur.listing.title, price: cur.listing.suggested_price_usd, sku: cur.sku });
    try {
      const res = await fetch("/api/ebay/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          listing: cur.listing,
          front: cur.front,
          back: cur.back,
          price: cur.listing.suggested_price_usd,
          sku: cur.sku,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as Partial<ListResult> & {
        error?: string;
        details?: string[];
        reconnect?: boolean;
      };
      if (!res.ok || !data.listingId || !data.url) {
        const message = data.error || `Listing failed (${res.status})`;
        log.error("ebay", `Listing — failed after ${Math.round(performance.now() - t0)} ms`, { status: res.status, data });
        setState({ kind: "error", message, details: data.details, reconnect: Boolean(data.reconnect) });
        return;
      }
      log.info("ebay", `Listing — done in ${Math.round(performance.now() - t0)} ms`, data);
      setState({ kind: "listed", result: data as ListResult });
    } catch (e) {
      log.error("ebay", "Listing — network error", e);
      setState({ kind: "error", message: (e as Error).message || "Network error. Try again." });
    } finally {
      busy.current = false;
    }
  }

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }

  const noticeEl = notice && (
    <p
      className={`rounded-xl border px-3 py-2 text-xs ${
        notice.tone === "ok"
          ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200"
          : "border-amber-400/30 bg-amber-500/10 text-amber-200"
      }`}
    >
      {notice.text}
    </p>
  );

  const sandboxNote = sandbox && (
    <p className="text-[11px] text-cream-500">
      Sandbox mode: listings only appear on sandbox.ebay.com, never on the live site.
    </p>
  );

  if (state.kind === "listed") {
    const { result } = state;
    return (
      <section className="card flex flex-col gap-3 border-emerald-400/30 bg-emerald-500/10 p-4">
        <div>
          <p className="eyebrow text-emerald-300">Live on eBay</p>
          <p className="font-display text-lg font-semibold text-cream-100">Your coin is listed</p>
          <p className="mt-1 text-xs text-cream-300">
            Item {result.listingId} · SKU {result.sku}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={result.url}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-gold rounded-full px-4 py-2 text-xs font-semibold"
          >
            View listing
          </a>
          <button
            type="button"
            onClick={() => void copyLink(result.url)}
            className="btn-ghost rounded-full px-4 py-2 text-xs font-medium"
          >
            {copied ? "Copied" : "Copy link"}
          </button>
        </div>
        {result.warnings && result.warnings.length > 0 && (
          <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-amber-200">
            {result.warnings.slice(0, 3).map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        )}
        {sandboxNote}
      </section>
    );
  }

  if (state.kind === "disconnected") {
    return (
      <section className="card flex flex-col gap-3 p-4">
        {noticeEl}
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-display text-lg font-semibold">List on eBay</p>
            <p className="text-xs text-cream-500">
              Connect your seller account once, then publish any scan with one tap.
            </p>
          </div>
          {/* Plain anchor: /api/ebay/connect is a route handler that 302s to eBay, so a full navigation is intended. */}
          <a
            href="/api/ebay/connect"
            onClick={() => log.info("ebay", "Connect requested")}
            className="btn-gold shrink-0 rounded-full px-4 py-2 text-xs font-semibold"
          >
            Connect eBay
          </a>
        </div>
        {sandboxNote}
      </section>
    );
  }

  const listing_ = state.kind === "listing";

  return (
    <section className="card flex flex-col gap-3 p-4">
      {noticeEl}
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-display text-lg font-semibold">List on eBay</p>
          <p className="text-xs text-cream-500">
            Fixed price, one item, your default shipping, payment and return policies.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void list()}
          disabled={listing_ || price < 0.99}
          aria-busy={listing_}
          className="btn-gold shrink-0 rounded-full px-4 py-2 text-xs font-semibold"
        >
          {listing_ ? (
            <span className="inline-flex items-center gap-2">
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-ink-900/40 border-t-ink-900" />
              Listing…
            </span>
          ) : state.kind === "error" ? (
            "Retry"
          ) : (
            `List for ${formatPrice(price)}`
          )}
        </button>
      </div>
      {price < 0.99 && !listing_ && (
        <p className="text-[11px] text-amber-200">Set a price of at least $0.99 in the listing above first.</p>
      )}
      {state.kind === "error" && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          <p>{state.message}</p>
          {state.details && state.details.length > 0 && state.details[0] !== state.message && (
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] text-red-200/80">
              {state.details.slice(0, 3).map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          )}
          {state.reconnect && (
            <a href="/api/ebay/connect" className="mt-2 inline-block underline underline-offset-2">
              Reconnect eBay
            </a>
          )}
        </div>
      )}
      <div className="flex items-center justify-between gap-3">
        {sandboxNote || <span />}
        <button
          type="button"
          onClick={() => void disconnect()}
          disabled={listing_}
          className="text-[11px] text-cream-500 underline-offset-2 hover:text-cream-300 hover:underline disabled:opacity-50"
        >
          Disconnect
        </button>
      </div>
    </section>
  );
}
