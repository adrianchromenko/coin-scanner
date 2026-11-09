"use client";

import { useEffect } from "react";
import { log } from "@/lib/log";

/**
 * Registers /sw.js (offline shell + static asset cache) in production builds.
 * Renders nothing. Development is skipped: the dev server's HMR and the
 * SW cache fight each other, and layout.tsx clears stale workers anyway.
 */
export default function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
      log.info("sw", "Service workers not supported; offline shell disabled");
      return;
    }

    let cancelled = false;

    const watchForUpdate = (reg: ServiceWorkerRegistration) => {
      if (reg.waiting && navigator.serviceWorker.controller) {
        log.info("sw", "Update available (worker waiting)");
      }
      reg.addEventListener("updatefound", () => {
        const next = reg.installing;
        if (!next) return;
        next.addEventListener("statechange", () => {
          if (next.state === "installed" && navigator.serviceWorker.controller) {
            log.info("sw", "Update available; it takes over on the next launch");
          }
        });
      });
    };

    const register = async () => {
      try {
        const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
        if (cancelled) return;
        log.info("sw", "Service worker registered", {
          scope: reg.scope,
          state: reg.active ? "active" : reg.installing ? "installing" : reg.waiting ? "waiting" : "unknown",
        });
        watchForUpdate(reg);
      } catch (e) {
        log.error("sw", "Service worker registration failed", e);
      }
    };

    // Wait for the page to finish loading so registration never competes with first paint.
    if (document.readyState === "complete") void register();
    else window.addEventListener("load", () => void register(), { once: true });

    const onControllerChange = () => log.info("sw", "New service worker took control");
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  return null;
}
