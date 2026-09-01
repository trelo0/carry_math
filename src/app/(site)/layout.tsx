import { draftMode } from "next/headers";
import { Header, ModalPopup, BackToTop, AuthModal, CinematicFX } from "@/components";
import { getSiteSettings } from "@/lib/studio/sanityData";
import { normalizeBrandName } from "@/lib/brand";

// Публичная часть сайта: шапка и футер рендерятся только здесь.
// Личный кабинет (/cabinet) живёт в своей группе (app) без них.
export default async function SiteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isEnabled } = await draftMode();
  const siteSettings = await getSiteSettings({ preview: isEnabled });

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
    <>
      <Header siteTitle={siteSettings?.title} headerButtonText={headerButtonText} />
      {children}
      <footer className="site-footer" id="site-footer">
        <div className="footer-content">

          <div className="footer-column footer-brand">
            <a href="/" className="site-logo">
              <span className="logo-icon" aria-hidden="true" />
              {title}
            </a>

            <p className="footer-description">
              {footerDescription}
            </p>
          </div>

          <div className="footer-column footer-legal">
            <span className="footer-label">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="8" r="3.5" />
                <path d="M5.5 20c.8-3.3 3-5 6.5-5s5.7 1.7 6.5 5" />
              </svg>
              РЕКВИЗИТЫ
            </span>

            <p className="footer-company">
              ИП Колодинская<br />
              Кристина Денисовна
            </p>

            <p>
              УНП: 693401354
            </p>

            <p>
              Свидетельство №693401354<br />
              от 24.08.2026, выдано<br />
              Столбцовским райисполкомом.
            </p>
          </div>

          <div className="footer-column footer-links">
            <span className="footer-label">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H10l2 2h5.5A2.5 2.5 0 0 1 20 9.5v7A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5z" />
                <path d="M4 10h16" />
              </svg>
              ДОКУМЕНТЫ
            </span>

            <a href="/public-offer" className="footer-document-link">
              Публичный договор<br />
              (оферта)
              <span className="footer-document-arrow" aria-hidden="true">&rarr;</span>
            </a>
          </div>

          <div className="footer-column footer-contacts-column">
            <span className="footer-label">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="4" width="18" height="16" rx="2" />
                <circle cx="8" cy="10" r="2" />
                <path d="M5.5 16c.7-1.7 1.5-2.5 2.5-2.5s1.8.8 2.5 2.5M13 9h5M13 13h5M13 17h3" />
              </svg>
              КОНТАКТЫ
            </span>

            <div className="footer-contacts">
              <a href="tel:+375336358488" className="footer-contact-link">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.909.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
                </svg>
                +375 33 635-84-88
              </a>

              <a href="mailto:district.school.210@gmail.com" className="footer-contact-link">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="2" y="4" width="20" height="16" rx="2" />
                  <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                </svg>
                district.school.210@gmail.com
              </a>
            </div>

            <div className="social-links">
              <a
                href={instagramUrl}
                aria-label="Instagram"
                target="_blank"
                rel="noopener noreferrer"
              >
                <svg
                  className="instagram-icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="2" y="2" width="20" height="20" rx="5" />
                  <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
                  <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
                </svg>
              </a>
            </div>
          </div>

        </div>

        <div className="footer-bottom">
          <p>
            © {new Date().getFullYear()} {title}
          </p>

          <div className="footer-payments">
            <span className="footer-payment-label">ОПЛАТА</span>
            <img
              src="/bepaid1.png"
              alt="Visa, Mastercard, Белкарт, bePaid и Google Pay"
              className="footer-payment-image"
            />
          </div>

          <p>
            Режим работы: ежедневно 10:00–22:00
          </p>
        </div>
      </footer>
      <ModalPopup modalTitle={modalTitle} modalSubmitButtonText={modalSubmitButtonText} />
      <AuthModal />
      <BackToTop />
      <CinematicFX />
    </>
  );
}
