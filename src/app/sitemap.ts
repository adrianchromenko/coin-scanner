import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/siteUrl";

export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: `${SITE_URL}/`, changeFrequency: "weekly", priority: 1 }];
}
