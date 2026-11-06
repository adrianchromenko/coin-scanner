"use client";

import { useState } from "react";
import type { CoinListing } from "@/lib/coinSchema";

type Props = {
  listing: CoinListing;
  front: string;
  back: string;
  onFixCrop?: (side: "front" | "back") => void;
};

function money(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
}

/** A marketplace-style mock-up of the finished listing, the way a buyer would see it. */
export default function ListingPreview({ listing, front, back, onFixCrop }: Props) {
  const [side, setSide] = useState<"front" | "back">("front");
  const condition = [listing.circulated ? "Circulated" : "Uncirculated", listing.grade_estimate]
    .filter(Boolean)
    .join(" · ");
  const specifics = listing.item_specifics.filter((s) => s.name && s.value).slice(0, 10);

  return (
    <section>
      <div className="mb-2 flex items-center justify-between px-1">
        <p className="eyebrow text-gold-300">Listing preview</p>
        <p className="text-xs text-cream-500">How buyers will see it</p>
      </div>
      <div className="overflow-hidden rounded-3xl bg-white text-zinc-900 shadow-[0_30px_80px_-30px_rgba(236,193,79,0.35)]">
        {/* Gallery */}
        <div className="bg-zinc-50 p-4">
          <div className="mx-auto aspect-square w-full max-w-[320px] overflow-hidden rounded-2xl bg-white ring-1 ring-zinc-200">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={side === "front" ? front : back} alt={`Coin ${side}`} className="h-full w-full object-contain" />
          </div>
          <div className="mt-3 flex items-center justify-center gap-2">
            {(["front", "back"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSide(s)}
                className={`h-14 w-14 overflow-hidden rounded-xl ring-2 transition ${
                  side === s ? "ring-zinc-900" : "ring-zinc-200 hover:ring-zinc-400"
                }`}
                aria-label={`Show ${s}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s === "front" ? front : back} alt="" className="h-full w-full object-cover" />
              </button>
            ))}
            {onFixCrop && (
              <button
                type="button"
                onClick={() => onFixCrop(side)}
                className="ml-2 rounded-full border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
              >
                Fix {side} crop
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-4 p-5">
          <h2 className="text-[17px] font-semibold leading-snug">{listing.title || "Untitled listing"}</h2>

          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-[26px] font-bold leading-none">{money(listing.suggested_price_usd)}</p>
              <p className="mt-1 text-xs text-zinc-500">or Best Offer · Free returns</p>
            </div>
            <span className="rounded-full bg-zinc-900 px-3.5 py-2 text-xs font-semibold text-white">Buy It Now</span>
          </div>

          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-y border-zinc-200 py-3 text-sm">
            <dt className="text-zinc-500">Condition</dt>
            <dd className="font-medium">{condition || "See description"}</dd>
            {listing.problems.length > 0 && (
              <>
                <dt className="text-zinc-500">Notes</dt>
                <dd className="font-medium text-amber-700">{listing.problems.join(", ")}</dd>
              </>
            )}
            <dt className="text-zinc-500">Shipping</dt>
            <dd className="font-medium">Calculated at checkout</dd>
          </dl>

          {specifics.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-semibold">Item specifics</h3>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[13px]">
                {specifics.map((s) => (
                  <div key={s.name} className="min-w-0">
                    <dt className="truncate text-zinc-500">{s.name}</dt>
                    <dd className="truncate font-medium">{s.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          <div>
            <h3 className="mb-2 text-sm font-semibold">About this item</h3>
            <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-zinc-700">{listing.description}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
