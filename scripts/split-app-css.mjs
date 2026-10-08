// Split the (pre-split) global stylesheet into feature files while preserving
// the original cascade order. One-off migration helper.
//
//   node scripts/split-app-css.mjs <source.css> [outDir]
//
// The source is expected to be the original monolithic `src/app.css` with the
// section-comment boundaries listed in `sections` below. Nodes never cross a
// boundary (validated); `@import` order in `src/app.css` equals cascade order.
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const postcss = require('postcss');

const src = process.argv[2];
const outDir = process.argv[3] || 'src/lib/styles';
if (!src) {
  console.error('usage: node scripts/split-app-css.mjs <source.css> [outDir]');
  process.exit(1);
}

const css = fs.readFileSync(src, 'utf8');
const root = postcss.parse(css, { from: src });

// [fileName, firstLine, 标题]
const sections = [
  ['base', 1, '基础重置与全局变量'],
  ['legacy', 26, '第一代（legacy）样式层：部分声明仍生效，改动前请先看 docs/css-refactor-handover.md'],
  ['attachments', 864, '附件上传与查看'],
  ['theme', 1040, '视觉主题变量与根排版'],
  ['shell', 1096, '应用外壳与侧边栏'],
  ['panels-controls', 1213, '面板/页头与通用控件'],
  ['filters', 1380, '筛选与表格工具'],
  ['metrics-tables', 1593, '指标卡与表格'],
  ['orders', 1728, '订单详情与表单'],
  ['reimbursements', 1949, '报销'],
  ['catalog', 2024, '资料库（报价库/成本库）'],
  ['modals', 2093, '弹窗与抽屉'],
  ['attachment-preview', 2184, '附件预览'],
  ['native-controls', 2366, '原生控件归一化'],
  ['responsive', 2470, '响应式'],
  ['admin', 2653, '管理端'],
  ['order-list', 3084, '订单列表（桌面表格 + 移动卡片）'],
  ['product-details', 3342, '产品明细栅格'],
];

const boundaries = sections.map(([, l]) => l).slice(1);
let violations = 0;
root.walk((node) => {
  const s = node.source.start.line;
  const e = node.source.end.line;
  for (const b of boundaries) {
    if (s < b && e >= b) {
      console.error(`VIOLATION: ${node.type} ${node.selector || node.name || ''} ${s}-${e} crosses ${b}`);
      violations++;
    }
  }
});
if (violations) process.exit(1);

const buckets = new Map(sections.map(([name]) => [name, []]));
root.each((node) => {
  const line = node.source.start.line;
  let name = sections[0][0];
  for (const [n, l] of sections) if (line >= l) name = n;
  buckets.get(name).push(node);
});

fs.mkdirSync(outDir, { recursive: true });
for (const [name, first, title] of sections) {
  const r = postcss.root();
  for (const n of buckets.get(name)) r.append(n.clone());
  const last = sections.find(([n]) => n === name);
  const idx = sections.indexOf(last);
  const endLine = idx + 1 < sections.length ? sections[idx + 1][1] - 1 : css.replace(/\n$/, '').split('\n').length;
  const header = `/* ${name} — ${title}（原 app.css 第 ${first}–${endLine} 行） */\n`;
  let text = r.toString().replace(/^\n+/, '');
  fs.writeFileSync(path.join(outDir, `${name}.css`), header + text.replace(/\n*$/, '\n'));
  console.log(`${name}.css  nodes=${buckets.get(name).length}`);
}

const imports = sections.map(([name]) => `@import './lib/styles/${name}.css';`).join('\n');
fs.writeFileSync('src/app.css', `/* 全局样式入口：按功能拆分，@import 顺序即层叠顺序，请勿调整。 */\n${imports}\n`);
console.log('src/app.css rewritten as import list');
