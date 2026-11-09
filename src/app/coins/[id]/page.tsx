"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import AccountButton from "@/components/AccountButton";
import { useAuth } from "@/components/AuthProvider";
import EbayButton from "@/components/EbayButton";
import ListingForm from "@/components/ListingForm";
import ListingPreview from "@/components/ListingPreview";
import ShareToggle from "@/components/ShareToggle";
import ValueHistory from "@/components/ValueHistory";
import type { CoinListing, PriceSource } from "@/lib/coinSchema";
import {
  EMPTY_MONEY,
  STATUS_LABEL,
  deleteCoin,
  getCoin,
  getCoinImages,
  netProfit,
  updateCoin,
  valuePoint,
  type CoinImages,
  type CoinMoney,
  type CoinStatus,
  type SavedCoin,
} from "@/lib/firebase/coins";
import { log } from "@/lib/log";
import { money, type Market } from "@/lib/market";
import { ApiError, postJson } from "@/lib/pipeline";

const STATUSES: CoinStatus[] = ["saved", "listed", "sold"];

const PLATFORMS = ["eBay", "Local", "Coin shop", "Auction house", "Facebook Marketplace", "Etsy", "Other"];

/** What POST /api/revalue returns (see the route for the authoritative shape). */
type RevalueResponse = {
  estimated_value_usd: { low: number; high: number };
  suggested_price_usd: number;
  price_basis: string;
  price_sources: PriceSource[];
  market: Market | null;
  requestId?: string;
};

/** yyyy-mm-dd in local time, for <input type="date">. */
function dateInput(ms: number | null): string {
  if (ms === null) return "";
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Local noon on the given day, so the date survives time-zone round trips. */
function fromDateInput(s: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d, 12).getTime();
}

