"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

type NavigationItem = {
  label: string;
  href: string;
  stub?: boolean;
  home?: boolean;
};

const SECTION_IDS = ["hero", "teachers", "formats", "signup", "process"] as const;
const MAIN_SECTION_IDS = ["hero", "teacher", "program", "reviews", "faq", "paths"] as const;

const NAV_ITEMS: NavigationItem[] = [
  { label: "Главная", href: "/", home: true },
  { label: "Наставник", href: "#teachers" },
  { label: "Варианты", href: "#formats" },
  { label: "Запись", href: "#signup" },
  { label: "Уроки", href: "#process" },
];

// Навигация главной: якоря секций страницы.
const MAIN_NAV_ITEMS: NavigationItem[] = [
  { label: "Наставник", href: "#teacher" },
  { label: "Программа", href: "#program" },
  { label: "Отзывы", href: "#reviews" },
  { label: "FAQ", href: "#faq" },
  { label: "Другой путь", href: "#paths" },
];

export function Header({
  siteTitle,
  headerButtonText,
}: {
  siteTitle?: string;
  headerButtonText?: string;
}) {
  const pathname = usePathname();
  const isMainPage = pathname === "/";
  const navItems = isMainPage ? MAIN_NAV_ITEMS : NAV_ITEMS;
  const sectionIds = isMainPage ? MAIN_SECTION_IDS : SECTION_IDS;
  // Кнопка шапки ведёт к блоку записи текущей страницы (#signup есть на обеих).
  const ctaHref = "#signup";
  const ctaLabel = "Записаться";

  const [scrolled, setScrolled] = useState(false);
  const [xp, setXp] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(true);
  const [activeSection, setActiveSection] = useState<string>("hero");

  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 10);
      const max = document.documentElement.scrollHeight - window.innerHeight;
      setXp(max > 0 ? Math.min(100, Math.round((window.scrollY / max) * 100)) : 0);
    };

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
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

    // Блокируем только прокрутку (position:fixed не используем —
    // он ломает переход по якорям после закрытия меню).
    if (menuOpen) {
      body.style.overflow = "hidden";
      html.style.overflow = "hidden";
    } else {
      body.style.overflow = "";
      html.style.overflow = "";
    }

    return () => {
      body.style.overflow = "";
      html.style.overflow = "";
    };
  }, [menuOpen]);

  useEffect(() => {
    const onScroll = () => {
      const offset = 90;
      let current: string = sectionIds[0];

      sectionIds.forEach((id) => {
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
  }, [sectionIds]);

  const handleNavClick = (item: NavigationItem, e: React.MouseEvent) => {
    if (item.stub) {
      e.preventDefault();
      return;
    }
    setMenuOpen(false);
  };

  return (
    <header className={`site-header${scrolled ? " scrolled" : ""}`}>
      <div className="header-xp" aria-hidden="true">
        <div className="header-xp-fill" style={{ width: `${xp}%` }} />
        <span className="header-xp-label">XP {xp}%</span>
      </div>
      <a href={isMainPage ? "#hero" : "/"} className="site-logo">
        <span className="logo-icon" aria-hidden="true" />
        {siteTitle ?? "District"}
      </a>
      <nav className="main-navigation" aria-label="Основная навигация">
        <ul>
          {navItems.map((item) => (
            <li key={item.label}>
              <a
                href={item.href}
                className={
                  !item.stub && !item.home && activeSection === item.href.replace("#", "")
                    ? "active"
                    : item.stub
                      ? "nav-stub"
                      : item.home
                        ? "nav-home"
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
        <a href={ctaHref} className="header-cta btn btn-gold">
          {ctaLabel}
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
              href={isMainPage ? "#hero" : "/"}
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
            {navItems.map((item) => (
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
            href={ctaHref}
            className="btn btn-gold mobile-menu-cta"
            onClick={() => setMenuOpen(false)}
          >
            {ctaLabel}
          </a>
        </div>
      </div>
    </header>
  );
}
