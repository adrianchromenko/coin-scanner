"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import AccountButton from "@/components/AccountButton";
import { useAuth } from "@/components/AuthProvider";
import Logo from "@/components/Logo";
import { STATUS_LABEL, subscribeCoins, type CoinStatus, type SavedCoin } from "@/lib/firebase/coins";

function money(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function when(ms: number) {
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

const STATUS_STYLE: Record<CoinStatus, string> = {
  saved: "bg-white/10 text-cream-300",
  listed: "bg-sky-500/15 text-sky-200",
  sold: "bg-emerald-500/15 text-emerald-200",
};

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
        <AccountButton />
      </div>
    </header>
  );
}

export default function CoinsPage() {
  const { enabled, user, loading, openSignIn } = useAuth();
  const [data, setData] = useState<{ uid: string; coins: SavedCoin[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

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
    if (!q) return coins;
    return coins.filter((c) =>
      [c.listing.title, c.listing.year, c.listing.country, c.listing.coin_type, c.listing.mint_mark]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [coins, filter]);

  const total = useMemo(
    () => (coins ?? []).reduce((sum, c) => sum + (Number(c.listing.suggested_price_usd) || 0), 0),
    [coins],
  );

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
        <div className="flex items-center gap-3">
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search year, type, country…"
            className="input-dark flex-1"
          />
          <div className="shrink-0 text-right">
            <p className="text-[11px] uppercase tracking-wider text-cream-500">Est. total</p>
            <p className="font-display text-lg font-semibold text-gold-300">{money(total)}</p>
          </div>
        </div>
        {shown.length === 0 ? (
          <p className="px-1 text-sm text-cream-500">Nothing matches “{filter}”.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {shown.map((c) => (
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
                    <div className="mt-2 flex items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLE[c.status]}`}>
                        {STATUS_LABEL[c.status]}
                      </span>
                      {!c.listing.identified && (
                        <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-200">
                          Not identified
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-display text-lg font-semibold text-gold-300">
                      {money(Number(c.listing.suggested_price_usd) || 0)}
                    </p>
                    <p className="text-[11px] text-cream-500">suggested</p>
                  </div>
                </Link>
              </li>
            ))}
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
