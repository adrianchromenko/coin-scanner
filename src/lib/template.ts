import type { CoinListing } from "./coinSchema";
import type { ListingTemplate } from "./firebase/settings";

/**
 * Append the seller's boilerplate to a listing description. The shipping and
 * returns lines form one paragraph, the footer another. Lines already present
 * in the description (the AI sometimes writes its own shipping sentence, or the
 * template was applied before) are not added twice.
 */
export function applyTemplate(listing: CoinListing, t: ListingTemplate): CoinListing {
  const base = (listing.description ?? "").replace(/\s+$/, "");
  const has = (line: string) => base.toLowerCase().includes(line.toLowerCase());

  const terms = [t.shipping_line, t.returns_line].map((s) => s.trim()).filter((s) => s && !has(s));
  const footer = t.footer.trim();

  const paragraphs = [base];
  if (terms.length) paragraphs.push(terms.join("\n"));
  if (footer && !has(footer)) paragraphs.push(footer);

  const description = paragraphs.filter(Boolean).join("\n\n");
  return description === listing.description ? { ...listing } : { ...listing, description };
}

/** Seller SKU for CSV exports: the template prefix followed by the saved coin id. */
export function skuFor(t: Pick<ListingTemplate, "sku_prefix">, coinId: string): string {
  return `${t.sku_prefix.trim()}${coinId}`;
}
