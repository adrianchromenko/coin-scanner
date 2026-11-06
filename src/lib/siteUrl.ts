/**
 * Public origin of the deployed site, used for canonical URLs, Open Graph
 * images, robots and the sitemap. Render sets RENDER_EXTERNAL_URL on every
 * web service; NEXT_PUBLIC_SITE_URL overrides it (e.g. for a custom domain).
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ||
  process.env.RENDER_EXTERNAL_URL ||
  "http://localhost:4321"
).replace(/\/+$/, "");
