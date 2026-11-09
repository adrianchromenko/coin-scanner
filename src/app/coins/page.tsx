"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import AccountButton from "@/components/AccountButton";
import { useAuth } from "@/components/AuthProvider";
import Logo from "@/components/Logo";
import { downloadText, ebayCsv, toCsv } from "@/lib/csv";
import { STATUS_LABEL, netProfit, subscribeCoins, type CoinStatus, type SavedCoin } from "@/lib/firebase/coins";
import { useListingTemplate } from "@/lib/firebase/settings";
import { log } from "@/lib/log";
import { applyTemplate, skuFor } from "@/lib/template";

function money(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function when(ms: number) {
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** yyyy-mm-dd in local time, for <input type="date">. */
function dateInput(ms: number) {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Start (or end) of the given local day, from a yyyy-mm-dd string. */
function dayBound(s: string, end: boolean): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  return end ? new Date(y, m - 1, d, 23, 59, 59, 999).getTime() : new Date(y, m - 1, d).getTime();
}

const STATUS_STYLE: Record<CoinStatus, string> = {
  saved: "bg-white/10 text-cream-300",
  listed: "bg-sky-500/15 text-sky-200",
  sold: "bg-emerald-500/15 text-emerald-200",
};

type StatusFilter = "all" | CoinStatus;
const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "saved", label: "Saved" },
  { key: "listed", label: "Listed" },
  { key: "sold", label: "Sold" },
];

function Header({ count }: { count: number | null }) {
  return (
    <header className="flex items-center justify-between gap-3">
      <Link href="/" className="flex items-center gap-3">
        <Logo size={40} className="drop-shadow-[0_6px_18px_rgba(236,193,79,0.35)]" />
        <div>
          <h1 className="font-display text-[26px] font-semibold leading-none tracking-tight">My coins</h1>
          <p className="mt-1 text-xs text-cream-500">
            {count === null ? "Your collection" : `${count} ${count === 1 ? "coin" : "coins"} saved`}
          </p>
        </div>
      </Link>
      <div className="flex items-center gap-2">
        <Link href="/" className="btn-ghost rounded-full px-3.5 py-1.5 text-xs font-medium">
          Scan a coin
        </Link>
        <Link
          href="/settings"
          aria-label="Settings"
          title="Settings"
          className="btn-ghost flex h-8 w-8 items-center justify-center rounded-full"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
          </svg>
        </Link>
        <AccountButton />
      </div>
    </header>
  );
}

function Stat({ label, value, tone = "" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl bg-black/25 px-3 py-2.5">
      <p className="eyebrow">{label}</p>
      <p className={`mt-0.5 truncate font-display text-lg font-semibold ${tone || "text-cream-100"}`}>{value}</p>
    </div>
  );
}

