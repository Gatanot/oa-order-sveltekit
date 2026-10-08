# CSS 重构交接文档

> 范围：`oa-order-sveltekit` 的全局样式 `src/app.css`（订单工作台）
> 最后更新：2026-10-08
> 当前分支：`refactor/split-app-css`（与 `main` 同一提交 `10b6b15`，无额外提交）
> 入口：`src/routes/+layout.svelte` → `import '../app.css'`；另 `src/routes/+error.svelte` 有组件级 scoped 样式

---

## 1. 背景

`src/app.css` 长期是"两代样式叠加"在同一个文件里：

1. **第一代（legacy）**：约前 1/4 的文件，是早期 demo 的样式，被后面的主题大量覆盖，但仍有部分声明在生效；
2. **Visual system**：`/* Visual system aligned with the approved UI reference. */` 之后的当前主题，按分节注释组织（shell / controls / filters / orders / reimbursements / catalog / modals / admin / responsive …）。

原始文件 **4139 行 / 729 条规则**，存在失效规则、被覆盖声明、缺失样式、未定义变量等问题。本轮已完成安全清理，剩余问题需要人工判断，故交接。

---

## 2. 已完成（`main` 上已提交）

| 提交 | 内容 |
|---|---|
| `5d32b22` `fix: 修正订单录入备注布局并清理失效样式` | ① 员工垫付表头「发票附件」→「发票与付款证明」；② 备注文本域恢复整行宽度（原来只占半栏、与全宽附件框错位）并统一内距；③ **A 类**：删除 116 条失效规则 / 134 个失效选择器 |
| `03f7ede` `refactor: 去重样式表中被新版覆盖的重复声明` | **B 类**：同一选择器 + 同一 `@media/@supports` 上下文中，后定义会覆盖前定义的同名属性；据此删除 59 条规则里的 139 处冗余声明（25 条规则整体变空被移除） |
| `10b6b15` `fix: 补齐缺失样式并消除未定义变量与冗余 !important` | **C 类**：新增 `.muted`、`.catalog-page-status`，给操作按钮共用规则补 `text-decoration:none`；**D 类**：`--radius-sm`→`var(--radius-md)`、`--text`→`var(--ink)`，移除全部 4 处 `!important` |

**体积变化**：`app.css` 4139 → **3360 行**；`!important` 14 → **0**；未定义变量 → **0**。

### A 类删除的失效模块（源码零引用 + 运行时从未命中）

- 旧财务/付款工作台：`finance-*`、`payment-*`、`workflow-section-heading/step`、`empty-workbench`
- 旧归档/凭证抽屉：`voucher-archive`、`archive-*`
- 已合并的"成本编辑行"：`cost-editor-row`、`linked-cost-hint`
- 旧设置/角色切换：`settings-drawer`、`settings-hint`、`role-switch`、`mode-switch`、`side-nav-admin`、`side-caption`
- 旧筛选/导出/提交下拉：`filter-bar`、`compact-filter-bar`、`export-fields`、`submit-group`、`submit-menu`、`project-create`、`entry-copy`、`.open`
- 旧客户统计卡：`customer-stats`、`customer-stat`、`stats-grid`、`stats-title`
- 失效直系选择器：`.order-sidebar>button`（按钮已移入 `.side-nav`）

---

## 3. 未决问题（本次交接的待办）

### 3.1 第一代样式层（legacy layer）仍然混杂在文件前部

- 位置：当前 `src/app.css` 约 **第 26–863 行**（约 838 行），命名可参考 `legacy`。
- 现状：大量声明被后面的 Visual system 同名选择器覆盖，但**仍有部分生效**（如 `.field-hint`、`.order-click-row`、`.visually-hidden`、`.date-input`、部分 `.suggestion-menu`/`.repeat-row` 等）。
- 问题：可读性差，维护时容易改错层；但**不能简单按功能重排**（见 3.2）。
- 建议：单独评估——先逐条判定"是否仍被覆盖"，再决定删除或迁出；不要直接重排。

### 3.2 跨代重复选择器无法安全自动合并（核心遗留）

