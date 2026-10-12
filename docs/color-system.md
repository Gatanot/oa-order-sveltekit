# OA 色彩体系规范

这套色彩服务于广告订单、报价、报销和审核工作台。颜色首先表达信息层级和操作结果，其次才承担品牌识别。页面背景保持安静，蓝色负责主要行动，报销状态色表达完成、未完成或打回。

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
| `--color-brand-50` | `#eef3ff` | 品牌提示底、选中背景 |
| `--color-brand-600` | `#315bdc` | 主要按钮、链接、复选框 |
| `--color-brand-700` | `#2349bd` | hover、按下态、强调文字 |
| `--color-focus-ring` | `#7b9af2` | 键盘焦点边界 |

主要按钮使用 `--color-brand-600`，hover 使用 `--color-brand-700`。普通次要按钮保持白色或中性灰表面，不把所有控件染成蓝色。

## 3. 报销状态语义色

| 报销类别 | 文字颜色 | 浅色背景 | 组件类名 |
| --- | --- | --- | --- |
| 未完成（待审核、待复核、待确认、待执行） | 黄色 `--color-status-pending` / `#865700` | `--color-status-pending-soft` / `#fff4d6` | `.reimbursement-pending` |
| 已完成（已执行） | 绿色 `--color-status-success` / `#2f7a50` | `--color-status-success-soft` / `#e8f5eb` | `.reimbursement-paid` |
| 已打回 | 红色 `--color-danger` / `#b54949` | `--color-danger-soft` / `#fdecec` | `.reimbursement-rejected` |

状态标签统一使用“深色文字 + 浅色背景”，只有上述三种颜色。所有未完成阶段共用黄色，并保留待审核、待复核等文字区分进度。`ReimbursementStatus.svelte` 统一负责分类和展示，我的报销、报销审核和订单关联报销共用此组件。

报销审核行内操作只使用绿色和红色：审核、复核、确认、执行按钮统一使用绿色 `--color-status-success`，只显示动作文字；右侧打回按钮使用红色 `--color-danger`，只显示叉号，并保留悬停提示和无障碍名称。两者高度统一为 34px。打回、删除等破坏性操作使用红色描边或浅红背景。

## 4. 交互层级

- 默认状态依靠表面、边界和文字层级表达，不额外增加彩色背景。
- hover 使用 `--color-surface-hover`，选中或按下使用 `--color-surface-active`。
- 键盘焦点使用 `--color-focus-ring`，不能只依靠颜色变化隐藏焦点。
- 同一语义在按钮、标签、提示和确认弹窗中复用同一个 token；不要直接写新的十六进制颜色。
- 颜色不单独承担状态信息，状态标签应同时保留文字，按钮应使用明确动词。

## 5. 实现入口

基础 token 位于 `src/lib/styles/theme.css`，Catsco 几何和交互别名位于 `src/lib/styles/catsco-system.css`。新页面优先引用语义 token，只有新增业务语义时才扩展本规范。
