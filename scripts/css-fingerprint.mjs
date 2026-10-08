// 全量计算样式指纹采集脚本（见 docs/css-refactor-handover.md 第 4 节）。
//
// 依赖环境里已安装的 Playwright（本项目未把它列为依赖）。可执行：
//   PLAYWRIGHT_PATH=/path/to/playwright/index.mjs \
//   CHROMIUM_PATH=/path/to/chrome \
//   BASE_URL=http://127.0.0.1:5199 \
//   ORDER_ID=<真实订单 id> \
//   node scripts/css-fingerprint.mjs /tmp/fp-before.json
//
// 采集方式：8 条路由 × 6 个宽度，对 DOM 中每个元素记录 ~87 个
// getComputedStyle 属性，写入 JSON。配合 css-fingerprint-compare.mjs 比对。
import fs from 'fs';

const out = process.argv[2];
if (!out) {
  console.error('usage: node scripts/css-fingerprint.mjs <out.json>');
  process.exit(1);
}

const pwPath = process.env.PLAYWRIGHT_PATH || '/root/work/XiaoBa-CLI/node_modules/playwright/index.mjs';
const chromePath = process.env.CHROMIUM_PATH || '/root/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';
const BASE = process.env.BASE_URL || 'http://127.0.0.1:5199';
const orderId = process.env.ORDER_ID || '8ff118ea-8fa9-4282-9545-c0d0898245a8';

const { chromium } = await import(pwPath);

const routes = ['/orders', '/orders/new', `/orders/${orderId}`, `/orders/${orderId}/edit`,
  '/reimbursements', '/reimbursements/review', '/catalog', '/admin', '/employees'];
const widths = [1440, 1024, 820, 700, 600, 390];
const PROPS = ['display', 'position', 'top', 'right', 'bottom', 'left', 'width', 'height', 'minWidth', 'minHeight',
  'maxWidth', 'maxHeight', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'paddingTop', 'paddingRight',
  'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'borderTopStyle', 'borderRightStyle', 'borderBottomStyle', 'borderLeftStyle', 'borderTopColor', 'borderRightColor',
  'borderBottomColor', 'borderLeftColor', 'borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius',
  'borderBottomLeftRadius', 'backgroundColor', 'backgroundImage', 'backgroundSize', 'backgroundPosition', 'color',
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'wordSpacing', 'textAlign',
  'textDecorationLine', 'textDecorationColor', 'textTransform', 'whiteSpace', 'textOverflow', 'overflow', 'overflowX',
  'overflowY', 'opacity', 'boxShadow', 'flexDirection', 'flexWrap', 'flexGrow', 'flexShrink', 'flexBasis',
  'justifyContent', 'alignItems', 'alignSelf', 'alignContent', 'gap', 'rowGap', 'columnGap', 'gridTemplateColumns',
  'gridTemplateRows', 'gridColumn', 'gridRow', 'order', 'zIndex', 'visibility', 'cursor', 'listStyleType',
  'listStylePosition', 'outlineWidth', 'outlineStyle', 'outlineColor', 'outlineOffset', 'verticalAlign', 'transform',
  'transitionProperty', 'transitionDuration', 'borderCollapse', 'borderSpacing', 'tableLayout', 'wordBreak',
  'overflowWrap', 'pointerEvents', 'fontVariantNumeric'];

const browser = await chromium.launch({ executablePath: chromePath, args: ['--no-sandbox'] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
const result = {};
for (const w of widths) {
  await page.setViewportSize({ width: w, height: 900 });
  for (const route of routes) {
    await page.goto(BASE + route, { waitUntil: 'networkidle', timeout: 20000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    result[w + ' ' + route] = await page.evaluate((props) => {
      const key = (e) => {
        const p = []; let n = e;
        while (n && n !== document.body) { p.unshift([...n.parentNode.children].indexOf(n)); n = n.parentNode; }
        return p.join('.') + '|' + e.tagName + '|' + (typeof e.className === 'string' ? e.className : '');
      };
      const o = {};
      for (const e of document.querySelectorAll('body *')) {
        const s = getComputedStyle(e);
        o[key(e)] = props.map(p => s[p]).join('\u0001');
      }
      return o;
    }, PROPS);
  }
}
fs.writeFileSync(out, JSON.stringify(result));
await browser.close();
process.exit(0);
