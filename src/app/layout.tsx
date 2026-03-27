import type { Metadata } from "next";
import { Manrope, Montserrat } from "next/font/google";
import { draftMode } from "next/headers";
import "../styles/globals.css";
import { Header, ModalPopup, BackToTop } from "@/components";
import { FormProvider } from "@/contexts/FormContext";
import { getSiteSettings } from "@/lib/sanity";
import { getBaseUrlString, getMetadataBaseUrl } from "@/lib/siteUrl";

const manrope = Manrope({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "600", "700"],
});

const montserrat = Montserrat({
  subsets: ["latin", "cyrillic"],
  weight: ["500", "600", "700"],
  variable: "--font-heading",
});

export const metadata: Metadata = {
  title: "Math Future — онлайн школа математики",
  description: "Онлайн школа математики для школьников и абитуриентов. Персональный подход, современные методики и удобный формат занятий.",
  metadataBase: getMetadataBaseUrl(),
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "Math Future — онлайн школа математики",
    description:
      "Онлайн школа математики для школьников и абитуриентов. Персональный подход, современные методики и удобный формат занятий.",
    type: "website",
    locale: "ru_RU",
    url: "/",
    images: [
      {
        url: "/photo_2026-02-23_17-27-09.jpg",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Math Future — онлайн школа математики",
    description:
      "Онлайн школа математики для школьников и абитуриентов. Персональный подход, современные методики и удобный формат занятий.",
    images: ["/photo_2026-02-23_17-27-09.jpg"],
  },
  icons: {
    icon: "/icon.svg",
  },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isEnabled } = await draftMode();
  const siteSettings = await getSiteSettings({ preview: isEnabled });

  const siteUrl = getBaseUrlString();
  const normalizedSiteUrl = siteUrl.replace(/\/$/, "");

  const title = siteSettings?.title ?? "Math Future";
  const footerDescription =
    siteSettings?.footerDescription ?? "Современная онлайн-школа математики.";
  const instagramUrl =
    siteSettings?.instagramUrl ??
    "https://www.instagram.com/carry_math?igsh=ZWRydWFwOGZjenh5&utm_source=qr";

  return (
    <html lang="ru">
      <body className={`${manrope.className} ${montserrat.variable}`}>
        <FormProvider>
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{
              __html: JSON.stringify({
                "@context": "https://schema.org",
                "@type": "Organization",
                name: title,
                url: normalizedSiteUrl,
                sameAs: instagramUrl ? [instagramUrl] : [],
              }),
            }}
          />
          <Header siteTitle={siteSettings?.title} />
          {children}
          <footer className="site-footer" id="site-footer">
            <div className="footer-content">
              <div className="footer-brand">
                <a href="#hero" className="site-logo">
                  {title}
                </a>
                <p>{footerDescription}</p>
                <div className="social-links">
                  <a href={instagramUrl} aria-label="Instagram">
                    <svg
                      className="instagram-icon"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect>
                      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path>
                      <line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line>
                    </svg>
                  </a>
                </div>
              </div>
            </div>

            <div className="footer-bottom">
              <p>© {new Date().getFullYear()} {title}</p>
            </div>
          </footer>
          <ModalPopup />
          <BackToTop />
        </FormProvider>
      </body>
    </html>
  );
}
