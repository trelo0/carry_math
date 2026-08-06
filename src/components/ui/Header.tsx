"use client";

import { useEffect, useState } from "react";

type NavigationItem = {
  label: string;
  href: string;
  stub?: boolean;
};

const SECTION_IDS = ["hero", "teachers", "principles", "process"] as const;

const NAV_ITEMS: NavigationItem[] = [
  { label: "Наставники", href: "#teachers" },
  { label: "Принципы", href: "#principles" },
  { label: "Как проходят занятия", href: "#process" },
  { label: "Вакансии", href: "#", stub: true },
];

export function Header({
  siteTitle,
  headerButtonText,
}: {
  siteTitle?: string;
  headerButtonText?: string;
}) {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(true);
  const [activeSection, setActiveSection] = useState<(typeof SECTION_IDS)[number]>("hero");

  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 10);
    };

    onScroll();
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1025px)");
    const apply = () => setIsDesktop(media.matches);

    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [menuOpen]);

  useEffect(() => {
    const body = document.body;
    const html = document.documentElement;
    const prevOverflow = body.style.overflow;
    const prevHtmlOverflow = html.style.overflow;
    const scrollY = window.scrollY;

    if (menuOpen) {
      body.style.overflow = "hidden";
      html.style.overflow = "hidden";
      body.style.position = "fixed";
      body.style.top = `-${scrollY}px`;
      body.style.width = "100%";
    } else {
      body.style.overflow = prevOverflow;
      html.style.overflow = prevHtmlOverflow;
      body.style.position = "";
      body.style.top = "";
      body.style.width = "";
      window.scrollTo(0, scrollY);
    }

    return () => {
      body.style.overflow = prevOverflow;
      html.style.overflow = prevHtmlOverflow;
      body.style.position = "";
      body.style.top = "";
      body.style.width = "";
    };
  }, [menuOpen]);

  useEffect(() => {
    const onScroll = () => {
      const offset = 90;
      let current: (typeof SECTION_IDS)[number] = "hero";

      SECTION_IDS.forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        const rect = el.getBoundingClientRect();
        if (rect.top - offset <= 0) {
          current = id;
        }
      });

      setActiveSection(current);
    };

    onScroll();
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const handleNavClick = (item: NavigationItem, e: React.MouseEvent) => {
    if (item.stub) {
      e.preventDefault();
      return;
    }
    setMenuOpen(false);
  };

  return (
    <header className={`site-header${scrolled ? " scrolled" : ""}`}>
      <a href="#hero" className="site-logo">
        <span className="logo-icon" aria-hidden="true" />
        {siteTitle ?? "District"}
      </a>
      <nav className="main-navigation" aria-label="Основная навигация">
        <ul>
          {NAV_ITEMS.map((item) => (
            <li key={item.label}>
              <a
                href={item.href}
                className={
                  !item.stub && activeSection === item.href.replace("#", "")
                    ? "active"
                    : item.stub
                      ? "nav-stub"
                      : undefined
                }
                onClick={(e) => handleNavClick(item, e)}
                aria-disabled={item.stub ? true : undefined}
              >
                {item.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <button
        type="button"
        className={`mobile-menu-button${menuOpen ? " open" : ""}`}
        aria-label={menuOpen ? "Закрыть меню" : "Открыть меню"}
        aria-expanded={menuOpen}
        aria-controls="mobile-menu"
        onClick={() => setMenuOpen((v) => !v)}
      >
        <span className="mobile-menu-icon" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      </button>

      {isDesktop ? (
        <a href="#teachers" className={`header-cta btn btn-primary${scrolled ? " visible" : ""}`}>
          {headerButtonText || "Записаться"}
        </a>
      ) : null}

      <div
        className={`mobile-menu-overlay${menuOpen ? " open" : ""}`}
        onClick={() => setMenuOpen(false)}
      >
        <div
          id="mobile-menu"
          className="mobile-menu-panel"
          role="dialog"
          aria-modal="true"
          aria-label="Меню"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mobile-menu-top">
            <a
              href="#hero"
              className="mobile-menu-logo"
              onClick={() => setMenuOpen(false)}
            >
              <span className="logo-icon" aria-hidden="true" />
              {siteTitle ?? "District"}
            </a>
            <button
              type="button"
              className="mobile-menu-close"
              aria-label="Закрыть меню"
              onClick={() => setMenuOpen(false)}
            >
              ×
            </button>
          </div>
          <nav className="mobile-navigation" aria-label="Мобильная навигация">
            {NAV_ITEMS.map((item) => (
              <a
                key={item.label}
                href={item.href}
                className={item.stub ? "nav-stub" : undefined}
                onClick={(e) => handleNavClick(item, e)}
                aria-disabled={item.stub ? true : undefined}
              >
                {item.label}
              </a>
            ))}
          </nav>
          <a
            href="#teachers"
            className="btn btn-primary mobile-menu-cta"
            onClick={() => setMenuOpen(false)}
          >
            {headerButtonText || "Записаться"}
          </a>
        </div>
      </div>
    </header>
  );
}
