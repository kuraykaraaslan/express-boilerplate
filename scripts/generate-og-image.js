// Usage: node scripts/generate-og-image.js
// Requires puppeteer — uses the one from 02_EJS_Components if not installed locally.
//   npm install puppeteer   (optional, only if running standalone)

const path = require('path');
const fs   = require('fs');
const puppeteer = require('puppeteer');

const OUT_PATH = path.resolve(__dirname, '../public/og-image.png');

const NAME     = 'KUIreact';
const SUBTITLE = 'Composable UI System';
const ACCENT   = '#3b82f6';

function buildHtml() {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 1200px;
    height: 630px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, #111827 0%, #1f2937 100%);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    color: white;
    overflow: hidden;
  }
  .card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 20px;
  }
  .badge {
    display: inline-block;
    padding: 6px 18px;
    border-radius: 999px;
    border: 2px solid ${ACCENT};
    color: ${ACCENT};
    font-size: 18px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .title {
    font-size: 96px;
    font-weight: 800;
    letter-spacing: -2px;
    line-height: 1;
    background: linear-gradient(135deg, #ffffff 0%, ${ACCENT} 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }
  .subtitle {
    font-size: 28px;
    color: rgba(255,255,255,0.55);
    font-weight: 400;
  }
  .dots {
    display: flex;
    gap: 8px;
    margin-top: 8px;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: ${ACCENT};
    opacity: 0.6;
  }
</style>
</head>
<body>
  <div class="card">
    <span class="badge">UI Components</span>
    <div class="title">${NAME}</div>
    <div class="subtitle">${SUBTITLE}</div>
    <div class="dots">
      <div class="dot"></div>
      <div class="dot" style="opacity:0.4"></div>
      <div class="dot" style="opacity:0.2"></div>
    </div>
  </div>
</body>
</html>`;
}

(async () => {
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
  await page.setContent(buildHtml(), { waitUntil: 'domcontentloaded' });
  await page.screenshot({ path: OUT_PATH, type: 'png' });
  await browser.close();

  console.log(`✓ ${NAME} → ${OUT_PATH}`);
})();
