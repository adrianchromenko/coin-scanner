"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import AccountButton from "@/components/AccountButton";
import { useAuth } from "@/components/AuthProvider";
import Logo from "@/components/Logo";
import { log } from "@/lib/log";
import { authHeaders } from "@/lib/pipeline";
import type { UsageReport } from "@/lib/server/auth";

function money(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

function Bars({ data, value, format }: { data: UsageReport["days"]; value: (d: UsageReport["days"][number]) => number; format: (n: number) => string }) {
  const max = Math.max(1, ...data.map(value));
  return (
    <div className="flex h-28 items-end gap-1">
      {data.map((d) => {
        const v = value(d);
        return (
          <div key={d.date} className="group relative flex flex-1 flex-col items-center justify-end">
            <div
              className="w-full rounded-t bg-gold-400/70 transition group-hover:bg-gold-300"
              style={{ height: `${Math.max(2, (v / max) * 100)}%` }}
              title={`${d.date}: ${format(v)}`}
            />
            <span className="mt-1 text-[9px] text-cream-500">{d.date.slice(5)}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function AdminPage() {
  const { enabled, user, loading, openSignIn } = useAuth();
  const [report, setReport] = useState<UsageReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(14);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/usage?days=${days}`, { headers: await authHeaders() });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      setReport(j as UsageReport);
      setError(null);
      log.info("admin", "Usage report loaded", { source: j.source, days });
    } catch (e) {
      log.warn("admin", "Usage report failed", e);
      setError((e as Error).message);
    }
  }, [days]);

  useEffect(() => {
    if (!user) return;
    // Deferred so the lint rule can see no state is set synchronously inside the effect body.
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [user, load]);

  const totalScans = report?.days.reduce((s, d) => s + d.count, 0) ?? 0;
  const totalCost = report?.days.reduce((s, d) => s + d.cost_usd, 0) ?? 0;

  let body: React.ReactNode;
  if (!enabled) {
    body = <p className="card p-5 text-sm text-cream-300">Accounts aren&apos;t set up on this deployment, so there is no one to be an admin.</p>;
  } else if (loading) {
    body = <div className="card h-40 animate-pulse bg-white/5" />;
  } else if (!user) {
    body = (
      <section className="card flex flex-col items-start gap-3 p-6">
        <p className="text-sm text-cream-300">Sign in with an admin account to see usage.</p>
        <button type="button" onClick={() => openSignIn()} className="btn-gold rounded-full px-5 py-2.5 text-sm font-semibold">
          Sign in
        </button>
      </section>
    );
  } else if (error) {
    body = <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</p>;
  } else if (!report) {
    body = <div className="card h-40 animate-pulse bg-white/5" />;
  } else {
    body = (
      <>
        <div className="grid grid-cols-3 gap-2">
          <div className="card p-3">
            <p className="eyebrow">Scans</p>
            <p className="font-display text-2xl font-semibold">{totalScans}</p>
          </div>
          <div className="card p-3">
            <p className="eyebrow">API cost</p>
            <p className="font-display text-2xl font-semibold text-gold-300">{money(totalCost)}</p>
          </div>
          <div className="card p-3">
            <p className="eyebrow">Per scan</p>
            <p className="font-display text-2xl font-semibold">{money(totalScans ? totalCost / totalScans : 0)}</p>
          </div>
        </div>

        <section className="card p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="font-display text-lg font-semibold">Scans per day</p>
            <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="input-dark w-auto py-1 text-xs">
              {[7, 14, 30, 60].map((n) => (
                <option key={n} value={n}>
                  Last {n} days
                </option>
              ))}
            </select>
          </div>
          <Bars data={report.days} value={(d) => d.count} format={(n) => `${n} scans`} />
        </section>

        <section className="card p-4">
          <p className="mb-3 font-display text-lg font-semibold">Cost per day</p>
          <Bars data={report.days} value={(d) => d.cost_usd} format={money} />
        </section>

        <section className="card p-4">
          <p className="mb-3 font-display text-lg font-semibold">Top users</p>
          {report.top.length === 0 ? (
            <p className="text-sm text-cream-500">No scans yet.</p>
          ) : (
            <ul className="divide-y divide-white/5 text-sm">
              {report.top.map((t) => (
                <li key={t.key} className="flex items-center justify-between py-2">
                  <span className="truncate text-cream-100">{t.email ?? (t.key.startsWith("ip_") ? `Anonymous (${t.key.slice(3).replace(/_/g, ".")})` : t.key)}</span>
                  <span className="shrink-0 font-semibold text-gold-300">{t.count}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card p-4">
          <p className="mb-3 font-display text-lg font-semibold">Recent scans</p>
          <ul className="divide-y divide-white/5 text-xs">
            {report.recent.map((r) => (
              <li key={`${r.at}-${r.key}`} className="flex items-center gap-3 py-2">
                <span className="w-24 shrink-0 text-cream-500">{new Date(r.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                <span className="min-w-0 flex-1 truncate text-cream-100">
                  {r.title || r.kind} <span className="text-cream-500">· {r.email ?? "anonymous"}</span>
                </span>
                <span className={`shrink-0 ${r.ok ? "text-cream-300" : "text-red-300"}`}>{money(r.cost_usd)}</span>
                <span className="shrink-0 text-cream-500">{(r.ms / 1000).toFixed(0)}s</span>
              </li>
            ))}
          </ul>
        </section>

        <p className="px-1 text-xs text-cream-500">
          Source: {report.source === "firestore" ? "Firestore (persistent)" : "server memory since last restart"} · sign-in required:{" "}
          {report.policy.require_sign_in ? "yes" : "no"} · daily limit: {report.policy.daily_limit || "none"}
        </p>
      </>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-5 px-4 pb-16 pt-[max(1.25rem,env(safe-area-inset-top))]">
      <header className="flex items-center justify-between gap-3">
        <Link href="/" className="flex items-center gap-3">
          <Logo size={40} />
          <div>
            <h1 className="font-display text-[26px] font-semibold leading-none tracking-tight">Usage</h1>
            <p className="mt-1 text-xs text-cream-500">Scans, cost and who&apos;s scanning</p>
          </div>
        </Link>
        <AccountButton />
      </header>
      <div className="flex animate-fade-up flex-col gap-4">{body}</div>
    </main>
  );
}