- 数量：当前 `app.css` 有 **173 个选择器被重复定义**；其中 **跨代重复（旧层与新层各定义一次）约 50 个**（按 `(选择器, 上下文)` 分组为 66 组，其中 25 组是完全独立规则）。
- 为什么不能自动合并：这些重复的旧/新定义声明的是**不同属性**（同类属性已在 B 类中去掉），要合并就得把旧声明从约第 26 行搬到约第 2500 行，**跨越几百条其他规则**。只要中间有任何规则能匹配同一元素并声明同类属性，最终计算值就会改变。
- 实测证据（用第 4 节指纹工具验证）：
  - 把 66 组全部合并 → 声明数反而从 1758 增到 1949（组合选择器拆分导致复制），且出现 **48 处计算样式不一致**（报销汇总栏 `margin-top`、栅格列数变化）；
  - 只合并 25 组独立规则 → 仍出现 **48 处不一致**；
  - 再加"中间无同类属性规则"的安全条件 → **0 组满足**。
- 结论：**建议保留现状**。这些重复不产生实际冲突（属性不同、互不覆盖），浏览器解析结果明确；真正的冗余（被同名覆盖的声明）已在 B 类清除。若一定要消除，只能**人工逐条**处理并逐条回归。

### 3.3 按功能拆分 app.css 的尝试（已实现并验证通过，但按要求先丢弃）

- 曾在本分支把 `app.css` **保序**切分为 18 个文件放到 `src/lib/styles/`，`app.css` 改为 `@import` 列表，import 顺序与原文件一致：
  `base / legacy / attachments / theme / shell / panels-controls / filters / metrics-tables / orders / reimbursements / catalog / modals / attachment-preview / native-controls / responsive / admin / order-list / product-details`
- 切分脚本做了**边界校验**（不截断任何规则）；`npm run build` 通过；**全量指纹回归 0 差异**。
- 该改动已按要求**丢弃**（不是失败，是为了统一在后续任务里处理）。
- 复现方式见附录 A。

### 3.4 其他低优先级

- **运行时未命中但静态仍引用的选择器**：第 3 节 A 类只清理了"源码零引用"的高置信部分；仍有几十条规则在 8 条主路由 × 6 个宽度下从未命中，多数属于**未打开的弹窗/抽屉状态**，需人工或用更完整的交互覆盖后再判定。
- **同一选择器在同代内也有重复**（如 `.order-sidebar`、`.form-grid`、`.repeat-row` 各有 3–4 处定义），与 3.2 同因，暂不动。
- **CSS 变量**：`app.css` 内定义的变量目前都被引用到；`--radius-sm`/`--text` 已修。注意 `src/app.css` 定义的 `:root` 变量是全局的，拆分时不要重复定义。
- `+error.svelte` 的样式是组件 scoped，与全局无关，勿并入。

---

## 4. 验证方法（重要：任何 CSS 改动都必须跑这个）

CSS 层叠对顺序极其敏感，像素截图不够（很多差异在布局尺寸上）。本轮采用**全量计算样式指纹**：

- 覆盖：8 条路由（`/orders`、`/orders/new`、`/orders/:id`、`/orders/:id/edit`、`/reimbursements`、`/reimbursements/review`、`/catalog`、`/admin`、`/employees`）× 6 个宽度（1440/1024/820/700/600/390）；
- 对 DOM 中**每个元素**记录约 87 个 `getComputedStyle` 属性，改前/改后逐元素逐属性比对；
- 要求：**mismatch = 0** 才能接受。

> 注意：Playwright 不是本项目依赖。本轮用的是环境里已有的 `/root/work/XiaoBa-CLI/node_modules/playwright` 与 `/root/.cache/ms-playwright/chromium-1243`。换机器需另装。
> 若后续要长期用，建议把指纹脚本落到仓库并加入 Playwright 作为 devDependency。

运行方式：先 `npm run dev -- --port 5199`，再执行附录 B 脚本分别采集 before/after 并比对。

---

## 5. 建议的后续步骤

1. **先决定拆分方案**：推荐"保序分层拆分"（附录 A），而不是"按功能重排"。重排会破坏层叠，必须靠指纹回归兜底。
2. 拆分落地后，再在对应文件内处理 **3.2 的跨代重复**（此时旧/新声明在同一文件内，人工合并成本更低，但仍需逐条回归）。
3. 逐步消化 **3.1 legacy 层**：先标注 `/* deprecated: 被下方覆盖 */`，确认无引用后删除；不确定的保留。
4. **3.4** 用"打开所有弹窗/抽屉 + 强制 hover/focus 状态"的增强版指纹，找出剩余运行时死规则。

