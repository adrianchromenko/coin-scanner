"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import ListingPreview from "@/components/ListingPreview";
import Wordmark from "@/components/Wordmark";
import { firebaseEnabled } from "@/lib/firebase/client";
import { getPublicCoin, type PublicCoin } from "@/lib/firebase/share";
import { log } from "@/lib/log";

function money(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
}

function Skeleton() {
  return (
    <div className="flex flex-col gap-5" aria-busy="true">
      <div className="card aspect-square w-full animate-pulse rounded-3xl bg-white/5" />
      <div className="card h-24 w-full animate-pulse bg-white/5" />
    </div>
  );
}

function NotShared() {
  return (
    <section className="card flex flex-col items-start gap-3 p-6">
      <p className="font-display text-xl font-semibold">This coin isn&apos;t shared</p>
      <p className="text-sm text-cream-300">
        The owner hasn&apos;t made it public, or the link is out of date. Ask them for a fresh link, or scan a coin
        of your own.
      </p>
      <Link href="/" className="btn-primary rounded-full px-5 py-2.5 text-sm font-semibold">
        Scan a coin
      </Link>
    </section>
  );
}

function SharedCoin() {
  const { uid, id } = useParams<{ uid: string; id: string }>();
  // undefined = loading, null = not shared / missing
  const [coin, setCoin] = useState<PublicCoin | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!firebaseEnabled || !uid || !id) return;
    let cancelled = false;
    (async () => {
      try {
        const c = await getPublicCoin(uid, id);
        if (cancelled) return;
        setCoin(c);
        if (c) log.info("share", `Opened shared coin ${id}`, { title: c.listing.title });
      } catch (e) {
        if (!cancelled) setError((e as Error).message || "Something went wrong loading this coin.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [uid, id]);

  let body: React.ReactNode;
  if (!firebaseEnabled) {
    body = <p className="card p-5 text-sm text-cream-300">Shared coins aren&apos;t available on this deployment.</p>;
  } else if (error) {
    body = <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</p>;
  } else if (coin === undefined) {
    body = <Skeleton />;
  } else if (coin === null) {
    body = <NotShared />;
  } else {
    const { listing, images } = coin;
    const value = listing.estimated_value_usd;
    const hasValue = value.low > 0 || value.high > 0;
    body = (
      <>
        {images ? (
          <ListingPreview listing={listing} front={images.front} back={images.back} />
        ) : (
          <section className="card flex flex-col gap-3 p-5">
            <h2 className="font-display text-xl font-semibold leading-snug">{listing.title || "Untitled listing"}</h2>
            <p className="text-xs text-cream-500">The photos for this coin could not be loaded.</p>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-cream-300">{listing.description}</p>
          </section>
        )}

        <section className="card p-4">
          <p className="eyebrow text-patina-300">Grade &amp; value</p>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <div className="rounded-xl bg-black/25 px-3 py-2.5">
              <p className="eyebrow">Grade</p>
              <p className="mt-0.5 truncate font-semibold">{listing.grade_estimate || "—"}</p>
            </div>
            <div className="rounded-xl bg-black/25 px-3 py-2.5">
              <p className="eyebrow">Est. value</p>
              <p className="mt-0.5 truncate font-semibold">
                {hasValue ? `${money(value.low)}–${money(value.high)}` : "—"}
              </p>
            </div>
            <div className="rounded-xl border border-gold-400/30 bg-gold-400/10 px-3 py-2.5">
              <p className="eyebrow text-gold-300/80">Asking</p>
              <p className="gold-text mt-0.5 truncate font-display text-lg font-bold">
                {money(listing.suggested_price_usd)}
              </p>
            </div>
          </div>

          {listing.problems.length > 0 && (
            <p className="mt-3 rounded-xl border border-gold-400/30 bg-gold-400/10 px-3 py-2 text-sm text-gold-200">
              <span className="font-semibold">Problems noted:</span> {listing.problems.join(", ")}
            </p>
          )}

          {listing.grade_reasoning && (
            <details className="group mt-3 text-sm">
              <summary className="flex cursor-pointer list-none items-center gap-2 text-cream-300 hover:text-cream-100">
                Why this grade
                <span className="ml-auto text-cream-500 transition-transform group-open:rotate-180">⌄</span>
              </summary>
              <p className="mt-3 whitespace-pre-wrap rounded-xl bg-black/25 p-3 leading-relaxed text-cream-300">
                {listing.grade_reasoning}
              </p>
            </details>
          )}

          <p className="mt-3 text-[11px] leading-relaxed text-cream-500">
            Grade and value are AI estimates from photos, not a certified appraisal.
          </p>
        </section>
      </>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-5 px-4 pb-16 pt-[max(1.25rem,env(safe-area-inset-top))]">
      <header className="flex items-center gap-3">
        <Link href="/" aria-label="CoinLens home">
          <h1 className="sr-only">CoinLens</h1>
          <Wordmark size={30} tagline="Shared with CoinLens" />
        </Link>
      </header>

      <div className="flex animate-fade-up flex-col gap-5">{body}</div>

      <footer className="mt-auto pt-6 text-center text-xs text-cream-500">
        Identified with CoinLens —{" "}
        <Link href="/" className="font-medium text-patina-300 hover:text-patina-200">
          scan your own coin
        </Link>
      </footer>
    </main>
  );
}

/** useParams() is request-time data, so the shared view streams in behind a Suspense boundary. */
export default function SharedCoinPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto w-full max-w-lg px-4 pt-6">
          <Skeleton />
        </main>
      }
    >
      <SharedCoin />
    </Suspense>
  );
}
