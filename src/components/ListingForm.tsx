"use client";

import Link from "next/link";
import { useState } from "react";
import { certLookupUrl, type CoinListing, type ItemSpecific } from "@/lib/coinSchema";
import type { Market } from "@/lib/market";
import { downloadText, ebayCsv, slugify } from "@/lib/csv";
import { useListingTemplate } from "@/lib/firebase/settings";
import { log } from "@/lib/log";
import { applyTemplate } from "@/lib/template";

type Props = {
  listing: CoinListing;
  onChange: (next: CoinListing) => void;
  front: string;
  back: string;
  /** Spot price and melt value for the identified coin, when it contains precious metal. */
  market?: Market | null;
  /** When set, the "add a close-up" button is shown for coins the AI flagged. */
  onCloseup?: (file: File) => void;
  closeupBusy?: boolean;
};

function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function money(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n % 1 ? 2 : 0 });
}

function Field({
  label,
  value,
  onChange,
  multiline,
  type = "text",
  extra,
}: {
  label: string;
  value: string | number;
  onChange: (v: string) => void;
  multiline?: boolean;
  type?: "text" | "number";
  extra?: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="eyebrow mb-1.5 flex items-baseline justify-between">
        {label}
        {extra}
      </span>
      {multiline ? (
        <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={9} className="input-dark" />
      ) : (
        <input type={type} value={value} onChange={(e) => onChange(e.target.value)} className="input-dark" />
      )}
    </label>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <h3 className="font-display text-lg font-semibold">{children}</h3>
      <div className="hairline flex-1" />
    </div>
  );
}

function Icon({ d, className = "h-4 w-4" }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={d} />
    </svg>
  );
}
const ICON = {
  copy: "M9 9h10v11H9zM5 15V4h10",
  photo: "M4 7h16v12H4zM4 15l4-4 4 4 3-3 5 5M15 10h.01",
  sheet: "M5 4h14v16H5zM5 9h14M5 14h14M10 9v11",
  sparkle: "M12 3v4m0 10v4M3 12h4m10 0h4M6.5 6.5l2 2m7 7 2 2m0-11-2 2m-7 7-2 2",
  edit: "M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3zM13.5 6.5l3 3",
};

