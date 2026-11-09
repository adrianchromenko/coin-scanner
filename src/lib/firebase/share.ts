"use client";

import { FirebaseError } from "firebase/app";
import { doc, getDoc, serverTimestamp, Timestamp, updateDoc } from "firebase/firestore";
import { normalizeListing, type CoinListing } from "@/lib/coinSchema";
import { log } from "@/lib/log";
import { SITE_URL } from "@/lib/siteUrl";
import { firebase } from "./client";

/**
 * Public "share a coin" links.
 *
 * A coin document at users/{uid}/coins/{coinId} carries a `public` boolean.
 * When it is true, firestore.rules lets anyone (signed in or not) `get` that
 * one document and its photos at users/{uid}/coins/{coinId}/images/full,
 * which is all the page at /s/{uid}/{coinId} needs. The owner's account,
 * other coins and all writes stay private.
 */

export type PublicCoin = {
  listing: CoinListing;
  /** Null when the photo document is missing or could not be read. */
  images: { front: string; back: string } | null;
  createdAt: number;
};

function coinRef(uid: string, coinId: string) {
  return doc(firebase().db, "users", uid, "coins", coinId);
}
function imagesRef(uid: string, coinId: string) {
  return doc(firebase().db, "users", uid, "coins", coinId, "images", "full");
}

function millis(v: unknown): number {
  if (v instanceof Timestamp) return v.toMillis();
  if (typeof v === "number") return v;
  return Date.now();
}

function isPermissionDenied(e: unknown): boolean {
  return e instanceof FirebaseError && e.code === "permission-denied";
}

/** Flip the public flag on a coin. Owner only (enforced by the rules). */
export async function setCoinPublic(uid: string, coinId: string, isPublic: boolean): Promise<void> {
  await updateDoc(coinRef(uid, coinId), { public: isPublic, updatedAt: serverTimestamp() });
  log.info("share", `Coin ${coinId} is now ${isPublic ? "public" : "private"}`);
}

/**
 * Load a coin for the public share page. Resolves to null when the coin does
 * not exist, is not flagged public, or the rules refuse the read, so the page
 * can show one friendly "not shared" state for all three.
 */
export async function getPublicCoin(uid: string, coinId: string): Promise<PublicCoin | null> {
  const t0 = performance.now();
  try {
    const snap = await getDoc(coinRef(uid, coinId));
    if (!snap.exists()) {
      log.info("share", `Public coin ${coinId} not found`);
      return null;
    }
    const d = snap.data();
    // The owner can read their own private coins, so check the flag here too:
    // the share page should show exactly what a stranger would see.
    if (d.public !== true) {
      log.info("share", `Coin ${coinId} is not public`);
      return null;
    }

    let images: PublicCoin["images"] = null;
    try {
      const im = await getDoc(imagesRef(uid, coinId));
      if (im.exists()) {
        const data = im.data();
        images = { front: String(data.front ?? ""), back: String(data.back ?? "") };
      }
    } catch (e) {
      if (!isPermissionDenied(e)) throw e;
      log.warn("share", `Photos for coin ${coinId} were refused by the rules`);
    }

    const listing = normalizeListing(d.listing as Partial<CoinListing>);
    log.info("share", `Loaded public coin ${coinId} in ${Math.round(performance.now() - t0)} ms`, {
      title: listing.title,
      hasImages: images !== null,
    });
    return { listing, images, createdAt: millis(d.createdAt) };
  } catch (e) {
    if (isPermissionDenied(e)) {
      log.info("share", `Public coin ${coinId} refused (not shared)`);
      return null;
    }
    log.error("share", `Could not load public coin ${coinId}`, e);
    throw e;
  }
}

/** Absolute URL of the public share page for a coin. */
export function shareUrl(uid: string, coinId: string): string {
  return `${SITE_URL}/s/${uid}/${coinId}`;
}
