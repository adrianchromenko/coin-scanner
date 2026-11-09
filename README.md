# CoinLens

Mobile web app for coin sellers. Photograph the front and back of a coin on your phone, tap one button, and Claude finds the coin in each photo, crops it, identifies it and fills out an eBay-style listing you can copy, edit, or export.

## Setup

```bash
npm install
cp .env.example .env.local   # then paste your Anthropic API key into .env.local
npm run dev -- --port 4321 --hostname 0.0.0.0
```

Open http://localhost:4321. To use it from a phone on the same Wi-Fi, open `http://<your-pc-ip>:4321`. The LAN address patterns that are allowed in dev are listed under `allowedDevOrigins` in `next.config.ts`. Add `?demo=1` to the URL to walk through the flow with a sample listing and no API calls.

## Deploy to Render

The repo contains a `render.yaml` blueprint, so the service is created from the file:

1. In Render, choose **New → Blueprint** and pick this GitHub repo.
2. Render asks for the one value not in the file: paste your Anthropic key as `ANTHROPIC_API_KEY`.
3. Click **Apply**. The first build takes a few minutes; after that every push to `master` redeploys.

The free plan works. Note that a free service sleeps after 15 minutes without traffic and takes about a minute to wake up on the next visit. Server logs appear in the Render **Logs** tab (the local `logs/app.log` file is not kept between restarts).

## Accounts and "My coins" (Firebase)

Signed-in users can save each scanned coin (listing + both photos) and come back to it at `/coins`. This is optional: with no Firebase settings the app runs exactly as before and the account UI is hidden.

