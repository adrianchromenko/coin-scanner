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

## How it works

1. **Capture**: `src/components/CoinCapture.tsx` opens the phone camera (or gallery), decodes the photo honoring EXIF rotation, and runs the detector.
2. **Auto-crop**: `src/lib/autoCrop.ts` estimates the background color from the photo border, thresholds by color distance (Otsu), takes the largest blob, and fits a circle. You can drag or resize the circle before confirming. Output is a 1200px square JPEG, optionally with the background replaced by white.
3. **Identify**: `src/app/api/identify/route.ts` sends both crops to Claude with a structured output schema (`src/lib/coinSchema.ts`) and returns country, denomination, year, mint mark, type, composition, a conservative grade estimate, problems, a title under 80 characters, a description, eBay item specifics, and a rough value range.
4. **Edit and export**: `src/components/ListingForm.tsx` lets you fix anything, then copy the title / description / specifics, download the two photos, or download an eBay File Exchange style CSV.

## Notes

- The API key never leaves the server; the browser only talks to `/api/locate`, `/api/identify` and `/api/log`.
- Grades and values are AI estimates from photos. Treat them as a starting point, not an appraisal.
- Nothing is cropped at upload. On Identify, the model returns a bounding box for each photo, the browser crops at full resolution, and the crops go to the model for identification. "Fix front/back crop" on the result screen opens a manual circle editor.
- There is no login. Anyone with the deployed URL can run identifications against your API key, so keep the link private or add auth before sharing it widely.

## Next steps

- Direct eBay listing through the Sell Inventory API (needs an eBay developer account and OAuth).
- Batch mode: scan a whole tray of coins in one session.
- Save history to a database so listings can be revisited.
- Wrap as a native app (Capacitor) if the PWA install flow is not enough.
