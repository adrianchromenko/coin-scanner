"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { CapturedSide } from "@/components/CoinCapture";
import { canvasToJpeg, loadToCanvas } from "@/lib/autoCrop";
import { log } from "@/lib/log";
import { assessPhotoGlobal, type PhotoAssessment } from "@/lib/photoCheck";

/**
 * Scans the user took while offline, kept in IndexedDB until they can be sent
 * to /api/locate and /api/identify. Photos are stored as full-resolution JPEG
 * data URLs so nothing is lost between sessions.
 */

export type QueuedPhoto = {
  /** Full-resolution JPEG (q0.9) of the captured canvas. */
  dataUrl: string;
  fileName: string;
};

export type QueuedScan = {
  id: string;
  createdAt: number;
  hints: string;
  front: QueuedPhoto;
  back: QueuedPhoto;
};

const DB_NAME = "coinlens";
const DB_VERSION = 1;
const STORE = "scans";
const STEP = "queue";

// ---------------------------------------------------------------------------
// IndexedDB plumbing

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available in this browser"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("createdAt", "createdAt");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Could not open IndexedDB"));
    req.onblocked = () => reject(new Error("IndexedDB open was blocked by another tab"));
  });
}

function requestToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, mode);
    const result = await requestToPromise(fn(tx.objectStore(STORE)));
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
      tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
    });
    return result;
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// Change notifications so every mounted hook re-reads after a write.

const listeners = new Set<() => void>();

function emitChange() {
  listeners.forEach((l) => l());
}

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function kb(dataUrl: string): number {
  return Math.round(dataUrl.length / 1365);
}

// ---------------------------------------------------------------------------
// Public API

export async function queueScan(
  sides: { front: CapturedSide; back: CapturedSide },
  hints: string,
): Promise<QueuedScan> {
  const t0 = performance.now();
  const item: QueuedScan = {
    id: newId(),
    createdAt: Date.now(),
    hints,
    front: { dataUrl: canvasToJpeg(sides.front.src, 0.9), fileName: sides.front.fileName },
    back: { dataUrl: canvasToJpeg(sides.back.src, 0.9), fileName: sides.back.fileName },
  };
  try {
    await withStore("readwrite", (s) => s.put(item));
  } catch (e) {
    log.error(STEP, "Could not save scan for later", e);
    throw e instanceof Error ? e : new Error("Could not save the scan on this device");
  }
  log.info(STEP, `Scan saved for later in ${Math.round(performance.now() - t0)} ms`, {
    id: item.id,
    frontKB: kb(item.front.dataUrl),
    backKB: kb(item.back.dataUrl),
    hints: hints.trim().length ? `${hints.trim().length} chars` : "none",
  });
  emitChange();
  return item;
}

export async function listQueued(): Promise<QueuedScan[]> {
  try {
    const all = await withStore<QueuedScan[]>("readonly", (s) => s.getAll());
    all.sort((a, b) => a.createdAt - b.createdAt);
    return all;
  } catch (e) {
    log.error(STEP, "Could not read the saved scans", e);
    return [];
  }
}

export async function removeQueued(id: string): Promise<void> {
  try {
    await withStore("readwrite", (s) => s.delete(id));
    log.info(STEP, "Removed saved scan", { id });
  } catch (e) {
    log.error(STEP, "Could not remove saved scan", { id, error: e });
    throw e instanceof Error ? e : new Error("Could not remove the saved scan");
  }
  emitChange();
}

/** Downscaled JPEG of a canvas (mirrors CoinCapture's private helper). */
function scaledJpeg(src: HTMLCanvasElement, maxDim: number, quality: number): string {
  const scale = Math.min(1, maxDim / Math.max(src.width, src.height));
  if (scale === 1) return src.toDataURL("image/jpeg", quality);
  const c = document.createElement("canvas");
  c.width = Math.round(src.width * scale);
  c.height = Math.round(src.height * scale);
  c.getContext("2d")?.drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", quality);
}

/** Decode a data URL without going through fetch (and therefore the service worker). */
function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(",");
  if (comma === -1) throw new Error("Malformed data URL");
  const meta = dataUrl.slice(0, comma);
  const type = /^data:([^;,]+)/.exec(meta)?.[1] ?? "image/jpeg";
  const payload = dataUrl.slice(comma + 1);
  if (!/;base64$/i.test(meta)) return new Blob([decodeURIComponent(payload)], { type });
  const bin = atob(payload);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

/** Rebuild a CapturedSide from a stored photo so the normal scan flow can run on it. */
export async function restoreSide(photo: QueuedPhoto): Promise<CapturedSide> {
  const t0 = performance.now();
  const src = await loadToCanvas(dataUrlToBlob(photo.dataUrl));
  let check: PhotoAssessment | null = null;
  try {
    check = assessPhotoGlobal(src);
  } catch (e) {
    log.error(STEP, "Photo check failed on restored photo", e);
  }
  log.info(STEP, `Restored ${photo.fileName} (${src.width}x${src.height}) in ${Math.round(performance.now() - t0)} ms`);
  return {
    src,
    srcUrl: scaledJpeg(src, 1000, 0.8),
    locateUrl: scaledJpeg(src, 1024, 0.85),
    check,
    blocking: false,
    fileName: photo.fileName,
  };
}

// ---------------------------------------------------------------------------
// Hooks

const EMPTY: QueuedScan[] = [];

/** Live view of the queue: re-reads on mount, on `online`, after every write, and on refresh(). */
export function useQueuedScans(): { items: QueuedScan[]; refresh: () => Promise<void> } {
  const [items, setItems] = useState<QueuedScan[]>(EMPTY);

  const refresh = useCallback(async () => {
    const next = await listQueued();
    setItems(next);
  }, []);

  useEffect(() => {
    let alive = true;
    const run = () => {
      void listQueued().then((next) => {
        if (alive) setItems(next);
      });
    };
    run();
    listeners.add(run);
    window.addEventListener("online", run);
    return () => {
      alive = false;
      listeners.delete(run);
      window.removeEventListener("online", run);
    };
  }, []);

  return { items, refresh };
}

function subscribeOnline(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

/** navigator.onLine as React state. Always true on the server and during hydration. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}
