const fs = require('fs');
const path = require('path');

const projectRoot = process.argv[2];
if (!projectRoot) {
  throw new Error('Usage: node add_individual_scroll_reveal.js <project-root>');
}

const componentPath = path.join(projectRoot, 'src', 'app', 'HomePageClient.tsx');
const cssPath = path.join(projectRoot, 'src', 'styles', 'sections.css');
let component = fs.readFileSync(componentPath, 'utf8').replace(/\r\n/g, '\n');
let css = fs.readFileSync(cssPath, 'utf8').replace(/\r\n/g, '\n');

const oldEffectPattern = /  useEffect\(\(\) => \{\n    const reduceMotion = window\.matchMedia\?\.\('\(prefers-reduced-motion: reduce\)'\)\?\.matches;[\s\S]*?\n  \}, \[\]\);\n(?=\n  if \(!home\))/;

const newEffect = `  useEffect(() => {\n    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;\n    const targets = Array.from(\n      document.querySelectorAll<HTMLElement>(\n        '[data-reveal], [data-scroll-reveal], .principle-item, .process-step-alt',\n      ),\n    );\n    if (targets.length === 0) return;\n\n    const revealTarget = (target: HTMLElement, animate: boolean) => {\n      const isStagedReveal = target.hasAttribute('data-scroll-reveal');\n      const wasAnimated = target.dataset.scrollRevealPlayed === 'true';\n\n      target.classList.add('revealed');\n      target.classList.add('visible');\n      if (isStagedReveal) target.classList.add('scroll-revealed');\n\n      if (!animate || !isStagedReveal || wasAnimated || typeof target.animate !== 'function') {\n        return;\n      }\n\n      target.dataset.scrollRevealPlayed = 'true';\n      const direction = target.dataset.revealDirection;\n      const origin =\n        direction === 'left'\n          ? 'translate3d(-22px, 0, 0)'\n          : direction === 'right'\n            ? 'translate3d(22px, 0, 0)'\n            : 'translate3d(0, 22px, 0)';\n      const order = Number.parseInt(target.dataset.revealDelay || '0', 10);\n      const delay = Number.isFinite(order) ? Math.max(0, order) * 80 : 0;\n\n      target.animate(\n        [\n          { opacity: 0, transform: origin },\n          { opacity: 1, transform: 'translate3d(0, 0, 0)' },\n        ],\n        {\n          duration: 620,\n          delay,\n          easing: 'cubic-bezier(0.22, 1, 0.36, 1)',\n        },\n      );\n    };\n\n    if (reduceMotion) {\n      targets.forEach((target) => revealTarget(target, false));\n      return;\n    }\n\n    const observer = new IntersectionObserver(\n      (entries, currentObserver) => {\n        entries.forEach((entry) => {\n          if (entry.isIntersecting) {\n            revealTarget(entry.target as HTMLElement, true);\n            currentObserver.unobserve(entry.target);\n          }\n        });\n      },\n      { threshold: 0.12, rootMargin: '0px 0px -6% 0px' },\n    );\n\n    targets.forEach((target) => observer.observe(target));\n    return () => observer.disconnect();\n  }, [format]);`;

if (!oldEffectPattern.test(component)) {
  throw new Error('The existing reveal observer block was not found. No changes were written.');
}
component = component.replace(oldEffectPattern, `${newEffect}\n`);

const jsxReplacements = [
  {
    find: '<article className="teacher-row" key={teacher._id}>',
    replace: '<article\n                  className="teacher-row"\n                  key={teacher._id}\n                  data-scroll-reveal\n                  data-reveal-direction={index % 2 === 0 ? \'left\' : \'right\'}\n                  data-reveal-delay={String(index)}\n                >',
  },
  {
    find: 'className="vs-side vs-side--solo"',
    replace: 'className="vs-side vs-side--solo"\n                data-scroll-reveal\n                data-reveal-direction="left"',
  },
  {
    find: 'className="vs-side vs-side--group"',
    replace: 'className="vs-side vs-side--group"\n                data-scroll-reveal\n                data-reveal-direction="right"\n                data-reveal-delay="1"',
  },
  {
    find: "className={'booking-format-card booking-format-card--' + format}",
    replace: "className={'booking-format-card booking-format-card--' + format}\n                  data-scroll-reveal",
  },
  {
    find: '<section className="booking-trial-guide" aria-label="О пробном занятии">',
    replace: '<section\n                className="booking-trial-guide"\n                aria-label="О пробном занятии"\n                data-scroll-reveal\n              >',
  },
  {
    find: '<article className="booking-benefit">',
    replace: '<article className="booking-benefit" data-scroll-reveal>',
    all: true,
  },
];

for (const replacement of jsxReplacements) {
  if (!component.includes(replacement.find)) {
    throw new Error(`Expected JSX marker not found: ${replacement.find}`);
  }
  if (replacement.all) {
    component = component.split(replacement.find).join(replacement.replace);
  } else {
    component = component.replace(replacement.find, replacement.replace);
  }
}

const revealCssMarker = '/* ===== Individual page: staged scroll reveal and mobile guardrails ===== */';
if (!css.includes(revealCssMarker)) {
  css += `\n\n${revealCssMarker}\n/* Inner elements enter only after their section reaches the viewport. The effect is scoped to markup used by /individual. */\n.main-page.sub-page [data-scroll-reveal]:not(.scroll-revealed) {\n  opacity: 0;\n  transform: translate3d(0, 22px, 0);\n  will-change: opacity, transform;\n}\n.main-page.sub-page [data-scroll-reveal][data-reveal-direction="left"]:not(.scroll-revealed) {\n  transform: translate3d(-22px, 0, 0);\n}\n.main-page.sub-page [data-scroll-reveal][data-reveal-direction="right"]:not(.scroll-revealed) {\n  transform: translate3d(22px, 0, 0);\n}\n\n/* Extra guardrails keep long CMS values contained on narrow screens without changing the format switcher. */\n@media (max-width: 640px) {\n  #signup.ind-signup .booking-offer-copy,\n  #signup.ind-signup .booking-trial-copy,\n  #signup.ind-signup .booking-trial-guide-copy {\n    min-width: 0;\n  }\n  #signup.ind-signup .booking-offer-meta {\n    white-space: normal;\n  }\n}\n\n@media (prefers-reduced-motion: reduce) {\n  .main-page.sub-page [data-scroll-reveal],\n  .main-page.sub-page [data-scroll-reveal]:not(.scroll-revealed) {\n    opacity: 1;\n    transform: none;\n    will-change: auto;\n  }\n}\n`;
}

fs.writeFileSync(componentPath, component);
fs.writeFileSync(cssPath, css);
console.log('Added staged scroll reveal and mobile content guardrails for /individual.');