export default function ListingForm({ listing, onChange, front, back, market, onCloseup, closeupBusy }: Props) {
  const [copied, setCopied] = useState<string | null>(null);
  // Seller boilerplate (shipping, returns, footer) from Settings is applied to exports only,
  // so the stored listing stays clean and the template can change later.
  const { template, source: templateSource } = useListingTemplate();
  const out = applyTemplate(listing, template);
  const templated = out.description !== listing.description;

  const set = <K extends keyof CoinListing>(key: K, v: CoinListing[K]) =>
    onChange({ ...listing, [key]: v });

  const num = (s: string) => (s === "" ? 0 : Number(s));

  async function copy(label: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      log.info("export", `Copied ${label.toLowerCase()} (${text.length} chars)`);
      setCopied(`${label} copied`);
    } catch (e) {
      log.warn("export", `Clipboard blocked when copying ${label.toLowerCase()}`, e);
      setCopied("Clipboard blocked by browser");
    }
    setTimeout(() => setCopied(null), 1600);
  }

  const specificsText = listing.item_specifics.map((s) => `${s.name}: ${s.value}`).join("\n");

  const allText = [
    listing.title,
    "",
    out.description,
    "",
    "Item specifics",
    specificsText,
    "",
    `Suggested price: $${listing.suggested_price_usd}`,
  ].join("\n");

  function exportCsv() {
    // eBay File Exchange style: item specifics go in C:<Name> columns.
    const csv = ebayCsv([{ listing: out }]);
    downloadText(csv, `${slugify(listing.title)}.csv`, "text/csv");
    log.info("export", "eBay CSV downloaded", { templated });
  }

  function updateSpecific(i: number, patch: Partial<ItemSpecific>) {
    set(
      "item_specifics",
      listing.item_specifics.map((s, j) => (j === i ? { ...s, ...patch } : s)),
    );
  }

  const slug = slugify(listing.title);
  const pct = Math.round(listing.confidence * 100);
  const conf =
    pct >= 80
      ? { cls: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300", dot: "bg-emerald-400" }
      : pct >= 50
        ? { cls: "border-gold-400/40 bg-gold-400/10 text-gold-300", dot: "bg-gold-400" }
        : { cls: "border-red-400/40 bg-red-400/10 text-red-300", dot: "bg-red-400" };

  const mint =
    listing.mint_mark && !/^(none|unknown|n\/a)$/i.test(listing.mint_mark) ? listing.mint_mark : "";
  const meta = [listing.year, mint, listing.denomination, listing.country].filter(Boolean).join(" · ");

  const ghostBtn = "btn-ghost flex items-center justify-center gap-2 rounded-xl px-3 py-3 text-sm font-medium";

  return (
    <div className="flex flex-col gap-5">
      {/* AI assessment */}
      <section className="card overflow-hidden">
        <div className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="eyebrow mb-1">{listing.identified ? "Identified as" : "Could not identify"}</p>
              <h2 className="font-display text-2xl font-semibold leading-tight">
                {listing.coin_type || listing.denomination || "Unknown coin"}
              </h2>
              {meta && <p className="mt-1 truncate text-sm text-cream-300">{meta}</p>}
            </div>
            <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${conf.cls}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${conf.dot}`} />
              {pct}% sure
            </span>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2">
            <div className="rounded-xl bg-black/25 px-3 py-2.5">
              <p className="eyebrow">Grade</p>
              <p className="mt-0.5 truncate font-semibold">{listing.grade_estimate || "—"}</p>
            </div>
            <div className="rounded-xl bg-black/25 px-3 py-2.5">
              <p className="eyebrow">Est. value</p>
              <p className="mt-0.5 truncate font-semibold">
                {money(listing.estimated_value_usd.low)}–{money(listing.estimated_value_usd.high)}
              </p>
            </div>
            <div className="rounded-xl border border-gold-400/30 bg-gold-400/10 px-3 py-2.5">
              <p className="eyebrow text-gold-300/80">List at</p>
              <p className="gold-text mt-0.5 truncate font-display text-lg font-bold">
                {money(listing.suggested_price_usd)}
              </p>
            </div>
          </div>

          {!listing.identified && (
            <p className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              The AI could not identify this coin. Check the notes below and retake clearer photos.
            </p>
          )}
          {listing.problems.length > 0 && (
            <p className="mt-4 rounded-xl border border-gold-400/30 bg-gold-400/10 px-3 py-2 text-sm text-gold-200">
              <span className="font-semibold">Problems noted:</span> {listing.problems.join(", ")}
            </p>
          )}

          {(listing.grading_service || listing.cert_number) && (
            <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-sky-400/30 bg-sky-400/10 px-3 py-2 text-sm text-sky-100">
              <span className="font-semibold">Slabbed</span>
              <span>{[listing.grading_service, listing.slab_grade].filter(Boolean).join(" ")}</span>
              {listing.cert_number && <span className="font-mono text-xs text-sky-200/80">cert {listing.cert_number}</span>}
              {certLookupUrl(listing.grading_service, listing.cert_number) && (
                <a
                  href={certLookupUrl(listing.grading_service, listing.cert_number)!}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-auto font-medium underline underline-offset-4"
                  onClick={() => log.info("slab", "Opened certificate lookup", { service: listing.grading_service, cert: listing.cert_number })}
                >
                  Verify certificate ↗
                </a>
              )}
            </div>
          )}

          {listing.needs_closeup && onCloseup && (
            <div className="mt-4 rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 text-sm text-amber-100">
              <p className="font-semibold">A close-up could change the value</p>
              <p className="mt-1 text-amber-100/90">{listing.closeup_reason}</p>
              <label className={`btn-primary mt-3 flex cursor-pointer items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold ${closeupBusy ? "pointer-events-none opacity-60" : ""}`}>
                <Icon d={ICON.photo} />
                {closeupBusy ? "Re-checking…" : "Add a close-up of the date & mint mark"}
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="sr-only"
                  disabled={closeupBusy}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onCloseup(f);
                    e.target.value = "";
                  }}
                />
              </label>
            </div>
          )}

          {(listing.price_basis || listing.price_sources.length > 0 || market?.melt_value_usd) && (
            <div className="mt-4 rounded-xl bg-black/25 p-3 text-sm">
              <p className="eyebrow mb-1">Where the price comes from</p>
              {listing.price_basis && <p className="leading-relaxed text-cream-300">{listing.price_basis}</p>}
              {market?.melt_value_usd != null && market.spot && (
                <p className={`mt-2 ${listing.suggested_price_usd < market.melt_value_usd ? "text-red-300" : "text-cream-300"}`}>
                  <span className="font-semibold text-cream-100">Melt value </span>
                  {money(market.melt_value_usd)}{" "}
                  <span className="text-cream-500">
                    ({market.spot.metal} at {money(market.spot.usd_per_oz)}/oz · {new Date(market.spot.as_of).toLocaleDateString()})
                  </span>
                  {listing.suggested_price_usd < market.melt_value_usd && " — your price is below melt"}
                </p>
              )}
              {listing.price_sources.length > 0 && (
                <ul className="mt-2 flex flex-col gap-1">
                  {listing.price_sources.slice(0, 6).map((s, i) => (
                    <li key={i} className="flex items-baseline gap-2 text-xs">
                      <a href={s.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-patina-300 underline-offset-4 hover:underline">
                        {s.title || s.url}
                      </a>
                      {s.price_usd != null && <span className="shrink-0 text-cream-300">{money(s.price_usd)}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}


          <details className="group mt-4 text-sm">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-cream-300 hover:text-cream-100">
              <Icon d={ICON.sparkle} className="h-4 w-4 text-patina-400" />
              How it was identified and graded
              <span className="ml-auto text-cream-500 transition-transform group-open:rotate-180">⌄</span>
            </summary>
            <div className="mt-3 flex flex-col gap-3 rounded-xl bg-black/25 p-3 leading-relaxed text-cream-300">
              <p className="whitespace-pre-wrap">{listing.identification_notes}</p>
              <p className="whitespace-pre-wrap">
                <span className="font-semibold text-cream-100">Grade. </span>
                {listing.grade_reasoning}
              </p>
            </div>
          </details>
        </div>
      </section>

      {/* Export actions */}
      <section className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => copy("Everything", allText)}
          className="btn-primary flex items-center justify-center gap-2 rounded-2xl px-4 py-4 text-base font-semibold"
        >
          <Icon d={ICON.copy} className="h-5 w-5" />
          Copy everything for eBay
        </button>
        <p className="px-1 text-center text-xs text-cream-500">
          {templated ? (
            <>Your shipping / returns / footer lines from <Link href="/settings" className="text-patina-300 underline-offset-4 hover:underline">Settings</Link> are added to the description{templateSource === "device" ? " (saved on this device)" : ""}.</>
          ) : (
            <>Add shipping and returns boilerplate once in <Link href="/settings" className="text-patina-300 underline-offset-4 hover:underline">Settings</Link>.</>
          )}
        </p>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => copy("Title", listing.title)} className={ghostBtn}>
            <Icon d={ICON.copy} /> Title
          </button>
          <button type="button" onClick={() => copy("Description", out.description)} className={ghostBtn}>
            <Icon d={ICON.copy} /> Description
          </button>
          <button type="button" onClick={() => copy("Item specifics", specificsText)} className={ghostBtn}>
            <Icon d={ICON.copy} /> Specifics
          </button>
          <button
            type="button"
            onClick={() => {
              log.info("export", "Photos downloaded", { slug });
              downloadDataUrl(front, `${slug}-front.jpg`);
              setTimeout(() => downloadDataUrl(back, `${slug}-back.jpg`), 300);
            }}
            className={ghostBtn}
          >
            <Icon d={ICON.photo} /> Photos
          </button>
          <button type="button" onClick={exportCsv} className={`${ghostBtn} col-span-2`}>
            <Icon d={ICON.sheet} /> Download eBay CSV
          </button>
        </div>
      </section>

      {/* Editing, collapsed by default */}
      <details className="group">
        <summary className="btn-ghost flex cursor-pointer list-none items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-medium">
          <Icon d={ICON.edit} />
          Edit listing details
          <span className="text-cream-500 transition-transform group-open:rotate-180">⌄</span>
        </summary>
        <div className="mt-4 flex flex-col gap-5">
      <section className="card p-5">
        <SectionTitle>Listing details</SectionTitle>
        <div className="flex flex-col gap-4">
          <Field
            label="Title"
            value={listing.title}
            onChange={(v) => set("title", v)}
            extra={
              <span className={listing.title.length > 80 ? "text-red-400" : "text-cream-500"}>
                {listing.title.length}/80
              </span>
            }
          />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Country" value={listing.country} onChange={(v) => set("country", v)} />
            <Field label="Denomination" value={listing.denomination} onChange={(v) => set("denomination", v)} />
            <Field label="Year" value={listing.year} onChange={(v) => set("year", v)} />
            <Field label="Mint mark" value={listing.mint_mark} onChange={(v) => set("mint_mark", v)} />
            <Field label="Type / series" value={listing.coin_type} onChange={(v) => set("coin_type", v)} />
            <Field label="Variety" value={listing.variety} onChange={(v) => set("variety", v)} />
            <Field label="Composition" value={listing.composition} onChange={(v) => set("composition", v)} />
            <Field label="Era" value={listing.era} onChange={(v) => set("era", v)} />
            <Field label="Grade" value={listing.grade_estimate} onChange={(v) => set("grade_estimate", v)} />
            <Field label="Certification" value={listing.certification} onChange={(v) => set("certification", v)} />
            <Field label="KM number" value={listing.km_number} onChange={(v) => set("km_number", v)} />
            <label className="block">
              <span className="eyebrow mb-1.5 block">Circulated</span>
              <select
                value={listing.circulated ? "yes" : "no"}
                onChange={(e) => set("circulated", e.target.value === "yes")}
                className="input-dark"
              >
                <option value="yes">Circulated</option>
                <option value="no">Uncirculated</option>
              </select>
            </label>
            <Field
              label="Price (USD)"
              type="number"
              value={listing.suggested_price_usd}
              onChange={(v) => set("suggested_price_usd", num(v))}
            />
            <div className="grid grid-cols-2 gap-2">
              <Field
                label="Low"
                type="number"
                value={listing.estimated_value_usd.low}
                onChange={(v) => set("estimated_value_usd", { ...listing.estimated_value_usd, low: num(v) })}
              />
              <Field
                label="High"
                type="number"
                value={listing.estimated_value_usd.high}
                onChange={(v) => set("estimated_value_usd", { ...listing.estimated_value_usd, high: num(v) })}
              />
            </div>
          </div>
          <Field
            label="Problems (comma separated)"
            value={listing.problems.join(", ")}
            onChange={(v) =>
              set(
                "problems",
                v.split(",").map((s) => s.trim()).filter(Boolean),
              )
            }
          />
          <Field label="Description" value={listing.description} onChange={(v) => set("description", v)} multiline />
        </div>
      </section>

      {/* Item specifics */}
      <section className="card p-5">
        <SectionTitle>Item specifics</SectionTitle>
        <div className="flex flex-col gap-2">
          {listing.item_specifics.map((s, i) => (
            <div key={i} className="flex gap-2">
              <input
                value={s.name}
                onChange={(e) => updateSpecific(i, { name: e.target.value })}
                className="input-dark basis-2/5"
                placeholder="Name"
              />
              <input
                value={s.value}
                onChange={(e) => updateSpecific(i, { value: e.target.value })}
                className="input-dark basis-3/5"
                placeholder="Value"
              />
              <button
                type="button"
                aria-label="Remove"
                onClick={() =>
                  set(
                    "item_specifics",
                    listing.item_specifics.filter((_, j) => j !== i),
                  )
                }
                className="shrink-0 px-2 text-lg leading-none text-cream-500 hover:text-red-400"
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => set("item_specifics", [...listing.item_specifics, { name: "", value: "" }])}
            className="mt-1 self-start text-sm font-medium text-patina-300 underline-offset-4 hover:underline"
          >
            + Add specific
          </button>
        </div>
      </section>
        </div>
      </details>

      {copied && (
        <div className="pointer-events-none fixed inset-x-0 bottom-[max(1.25rem,env(safe-area-inset-bottom))] z-50 flex justify-center px-4">
          <p className="animate-fade-up rounded-full border border-patina-400/40 bg-ink-800/95 px-4 py-2 text-sm font-medium text-patina-200 shadow-xl backdrop-blur">
            {copied}
          </p>
        </div>
      )}
    </div>
  );
}