export default function CoinsPage() {
  const { enabled, user, loading, openSignIn } = useAuth();
  const { template } = useListingTemplate();
  const [data, setData] = useState<{ uid: string; coins: SavedCoin[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [exportOpen, setExportOpen] = useState(false);
  // Empty until the export menu opens (a prerender must not read the clock); blank = no bound.
  const [range, setRange] = useState({ from: "", to: "" });
  function openExport() {
    if (!exportOpen && !range.from && !range.to) {
      const now = new Date();
      setRange({ from: dateInput(new Date(now.getFullYear(), 0, 1).getTime()), to: dateInput(now.getTime()) });
    }
    setExportOpen(!exportOpen);
  }

  useEffect(() => {
    if (!user) return;
    const uid = user.uid;
    return subscribeCoins(
      uid,
      (coins) => {
        setData({ uid, coins });
        setError(null);
      },
      (e) => setError(e.message),
    );
  }, [user]);
  // Coins from a previous account are never shown after a sign-out / switch.
  const coins = user && data?.uid === user.uid ? data.coins : null;

  const shown = useMemo(() => {
    if (!coins) return [];
    const q = filter.trim().toLowerCase();
    return coins.filter((c) => {
      if (status !== "all" && c.status !== status) return false;
      if (!q) return true;
      return [c.listing.title, c.listing.year, c.listing.country, c.listing.coin_type, c.listing.mint_mark]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [coins, filter, status]);

  const counts = useMemo(() => {
    const n: Record<StatusFilter, number> = { all: 0, saved: 0, listed: 0, sold: 0 };
    for (const c of coins ?? []) {
      n.all++;
      n[c.status]++;
    }
    return n;
  }, [coins]);

  const stats = useMemo(() => {
    let cost = 0;
    let value = 0;
    let profit = 0;
    let soldCount = 0;
    for (const c of coins ?? []) {
      cost += c.cost_basis_usd ?? 0;
      if (c.status === "sold") {
        soldCount++;
        profit += netProfit(c) ?? 0;
      } else {
        value += Number(c.listing.suggested_price_usd) || 0;
      }
    }
    return { cost, value, profit, soldCount };
  }, [coins]);

  function exportAll() {
    if (!coins?.length) return;
    const rows = coins.map((c) => ({ listing: applyTemplate(c.listing, template), sku: skuFor(template, c.id) }));
    downloadText(ebayCsv(rows), `coinlens-all-coins-${dateInput(Date.now())}.csv`, "text/csv");
    log.info("export", "All coins CSV downloaded", { coins: rows.length });
    setExportOpen(false);
  }

  const soldInRange = useMemo(() => {
    const from = dayBound(range.from, false);
    const to = dayBound(range.to, true);
    return (coins ?? []).filter((c) => {
      if (c.status !== "sold") return false;
      // Coins marked sold without a date fall back to when they were last edited.
      const t = c.sold_at ?? c.updatedAt;
      if (from !== null && t < from) return false;
      if (to !== null && t > to) return false;
      return true;
    });
  }, [coins, range]);

  function exportSold() {
    if (!soldInRange.length) return;
    const header = ["Date sold", "Title", "Grade", "Cost", "Sold price", "Fees", "Net profit", "Platform"];
    const rows = [...soldInRange]
      .sort((a, b) => (a.sold_at ?? a.updatedAt) - (b.sold_at ?? b.updatedAt))
      .map((c) => [
        dateInput(c.sold_at ?? c.updatedAt),
        c.listing.title,
        c.listing.slab_grade || c.listing.grade_estimate,
        c.cost_basis_usd ?? "",
        c.sold_price_usd ?? "",
        c.fees_usd ?? "",
        netProfit(c) ?? "",
        c.sale_platform,
      ]);
    downloadText(toCsv(header, rows), `coinlens-sold-${range.from}-to-${range.to}.csv`, "text/csv");
    log.info("export", "Sold coins CSV downloaded", { coins: rows.length, from: range.from, to: range.to });
    setExportOpen(false);
  }

  let body: React.ReactNode;
  if (!enabled) {
    body = (
      <p className="card p-5 text-sm text-cream-300">
        Accounts aren&apos;t set up on this deployment yet. Add the Firebase settings described in the
        README to turn on saving.
      </p>
    );
  } else if (loading) {
    body = <Skeleton />;
  } else if (!user) {
    body = (
      <section className="card flex flex-col items-start gap-4 p-6">
        <h2 className="font-display text-2xl font-semibold">Your coins, in one place</h2>
        <p className="text-sm text-cream-300">
          Sign in to see every coin you&apos;ve saved, edit listings later and track what&apos;s listed or sold.
        </p>
        <button
          type="button"
          onClick={() => openSignIn({ reason: "Sign in to see your collection" })}
          className="btn-gold rounded-full px-5 py-2.5 text-sm font-semibold"
        >
          Sign in or create account
        </button>
      </section>
    );
  } else if (error) {
    body = (
      <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</p>
    );
  } else if (coins === null) {
    body = <Skeleton />;
  } else if (coins.length === 0) {
    body = (
      <section className="card flex flex-col items-center gap-3 p-8 text-center">
        <Logo size={56} className="opacity-70" />
        <h2 className="font-display text-2xl font-semibold">No coins yet</h2>
        <p className="max-w-xs text-sm text-cream-300">
          Scan a coin and tap <span className="text-gold-300">Save to my coins</span> on the listing to
          start your collection.
        </p>
        <Link href="/" className="btn-gold mt-2 rounded-full px-5 py-2.5 text-sm font-semibold">
          Scan your first coin
        </Link>
      </section>
    );
  } else {
    body = (
      <>
        {/* Stats */}
        <section className="card p-3">
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Coins" value={String(coins.length)} />
            <Stat label="Total cost" value={money(stats.cost)} />
            <Stat label="Est. value (unsold)" value={money(stats.value)} tone="text-gold-300" />
            <Stat
              label={`Realised profit${stats.soldCount ? ` · ${stats.soldCount} sold` : ""}`}
              value={`${stats.profit < 0 ? "−" : ""}${money(Math.abs(stats.profit))}`}
              tone={stats.profit > 0 ? "text-emerald-300" : stats.profit < 0 ? "text-red-300" : "text-cream-100"}
            />
          </div>
        </section>

        {/* Search + export */}
        <div className="flex items-center gap-2">
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search year, type, country…"
            className="input-dark flex-1"
          />
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={openExport}
              aria-haspopup="menu"
              aria-expanded={exportOpen}
              className="btn-ghost rounded-xl px-3.5 py-2.5 text-xs font-medium"
            >
              Export {exportOpen ? "▴" : "▾"}
            </button>
            {exportOpen && (
              <div
                role="menu"
                className="card absolute right-0 top-12 z-30 w-[min(20rem,calc(100vw-2rem))] animate-fade-up p-3 shadow-2xl"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={exportAll}
                  className="block w-full rounded-xl px-3 py-2.5 text-left text-sm text-cream-100 hover:bg-white/5"
                >
                  All coins CSV (eBay format)
                  <span className="block text-[11px] text-cream-500">
                    {coins.length} {coins.length === 1 ? "coin" : "coins"}, template applied, SKU = coin id
                  </span>
                </button>
                <div className="my-2 hairline" />
                <div className="px-3 py-1">
                  <p className="text-sm text-cream-100">Sold coins CSV</p>
                  <p className="text-[11px] text-cream-500">Date, title, grade, cost, price, fees, profit, platform</p>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <label className="block">
                      <span className="eyebrow mb-1 block">From</span>
                      <input
                        type="date"
                        value={range.from}
                        max={range.to}
                        onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
                        className="input-dark px-2 py-1.5 text-xs"
                      />
                    </label>
                    <label className="block">
                      <span className="eyebrow mb-1 block">To</span>
                      <input
                        type="date"
                        value={range.to}
                        min={range.from}
                        onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
                        className="input-dark px-2 py-1.5 text-xs"
                      />
                    </label>
                  </div>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={exportSold}
                    disabled={soldInRange.length === 0}
                    className="btn-gold mt-2 w-full rounded-xl px-3 py-2 text-xs font-semibold"
                  >
                    {soldInRange.length === 0
                      ? "No sales in this range"
                      : `Download ${soldInRange.length} ${soldInRange.length === 1 ? "sale" : "sales"}`}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Status chips */}
        <div className="flex gap-1.5 overflow-x-auto pb-0.5" role="tablist" aria-label="Filter by status">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              role="tab"
              aria-selected={status === f.key}
              onClick={() => setStatus(f.key)}
              className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition ${
                status === f.key ? "bg-gold-400 text-ink-950" : "bg-white/5 text-cream-300 hover:bg-white/10"
              }`}
            >
              {f.label}
              <span className={`ml-1 ${status === f.key ? "text-ink-950/70" : "text-cream-500"}`}>{counts[f.key]}</span>
            </button>
          ))}
        </div>

        {shown.length === 0 ? (
          <p className="px-1 text-sm text-cream-500">
            {filter.trim() ? `Nothing matches “${filter}”.` : `No ${status === "all" ? "" : status + " "}coins yet.`}
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {shown.map((c) => {
              const profit = c.status === "sold" ? netProfit(c) : null;
              return (
                <li key={c.id}>
                  <Link
                    href={`/coins/${c.id}`}
                    className="card flex items-center gap-4 p-3 transition hover:border-gold-400/30"
                  >
                    <div className="h-20 w-20 shrink-0 overflow-hidden rounded-2xl bg-white">
                      {c.thumb ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={c.thumb} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="h-full w-full bg-ink-700" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 text-sm font-medium leading-snug text-cream-100">
                        {c.listing.title || "Untitled coin"}
                      </p>
                      <p className="mt-1 truncate text-xs text-cream-500">
                        {[c.listing.grade_estimate, c.listing.country, when(c.createdAt)].filter(Boolean).join(" · ")}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLE[c.status]}`}>
                          {STATUS_LABEL[c.status]}
                        </span>
                        {!c.listing.identified && (
                          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-200">
                            Not identified
                          </span>
                        )}
                        {c.public && (
                          <span className="rounded-full bg-gold-400/15 px-2 py-0.5 text-[11px] font-medium text-gold-200">
                            Shared
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      {c.status === "sold" && c.sold_price_usd !== null ? (
                        <>
                          <p className="font-display text-lg font-semibold text-emerald-200">{money(c.sold_price_usd)}</p>
                          <p className="text-[11px] text-cream-500">
                            {profit === null ? "sold" : `${profit < 0 ? "−" : "+"}${money(Math.abs(profit))} net`}
                          </p>
                        </>
                      ) : (
                        <>
                          <p className="font-display text-lg font-semibold text-gold-300">
                            {money(Number(c.listing.suggested_price_usd) || 0)}
                          </p>
                          <p className="text-[11px] text-cream-500">suggested</p>
                        </>
                      )}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-5 px-4 pb-16 pt-[max(1.25rem,env(safe-area-inset-top))]">
      <Header count={coins?.length ?? null} />
      <div className="flex animate-fade-up flex-col gap-4">{body}</div>
    </main>
  );
}

function Skeleton() {
  return (
    <ul className="flex flex-col gap-3" aria-busy="true" aria-label="Loading coins">
      {[0, 1, 2].map((i) => (
        <li key={i} className="card flex items-center gap-4 p-3">
          <div className="h-20 w-20 animate-pulse rounded-2xl bg-white/10" />
          <div className="flex-1 space-y-2">
            <div className="h-3.5 w-3/4 animate-pulse rounded bg-white/10" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-white/10" />
            <div className="h-4 w-16 animate-pulse rounded-full bg-white/10" />
          </div>
        </li>
      ))}
    </ul>
  );
}
