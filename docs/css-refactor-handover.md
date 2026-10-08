# CSS 重构交接文档

> 范围：`oa-order-sveltekit` 的全局样式 `src/app.css`（订单工作台）
> 最后更新：2026-10-08（按功能拆分已落地）
> 当前分支：`refactor/split-app-css`
> 入口：`src/routes/+layout.svelte` → `import '../app.css'`；`src/app.css` 现为 `@import` 清单，实际样式在 `src/lib/styles/`；另 `src/routes/+error.svelte` 有组件级 scoped 样式

---

## 1. 背景

`src/app.css` 长期是"两代样式叠加"在同一个文件里：

1. **第一代（legacy）**：约前 1/4 的文件，是早期 demo 的样式，被后面的主题大量覆盖，但仍有部分声明在生效；
2. **Visual system**：`/* Visual system aligned with the approved UI reference. */` 之后的当前主题，按分节注释组织（shell / controls / filters / orders / reimbursements / catalog / modals / admin / responsive …）。

原始文件 **4139 行 / 729 条规则**，存在失效规则、被覆盖声明、缺失样式、未定义变量等问题。本轮已完成安全清理，剩余问题需要人工判断，故交接。

---

## 2. 已完成

| 提交 | 内容 |
|---|---|
| `5d32b22` `fix: 修正订单录入备注布局并清理失效样式` | ① 员工垫付表头「发票附件」→「发票与付款证明」；② 备注文本域恢复整行宽度（原来只占半栏、与全宽附件框错位）并统一内距；③ **A 类**：删除 116 条失效规则 / 134 个失效选择器 |
| `03f7ede` `refactor: 去重样式表中被新版覆盖的重复声明` | **B 类**：同一选择器 + 同一 `@media/@supports` 上下文中，后定义会覆盖前定义的同名属性；据此删除 59 条规则里的 139 处冗余声明（25 条规则整体变空被移除） |
| `10b6b15` `fix: 补齐缺失样式并消除未定义变量与冗余 !important` | **C 类**：新增 `.muted`、`.catalog-page-status`，给操作按钮共用规则补 `text-decoration:none`；**D 类**：`--radius-sm`→`var(--radius-md)`、`--text`→`var(--ink)`，移除全部 4 处 `!important` |
| 本分支 | `refactor: 按功能保序拆分 app.css`：将单文件保序切分为 `src/lib/styles/` 下 18 个功能文件（见 3.3 / 附录 A），`app.css` 改为按原顺序的 `@import` 清单，逐文件加功能标题注释；把指纹采集/比对脚本落到 `scripts/` |

**体积变化**：`app.css` 4139 → **3360 行**；`!important` 14 → **0**；未定义变量 → **0**。拆分后总行数不变（仅把 `app.css` 换成 import 清单，并在每个文件顶部加一行功能注释）。开发 `npm run dev` 与生产 `npm run build` 均通过；全量计算样式指纹 **mismatch = 0**。

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

- 位置：拆分后位于 `src/lib/styles/legacy.css`（原 `app.css` 第 26–863 行，约 838 行）。
- 现状：大量声明被后面的 Visual system 同名选择器覆盖，但**仍有部分生效**（如 `.field-hint`、`.order-click-row`、`.visually-hidden`、`.date-input`、部分 `.suggestion-menu`/`.repeat-row` 等）。实测：整体移除 legacy 层会产生 **5870 处计算样式差异**，因此必须以“逐条删除 + 回归”的方式处理，不能整层删除。
- 问题：可读性差，维护时容易改错层；但**不能简单按功能重排**（见 3.2）。
- 建议：单独评估——先逐条判定“是否仍被覆盖”，再决定删除或迁出；不要直接重排。

### 3.2 跨代重复选择器无法安全自动合并（核心遗留）

