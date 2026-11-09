import type { CoinListing } from "./coinSchema";

/** CSV helpers shared by the single listing export, batch mode and the collection exports. */

export function csvCell(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "coin"
  );
}

/** Build a CSV string from a header row and data rows. */
export function toCsv(header: string[], rows: (string | number | null | undefined)[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
}

export type EbayRow = {
  listing: CoinListing;
  /** Public picture URLs, pipe-separated by eBay's convention. Optional. */
  picUrls?: string[];
  /** Overrides the listing's suggested price. */
  price?: number;
  /** Seller SKU (we use the saved coin id). */
  sku?: string;
};

/**
 * eBay File Exchange / Seller Hub Reports style CSV. Item specifics become
 * C:<Name> columns; the union of all names across rows is used so every row
 * has the same columns.
 */
export function ebayCsv(rows: EbayRow[]): string {
  const specificNames: string[] = [];
  for (const r of rows) {
    for (const s of r.listing.item_specifics) {
      if (s.name && s.value && !specificNames.includes(s.name)) specificNames.push(s.name);
    }
  }
  const header = [
    "*Action(SiteID=US|Country=US|Currency=USD|Version=1193)",
    "CustomLabel",
    "*Category",
    "*Title",
    "Description",
    "PicURL",
    "*StartPrice",
    "*Format",
    "*Duration",
    "*Quantity",
    "*ConditionID",
    ...specificNames.map((n) => `C:${n}`),
  ];
  const data = rows.map((r) => {
    const l = r.listing;
    const byName = new Map(l.item_specifics.map((s) => [s.name, s.value]));
    return [
      "Add",
      r.sku ?? "",
      "",
      l.title,
      l.description,
      (r.picUrls ?? []).join("|"),
      r.price ?? l.suggested_price_usd,
      "FixedPrice",
      "GTC",
      1,
      l.circulated ? "3000" : "1000",
      ...specificNames.map((n) => byName.get(n) ?? ""),
    ];
  });
  return toCsv(header, data);
}

/** Trigger a browser download of a text file. */
export function downloadText(text: string, filename: string, mime = "text/plain"): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