function parseMoney(s: string): number | null {
  if (s.trim() === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Marking a coin sold without a date stamps today, so the tax export has one. */
function statusPatch(next: CoinStatus, soldAt: number | null): { status: CoinStatus; sold_at?: number } {
  return next === "sold" && soldAt === null ? { status: next, sold_at: Date.now() } : { status: next };
}

function signed(n: number) {
  return `${n < 0 ? "−" : n > 0 ? "+" : ""}${money(Math.abs(n))}`;
}

function MoneyField({
  label,
  value,
  onChange,
  placeholder = "0.00",
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="eyebrow mb-1.5 block">{label}</span>
      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-cream-500">$</span>
        <input
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          value={value === null ? "" : String(value)}
          onChange={(e) => onChange(parseMoney(e.target.value))}
          placeholder={placeholder}
          className="input-dark pl-7"
        />
      </div>
    </label>
  );
}

function CoinDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { enabled, user, loading, openSignIn } = useAuth();
  const [coin, setCoin] = useState<SavedCoin | null | undefined>(undefined);
  const [images, setImages] = useState<CoinImages | null>(null);
  const [listing, setListing] = useState<CoinListing | null>(null);
  const [status, setStatus] = useState<CoinStatus>("saved");
  const [moneyFields, setMoneyFields] = useState<CoinMoney>(EMPTY_MONEY);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<"save" | "delete" | "revalue" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    if (!user || !id) return;
    let cancelled = false;
    (async () => {
      try {
        const [c, im] = await Promise.all([getCoin(user.uid, id), getCoinImages(user.uid, id)]);
        if (cancelled) return;
        setError(null);
        setCoin(c);
        setImages(im);
        if (c) {
          setListing(c.listing);
          setStatus(c.status);
          setMoneyFields({
            cost_basis_usd: c.cost_basis_usd,
            sold_price_usd: c.sold_price_usd,
            fees_usd: c.fees_usd,
            sold_at: c.sold_at,
            sale_platform: c.sale_platform,
            notes: c.notes,
          });
          log.info("collection", `Opened coin ${id}`, { title: c.listing.title, history: c.value_history.length });
        }
      } catch (e) {
        if (!cancelled) {
          log.error("collection", `Could not open coin ${id}`, e);
          setError((e as Error).message);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, id]);

  function showFlash(msg: string) {
    setFlash(msg);
    setTimeout(() => setFlash(null), 1600);
  }

  function edit(next: CoinListing) {
    setListing(next);
    setDirty(true);
  }

  function editMoney(patch: Partial<CoinMoney>) {
    setMoneyFields((m) => {
      const next = { ...m, ...patch };
      // Entering a sale price for the first time stamps today as the sale date.
      if (patch.sold_price_usd !== undefined && patch.sold_price_usd !== null && m.sold_at === null) {
        next.sold_at = Date.now();
      }
      return next;
    });
    setDirty(true);
  }

  async function save() {
    if (!user || !listing || !coin) return;
    setBusy("save");
    setError(null);
    try {
      // A hand-edited price is a new point on the value chart.
      const last = coin.value_history[coin.value_history.length - 1];
      const priceChanged =
        !last ||
        last.suggested !== (Number(listing.suggested_price_usd) || 0) ||
        last.low !== (Number(listing.estimated_value_usd.low) || 0) ||
        last.high !== (Number(listing.estimated_value_usd.high) || 0);
      const point = priceChanged ? valuePoint(listing, "manual edit") : undefined;
      await updateCoin(user.uid, id, { listing, status, ...moneyFields }, { appendValue: point });
      setCoin({
        ...coin,
        listing,
        status,
        ...moneyFields,
        value_history: point ? [...coin.value_history, point] : coin.value_history,
        updatedAt: Date.now(),
      });
      setDirty(false);
      log.info("collection", `Saved changes to coin ${id}`, {
        status,
        sold: moneyFields.sold_price_usd,
        cost: moneyFields.cost_basis_usd,
        priceChanged,
      });
      showFlash("Saved");
    } catch (e) {
      log.error("collection", `Could not save coin ${id}`, e);
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function changeStatus(next: CoinStatus) {
    if (!user) return;
    setStatus(next);
    const patch = statusPatch(next, moneyFields.sold_at);
    if (patch.sold_at !== undefined) setMoneyFields((m) => ({ ...m, sold_at: patch.sold_at ?? m.sold_at }));
    try {
      await updateCoin(user.uid, id, patch);
      setCoin((c) => (c ? { ...c, ...patch } : c));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function revalue() {
    if (!user || !coin || !listing) return;
    setBusy("revalue");
    setError(null);
    const t0 = performance.now();
    log.info("revalue", `Re-checking value of coin ${id}`, { title: listing.title, grade: listing.grade_estimate });
    try {
      const r = await postJson<RevalueResponse>("/api/revalue", { listing });
      const priceFields: Pick<CoinListing, "estimated_value_usd" | "suggested_price_usd" | "price_basis" | "price_sources"> = {
        estimated_value_usd: {
          low: Number(r.estimated_value_usd?.low) || 0,
          high: Number(r.estimated_value_usd?.high) || 0,
        },
        suggested_price_usd: Number(r.suggested_price_usd) || 0,
        price_basis: typeof r.price_basis === "string" ? r.price_basis : "",
        price_sources: Array.isArray(r.price_sources) ? r.price_sources : [],
      };
      // Persist the new prices onto the *saved* listing so unsaved edits stay unsaved;
      // the on-screen listing gets the same price fields on top of those edits.
      const savedListing: CoinListing = { ...coin.listing, ...priceFields };
      const market = r.market ?? coin.market;
      const point = valuePoint(savedListing, "revalue");
      await updateCoin(user.uid, id, { listing: savedListing, market }, { appendValue: point });
      setCoin({ ...coin, listing: savedListing, market, value_history: [...coin.value_history, point], updatedAt: Date.now() });
      setListing({ ...listing, ...priceFields });
      log.info("revalue", `Value updated in ${Math.round(performance.now() - t0)} ms`, {
        requestId: r.requestId,
        suggested: priceFields.suggested_price_usd,
        range: priceFields.estimated_value_usd,
        sources: priceFields.price_sources.length,
        melt: market?.melt_value_usd ?? null,
      });
      showFlash("Value updated");
    } catch (e) {
      log.error("revalue", `Re-check failed for coin ${id}`, e);
      setError(e instanceof ApiError ? e.message : (e as Error).message || "Could not re-check the value.");
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!user) return;
    setBusy("delete");
    try {
      await deleteCoin(user.uid, id);
      router.replace("/coins");
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  let body: React.ReactNode;
  if (!enabled) {
    body = <p className="card p-5 text-sm text-cream-300">Accounts aren&apos;t set up on this deployment.</p>;
  } else if (loading || (user && coin === undefined && !error)) {
    body = (
      <div className="card aspect-square w-full animate-pulse rounded-3xl bg-white/5" aria-busy="true" />
    );
  } else if (!user) {
    body = (
      <section className="card flex flex-col items-start gap-4 p-6">
        <p className="text-sm text-cream-300">Sign in to see this coin.</p>
        <button
          type="button"
          onClick={() => openSignIn()}
          className="btn-primary rounded-full px-5 py-2.5 text-sm font-semibold"
        >
          Sign in
        </button>
      </section>
    );
  } else if (error && !coin) {
    body = <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</p>;
  } else if (!coin || !listing) {
    body = (
      <section className="card flex flex-col items-start gap-3 p-6">
        <p className="font-display text-xl font-semibold">That coin isn&apos;t here</p>
        <p className="text-sm text-cream-300">It may have been deleted, or the link belongs to another account.</p>
        <Link href="/coins" className="btn-ghost rounded-full px-4 py-2 text-xs font-medium">
          Back to my coins
        </Link>
      </section>
    );
  } else {
    const profit = netProfit(moneyFields);
    const melt = coin.market?.melt_value_usd ?? null;
    const spot = coin.market?.spot ?? null;
    const sources = listing.price_sources.filter((s) => s.url);
    body = (
      <>
        <section className="card flex flex-col gap-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="eyebrow">Status</p>
              <div className="mt-1.5 flex gap-1.5">
                {STATUSES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => changeStatus(s)}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                      status === s ? "bg-patina-400 text-ink-950" : "bg-white/5 text-cream-300 hover:bg-white/10"
                    }`}
                  >
                    {STATUS_LABEL[s]}
                  </button>
                ))}
              </div>
            </div>
            <p className="text-xs text-cream-500">
              Saved {new Date(coin.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
            </p>
          </div>
          <ShareToggle
            uid={user.uid}
            coinId={id}
            isPublic={coin.public ?? false}
            onChange={(v: boolean) => setCoin((c) => (c ? { ...c, public: v } : c))}
          />
        </section>

        {images ? (
          <>
            <ListingPreview listing={listing} front={images.front} back={images.back} />
            <EbayButton listing={listing} front={images.front} back={images.back} sku={coin.id} />
          </>
        ) : (
          <p className="card p-5 text-sm text-cream-300">The photos for this coin could not be loaded.</p>
        )}

        {/* Value */}
        <section className="card p-5">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <p className="eyebrow mb-1">Value</p>
              <h2 className="font-display text-xl font-semibold leading-tight">What it&apos;s worth</h2>
            </div>
            <button
              type="button"
              onClick={revalue}
              disabled={busy !== null}
              className="btn-ghost shrink-0 rounded-full px-4 py-2 text-xs font-medium"
            >
              {busy === "revalue" ? "Checking…" : "Re-check value"}
            </button>
          </div>

          <div className={`grid gap-2 ${melt !== null ? "grid-cols-3" : "grid-cols-2"}`}>
            <div className="rounded-xl bg-black/25 px-3 py-2.5">
              <p className="eyebrow">Est. range</p>
              <p className="mt-0.5 truncate font-semibold">
                {money(listing.estimated_value_usd.low, 0)}–{money(listing.estimated_value_usd.high, 0)}
              </p>
            </div>
            <div className="rounded-xl border border-gold-400/30 bg-gold-400/10 px-3 py-2.5">
              <p className="eyebrow text-gold-300/80">Suggested</p>
              <p className="gold-text mt-0.5 truncate font-display text-lg font-bold">{money(listing.suggested_price_usd, 0)}</p>
            </div>
            {melt !== null && (
              <div className="rounded-xl bg-black/25 px-3 py-2.5">
                <p className="eyebrow">Melt</p>
                <p className="mt-0.5 truncate font-semibold">{money(melt)}</p>
              </div>
            )}
          </div>
          {spot && (
            <p className="mt-2 text-[11px] text-cream-500">
              {spot.metal.charAt(0).toUpperCase() + spot.metal.slice(1)} spot {money(spot.usd_per_oz)}/oz
              {spot.as_of && ` as of ${new Date(spot.as_of).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`}
              {spot.source && ` · ${spot.source}`}
            </p>
          )}

          {busy === "revalue" && (
            <p className="mt-3 text-xs text-cream-300" aria-live="polite">
              Searching recent sold listings for this coin and grade…
            </p>
          )}

          {(listing.price_basis || sources.length > 0) && (
            <div className="mt-4 rounded-xl bg-black/25 p-3 text-sm leading-relaxed text-cream-300">
              {listing.price_basis && <p className="whitespace-pre-wrap">{listing.price_basis}</p>}
              {sources.length > 0 && (
                <ul className={`${listing.price_basis ? "mt-2 " : ""}flex flex-col gap-1 text-xs`}>
                  {sources.map((s, i) => (
                    <li key={`${s.url}-${i}`} className="flex items-baseline justify-between gap-3">
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="min-w-0 truncate text-patina-300 underline-offset-4 hover:underline"
                      >
                        {s.title || s.url}
                      </a>
                      {s.price_usd !== null && s.price_usd !== undefined && (
                        <span className="shrink-0 text-cream-500">{money(s.price_usd, 0)}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="mt-4">
            <p className="eyebrow mb-2">Suggested price over time</p>
            <ValueHistory entries={coin.value_history} />
          </div>
        </section>

        {/* Money */}
        <section className="card p-5">
          <div className="mb-4">
            <p className="eyebrow mb-1">Money</p>
            <h2 className="font-display text-xl font-semibold leading-tight">Cost and sale</h2>
            <p className="mt-1 text-xs text-cream-500">Private to you. Feeds the profit stats and the sold-coins export.</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <MoneyField
              label="Cost basis"
              value={moneyFields.cost_basis_usd}
              onChange={(v) => editMoney({ cost_basis_usd: v })}
            />
            <MoneyField
              label="Sold price"
              value={moneyFields.sold_price_usd}
              onChange={(v) => editMoney({ sold_price_usd: v })}
            />
            <MoneyField label="Fees" value={moneyFields.fees_usd} onChange={(v) => editMoney({ fees_usd: v })} />
            <label className="block">
              <span className="eyebrow mb-1.5 block">Sold on</span>
              <input
                type="date"
                value={dateInput(moneyFields.sold_at)}
                onChange={(e) => editMoney({ sold_at: fromDateInput(e.target.value) })}
                className="input-dark"
              />
            </label>
            <label className="col-span-2 block">
              <span className="eyebrow mb-1.5 block">Platform</span>
              <input
                type="text"
                list="sale-platforms"
                value={moneyFields.sale_platform}
                onChange={(e) => editMoney({ sale_platform: e.target.value })}
                placeholder="eBay, Local, …"
                className="input-dark"
              />
              <datalist id="sale-platforms">
                {PLATFORMS.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
            </label>
            <label className="col-span-2 block">
              <span className="eyebrow mb-1.5 block">Notes</span>
              <textarea
                value={moneyFields.notes}
                onChange={(e) => editMoney({ notes: e.target.value })}
                rows={3}
                placeholder="Where it came from, buyer, lot number…"
                className="input-dark"
              />
            </label>
          </div>
          <div className="mt-4 flex items-center justify-between rounded-xl bg-black/25 px-3 py-2.5">
            <div>
              <p className="eyebrow">Net profit</p>
              <p className="text-[11px] text-cream-500">Sold price − fees − cost</p>
            </div>
            <p
              className={`font-display text-lg font-semibold ${
                profit === null ? "text-cream-500" : profit > 0 ? "text-emerald-300" : profit < 0 ? "text-red-300" : "text-cream-100"
              }`}
            >
              {profit === null ? "—" : signed(profit)}
            </p>
          </div>
          {status !== "sold" && moneyFields.sold_price_usd !== null && (
            <p className="mt-3 text-xs text-amber-200">
              This coin has a sale price but isn&apos;t marked sold. Set the status to Sold so it counts as realised profit.
            </p>
          )}
        </section>

        {images && <ListingForm listing={listing} onChange={edit} front={images.front} back={images.back} />}

        <section className="card flex flex-col gap-3 p-4">
          {!confirmDelete ? (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="self-start text-xs text-red-300 hover:text-red-200"
            >
              Delete this coin
            </button>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm text-red-200">Delete this coin and its photos? This can&apos;t be undone.</p>
              <button
                type="button"
                onClick={remove}
                disabled={busy === "delete"}
                className="rounded-full bg-red-500/20 px-4 py-1.5 text-xs font-semibold text-red-100 hover:bg-red-500/30 disabled:opacity-60"
              >
                {busy === "delete" ? "Deleting…" : "Yes, delete"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="btn-ghost rounded-full px-4 py-1.5 text-xs font-medium"
              >
                Keep it
              </button>
            </div>
          )}
        </section>

        {error && (
          <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</p>
        )}

        {(dirty || flash) && (
          <div className="fixed inset-x-0 bottom-0 z-40 bg-gradient-to-t from-ink-900 via-ink-900/95 to-transparent px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-10">
            <div className="mx-auto max-w-lg">
              <button
                type="button"
                onClick={save}
                disabled={busy !== null || !dirty}
                className="btn-primary w-full rounded-2xl px-4 py-4 text-base font-semibold"
              >
                {busy === "save" ? "Saving…" : flash && !dirty ? `${flash} ✓` : "Save changes"}
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-5 px-4 pb-40 pt-[max(1.25rem,env(safe-area-inset-top))]">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div>
            <Link href="/coins" className="text-xs text-cream-500 hover:text-cream-100">
              ← My coins
            </Link>
            <h1 className="font-display text-[22px] font-semibold leading-tight tracking-tight">Coin details</h1>
          </div>
        </div>
        <AccountButton />
      </header>
      <div className="flex animate-fade-up flex-col gap-5">{body}</div>
    </main>
  );
}

/** useParams() is request-time data, so the detail view streams in behind a Suspense boundary. */
export default function CoinDetailPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto w-full max-w-lg px-4 pt-6">
          <div className="card aspect-square w-full animate-pulse rounded-3xl bg-white/5" aria-busy="true" />
        </main>
      }
    >
      <CoinDetail />
    </Suspense>
  );
}
