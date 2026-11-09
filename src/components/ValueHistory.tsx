"use client";

import { useId, useState } from "react";
import type { ValuePoint } from "@/lib/firebase/coins";

type Props = {
  /** Any order; sorted by time here. */
  entries: ValuePoint[];
  className?: string;
};

const W = 320;
const H = 88;
const PAD_X = 6;
const PAD_TOP = 10;
const PAD_BOTTOM = 8;

function money(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n % 1 ? 2 : 0 });
}

function shortDate(ms: number) {
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function fullDate(ms: number) {
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

const SOURCE_LABEL: Record<string, string> = {
  scan: "Scan",
  revalue: "Re-check",
  "manual edit": "Edited",
};

/**
 * Sparkline of the suggested price over time, with the low–high range as a soft
 * band behind it. One series, so no legend: the card title names it. Hover or
 * focus a point for the exact figures; the table under "All estimates" carries
 * the same numbers for anyone who cannot use the chart.
 */
export default function ValueHistory({ entries, className = "" }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const titleId = useId();
  const points = [...entries].sort((a, b) => a.at - b.at);

  if (points.length === 0) {
    return (
      <p className={`text-xs text-cream-500 ${className}`}>
        No value history yet. Re-check the value to start tracking it over time.
      </p>
    );
  }

  const first = points[0];
  const last = points[points.length - 1];
  const change = last.suggested - first.suggested;

  if (points.length === 1) {
    return (
      <div className={`flex items-baseline justify-between gap-3 text-xs ${className}`}>
        <p className="text-cream-300">
          <span className="font-display text-base font-semibold text-cream-100">{money(first.suggested)}</span>
          <span className="text-cream-500"> · one estimate so far</span>
        </p>
        <p className="text-cream-500">{fullDate(first.at)}</p>
      </div>
    );
  }

  // Scales. Values include the low/high band so it never clips.
  const t0 = first.at;
  const t1 = last.at;
  const span = Math.max(1, t1 - t0);
  const vals = points.flatMap((p) => [p.suggested, p.low, p.high]).filter((v) => Number.isFinite(v));
  const vMin = Math.min(...vals);
  const vMax = Math.max(...vals);
  const vSpan = vMax - vMin || Math.max(1, vMax);
  const plotH = H - PAD_TOP - PAD_BOTTOM;
  const x = (ms: number) => PAD_X + ((ms - t0) / span) * (W - PAD_X * 2);
  const y = (v: number) => PAD_TOP + (1 - (v - vMin) / vSpan) * plotH;

  const xs = points.map((p) => x(p.at));
  const line = points.map((p, i) => `${i ? "L" : "M"}${xs[i].toFixed(1)},${y(p.suggested).toFixed(1)}`).join(" ");
  const area = `${line} L${xs[xs.length - 1].toFixed(1)},${(H - PAD_BOTTOM).toFixed(1)} L${xs[0].toFixed(1)},${(H - PAD_BOTTOM).toFixed(1)} Z`;
  const band =
    points.map((p, i) => `${i ? "L" : "M"}${xs[i].toFixed(1)},${y(p.high).toFixed(1)}`).join(" ") +
    " " +
    [...points]
      .reverse()
      .map((p, i) => `L${xs[points.length - 1 - i].toFixed(1)},${y(p.low).toFixed(1)}`)
      .join(" ") +
    " Z";

  function nearest(clientX: number, el: SVGSVGElement): number {
    const rect = el.getBoundingClientRect();
    const px = ((clientX - rect.left) / rect.width) * W;
    let best = 0;
    for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i] - px) < Math.abs(xs[best] - px)) best = i;
    return best;
  }

  const h = hover === null ? null : points[hover];
  const tipLeft = hover === null ? 0 : Math.min(Math.max((xs[hover] / W) * 100, 18), 82);

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <p className="text-cream-300">
          <span className="font-display text-base font-semibold text-cream-100">{money(last.suggested)}</span>
          <span className="text-cream-500"> now</span>
        </p>
        <p className={change === 0 ? "text-cream-500" : change > 0 ? "text-emerald-300" : "text-red-300"}>
          {change === 0 ? "No change" : `${change > 0 ? "+" : "−"}${money(Math.abs(change))}`}
          <span className="text-cream-500"> since first estimate</span>
        </p>
      </div>

      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="block h-24 w-full touch-none select-none"
          role="img"
          aria-labelledby={titleId}
          onPointerMove={(e) => setHover(nearest(e.clientX, e.currentTarget))}
          onPointerLeave={() => setHover(null)}
        >
          <title id={titleId}>
            Suggested price over time, {fullDate(first.at)} to {fullDate(last.at)}: {money(first.suggested)} to{" "}
            {money(last.suggested)}
          </title>
          {/* Low–high band: a wash, never a block */}
          <path d={band} fill="#ecc14f" fillOpacity="0.08" />
          {/* Area under the line */}
          <path d={area} fill="#ecc14f" fillOpacity="0.10" />
          {/* Baseline, one step off the surface */}
          <line x1={PAD_X} x2={W - PAD_X} y1={H - PAD_BOTTOM} y2={H - PAD_BOTTOM} stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
          {/* Crosshair */}
          {hover !== null && (
            <line x1={xs[hover]} x2={xs[hover]} y1={PAD_TOP - 4} y2={H - PAD_BOTTOM} stroke="rgba(244,239,228,0.35)" strokeWidth="1" />
          )}
          <path d={line} fill="none" stroke="#ecc14f" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          {/* End markers with a 2px surface ring; intermediate points only when hovered */}
          {points.map((p, i) => {
            const show = i === 0 || i === points.length - 1 || i === hover;
            if (!show) return null;
            return (
              <g key={p.at}>
                <circle cx={xs[i]} cy={y(p.suggested)} r="6" fill="#111727" />
                <circle cx={xs[i]} cy={y(p.suggested)} r="4" fill="#ecc14f" />
              </g>
            );
          })}
          {/* Invisible hit targets so each point is reachable by keyboard too */}
          {points.map((p, i) => (
            <rect
              key={`hit-${p.at}`}
              x={xs[i] - 12}
              y={0}
              width={24}
              height={H}
              fill="transparent"
              tabIndex={0}
              aria-label={`${fullDate(p.at)}: ${money(p.suggested)} suggested, ${money(p.low)} to ${money(p.high)}`}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              className="outline-none"
            />
          ))}
        </svg>

        {h && (
          <div
            className="pointer-events-none absolute -top-1 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg border border-white/10 bg-ink-800 px-2.5 py-1.5 text-[11px] shadow-xl"
            style={{ left: `${tipLeft}%` }}
            role="status"
          >
            <p className="font-semibold text-cream-100">{money(h.suggested)}</p>
            <p className="text-cream-500">
              {money(h.low)}–{money(h.high)} · {fullDate(h.at)} · {SOURCE_LABEL[h.source] ?? h.source}
            </p>
          </div>
        )}
      </div>

      {/* First / last direct labels and the date range */}
      <div className="flex items-start justify-between text-[11px] text-cream-500">
        <div>
          <p className="font-medium text-cream-300">{money(first.suggested)}</p>
          <p>{shortDate(first.at)}</p>
        </div>
        <p className="self-center">
          {points.length} estimate{points.length === 1 ? "" : "s"}
        </p>
        <div className="text-right">
          <p className="font-medium text-cream-300">{money(last.suggested)}</p>
          <p>{shortDate(last.at)}</p>
        </div>
      </div>

      <details className="text-xs">
        <summary className="cursor-pointer text-cream-500 hover:text-cream-300">All estimates</summary>
        <table className="mt-2 w-full text-left text-[11px]">
          <thead className="text-cream-500">
            <tr>
              <th className="py-1 pr-2 font-medium">Date</th>
              <th className="py-1 pr-2 font-medium">Suggested</th>
              <th className="py-1 pr-2 font-medium">Range</th>
              <th className="py-1 font-medium">Source</th>
            </tr>
          </thead>
          <tbody className="text-cream-300">
            {[...points].reverse().map((p) => (
              <tr key={p.at} className="border-t border-white/5">
                <td className="py-1 pr-2">{fullDate(p.at)}</td>
                <td className="py-1 pr-2 text-cream-100">{money(p.suggested)}</td>
                <td className="py-1 pr-2">
                  {money(p.low)}–{money(p.high)}
                </td>
                <td className="py-1">{SOURCE_LABEL[p.source] ?? p.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