---

## 附录 A：保序拆分脚本思路

用 PostCSS 解析后：

1. 取 `root.nodes` 中每个**顶层子节点**的起止行（注释、`@media` 块都算独立节点）；`@media` 内部不拆，整体归入所在区间；
2. 定义边界行（用现有分节注释行，如 26 / 864 / 1040 / 1096 / 1213 / 1287 / 1380 / 1593 / 1642 / 1728 / 1949 / 2024 / 2093 / 2184 / 2366 / 2470 / 2653 / 3084 / 3342）；
3. **校验**：任何顶层节点不得跨越边界（否则会截断规则）；
4. 按边界把节点 `clone()` 进各 bucket，`bucket.toString()` 写入对应文件（保留原始 raws/空行/注释）；
5. `app.css` 改为按原顺序的 `@import './lib/styles/xxx.css';`（Vite 会在构建时内联，顺序即层叠顺序）。

关键约束：**import 顺序必须与原始文件顺序完全一致**。

## 附录 B：计算样式指纹脚本（参考实现）

```js
// usage: node fingerprint.mjs /tmp/fp-before.json
import { chromium } from '<playwright>/index.mjs'; // 环境已装的 playwright
import fs from 'fs';
const out = process.argv[2];
const BASE = 'http://127.0.0.1:5199';
const orderId = '<一个真实订单 id>';
const routes = ['/orders','/orders/new',`/orders/${orderId}`,`/orders/${orderId}/edit`,
  '/reimbursements','/reimbursements/review','/catalog','/admin','/employees'];
const widths = [1440,1024,820,700,600,390];
const PROPS = ['display','position','top','right','bottom','left','width','height','minWidth','minHeight',
  'maxWidth','maxHeight','marginTop','marginRight','marginBottom','marginLeft','paddingTop','paddingRight',
  'paddingBottom','paddingLeft','borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth',
  'borderTopStyle','borderRightStyle','borderBottomStyle','borderLeftStyle','borderTopColor','borderRightColor',
  'borderBottomColor','borderLeftColor','borderTopLeftRadius','borderTopRightRadius','borderBottomRightRadius',
  'borderBottomLeftRadius','backgroundColor','backgroundImage','backgroundSize','backgroundPosition','color',
  'fontFamily','fontSize','fontWeight','fontStyle','lineHeight','letterSpacing','wordSpacing','textAlign',
  'textDecorationLine','textDecorationColor','textTransform','whiteSpace','textOverflow','overflow','overflowX',
  'overflowY','opacity','boxShadow','flexDirection','flexWrap','flexGrow','flexShrink','flexBasis',
  'justifyContent','alignItems','alignSelf','alignContent','gap','rowGap','columnGap','gridTemplateColumns',
  'gridTemplateRows','gridColumn','gridRow','order','zIndex','visibility','cursor','listStyleType',
  'listStylePosition','outlineWidth','outlineStyle','outlineColor','outlineOffset','verticalAlign','transform',
  'transitionProperty','transitionDuration','borderCollapse','borderSpacing','tableLayout','wordBreak',
  'overflowWrap','pointerEvents','fontVariantNumeric'];
const browser = await chromium.launch({ executablePath:'<chromium>', args:['--no-sandbox'] });
const page = await (await browser.newContext({ viewport:{width:1440,height:1000} })).newPage();
const result = {};
for (const w of widths) {
  await page.setViewportSize({ width:w, height:900 });
  for (const route of routes) {
    await page.goto(BASE+route, { waitUntil:'networkidle', timeout:20000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    result[w+' '+route] = await page.evaluate((props) => {
      const key = e => { const p=[]; let n=e;
        while (n && n!==document.body) { p.unshift([...n.parentNode.children].indexOf(n)); n=n.parentNode; }
        return p.join('.')+'|'+e.tagName+'|'+(typeof e.className==='string'?e.className:''); };
      const o = {};
      for (const e of document.querySelectorAll('body *')) { const s=getComputedStyle(e);
        o[key(e)] = props.map(p=>s[p]).join('\u0001'); }
      return o;
    }, PROPS);
  }
}
fs.writeFileSync(out, JSON.stringify(result));
await browser.close(); process.exit(0);
```

比对脚本：对同一 key 的 `\u0001` 分隔串逐段比较，任何不一致即视为回归（见本轮 `/tmp/fp-compare.mjs`）。
