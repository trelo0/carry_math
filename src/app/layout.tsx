import type { Metadata } from "next";
import { Manrope, Oswald } from "next/font/google";
import { draftMode } from "next/headers";
import { Analytics } from "@vercel/analytics/next";
import "../styles/globals.css";
import { Header, ModalPopup, BackToTop, AuthModal, CinematicFX } from "@/components";
import { FormProvider } from "@/contexts/FormContext";
import { AuthProvider } from "@/contexts/AuthContext";
import { getSiteSettings } from "@/lib/studio/sanityData";
import { normalizeBrandName } from "@/lib/brand";
import { buildSiteMetadata } from "@/lib/siteMetadata";
import { getBaseUrlString } from "@/lib/siteUrl";

const manrope = Manrope({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "600", "700"],
});

const oswald = Oswald({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-heading",
});

export async function generateMetadata(): Promise<Metadata> {
  return buildSiteMetadata();
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isEnabled } = await draftMode();
  const siteSettings = await getSiteSettings({ preview: isEnabled });

  const siteUrl = getBaseUrlString();
  const normalizedSiteUrl = siteUrl.replace(/\/$/, "");

  const title = normalizeBrandName(siteSettings?.title);
  const footerDescription =
    siteSettings?.footerDescription ?? "Онлайн-школа для тех, кто готов побеждать.";
  const instagramUrl =
    siteSettings?.instagramUrl ??
    "https://www.instagram.com/district";
  const headerButtonText = siteSettings?.headerButtonText;
  const modalTitle = siteSettings?.modalTitle;
  const modalSubmitButtonText = siteSettings?.modalSubmitButtonText;

  return (
    <html lang="ru">
      <body className={`${manrope.className} ${oswald.variable}`}>
        <AuthProvider>
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
          <Header siteTitle={siteSettings?.title} headerButtonText={headerButtonText} />
          {children}
          <footer className="site-footer" id="site-footer">
            <div className="footer-content">
              <div className="footer-brand">
                <a href="#hero" className="site-logo">
                  <span className="logo-icon" aria-hidden="true" />
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
          <ModalPopup modalTitle={modalTitle} modalSubmitButtonText={modalSubmitButtonText} />
          <AuthModal />
          <BackToTop />
          <CinematicFX />
          <Analytics />
        </FormProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
