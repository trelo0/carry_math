import type { Metadata } from "next";
import { Manrope, Oswald } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "../styles/globals.css";
import { FormProvider } from "@/contexts/FormContext";
import { AuthProvider } from "@/contexts/AuthContext";
import { buildSiteMetadata } from "@/lib/siteMetadata";
import { getBaseUrlString } from "@/lib/siteUrl";
import { normalizeBrandName } from "@/lib/brand";

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

// Корневой layout несёт только <html>, провайдеры и аналитику.
// Шапка/футер сайта — в группе (site), личный кабинет — в группе (app).
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const siteUrl = getBaseUrlString();
  const normalizedSiteUrl = siteUrl.replace(/\/$/, "");
  const title = normalizeBrandName();

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
              }),
            }}
          />
          {children}
          <Analytics />
        </FormProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
