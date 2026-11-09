"use client";

import Link from "next/link";
import { useState } from "react";
import AccountButton from "@/components/AccountButton";
import { useAuth } from "@/components/AuthProvider";
import { EMPTY_TEMPLATE, TEMPLATE_FIELDS, useListingTemplate, type ListingTemplate } from "@/lib/firebase/settings";
import { log } from "@/lib/log";
import { SAMPLE_LISTING } from "@/lib/sampleListing";
import { applyTemplate, skuFor } from "@/lib/template";

/**
 * Listing template and account settings. The template is the boilerplate
 * appended to every listing description and the SKU prefix used in exports.
 * Edits are kept as an overlay on the loaded template until "Save template",
 * so a late-arriving Firestore snapshot never wipes what the user is typing.
 */
export default function SettingsPage() {
  const { enabled, user, loading: authLoading, openSignIn, signOut } = useAuth();
  const { template, loading, source, save } = useListingTemplate();
  const [draft, setDraft] = useState<Partial<ListingTemplate> | null>(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const form: ListingTemplate = { ...template, ...(draft ?? {}) };
  const dirty = draft !== null && (Object.keys(draft) as (keyof ListingTemplate)[]).some((k) => draft[k] !== template[k]);
  const preview = applyTemplate(SAMPLE_LISTING, form);

  function edit<K extends keyof ListingTemplate>(key: K, value: string) {
    setDraft((d) => ({ ...(d ?? {}), [key]: value }));
    setFlash(null);
  }

  async function onSave() {
    setBusy(true);
    setError(null);
    try {
      await save(form);
      setDraft(null);
      setFlash(source === "account" ? "Saved to your account" : "Saved on this device");
      setTimeout(() => setFlash(null), 2000);
    } catch (e) {
      log.error("settings", "Could not save the listing template", e);
      setError((e as Error).message || "Could not save. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setDraft({ ...EMPTY_TEMPLATE });
    setFlash(null);
  }

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-5 px-4 pb-24 pt-[max(1.25rem,env(safe-area-inset-top))]">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div>
            <Link href="/coins" className="text-xs text-cream-500 hover:text-cream-100">
              ← My coins
            </Link>
            <h1 className="font-display text-[22px] font-semibold leading-tight tracking-tight">Settings</h1>
          </div>
        </div>
        <AccountButton />
      </header>

      <div className="flex animate-fade-up flex-col gap-5">
        {/* Listing template */}
        <section className="card p-5">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <p className="eyebrow mb-1">Listing template</p>
              <h2 className="font-display text-xl font-semibold leading-tight">Your standard terms</h2>
              <p className="mt-1 text-xs text-cream-500">
                Added to the end of every listing description and used in CSV exports.
                {enabled && !user && !authLoading && " Sign in to keep it with your account."}
                {!enabled && " Stored on this device."}
              </p>
            </div>
          </div>

          {loading ? (
            <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading template">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-10 animate-pulse rounded-xl bg-white/5" />
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {TEMPLATE_FIELDS.map((f) => (
                <label key={f.key} className="block">
                  <span className="eyebrow mb-1.5 block">{f.label}</span>
                  {f.multiline ? (
                    <textarea
                      value={form[f.key]}
                      onChange={(e) => edit(f.key, e.target.value)}
                      placeholder={f.hint}
                      rows={3}
                      className="input-dark"
                    />
                  ) : (
                    <input
                      type="text"
                      value={form[f.key]}
                      onChange={(e) => edit(f.key, e.target.value)}
                      placeholder={f.hint}
                      className="input-dark"
                    />
                  )}
                </label>
              ))}
              <p className="-mt-2 text-[11px] text-cream-500">
                Export SKU looks like <span className="font-mono text-cream-300">{skuFor(form, "a1b2c3")}</span>
              </p>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={onSave}
                  disabled={busy || !dirty}
                  className="btn-primary rounded-full px-5 py-2.5 text-sm font-semibold"
                >
                  {busy ? "Saving…" : "Save template"}
                </button>
                <button type="button" onClick={reset} className="btn-ghost rounded-full px-4 py-2 text-xs font-medium">
                  Clear
                </button>
                {flash && <span className="text-xs text-emerald-300">{flash}</span>}
              </div>
              {error && (
                <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">{error}</p>
              )}
            </div>
          )}
        </section>

        {/* Live preview */}
        <section>
          <div className="mb-2 flex items-center justify-between px-1">
            <p className="eyebrow text-patina-300">Preview</p>
            <p className="text-xs text-cream-500">Sample description with your template</p>
          </div>
          <div className="rounded-3xl bg-white p-5 text-zinc-900">
            <h3 className="text-sm font-semibold leading-snug">{preview.title}</h3>
            <p className="mt-3 whitespace-pre-wrap text-[13px] leading-relaxed text-zinc-700">{preview.description}</p>
          </div>
        </section>

        {/* Account */}
        <section className="card p-5">
          <p className="eyebrow mb-1">Account</p>
          {!enabled ? (
            <p className="text-sm text-cream-300">
              Accounts aren&apos;t set up on this deployment yet. Add the Firebase settings described in the README to
              turn on saving and sign-in.
            </p>
          ) : authLoading ? (
            <div className="h-5 w-40 animate-pulse rounded bg-white/10" aria-busy="true" />
          ) : user ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-cream-100">{user.displayName || user.email || "Signed in"}</p>
                {user.displayName && user.email && <p className="truncate text-xs text-cream-500">{user.email}</p>}
              </div>
              <button
                type="button"
                onClick={() => {
                  log.info("auth", "Sign out from settings");
                  void signOut();
                }}
                className="btn-ghost rounded-full px-4 py-2 text-xs font-medium"
              >
                Sign out
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-cream-300">You&apos;re not signed in.</p>
              <button
                type="button"
                onClick={() => openSignIn({ reason: "Sign in to sync your settings" })}
                className="btn-primary rounded-full px-4 py-2 text-xs font-semibold"
              >
                Sign in
              </button>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
