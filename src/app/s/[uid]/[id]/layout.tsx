import type { Metadata } from "next";

/**
 * Metadata for public share pages (/s/{uid}/{coinId}).
 *
 * The coin itself is read in the browser with the Firestore client SDK, so
 * there is no server-side data to put in the title. A static, generic title
 * keeps the segment fully prerenderable under Cache Components; the root
 * opengraph-image / twitter-image conventions still supply the preview card.
 */
const TITLE = "Coin on CoinLens";
const DESCRIPTION =
  "A coin identified, graded and priced with CoinLens. Snap both sides of your own coin to get an eBay-ready listing.";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  // Share links carry an account id in the path; keep them out of search indexes.
  robots: { index: false, follow: true },
  openGraph: { type: "website", siteName: "CoinLens", title: TITLE, description: DESCRIPTION },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

export default function ShareLayout({ children }: { children: React.ReactNode }) {
  return children;
}
