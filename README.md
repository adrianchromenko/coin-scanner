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
- There is no login. Anyone with the deployed URL can run identifications against your API key, so keep the link private or add auth before sharing it widely.

## Next steps

- Direct eBay listing through the Sell Inventory API (needs an eBay developer account and OAuth).
- Batch mode: scan a whole tray of coins in one session.
- Save history to a database so listings can be revisited.
- Wrap as a native app (Capacitor) if the PWA install flow is not enough.
