"use client";

import { useEffect, useState } from "react";

type NavigationItem = {
  label: string;
  href: string;
};

const SECTION_IDS = ["hero", "process", "teachers", "courses",  "problems-method", "signup"] as const;

const FALLBACK_NAV: NavigationItem[] = [
  { label: "Кому подойдёт", href: "#problems-method" },
  { label: "Преподаватели", href: "#teachers" },
  { label: "Программы", href: "#courses" },
  { label: "Как проходят занятия", href: "#process" },
];

export function Header({
  siteTitle,
}: {
  siteTitle?: string;
}) {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(true);
  const [activeSection, setActiveSection] = useState<(typeof SECTION_IDS)[number]>(
    "hero",
  );

  const navItems = FALLBACK_NAV;

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
      const offset = 90; // примерно высота хедера
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

  return (
    <header className={`site-header${scrolled ? " scrolled" : ""}`}>
      <a href="#hero" className="site-logo">
        {siteTitle ?? "Math Future"}
      </a>
      <nav className="main-navigation" aria-label="Основная навигация">
        <ul>
          {navItems.map((item) => (
            <li key={item.href}>
              <a
                href={item.href}
                className={activeSection === (item.href.replace('#', '') as any) ? "active" : undefined}
              >
                {item.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <button
        type="button"
        className="mobile-menu-button"
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
          Записаться
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
              {siteTitle ?? "Math Future"}
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
            {navItems.map((item) => (
              <a
                key={item.href}
                href={item.href}
                onClick={() => setMenuOpen(false)}
              >
                {item.label}
              </a>
            ))}
           
          </nav>
          <a
            href="#signup"
            className="btn btn-primary mobile-menu-cta"
            onClick={() => setMenuOpen(false)}
          >
            Записаться
          </a>
        </div>
      </div>
    </header>
  );
}
