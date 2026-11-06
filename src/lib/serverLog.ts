import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

/**
 * Server-side logging: prints to the terminal running `next dev` / `next start`
 * and appends the same line to logs/app.log (git-ignored).
 */

export type ServerLogLevel = "info" | "warn" | "error";

const LOG_DIR = path.join(process.cwd(), "logs");
const LOG_FILE = path.join(LOG_DIR, "app.log");
let dirReady: Promise<void> | null = null;

function serialise(data: unknown): string {
  if (data === undefined) return "";
  if (data instanceof Error) {
    return ` ${JSON.stringify({ name: data.name, message: data.message, stack: data.stack })}`;
  }
  try {
    return ` ${JSON.stringify(data, (_k, v) =>
      typeof v === "string" && v.length > 300 ? `${v.slice(0, 120)}… (${v.length} chars)` : v,
    )}`;
  } catch {
    return ` ${String(data)}`;
  }
}

export function slog(level: ServerLogLevel, step: string, msg: string, data?: unknown) {
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${step}: ${msg}${serialise(data)}`;
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);

  if (!dirReady) dirReady = mkdir(LOG_DIR, { recursive: true }).then(() => undefined).catch(() => undefined);
  dirReady
    .then(() => appendFile(LOG_FILE, line + "\n"))
    .catch(() => {
      /* never let logging break a request */
    });
}

/** Short request id so client and server lines can be matched up. */
export function requestId() {
  return Math.random().toString(36).slice(2, 8);
}
