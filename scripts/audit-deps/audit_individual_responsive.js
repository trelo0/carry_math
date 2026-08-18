const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const outputDir = 'D:\\online-math\\artifacts\\adaptive-audit';
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const url = 'http://localhost:3111/individual';
const viewports = [
  { name: 'mobile-375', width: 375, height: 812 },
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'tablet-1024', width: 1024, height: 900 },
];

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function revealAll(page) {
  await page.evaluate(async () => {
    const max = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
    const step = Math.max(360, Math.floor(window.innerHeight * 0.72));
    for (let y = 0; y <= max; y += step) {
      window.scrollTo({ top: y, behavior: 'instant' });
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }
    window.scrollTo({ top: 0, behavior: 'instant' });
  });
  await delay(500);
}

async function collectAudit(page) {
  return page.evaluate(() => {
    const selectors = [
      '.ind-hero',
      '.main-teacher',
      '.ind-principles',
      '.ind-formats-vs',
      '.vs-split',
      '.vs-side',
      '.data-strip',
      '.section-process',
      '.ind-signup',
      '.booking-layout-toggle',
      '.booking-format-card',
      '.booking-solo-layout',
      '.booking-group-layout',
      '.booking-trial-panel',
      '.booking-permanent-info',
      '.booking-trial-guide',
      '.booking-benefits',
      '.booking-benefit',
    ];
    const elementMetrics = {};
    for (const selector of selectors) {
      elementMetrics[selector] = Array.from(document.querySelectorAll(selector)).map((el) => {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return {
          x: Math.round(rect.x),
          y: Math.round(rect.y + window.scrollY),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          display: style.display,
          gridTemplateColumns: style.gridTemplateColumns,
          overflowX: style.overflowX,
          visible: style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0,
        };
      });
    }

    const overflow = Array.from(document.querySelectorAll('body *'))
      .map((el) => {
        const rect = el.getBoundingClientRect();
        return {
          tag: el.tagName.toLowerCase(),
          id: el.id || null,
          classes: typeof el.className === 'string' ? el.className.slice(0, 180) : '',
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
          top: Math.round(rect.top + window.scrollY),
        };
      })
      .filter((item) => item.width > window.innerWidth + 2 || item.left < -2 || item.right > window.innerWidth + 2)
      .filter((item) => !/star|bg-shape|constellation|deco-sym|atmosphere/i.test(item.classes))
      .slice(0, 60);

    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      document: {
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        bodyScrollWidth: document.body.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
      },
      elementMetrics,
      overflow,
    };
  });
}

(async () => {
  fs.mkdirSync(outputDir, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    defaultViewport: null,
    args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1'],
  });
  const results = [];

  for (const viewport of viewports) {
    const page = await browser.newPage();
    await page.setViewport({ width: viewport.width, height: viewport.height, deviceScaleFactor: 1 });
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 45000 });
    await revealAll(page);

    const soloAudit = await collectAudit(page);
    await page.screenshot({ path: path.join(outputDir, `${viewport.name}-solo.png`), fullPage: true });

    const groupToggle = await page.$('.format-tabs .format-tab:nth-of-type(2)');
    if (groupToggle) {
      await groupToggle.click();
      await delay(600);
    }
    const groupAudit = await collectAudit(page);
    await page.screenshot({ path: path.join(outputDir, `${viewport.name}-group.png`), fullPage: true });

    results.push({ viewport, solo: soloAudit, group: groupAudit });
    await page.close();
  }

  await browser.close();
  fs.writeFileSync(path.join(outputDir, 'responsive-audit.json'), JSON.stringify(results, null, 2));
  console.log(`Responsive audit complete: ${path.join(outputDir, 'responsive-audit.json')}`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
