import type { Metadata } from "next";
import { getHomePage, getSiteSettings } from "@/lib/sanity";
import { getMetadataBaseUrl } from "@/lib/siteUrl";

export async function getSiteMetaContent() {
  const [siteSettings, home] = await Promise.all([
    getSiteSettings(),
    getHomePage(),
  ]);

  const siteName = siteSettings?.title?.trim() || "Math Future";
  const description =
    home?.heroDescription?.trim() ||
    siteSettings?.footerDescription?.trim() ||
    "Онлайн школа математики для школьников и абитуриентов.";

  const title = `${siteName} — онлайн школа математики`;

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
