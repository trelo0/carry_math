import type { MetadataRoute } from "next";
import { getBaseUrlString } from "@/lib/siteUrl";

export default function robots(): MetadataRoute.Robots {
  const base = getBaseUrlString();
  return {
    rules: {
      userAgent: "*",
      allow: "/",
    },
    sitemap: `${base}/sitemap.xml`,
  };
}

