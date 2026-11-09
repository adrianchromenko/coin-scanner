# CoinLens brand

- `CoinLens-Brand-Guide.pdf` — the brand guide (identity, rules, five directions, applications, ChatGPT logo prompts).
- `source/guide.html` — the guide's source. Re-render with headless Chrome:

```
cd brand/source && node render.mjs      # needs puppeteer-core on the path (npm i puppeteer-core)
```

Google Fonts must be reachable while rendering (Poppins, Geist Mono).
The film grain is a pre-rendered PNG tile on purpose: an SVG `feTurbulence` filter makes Chrome rasterise every page and bloats the PDF to 60 MB+.

## Wordmark assets

- `assets/coinlens-lockup.png` — the drawn name + tagline on a transparent background (1170×332).
- `assets/coinlens-wordmark.png` — the name only (1170×226). Also served from `public/brand/` and used by `src/components/Wordmark.tsx` in the app header.
- Source: `coins-lens.png` generated from `logo-prompts.txt`, background knocked out with a luminance key.