- 数量（拆分前）：`app.css` 有 **173 个选择器被重复定义**；其中 **跨代重复（旧层与新层各定义一次）约 50 个**（按 `(选择器, 上下文)` 分组为 66 组，其中 25 组是完全独立规则）。
- 为什么不能自动合并：这些重复的旧/新定义声明的是**不同属性**（同类属性已在 B 类中去掉），要合并就得把旧声明从约第 26 行搬到约第 2500 行，**跨越几百条其他规则**。只要中间有任何规则能匹配同一元素并声明同类属性，最终计算值就会改变。
- 实测证据（用第 4 节指纹工具验证）：
  - 把 66 组全部合并 → 声明数反而从 1758 增到 1949（组合选择器拆分导致复制），且出现 **48 处计算样式不一致**（报销汇总栏 `margin-top`、栅格列数变化）；
  - 只合并 25 组独立规则 → 仍出现 **48 处不一致**；
  - 再加"中间无同类属性规则"的安全条件 → **0 组满足**。
- 结论：**建议保留现状**。这些重复不产生实际冲突（属性不同、互不覆盖），浏览器解析结果明确；真正的冗余（被同名覆盖的声明）已在 B 类清除。若一定要消除，只能**人工逐条**处理并逐条回归。
- 拆分后复查（按 `(上下文, 完整选择器文本)` 分组）：规则总数 590；重复组 45，其中 **39 组为 legacy vs 后续文件的跳代重复**，1 组为同文件内重复。逐组比对后，**没有任何一组属于“所有属性均被后续同名同上下文规则覆盖”**（完全冗余 = 0），证明 3.2 的结论在拆分后依旧成立。

### 3.3 按功能拆分 app.css（已完成）

- 本分支已将 `app.css` **保序**切分为 18 个文件，放到 `src/lib/styles/`；`app.css` 改为按原顺序的 `@import` 清单，import 顺序即层叠顺序。

| 文件 | 功能 | 原 app.css 行 |
|---|---|---|
| `base.css` | 基础重置与全局变量 | 1–25 |
| `legacy.css` | 第一代（legacy）样式层 | 26–863 |
| `attachments.css` | 附件上传与查看 | 864–1039 |
| `theme.css` | 视觉主题变量与根排版 | 1040–1095 |
| `shell.css` | 应用外壳与侧边栏 | 1096–1212 |
| `panels-controls.css` | 面板/页头与通用控件 | 1213–1379 |
| `filters.css` | 筛选与表格工具 | 1380–1592 |
| `metrics-tables.css` | 指标卡与表格 | 1593–1727 |
| `orders.css` | 订单详情与表单 | 1728–1948 |
| `reimbursements.css` | 报销 | 1949–2023 |
| `catalog.css` | 资料库（报价库/成本库） | 2024–2092 |
| `modals.css` | 弹窗与抽屉 | 2093–2183 |
| `attachment-preview.css` | 附件预览 | 2184–2365 |
| `native-controls.css` | 原生控件归一化 | 2366–2469 |
| `responsive.css` | 响应式 | 2470–2652 |
| `admin.css` | 管理端 | 2653–3083 |
| `order-list.css` | 订单列表（桌面表格 + 移动卡片） | 3084–3341 |
| `product-details.css` | 产品明细栅格 | 3342–3360 |

- 切分脚本 `scripts/split-app-css.mjs` 做了**边界校验**（不截断任何规则），并在每个文件顶部写入功能标题注释；去注释、去空行后与原文逐字节一致。
- 验证：`npm run build` 通过；**全量指纹回归 mismatch = 0**。
- **约束：`app.css` 的 `@import` 顺序不能调整**，这与源文件顺序等价。
- 注意：`:root` 变量是全局的，拆分后分布在 `base.css` 与 `theme.css`，不要在其它文件重复定义（目前两处变量名无重叠）。
- 复现方式见附录 A；指纹工具见第 4 节。

### 3.4 其他低优先级

- **运行时未命中但静态仍引用的选择器**：第 3 节 A 类只清理了"源码零引用"的高置信部分；仍有几十条规则在 8 条主路由 × 6 个宽度下从未命中，多数属于**未打开的弹窗/抽屉状态**，需人工或用更完整的交互覆盖后再判定。
- **同一选择器在同代内也有重复**（如 `.order-sidebar`、`.form-grid`、`.repeat-row` 各有 3–4 处定义），与 3.2 同因，暂不动。
- **CSS 变量**：`app.css` 内定义的变量目前都被引用到；`--radius-sm`/`--text` 已修。注意 `:root` 变量是全局的，拆分后分布在 `base.css` 与 `theme.css`，不要在其它文件重复定义。
- `+error.svelte` 的样式是组件 scoped，与全局无关，勿并入。

