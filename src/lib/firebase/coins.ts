"use client";

import {
  arrayUnion,
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
import { normalizeListing, type CoinListing } from "@/lib/coinSchema";
import { log } from "@/lib/log";
import type { Market, SpotPrice } from "@/lib/market";
import { firebase } from "./client";

/**
 * A user's coin collection lives at users/{uid}/coins/{coinId}.
 * The coin document holds the listing plus a small thumbnail so the list
 * view is cheap to load. The two full photos live in a sub-document at
 * users/{uid}/coins/{coinId}/images/full (loaded only on the detail page).
 * Photos are stored inline as JPEG data URLs so the free Firebase plan is
 * enough (no Cloud Storage bucket needed). Well under the 1 MiB document cap.
 *
 * Besides the listing, a coin carries bookkeeping fields (what it cost, what
 * it sold for), the market snapshot from the last valuation and a history of
 * value estimates so the detail page can chart them over time.
 */

export type CoinStatus = "saved" | "listed" | "sold";

export const STATUS_LABEL: Record<CoinStatus, string> = {
  saved: "Saved",
  listed: "Listed on eBay",
  sold: "Sold",
};

/** One point on the value chart: what the estimate was at a moment in time. */
export type ValuePoint = {
  /** Unix ms. */
  at: number;
  low: number;
  high: number;
  suggested: number;
  /** Where the estimate came from: "scan", "revalue", "manual edit". */
  source: string;
};

/** Bookkeeping the owner fills in by hand on the detail page. */
export type CoinMoney = {
  /** What the coin cost to acquire, USD. */
  cost_basis_usd: number | null;
  /** Final sale price, USD. */
  sold_price_usd: number | null;
  /** Marketplace + payment fees, shipping paid by the seller, etc. */
  fees_usd: number | null;
  /** When it sold, unix ms. */
  sold_at: number | null;
  /** "eBay", "Local", "Auction", ... Free text. */
  sale_platform: string;
  /** Private notes, never exported to a listing. */
  notes: string;
};

export const EMPTY_MONEY: CoinMoney = {
  cost_basis_usd: null,
  sold_price_usd: null,
  fees_usd: null,
  sold_at: null,
  sale_platform: "",
  notes: "",
};

export type SavedCoin = CoinMoney & {
  id: string;
  listing: CoinListing;
  hints: string;
  status: CoinStatus;
  /** Small front-side JPEG data URL for lists. */
  thumb: string;
  /** True when the owner shares this coin at /s/{uid}/{coinId}. */
  public?: boolean;
  /** Spot price and melt value from the last identification or re-valuation. */
  market: Market | null;
  /** Oldest first. Appended on save and on every re-valuation. */
  value_history: ValuePoint[];
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

/** A finite number or null; strings like "12.5" from older hand edits are accepted. */
function numOrNull(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function toSpot(v: unknown): SpotPrice | null {
  if (!v || typeof v !== "object") return null;
  const s = v as Record<string, unknown>;
  const usd = numOrNull(s.usd_per_oz);
  if (usd === null || typeof s.metal !== "string") return null;
  return { metal: s.metal as SpotPrice["metal"], usd_per_oz: usd, as_of: str(s.as_of), source: str(s.source) };
}

function toMarket(v: unknown): Market | null {
  if (!v || typeof v !== "object") return null;
  const m = v as Record<string, unknown>;
  return { spot: toSpot(m.spot), melt_value_usd: numOrNull(m.melt_value_usd) };
}

function toHistory(v: unknown): ValuePoint[] {
  if (!Array.isArray(v)) return [];
  const out: ValuePoint[] = [];
  for (const e of v) {
    if (!e || typeof e !== "object") continue;
    const p = e as Record<string, unknown>;
    const at = numOrNull(p.at);
    if (at === null) continue;
    out.push({
      at,
      low: numOrNull(p.low) ?? 0,
      high: numOrNull(p.high) ?? 0,
      suggested: numOrNull(p.suggested) ?? 0,
      source: str(p.source) || "scan",
    });
  }
  return out.sort((a, b) => a.at - b.at);
}

/** Build a value-history point from a listing's current price fields. */
export function valuePoint(listing: CoinListing, source: string, at = Date.now()): ValuePoint {
  return {
    at,
    low: Number(listing.estimated_value_usd?.low) || 0,
    high: Number(listing.estimated_value_usd?.high) || 0,
    suggested: Number(listing.suggested_price_usd) || 0,
    source,
  };
}

/** Tolerant of documents written before any of the newer fields existed. */
function toCoin(snap: DocumentSnapshot<DocumentData>): SavedCoin {
  const d = snap.data({ serverTimestamps: "estimate" }) ?? {};
  const status: CoinStatus =
    d.status === "listed" || d.status === "sold" || d.status === "saved" ? d.status : "saved";
  return {
    id: snap.id,
    listing: normalizeListing(d.listing as Partial<CoinListing> | undefined),
    hints: str(d.hints),
    status,
    thumb: str(d.thumb),
    public: d.public === true,
    cost_basis_usd: numOrNull(d.cost_basis_usd),
    sold_price_usd: numOrNull(d.sold_price_usd),
    fees_usd: numOrNull(d.fees_usd),
    sold_at: d.sold_at instanceof Timestamp ? d.sold_at.toMillis() : numOrNull(d.sold_at),
    sale_platform: str(d.sale_platform),
    notes: str(d.notes),
    market: toMarket(d.market),
    value_history: toHistory(d.value_history),
    createdAt: millis(d.createdAt),
    updatedAt: millis(d.updatedAt),
  };
}

export type SaveInput = {
  listing: CoinListing;
  hints: string;
  front: string;
  back: string;
  /** Spot/melt snapshot returned alongside the listing by /api/identify. */
  market?: Market | null;
};

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
    public: false,
    ...EMPTY_MONEY,
    market: input.market ? plain(input.market) : null,
    value_history: [valuePoint(input.listing, "scan")],
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
    melt: input.market?.melt_value_usd ?? null,
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

/** Fields the owner may change after saving. Everything else is derived or set once. */
export type CoinPatch = Partial<
  Pick<SavedCoin, "listing" | "status" | "hints" | "public" | "market" | "value_history"> & CoinMoney
>;

export type UpdateOptions = {
  /** Append this point to `value_history` in the same write (atomic with the patch). */
  appendValue?: ValuePoint;
};

export async function updateCoin(uid: string, id: string, patch: CoinPatch, opts: UpdateOptions = {}): Promise<void> {
  // plain() would turn the arrayUnion sentinel into {}, so it is added afterwards.
  const data: Record<string, unknown> = { ...plain(patch), updatedAt: serverTimestamp() };
  if (opts.appendValue) data.value_history = arrayUnion(plain(opts.appendValue));
  await updateDoc(coinRef(uid, id), data);
  log.info("collection", `Updated coin ${id}`, {
    fields: Object.keys(patch),
    appended: opts.appendValue ? opts.appendValue.source : undefined,
  });
}

/** Record a new value estimate without touching anything else on the coin. */
export async function appendValueHistory(uid: string, id: string, entry: ValuePoint): Promise<void> {
  await updateDoc(coinRef(uid, id), { value_history: arrayUnion(plain(entry)), updatedAt: serverTimestamp() });
  log.info("collection", `Appended value point to coin ${id}`, entry);
}

export async function deleteCoin(uid: string, id: string): Promise<void> {
  await deleteDoc(imagesRef(uid, id));
  await deleteDoc(coinRef(uid, id));
  log.info("collection", `Deleted coin ${id}`);
}

/** Net profit on a sold coin: sale price minus fees minus cost. Null until a sale price is entered. */
export function netProfit(c: Pick<CoinMoney, "cost_basis_usd" | "sold_price_usd" | "fees_usd">): number | null {
  if (c.sold_price_usd === null) return null;
  return c.sold_price_usd - (c.fees_usd ?? 0) - (c.cost_basis_usd ?? 0);
}