1. In the [Firebase console](https://console.firebase.google.com) create a project (the free Spark plan is enough) and add a **Web app** to it.
2. **Authentication → Sign-in method**: enable **Email/Password** and **Google**. Under **Settings → Authorized domains** add your Render host (for example `coinlens-h71x.onrender.com`).
3. **Firestore Database → Create database** (production mode), then publish the rules from `firestore.rules` (paste them in the Rules tab, or run `firebase deploy --only firestore:rules`).
4. Copy the web app config (Project settings → Your apps) into `.env.local` locally and into the Render **Environment** tab: `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, `NEXT_PUBLIC_FIREBASE_APP_ID` (storage bucket and sender id are optional). Redeploy; the values are baked in at build time.

Data model: `users/{uid}/coins/{coinId}` holds the listing, status (saved / listed / sold) and a small thumbnail; `users/{uid}/coins/{coinId}/images/full` holds the two 800 px photos as JPEG data URLs, so no Cloud Storage bucket is needed. The rules only let a user read and write their own `users/{uid}` tree.

## Pricing: sold comps, melt value, re-checks

- **Sold prices**: during identification the model runs up to six web searches for recent sold listings of the same coin and grade and returns a `price_basis` sentence plus `price_sources` links, shown under "Where the price comes from". Turn this off with `PRICE_SEARCH=0` to save roughly six cents per scan.
- **Melt value**: `/api/spot` fetches silver, gold, platinum and palladium spot prices from gold-api.com (cached one hour). For precious-metal coins the result shows the melt value and the suggested price is never allowed below it.
- **Re-check value**: on a saved coin's page, "Re-check value" calls `/api/revalue`, which re-runs only the pricing search and appends a point to the coin's value history chart.
- **Close-up step**: if the model says a key date or mint-mark variety could change the value, the listing shows "Add a close-up of the date & mint mark"; the third photo is sent with the first result for a refined identification.
- **Slabs**: for PCGS / NGC / ANACS / ICG / CACG holders the label is read and a "Verify certificate" link goes to the grading service's lookup page.

## Inventory, exports and templates

- `/coins` shows totals (coins, cost, estimated value of unsold, realised profit), status filters and an **Export** menu: all coins as an eBay File Exchange CSV, or sold coins as a tax-season CSV (date, title, cost, sale price, fees, net).
- Each coin's page has a **Money** card (cost basis, sale price, fees, date, platform, notes) and a **Value** card with the history chart.
- `/settings` holds a listing template (shipping line, returns line, footer, SKU prefix) that is appended to every copied description and CSV export. It is stored per account, or on the device when accounts are off.
- **Share**: the toggle on a coin's page makes it readable at `/s/{uid}/{coinId}` for anyone with the link (Firestore rules allow a single-document `get` only when `public == true`).

## Batch mode

`/batch` ("Scan a tray" on the home screen) takes up to 20 coins, two photos each, scans them one after another with progress, then offers "Save all to my coins" and a single CSV for the whole tray.

## Listing on eBay with one tap

With eBay developer keys configured, the result screen shows **Connect eBay**, then **List for $X**. The server uploads both photos (Trading API `UploadSiteHostedPictures`), picks a Coins & Paper Money category, creates the inventory item and offer, and publishes a fixed-price listing (Sell Inventory API).

1. At [developer.ebay.com](https://developer.ebay.com) create an application keyset (Sandbox first). Copy App ID to `EBAY_CLIENT_ID` and Cert ID to `EBAY_CLIENT_SECRET`.
2. Under **User Tokens → Get a Token from eBay via Your Application → Add eBay Redirect URL**, set the auth-accepted URL to `https://<your host>/api/ebay/callback` (choose OAuth) and copy the generated RuName to `EBAY_RU_NAME`.
3. Set `EBAY_TOKEN_SECRET` to 32+ random characters and `EBAY_POSTAL_CODE` to your ship-from ZIP.
4. The seller account needs business policies (one shipping, one payment, one return) in Seller Hub; the app reports a clear error until they exist. For the sandbox, register a sandbox seller user and create them at sandbox.ebay.com.
5. Switch `EBAY_ENV=production` with the production keyset when ready.

The refresh token is encrypted into a browser cookie; the server stores nothing.

## Offline and install

The app is a PWA: a service worker (`public/sw.js`) caches the shell so it opens without a connection, and an install bar appears on supported browsers (on iOS: Share → Add to Home Screen). If Identify fails while offline, **Save for later** keeps both photos in IndexedDB and a banner offers to run them when you are back online.

## Sign-in requirement, daily limits and the admin dashboard

Anyone who finds the URL can spend your API budget, so three server-side knobs exist:

- `REQUIRE_SIGN_IN=1` makes `/api/identify` and `/api/revalue` refuse anonymous requests (the app opens the sign-in sheet). Needs Firebase.
- `DAILY_SCAN_LIMIT=25` caps scans per user per UTC day (per IP when anonymous). The result screen shows "N scans left today".
- `ADMIN_EMAILS=you@example.com` unlocks `/admin`: scans and estimated API cost per day, top users, recent scans.

Counters and the scan log are kept in Firestore (`usage_daily/`, `scans/`) when `FIREBASE_SERVICE_ACCOUNT` holds a service-account JSON; otherwise they live in server memory and reset on each deploy. Token verification falls back to Google's REST endpoint, so sign-in enforcement works either way.

## How it works

1. **Capture**: `src/components/CoinCapture.tsx` opens the phone camera (or gallery), decodes the photo honoring EXIF rotation, and runs the detector.
2. **Auto-crop**: `src/lib/autoCrop.ts` estimates the background color from the photo border, thresholds by color distance (Otsu), takes the largest blob, and fits a circle. You can drag or resize the circle before confirming. Output is a 1200px square JPEG, optionally with the background replaced by white.
3. **Identify**: `src/app/api/identify/route.ts` sends both crops to Claude with a structured output schema (`src/lib/coinSchema.ts`) and returns country, denomination, year, mint mark, type, composition, a conservative grade estimate, problems, a title under 80 characters, a description, eBay item specifics, and a rough value range.
4. **Edit and export**: `src/components/ListingForm.tsx` lets you fix anything, then copy the title / description / specifics, download the two photos, or download an eBay File Exchange style CSV.

## Notes

- The API key never leaves the server; the browser only talks to `/api/locate`, `/api/identify` and `/api/log`.
- Grades and values are AI estimates from photos. Treat them as a starting point, not an appraisal.
- Blur is caught twice. At upload a Laplacian focus measure over the centre of the photo blocks clearly blurry shots (thresholds in `src/lib/photoCheck.ts`, with a "Use anyway" override). At Identify, the locate call also asks the model to flag blur, glare, darkness, cut-off or obstructed coins; if anything is flagged the app shows the crops and offers a retake before spending on identification.
- Share previews and SEO: Open Graph and Twitter tags, a generated share image, an iOS home-screen icon, robots.txt and sitemap.xml come from `src/app/layout.tsx` and the metadata files next to it. The public origin comes from `NEXT_PUBLIC_SITE_URL` (set in `render.yaml`) or Render's `RENDER_EXTERNAL_URL`.
- Nothing is cropped at upload. On Identify, the model returns a bounding box for each photo, the browser crops at full resolution, and the crops go to the model for identification. "Fix front/back crop" on the result screen opens a manual circle editor.
- By default anyone with the URL can scan. Set `REQUIRE_SIGN_IN=1` and `DAILY_SCAN_LIMIT` before sharing the link widely (see the limits section above).

## Next steps

- Wrap as a native app (Capacitor) if the PWA install flow is not enough.
- Best-offer and auction formats for eBay listings.
- Server-rendered preview images for shared coin pages.
