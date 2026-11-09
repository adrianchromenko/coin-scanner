"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { log } from "@/lib/log";

/** Chrome's non-standard install event. */
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

const DISMISS_KEY = "cl-install-dismissed";
const DISMISS_DAYS = 14;

type Mode = "hidden" | "install" | "ios";

function isStandalone(): boolean {
  try {
    if (window.matchMedia("(display-mode: standalone)").matches) return true;
    if (window.matchMedia("(display-mode: fullscreen)").matches) return true;
    return (navigator as Navigator & { standalone?: boolean }).standalone === true;
  } catch {
    return false;
  }
}

function isIosSafari(): boolean {
  const ua = navigator.userAgent;
  const iOS = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (!iOS) return false;
  // Other iOS browsers cannot add to the home screen from their own menus.
  return !/CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo/i.test(ua);
}

function recentlyDismissed(): boolean {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const at = Number(raw);
    return Number.isFinite(at) && Date.now() - at < DISMISS_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

function rememberDismissal() {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch {
    /* storage blocked; the bar will simply show again next visit */
  }
}

/**
 * One-line "Add CoinLens to your home screen" bar. Uses Chrome's install
 * prompt where available, a Share-sheet hint on iOS Safari, and stays hidden
 * when the app is already running standalone or was dismissed recently.
 */
type Env = { standalone: boolean; ios: boolean; dismissedRecently: boolean };
const SERVER_ENV: Env = { standalone: false, ios: false, dismissedRecently: false };
let clientEnv: Env | null = null;

/** Environment facts, read once on the client; the server and hydration render nothing. */
function getEnv(): Env {
  if (!clientEnv) {
    clientEnv = { standalone: isStandalone(), ios: isIosSafari(), dismissedRecently: recentlyDismissed() };
  }
  return clientEnv;
}
const noSubscribe = () => () => {};

export default function InstallPrompt() {
  const env = useSyncExternalStore(noSubscribe, getEnv, () => SERVER_ENV);
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [closed, setClosed] = useState(false);
  const [installing, setInstalling] = useState(false);

  const eligible = !env.standalone && !env.dismissedRecently && !closed;
  const mode: Mode = !eligible ? "hidden" : deferred ? "install" : env.ios ? "ios" : "hidden";

  useEffect(() => {
    if (!eligible) return;
    if (env.ios) log.info("install", "Showing iOS add-to-home-screen hint");

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      log.info("install", "Install prompt available");
    };
    const onInstalled = () => {
      setClosed(true);
      setDeferred(null);
      log.info("install", "App installed to home screen");
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [eligible, env.ios]);

  if (mode === "hidden") return null;

  function dismiss() {
    rememberDismissal();
    setClosed(true);
    log.info("install", `Install bar dismissed for ${DISMISS_DAYS} days`);
  }

  async function install() {
    if (!deferred) return;
    setInstalling(true);
    try {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      log.info("install", `Install prompt ${choice.outcome}`, { platform: choice.platform });
      if (choice.outcome === "accepted") setClosed(true);
      else dismiss();
    } catch (e) {
      log.error("install", "Install prompt failed", e);
      setClosed(true);
    } finally {
      setDeferred(null);
      setInstalling(false);
    }
  }

  return (
    <div
      role="region"
      aria-label="Install CoinLens"
      className="animate-fade-up border-b border-gold-500/20 bg-ink-800/90 px-4 py-2 text-xs text-cream-300 backdrop-blur"
    >
      <div className="mx-auto flex w-full max-w-lg items-center gap-3">
        <span className="min-w-0 flex-1 truncate">
          <span className="font-medium text-cream-100">Add CoinLens to your home screen</span>
          {mode === "ios" && (
            <span className="text-cream-500">
              {" "}
              — tap <span className="text-gold-300">Share</span> → <span className="text-gold-300">Add to Home Screen</span>
            </span>
          )}
        </span>
        {mode === "install" && (
          <button
            type="button"
            onClick={install}
            disabled={installing}
            className="btn-gold shrink-0 rounded-full px-3 py-1 text-xs font-semibold"
          >
            {installing ? "…" : "Install"}
          </button>
        )}
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="btn-ghost shrink-0 rounded-full px-2 py-1 text-xs leading-none"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
