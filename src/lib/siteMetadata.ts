import type { Metadata } from "next";
import { getHomePage, getSiteSettings } from "@/lib/sanity";
import { normalizeBrandName } from "@/lib/brand";
import { getMetadataBaseUrl } from "@/lib/siteUrl";

export async function getSiteMetaContent() {
  const [siteSettings, home] = await Promise.all([
    getSiteSettings(),
    getHomePage(),
  ]);

  const siteName = normalizeBrandName(siteSettings?.title);
  const description =
    home?.heroDescription?.trim() ||
    siteSettings?.footerDescription?.trim() ||
    "Онлайн-школа для тех, кто готов побеждать.";

  const title = `${siteName} — онлайн-школа`;

  return { siteName, title, description };
}

export async function buildSiteMetadata(): Promise<Metadata> {
  const { siteName, title, description } = await getSiteMetaContent();

  return {
    title,
    description,
    metadataBase: getMetadataBaseUrl(),
    alternates: {
      canonical: "/",
    },
    openGraph: {
      title,
      description,
      type: "website",
      locale: "ru_RU",
      url: "/",
      siteName,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
    icons: {
      icon: "/icon.svg",
    },
  };
}
