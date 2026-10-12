# OA 色彩体系规范

这套色彩服务于广告订单、报价、报销和审核工作台。颜色首先表达信息层级和操作结果，其次才承担品牌识别。页面背景保持安静，蓝色负责主要行动，状态色只用于识别流程节点。

## 1. 基础色

| Token | 色值 | 用途 |
| --- | --- | --- |
| `--ink` | `#1b2738` | 标题、正文、金额等主要信息 |
| `--muted` | `#5f6e82` | 辅助说明、表头、次要信息 |
| `--paper` | `#f3f5f8` | 页面底色 |
| `--panel` | `#ffffff` | 卡片、筛选区、表格容器 |
| `--line` | `#dfe5ee` | 主要边界和控件描边 |
| `--line-soft` | `#edf1f5` | 表格分隔线和弱边界 |
| `--navy` / `--navy-2` | `#17243d` / `#24385d` | 左侧导航和导航激活态 |

## 2. 品牌色

| Token | 色值 | 用途 |
| --- | --- | --- |
| `--color-brand-50` | `#eef3ff` | 蓝色状态底、选中背景 |
| `--color-brand-600` | `#315bdc` | 主要按钮、链接、复选框 |
| `--color-brand-700` | `#2349bd` | hover、按下态、强调文字 |
| `--color-focus-ring` | `#7b9af2` | 键盘焦点边界 |

主要按钮使用 `--color-brand-600`，hover 使用 `--color-brand-700`。普通次要按钮保持白色或中性灰表面，不把所有控件染成蓝色。

## 3. 审核流程语义色

| 流程节点 | 文字 / 按钮 | 浅色背景 | 组件类名 |
| --- | --- | --- | --- |
| 待审核 | `--color-status-review` | `--color-status-review-soft` | `.reimbursement-review` |
| 待复核 | `--color-status-recheck` | `--color-status-recheck-soft` | `.reimbursement-recheck` |
| 待确认 | `--color-status-confirm` | `--color-status-confirm-soft` | `.reimbursement-confirm` |
| 待执行 | `--color-status-payment` | `--color-status-payment-soft` | `.reimbursement-payment` |
| 已执行 | `--color-status-success` | `--color-status-success-soft` | `.reimbursement-paid` |
| 已打回 / 错误 | `--color-danger` | `--color-danger-soft` | `.reimbursement-rejected` |

状态标签使用“深色文字 + 浅色背景”，行内推进按钮使用同一语义色的实心背景。打回、删除等破坏性操作使用红色描边或浅红背景，不与成功操作共用蓝色。

## 4. 交互层级

- 默认状态依靠表面、边界和文字层级表达，不额外增加彩色背景。
- hover 使用 `--color-surface-hover`，选中或按下使用 `--color-surface-active`。
- 键盘焦点使用 `--color-focus-ring`，不能只依靠颜色变化隐藏焦点。
- 同一语义在按钮、标签、提示和确认弹窗中复用同一个 token；不要直接写新的十六进制颜色。
- 颜色不单独承担状态信息，状态标签应同时保留文字，按钮应使用明确动词。

## 5. 实现入口

基础 token 位于 `src/lib/styles/theme.css`，Catsco 几何和交互别名位于 `src/lib/styles/catsco-system.css`。新页面优先引用语义 token，只有新增业务语义时才扩展本规范。
