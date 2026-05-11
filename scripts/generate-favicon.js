// Usage: node scripts/generate-favicon.js
// Output: app/favicon.ico  (App Router uses it automatically)

const path = require('path');
const fs   = require('fs');
const os   = require('os');

let puppeteer;
try {
  puppeteer = require('puppeteer');
} catch {
  puppeteer = require(path.resolve(__dirname, '../../02_EJS_Components/node_modules/puppeteer'));
}

const { PNG } = require(path.resolve(__dirname, '../../02_EJS_Components/node_modules/pngjs'));

const OUT_PATH = path.resolve(__dirname, '../app/favicon.ico');
const SIZES    = [16, 32, 48];
const ACCENT   = '#3b82f6';

function buildHtml(size) {
  const fontSize = Math.round(size * 0.58);
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: ${size}px;
    height: ${size}px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: ${ACCENT};
    overflow: hidden;
  }
  span {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: ${fontSize}px;
    font-weight: 800;
    color: white;
    line-height: 1;
  }
</style>
</head>
<body><span>K</span></body>
</html>`;
}

// Convert RGB PNG buffer → RGBA PNG buffer (alpha = 255 everywhere)
function toRGBA(pngBuf) {
  const src = PNG.sync.read(pngBuf);
  const dst = new PNG({ width: src.width, height: src.height, colorType: 6 });
  for (let i = 0; i < src.width * src.height; i++) {
    dst.data[i * 4 + 0] = src.data[i * 4 + 0];
    dst.data[i * 4 + 1] = src.data[i * 4 + 1];
    dst.data[i * 4 + 2] = src.data[i * 4 + 2];
    dst.data[i * 4 + 3] = 255;
  }
  return PNG.sync.write(dst);
}

function buildIco(pngBuffers, sizes) {
  const count   = pngBuffers.length;
  const dirSize = 6 + count * 16;
  const offsets = [];
  let offset = dirSize;
  for (const buf of pngBuffers) { offsets.push(offset); offset += buf.length; }

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);

  const entries = pngBuffers.map((buf, i) => {
    const e = Buffer.alloc(16);
    const s = sizes[i];
    e.writeUInt8(s >= 256 ? 0 : s, 0);
    e.writeUInt8(s >= 256 ? 0 : s, 1);
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(buf.length, 8);
    e.writeUInt32LE(offsets[i], 12);
    return e;
  });

  return Buffer.concat([header, ...entries, ...pngBuffers]);
}

(async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'favicon-'));

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  const page = await browser.newPage();
  const pngBuffers = [];

  for (const size of SIZES) {
    const pngPath = path.join(tmpDir, `${size}.png`);
    await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
    await page.setContent(buildHtml(size), { waitUntil: 'domcontentloaded' });
    await page.screenshot({ path: pngPath, type: 'png', clip: { x: 0, y: 0, width: size, height: size } });
    pngBuffers.push(toRGBA(fs.readFileSync(pngPath)));
  }

  await browser.close();
  fs.rmSync(tmpDir, { recursive: true });

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, buildIco(pngBuffers, SIZES));

  console.log(`✓ favicon.ico (${SIZES.join('/')}px) → ${OUT_PATH}`);
})();
