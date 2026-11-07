"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import AccountButton from "@/components/AccountButton";
import { useAuth } from "@/components/AuthProvider";
import ListingForm from "@/components/ListingForm";
import ListingPreview from "@/components/ListingPreview";
import Logo from "@/components/Logo";
import type { CoinListing } from "@/lib/coinSchema";
import {
  STATUS_LABEL,
  deleteCoin,
  getCoin,
  getCoinImages,
  updateCoin,
  type CoinImages,
  type CoinStatus,
  type SavedCoin,
} from "@/lib/firebase/coins";
import { log } from "@/lib/log";

const STATUSES: CoinStatus[] = ["saved", "listed", "sold"];

function CoinDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { enabled, user, loading, openSignIn } = useAuth();
  const [coin, setCoin] = useState<SavedCoin | null | undefined>(undefined);
  const [images, setImages] = useState<CoinImages | null>(null);
  const [listing, setListing] = useState<CoinListing | null>(null);
  const [status, setStatus] = useState<CoinStatus>("saved");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<"save" | "delete" | null>(null);
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
          log.info("collection", `Opened coin ${id}`, { title: c.listing.title });
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

  function edit(next: CoinListing) {
    setListing(next);
    setDirty(true);
  }

  async function save() {
    if (!user || !listing) return;
    setBusy("save");
    setError(null);
    try {
      await updateCoin(user.uid, id, { listing, status });
      setDirty(false);
      setFlash("Saved");
      setTimeout(() => setFlash(null), 1600);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function changeStatus(next: CoinStatus) {
    if (!user) return;
    setStatus(next);
    try {
      await updateCoin(user.uid, id, { status: next });
    } catch (e) {
      setError((e as Error).message);
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
          className="btn-gold rounded-full px-5 py-2.5 text-sm font-semibold"
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
    body = (
      <>
        <section className="card flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-cream-500">Status</p>
            <div className="mt-1.5 flex gap-1.5">
              {STATUSES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => changeStatus(s)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                    status === s ? "bg-gold-400 text-ink-950" : "bg-white/5 text-cream-300 hover:bg-white/10"
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
        </section>

        {images ? (
          <>
            <ListingPreview listing={listing} front={images.front} back={images.back} />
            <ListingForm listing={listing} onChange={edit} front={images.front} back={images.back} />
          </>
        ) : (
          <p className="card p-5 text-sm text-cream-300">The photos for this coin could not be loaded.</p>
        )}

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
                disabled={busy === "save" || !dirty}
                className="btn-gold w-full rounded-2xl px-4 py-4 text-base font-semibold"
              >
                {busy === "save" ? "Saving…" : flash && !dirty ? "Saved ✓" : "Save changes"}
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
          <Link href="/coins" aria-label="Back to my coins">
            <Logo size={40} className="drop-shadow-[0_6px_18px_rgba(236,193,79,0.35)]" />
          </Link>
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
