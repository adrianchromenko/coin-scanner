"use client";

import { useSyncExternalStore } from "react";

/**
 * Client-side logging. Every entry goes to the browser console, into an
 * in-memory buffer (shown by <DebugPanel />), and is batched to /api/log so
 * it also appears in the server terminal and logs/app.log.
 */

export type LogLevel = "info" | "warn" | "error";

export type LogEntry = {
  id: number;
  t: number;
  level: LogLevel;
  step: string;
  msg: string;
  data?: unknown;
};

const MAX_ENTRIES = 300;
const entries: LogEntry[] = [];
const listeners = new Set<() => void>();
let nextId = 1;
let snapshot: LogEntry[] = [];

const pending: LogEntry[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let installed = false;

function notify() {
  snapshot = entries.slice();
  listeners.forEach((l) => l());
}

function safeData(data: unknown): unknown {
  if (data instanceof Error) {
    return { name: data.name, message: data.message, stack: data.stack };
  }
  try {
    // Drop anything that cannot be serialised and truncate huge strings (data URLs).
    return JSON.parse(
      JSON.stringify(data, (_k, v) =>
        typeof v === "string" && v.length > 300 ? `${v.slice(0, 120)}… (${v.length} chars)` : v,
      ),
    );
  } catch {
    return String(data);
  }
}

function flush() {
  flushTimer = null;
  if (pending.length === 0) return;
  const batch = pending.splice(0, pending.length);
  try {
    fetch("/api/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events: batch }),
      keepalive: true,
    }).catch(() => {
      /* logging must never break the app */
    });
  } catch {
    /* ignore */
  }
}

function push(level: LogLevel, step: string, msg: string, data?: unknown) {
  const entry: LogEntry = {
    id: nextId++,
    t: Date.now(),
    level,
    step,
    msg,
    data: data === undefined ? undefined : safeData(data),
  };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
  notify();

  const line = `[CoinLens] ${step}: ${msg}`;
  if (level === "error") console.error(line, entry.data ?? "");
  else if (level === "warn") console.warn(line, entry.data ?? "");
  else console.log(line, entry.data ?? "");

  if (typeof window !== "undefined") {
    pending.push(entry);
    if (!flushTimer) flushTimer = setTimeout(flush, 800);
  }
  return entry;
}

export const log = {
  info: (step: string, msg: string, data?: unknown) => push("info", step, msg, data),
  warn: (step: string, msg: string, data?: unknown) => push("warn", step, msg, data),
  error: (step: string, msg: string, data?: unknown) => push("error", step, msg, data),
  /** Time an async step; logs start, finish (with ms) or failure. */
  async time<T>(step: string, msg: string, fn: () => Promise<T>, data?: unknown): Promise<T> {
    const t0 = performance.now();
    push("info", step, `${msg} — start`, data);
    try {
      const out = await fn();
      push("info", step, `${msg} — done in ${Math.round(performance.now() - t0)} ms`);
      return out;
    } catch (e) {
      push("error", step, `${msg} — failed after ${Math.round(performance.now() - t0)} ms`, e);
      throw e;
    }
  },
  clear() {
    entries.splice(0, entries.length);
    notify();
  },
  entries: () => snapshot,
};

/** Catch anything that slips past try/catch anywhere in the app. */
export function installGlobalErrorLogging() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (e) => {
    push("error", "window", e.message || "Uncaught error", {
      file: e.filename,
      line: e.lineno,
      col: e.colno,
      error: e.error instanceof Error ? safeData(e.error) : undefined,
    });
  });
  window.addEventListener("unhandledrejection", (e) => {
    push("error", "window", "Unhandled promise rejection", e.reason);
  });
  window.addEventListener("pagehide", flush);
  push("info", "app", "Page loaded", {
    url: window.location.href,
    ua: navigator.userAgent,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    online: navigator.onLine,
  });
}

/** Server render and hydration always see an empty log; entries appear on the first client render. */
const EMPTY: LogEntry[] = [];

export function useLogEntries(): LogEntry[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => snapshot,
    () => EMPTY,
  );
}

export function formatEntries(list: LogEntry[]): string {
  return list
    .map((e) => {
      const time = new Date(e.t).toISOString().slice(11, 23);
      const data = e.data === undefined ? "" : ` ${JSON.stringify(e.data)}`;
      return `${time} ${e.level.toUpperCase().padEnd(5)} ${e.step}: ${e.msg}${data}`;
    })
    .join("\n");
}
