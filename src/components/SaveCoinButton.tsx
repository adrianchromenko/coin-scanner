"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { CoinListing } from "@/lib/coinSchema";
import type { Market } from "@/lib/market";
import { saveCoin, updateCoin } from "@/lib/firebase/coins";
import { log } from "@/lib/log";
import { useAuth } from "./AuthProvider";

type Props = { listing: CoinListing; hints: string; front: string; back: string; market?: Market | null };
type State =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; id: string; listing: CoinListing }
  | { kind: "error"; message: string };

/**
 * "Save to my coins" on the result screen. Signs the user in first if needed,
 * then stores the listing and both photos. Editing the listing after saving
 * turns the button into "Save changes".
 */
export default function SaveCoinButton({ listing, hints, front, back, market = null }: Props) {
  const { enabled, user, openSignIn } = useAuth();
  const [state, setState] = useState<State>({ kind: "idle" });
  // Always save the latest listing, even when the click came through the sign-in sheet.
  const latest = useRef({ listing, hints, front, back, market });
  useEffect(() => {
    latest.current = { listing, hints, front, back, market };
  }, [listing, hints, front, back, market]);

  if (!enabled) return null;

  const dirty = state.kind === "saved" && state.listing !== listing;

  async function doSave(uid: string) {
    setState({ kind: "saving" });
    const cur = latest.current;
    try {
      if (state.kind === "saved") {
        await updateCoin(uid, state.id, { listing: cur.listing, hints: cur.hints });
        setState({ kind: "saved", id: state.id, listing: cur.listing });
      } else {
        const id = await saveCoin(uid, cur);
        setState({ kind: "saved", id, listing: cur.listing });
      }
    } catch (e) {
      log.error("collection", "Save failed", e);
      setState({ kind: "error", message: (e as Error).message || "Could not save. Try again." });
    }
  }

  function onClick() {
    if (user) {
      void doSave(user.uid);
      return;
    }
    log.info("collection", "Save requested while signed out; opening sign-in");
    openSignIn({
      reason: "Sign in to keep this coin in your collection",
      onDone: () => {
        // The provider calls this after auth state flips; read the user then.
        import("@/lib/firebase/client").then(({ firebase }) => {
          const u = firebase().auth.currentUser;
          if (u) void doSave(u.uid);
        });
      },
    });
  }

  const saved = state.kind === "saved" && !dirty;

  return (
    <section className="card flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-display text-lg font-semibold">
            {saved ? "In your collection" : "Keep this coin"}
          </p>
          <p className="text-xs text-cream-500">
            {saved
              ? "Listing and both photos are saved to your account."
              : user
                ? "Save the listing and photos to your account."
                : "Create a free account to save every coin you scan."}
          </p>
        </div>
        {saved ? (
          <Link href="/coins" className="btn-ghost shrink-0 rounded-full px-4 py-2 text-xs font-medium">
            My coins
          </Link>
        ) : (
          <button
            type="button"
            onClick={onClick}
            disabled={state.kind === "saving"}
            className="btn-primary shrink-0 rounded-full px-4 py-2 text-xs font-semibold"
          >
            {state.kind === "saving" ? "Saving…" : dirty ? "Save changes" : "Save to my coins"}
          </button>
        )}
      </div>
      {state.kind === "error" && (
        <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          {state.message}
        </p>
      )}
    </section>
  );
}