---

## 4. 验证方法（重要：任何 CSS 改动都必须跑这个）

CSS 层叠对顺序极其敏感，像素截图不够（很多差异在布局尺寸上）。本轮采用**全量计算样式指纹**：

- 覆盖：8 条路由（`/orders`、`/orders/new`、`/orders/:id`、`/orders/:id/edit`、`/reimbursements`、`/reimbursements/review`、`/catalog`、`/admin`、`/employees`）× 6 个宽度（1440/1024/820/700/600/390）；
- 对 DOM 中**每个元素**记录约 87 个 `getComputedStyle` 属性，改前/改后逐元素逐属性比对；
- 要求：**mismatch = 0** 才能接受。

> 注意：Playwright 不是本项目依赖。本轮用的是环境里已有的 `/root/work/XiaoBa-CLI/node_modules/playwright` 与 `/root/.cache/ms-playwright/chromium-1243`。换机器需另装。
> 指纹脚本已落到 `scripts/css-fingerprint.mjs` 与 `scripts/css-fingerprint-compare.mjs`（可用环境变量指定 playwright/chromium 路径）。

运行方式：先 `npm run dev -- --port 5199`，再分别采集 before/after 并比对：

```bash
node scripts/css-fingerprint.mjs /tmp/fp-before.json
# …改动…
node scripts/css-fingerprint.mjs /tmp/fp-after.json
node scripts/css-fingerprint-compare.mjs /tmp/fp-before.json /tmp/fp-after.json   # mismatch=0 才接受
```

可用环境变量覆盖：`PLAYWRIGHT_PATH`、`CHROMIUM_PATH`、`BASE_URL`、`ORDER_ID`（默认取 `data/oa.db` 中一个真实订单 id）。

---

## 5. 后续步骤

1. ~~先决定拆分方案并落地~~ → **已完成**（第 3.3 节，保序拆分 + 指纹 0 差异）。
2. 在拆分后的文件内处理 **3.2 的跨代重复**：虽然完全冗余组为 0，但可逐组人工评估“旧声明是否能搬到新文件而不影响层叠”，每条都必须跑指纹回归。
3. 逐步消化 **3.1 legacy 层**（`src/lib/styles/legacy.css`）：先标注 `/* deprecated: 被下方覆盖 */`，确认无引用后删除；不确定的保留。建议配合增强版指纹（打开弹窗/抽屉/hover）。
4. **3.4** 用“打开所有弹窗/抽屉 + 强制 hover/focus 状态”的增强版指纹，找出剩余运行时死规则。

---

## 附录 A：保序拆分脚本（已落地）

实现见 **`scripts/split-app-css.mjs`**，仍为一次性迁移工具（当前 `app.css` 已是 `@import` 清单，需传入拆分前的原始文件才能重跑）：

```bash
node scripts/split-app-css.mjs <原始 app.css> [输出目录]
```

思路：

1. 用 PostCSS 解析，取每个**顶层子节点**的行号（注释、`@media` 块都算独立节点）；`@media` 内部不拆，整体归入所在区间；
2. 边界行：26 / 864 / 1040 / 1096 / 1213 / 1380 / 1593 / 1728 / 1949 / 2024 / 2093 / 2184 / 2366 / 2470 / 2653 / 3084 / 3342；
3. **校验**：任何顶层节点不得跨越边界（否则直接失败退出）；
4. 按边界把节点 `clone()` 进各 bucket，写入对应文件，并在文件头加功能标题注释；
5. `app.css` 改为按原顺序的 `@import './lib/styles/xxx.css';`（Vite 构建时内联，顺序即层叠顺序）。

关键约束：**import 顺序必须与原始文件顺序完全一致，不得重排**。

## 附录 B：计算样式指纹脚本（已落地）

- 采集：`scripts/css-fingerprint.mjs`
- 比对：`scripts/css-fingerprint-compare.mjs`（对同一 key 的 `\u0001` 分隔串逐段比较，任何不一致即回归）

```bash
node scripts/css-fingerprint.mjs /tmp/fp-before.json
# …改动…
node scripts/css-fingerprint.mjs /tmp/fp-after.json
node scripts/css-fingerprint-compare.mjs /tmp/fp-before.json /tmp/fp-after.json
```
