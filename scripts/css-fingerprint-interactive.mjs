// 增强版计算样式指纹：在普通指纹基础上，自动打开弹窗/抽屉/建议菜单等交互态，
// 对每个状态单独采集全量 getComputedStyle，用于回归那些只在交互态生效的样式。
//
//   PLAYWRIGHT_PATH=... CHROMIUM_PATH=... BASE_URL=... ORDER_ID=... \
//   node scripts/css-fingerprint-interactive.mjs /tmp/fp-int-before.json
//
// 与 scripts/css-fingerprint-compare.mjs 配合使用（mismatch=0 才接受）。
// 输出中 `__reached` 记录每个交互态是否真正出现（marker 命中），未命中的状态
// 不计入“该状态可用”的判定。
import fs from 'fs';

const out = process.argv[2];
if (!out) { console.error('usage: node scripts/css-fingerprint-interactive.mjs <out.json>'); process.exit(1); }

const pwPath = process.env.PLAYWRIGHT_PATH || '/root/work/XiaoBa-CLI/node_modules/playwright/index.mjs';
const chromePath = process.env.CHROMIUM_PATH || '/root/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';
const BASE = process.env.BASE_URL || 'http://127.0.0.1:5199';
const orderId = process.env.ORDER_ID || '8ff118ea-8fa9-4282-9545-c0d0898245a8';
const { chromium } = await import(pwPath);

const widths = [1440, 1024, 700, 390];
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

// 每个状态：route + 操作序列 + 用于判断是否真正进入该状态的 marker 选择器。
const STATES = [
  { name: 'orders-filter-drawer', route: '/orders', marker: '.filter-drawer', steps: [{ clickText: '更多筛选' }] },
  { name: 'orders-export-drawer', route: '/orders', marker: '.export-drawer:not(.filter-drawer)', steps: [{ clickText: '导出结算单' }] },
  { name: 'orders-column-menu', route: '/orders', marker: '.column-menu', steps: [{ clickSel: 'details.column-settings > summary' }] },
  { name: 'orders-confirm-modal', route: '/orders', marker: '.confirm-modal', steps: [{ clickSel: 'button[aria-label^="删除订单"]:visible' }] },
  { name: 'orders-detail-attachment', route: `/orders/${orderId}`, marker: '.attachment-preview-backdrop', steps: [{ clickSel: '.attachment-link' }] },
  { name: 'new-project-modal', route: '/orders/new', marker: '.project-modal', steps: [{ clickText: '新建项目' }] },
  { name: 'new-suggestion-menu', route: '/orders/new', marker: '.suggestion-menu', steps: [{ type: 'input[placeholder="输入产品名称以匹配报价库"]', value: '喷绘' }] },
  { name: 'reimbursement-modal', route: '/reimbursements', marker: '.reimbursement-modal', steps: [{ clickText: '报销录入' }] },
  { name: 'reimbursement-detail', route: '/reimbursements', marker: '.reimbursement-detail', steps: [{ clickAnyText: ['查看进度', '查看单据'] }] },
  { name: 'review-detail', route: '/reimbursements/review', marker: '.reimbursement-detail', steps: [{ clickAnyText: ['查看进度', '查看单据'] }] },
  { name: 'review-attachments', route: '/reimbursements/review', marker: '.attachment-row', steps: [{ clickSel: '.attachment-toggle' }] },
  { name: 'catalog-source-modal', route: '/catalog', marker: '.project-modal', steps: [{ clickText: '新增公司' }] },
  { name: 'catalog-detail-drawer', route: '/catalog', marker: '.catalog-detail-viewer', steps: [{ clickText: '查看明细' }] },
  {
    name: 'catalog-import-preview', route: '/catalog', marker: '.import-preview-summary',
    steps: [{ upload: '.upload-action input[type="file"]', filename: 'fingerprint.csv', mimeType: 'text/csv', body: '名称,单位,单价\n指纹测试产品,个,10\n' }],
    settle: 1500,
  },
];

async function runStep(page, step) {
  if (step.clickText) await page.getByRole('button', { name: step.clickText, exact: false }).first().click({ timeout: 4000 });
  else if (step.clickAnyText) {
    for (const text of step.clickAnyText) {
      const loc = page.locator('button', { hasText: text }).first();
      if (await loc.count()) { await loc.click({ timeout: 4000 }); return; }
    }
    throw new Error('no clickable text found: ' + step.clickAnyText.join(','));
  }
  else if (step.clickSel) {
    let loc = page.locator(step.clickSel);
    if (step.notText) loc = page.locator(step.clickSel, { hasNotText: step.notText });
    await loc.first().click({ timeout: 4000 });
  }
  else if (step.type) await page.locator(step.type).first().pressSequentially(step.value, { delay: 40, timeout: 6000 });
  else if (step.fill) await page.locator(step.fill).first().fill(step.value, { timeout: 4000 });
  else if (step.upload) await page.locator(step.upload).first().setInputFiles({ name: step.filename, mimeType: step.mimeType, buffer: Buffer.from(step.body) }, { timeout: 4000 });
}

const browser = await chromium.launch({ executablePath: chromePath, args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const result = { __reached: {} };

for (const w of widths) {
  await page.setViewportSize({ width: w, height: 900 });
  for (const state of STATES) {
    const key = `${w} ${state.name}`;
    try {
      await page.goto(BASE + state.route, { waitUntil: 'networkidle', timeout: 20000 });
      for (const step of state.steps) await runStep(page, step);
      await page.waitForTimeout(state.settle || 700);
      await page.mouse.move(1, 1);
      await page.waitForTimeout(300);
      const reached = await page.locator(state.marker).first().count().then(c => c > 0).catch(() => false);
      const prev = result.__reached[state.name];
      result.__reached[state.name] = prev === false ? false : reached;
      if (!reached) { result[key] = {}; continue; }
      result[key] = await page.evaluate((props) => {
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
    } catch (error) {
      result[key] = {};
      result.__reached[state.name] = false;
    }
  }
}

fs.writeFileSync(out, JSON.stringify(result));
console.log('reached states:', JSON.stringify(result.__reached));
await browser.close();
process.exit(0);
