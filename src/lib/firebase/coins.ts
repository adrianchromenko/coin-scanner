"use client";

import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  writeBatch,
  type DocumentData,
  type DocumentSnapshot,
} from "firebase/firestore";
import type { CoinListing } from "@/lib/coinSchema";
import { log } from "@/lib/log";
import { firebase } from "./client";

/**
 * A user's coin collection lives at users/{uid}/coins/{coinId}.
 * The coin document holds the listing plus a small thumbnail so the list
 * view is cheap to load. The two full photos live in a sub-document at
 * users/{uid}/coins/{coinId}/images/full (loaded only on the detail page).
 * Photos are stored inline as JPEG data URLs so the free Firebase plan is
 * enough (no Cloud Storage bucket needed). Well under the 1 MiB document cap.
 */

export type CoinStatus = "saved" | "listed" | "sold";

export const STATUS_LABEL: Record<CoinStatus, string> = {
  saved: "Saved",
  listed: "Listed on eBay",
  sold: "Sold",
};

export type SavedCoin = {
  id: string;
  listing: CoinListing;
  hints: string;
  status: CoinStatus;
  /** Small front-side JPEG data URL for lists. */
  thumb: string;
  createdAt: number;
  updatedAt: number;
};

export type CoinImages = { front: string; back: string };

const FULL_SIZE = 800;
const THUMB_SIZE = 200;

function coinsRef(uid: string) {
  return collection(firebase().db, "users", uid, "coins");
}
function coinRef(uid: string, id: string) {
  return doc(firebase().db, "users", uid, "coins", id);
}
function imagesRef(uid: string, id: string) {
  return doc(firebase().db, "users", uid, "coins", id, "images", "full");
}

/** Re-encode a square JPEG data URL at a smaller size. */
async function shrink(dataUrl: string, size: number, quality: number): Promise<string> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const target = Math.min(size, img.naturalWidth);
  const c = document.createElement("canvas");
  c.width = target;
  c.height = target;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D not supported");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, target, target);
  ctx.drawImage(img, 0, 0, target, target);
  return c.toDataURL("image/jpeg", quality);
}

/** Firestore rejects `undefined`; a JSON round-trip drops it. */
function plain<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function millis(v: unknown): number {
  if (v instanceof Timestamp) return v.toMillis();
  if (typeof v === "number") return v;
  return Date.now();
}

function toCoin(snap: DocumentSnapshot<DocumentData>): SavedCoin {
  const d = snap.data({ serverTimestamps: "estimate" }) ?? {};
  const status: CoinStatus =
    d.status === "listed" || d.status === "sold" || d.status === "saved" ? d.status : "saved";
  return {
    id: snap.id,
    listing: d.listing as CoinListing,
    hints: typeof d.hints === "string" ? d.hints : "",
    status,
    thumb: typeof d.thumb === "string" ? d.thumb : "",
    createdAt: millis(d.createdAt),
    updatedAt: millis(d.updatedAt),
  };
}

export type SaveInput = { listing: CoinListing; hints: string; front: string; back: string };

/** Store a new coin (listing + photos). Returns the new coin id. */
export async function saveCoin(uid: string, input: SaveInput): Promise<string> {
  const t0 = performance.now();
  const [front, back, thumb] = await Promise.all([
    shrink(input.front, FULL_SIZE, 0.85),
    shrink(input.back, FULL_SIZE, 0.85),
    shrink(input.front, THUMB_SIZE, 0.8),
  ]);
  const ref = doc(coinsRef(uid));
  const batch = writeBatch(firebase().db);
  batch.set(ref, {
    listing: plain(input.listing),
    hints: input.hints,
    status: "saved",
    thumb,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  batch.set(imagesRef(uid, ref.id), { front, back });
  await batch.commit();
  log.info("collection", `Saved coin ${ref.id} in ${Math.round(performance.now() - t0)} ms`, {
    title: input.listing.title,
    frontKB: Math.round(front.length / 1365),
    backKB: Math.round(back.length / 1365),
    thumbKB: Math.round(thumb.length / 1365),
  });
  return ref.id;
}

/** Live list of the user's coins, newest first. Returns an unsubscribe function. */
export function subscribeCoins(
  uid: string,
  onChange: (coins: SavedCoin[]) => void,
  onError: (e: Error) => void,
): () => void {
  const q = query(coinsRef(uid), orderBy("createdAt", "desc"));
  return onSnapshot(
    q,
    (snap) => {
      const coins = snap.docs.map(toCoin);
      log.info(
        "collection",
        `Loaded ${coins.length} coins${snap.metadata.fromCache ? " (from cache)" : ""}`,
      );
      onChange(coins);
    },
    (e) => {
      log.error("collection", "Could not load coins", e);
      onError(e);
    },
  );
}

export async function getCoin(uid: string, id: string): Promise<SavedCoin | null> {
  const snap = await getDoc(coinRef(uid, id));
  return snap.exists() ? toCoin(snap) : null;
}

export async function getCoinImages(uid: string, id: string): Promise<CoinImages | null> {
  const snap = await getDoc(imagesRef(uid, id));
  if (!snap.exists()) return null;
  const d = snap.data();
  return { front: String(d.front ?? ""), back: String(d.back ?? "") };
}

export async function updateCoin(
  uid: string,
  id: string,
  patch: Partial<Pick<SavedCoin, "listing" | "status" | "hints">>,
): Promise<void> {
  await updateDoc(coinRef(uid, id), { ...plain(patch), updatedAt: serverTimestamp() });
  log.info("collection", `Updated coin ${id}`, Object.keys(patch));
}

export async function deleteCoin(uid: string, id: string): Promise<void> {
  await deleteDoc(imagesRef(uid, id));
  await deleteDoc(coinRef(uid, id));
  log.info("collection", `Deleted coin ${id}`);
}
