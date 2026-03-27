import type { MetadataRoute } from "next";
import { getBaseUrlString } from "@/lib/siteUrl";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = getBaseUrlString();
  return [
    {
      url: `${base}/`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
  ];
}

