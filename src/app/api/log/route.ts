import { NextResponse } from "next/server";
import { slog } from "@/lib/serverLog";

type ClientEvent = {
  t?: number;
  level?: "info" | "warn" | "error";
  step?: string;
  msg?: string;
  data?: unknown;
};

/** Receives batched browser log events and writes them to the server log. */
export async function POST(req: Request) {
  let events: ClientEvent[] = [];
  try {
    const body = (await req.json()) as { events?: ClientEvent[] };
    events = Array.isArray(body.events) ? body.events.slice(0, 200) : [];
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const ua = req.headers.get("user-agent") ?? "";
  const device = /iPhone|iPad/.test(ua) ? "ios" : /Android/.test(ua) ? "android" : "desktop";

  for (const e of events) {
    const level = e.level === "error" || e.level === "warn" ? e.level : "info";
    const at = typeof e.t === "number" ? new Date(e.t).toISOString().slice(11, 23) : "";
    slog(level, `client[${device}] ${e.step ?? "?"}`, `${at ? `@${at} ` : ""}${e.msg ?? ""}`, e.data);
  }
  return NextResponse.json({ ok: true, received: events.length });
}
