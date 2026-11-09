"use client";

import { doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useAuth } from "@/components/AuthProvider";
import { log } from "@/lib/log";
import { firebase } from "./client";

/**
 * Per-user listing template, stored at users/{uid}/settings/listing.
 * Boilerplate every listing should end with (shipping terms, returns, a
 * sign-off) and a prefix for the seller SKU used in CSV exports.
 *
 * When accounts are disabled on the deployment, or the visitor is signed out,
 * the template lives in localStorage instead so the feature still works.
 */
export type ListingTemplate = {
  /** Closing paragraph, e.g. "Thanks for looking! Check out my other coins." */
  footer: string;
  /** e.g. "Ships within 1 business day in a protective flip, tracked." */
  shipping_line: string;
  /** e.g. "30-day returns accepted, buyer pays return shipping." */
  returns_line: string;
  /** Prepended to the coin id to form the eBay CustomLabel / SKU. */
  sku_prefix: string;
};

export const EMPTY_TEMPLATE: ListingTemplate = {
  footer: "",
  shipping_line: "",
  returns_line: "",
  sku_prefix: "",
};

export const TEMPLATE_FIELDS: { key: keyof ListingTemplate; label: string; hint: string; multiline?: boolean }[] = [
  { key: "shipping_line", label: "Shipping line", hint: "Ships within 1 business day in a protective flip, tracked." },
  { key: "returns_line", label: "Returns line", hint: "30-day returns accepted; buyer pays return shipping." },
  { key: "footer", label: "Footer", hint: "Thanks for looking! Combined shipping on multiple coins.", multiline: true },
  { key: "sku_prefix", label: "SKU prefix", hint: "COIN-" },
];

const LS_KEY = "coinlens.listingTemplate";

/** Clamp any stored shape to a full template so the UI never sees undefined. */
export function normalizeTemplate(raw: unknown): ListingTemplate {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const s = (k: keyof ListingTemplate) => (typeof r[k] === "string" ? (r[k] as string) : "");
  return { footer: s("footer"), shipping_line: s("shipping_line"), returns_line: s("returns_line"), sku_prefix: s("sku_prefix") };
}

function settingsRef(uid: string) {
  return doc(firebase().db, "users", uid, "settings", "listing");
}

// --- localStorage as an external store (keeps hydration honest: server snapshot is empty) ---

const localListeners = new Set<() => void>();
let localCache: { raw: string | null; value: ListingTemplate } | null = null;

function readLocal(): ListingTemplate {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(LS_KEY);
  } catch {
    raw = null;
  }
  if (localCache && localCache.raw === raw) return localCache.value;
  let value = EMPTY_TEMPLATE;
  if (raw) {
    try {
      value = normalizeTemplate(JSON.parse(raw));
    } catch {
      value = EMPTY_TEMPLATE;
    }
  }
  localCache = { raw, value };
  return value;
}

function writeLocal(t: ListingTemplate) {
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(t));
  } catch (e) {
    log.warn("settings", "Could not persist the listing template locally", e);
  }
  localListeners.forEach((l) => l());
}

function subscribeLocal(cb: () => void) {
  localListeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === LS_KEY) cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    localListeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

export type ListingTemplateState = {
  template: ListingTemplate;
  /** True while the signed-in user's template is still loading from Firestore. */
  loading: boolean;
  /** Where the current template is coming from. */
  source: "account" | "device";
  save: (t: ListingTemplate) => Promise<void>;
};

export function useListingTemplate(): ListingTemplateState {
  const { enabled, user, loading: authLoading } = useAuth();
  const local = useSyncExternalStore(subscribeLocal, readLocal, () => EMPTY_TEMPLATE);
  // Tagged with the uid so a template from a previous account is never shown after a switch.
  const [remote, setRemote] = useState<{ uid: string; template: ListingTemplate } | null>(null);

  useEffect(() => {
    if (!enabled || !user) return;
    const uid = user.uid;
    return onSnapshot(
      settingsRef(uid),
      (snap) => {
        setRemote({ uid, template: normalizeTemplate(snap.data()) });
      },
      (e) => {
        log.error("settings", "Could not load the listing template", e);
        // Fall back to an empty template rather than spinning forever.
        setRemote({ uid, template: EMPTY_TEMPLATE });
      },
    );
  }, [enabled, user]);

  const signedIn = enabled && !!user;
  const remoteReady = signedIn && remote?.uid === user.uid;

  const save = useCallback(
    async (t: ListingTemplate) => {
      const clean = normalizeTemplate(t);
      if (signedIn && user) {
        await setDoc(settingsRef(user.uid), { ...clean, updatedAt: serverTimestamp() }, { merge: true });
        log.info("settings", "Listing template saved to account", { chars: JSON.stringify(clean).length });
      } else {
        writeLocal(clean);
        log.info("settings", "Listing template saved on this device");
      }
    },
    [signedIn, user],
  );

  return {
    template: remoteReady ? remote.template : signedIn ? EMPTY_TEMPLATE : local,
    loading: enabled && (authLoading || (signedIn && !remoteReady)),
    source: signedIn ? "account" : "device",
    save,
  };
}
