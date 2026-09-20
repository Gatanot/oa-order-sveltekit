# ORBIT OA 开发情况总结（截至 2026-09-20）

> 仓库：`oa-order-sveltekit`
> 当前分支：`main` @ `acdd4d6 feat: complete demo4 workflow alignment`
> 总结时间：2026-09-20 13:47（CST）

## 1. 项目基线

- 技术栈：SvelteKit 2.20 + Svelte 5 + TypeScript + SQLite（`better-sqlite3`）+ `@sveltejs/adapter-node`，Node 20。
- 业务：广告订单 OA，订单、报价/成本库、报销、附件、导出全部服务端持久化。
- 使用模型：无登录、无账号体系，前端分「查看 / 填写 / 财务」三种工作模式（仅界面功能切换，不是安全权限）。
- 视觉与业务基准：`pics/demo4.html`；数据库 schema 版本 **v20**。
- 仓库状态：工作区干净，`build/` 于 13:42 构建完成，本地 `data/oa.db`（v20）与附件目录存在。

## 2. 上周开发情况（2026-09-07 ~ 09-13，19 次提交）

主线：**订单录入闭环 + 附件 + 报销状态机**。

| 日期 | 提交 | 内容 |
|---|---|---|
| 09-07 | `b9083ec` / `3a0f718` / `b9a244d` | 检查点；收紧财务与报销工作流 |
| 09-08 | `33b867b` | 重置 demo 订单时保留工作流状态 |
| 09-09 | `209152a` / `c8884ba` | 检查点；加固 API 边界与导出 |
| 09-10 | `51219c3` ~ `61bb724`（12 次提交） | 完善订单录入与项目管理体验；`OrderDesk` 拆分为职责单一的组件；订单概览与附件接口；附件真实上传与在线查看；员工垫付支持上传发票；提交校验放开（产品/成本/垫付任一有内容即可提交、单行垫付也能保存）；修复金额格式、产品推荐、侧边栏固定、明细列对齐等体验问题 |
| 09-11 | `fcaeb8a` ~ `20283fa`（4 次提交） | 完善订单录入与报销核验体验；独立报销处理流程；加强报销批量处理与失败回滚；统一订单垫付与报销模型 |

## 3. 本周开发情况（2026-09-14 ~ 09-20，5 次提交）

主线：**路由化重构 + demo4 对齐**。

| 日期 | 提交 | 内容 |
|---|---|---|
| 09-14 | `c8913ff` | 对齐最新原型：引入 demo2/demo3 与 `docs/demo3-review.md`；订单工作流、报销、导出 API 扩展 |
| 09-15 | `785b2df` | 重建「新建订单」完整表单重置逻辑，收紧提交校验 |
| 09-17 | `2dc8d38` | 架构重构：新增服务端 `workbench.ts` 加载器；根路径重定向；拆分 `/orders`、`/orders/new`、`/orders/[id]`、`/orders/[id]/edit`、`/reimbursements`、`/catalog` 独立路由；新增资料库导入/来源、报销归档/导出 API；补充 README、`docs/deployment.md`、`plan.md`、smoke-test；schema 升至 v20（移除旧登录表与用户 ID 字段） |
| 09-17 | `7937484` | UI 对齐 demo4：`app.css` 新增 1318 行，侧栏、订单概览、报销界面改版 |
| 09-20 | `acdd4d6` | 完成 demo4 工作流对齐（13:45，由 `feature/demo4-design-migration` 快进合并到 main） |

## 4. 当前正在处理的细节（最新提交 `acdd4d6`）

### 4.1 报销 / 垫付模型收紧

- 每条员工垫付可独立指定员工；`hydrateOrder` 返回 `attachment_id` / `attachment_count`，订单详情可直接在线查看发票。
- 已进入报销流程的垫付前后端都禁止删改：服务端报「已进入报销流程的垫付不可删除或修改」，前端 `canEditAdvance` 将输入框、日期、上传、删除置为只读/禁用。
- 审核通过进入「待打款」时自动生成幂等单据号（`ensureReimbursementVoucher`），手动生成不会覆盖自动单号。
- 报销统计改为按财务筛选条件（项目/类型/日期）计算 `reimbursementSummaryRows`；零金额报销由服务端拒绝。

### 4.2 资料库

- 新增「新增公司/厂商」弹窗，支持「沿用」同类型资料库（`copy_from_id` 事务复制条目，`import_summary_json` 记录复制来源与条数）。
- 资料库明细抽屉新增关键词搜索。
- 订单录入的产品/成本建议改为按 `item.id` 回填，并显示报价/成本库来源与分类。

### 4.3 订单与导出

- 产品明细 hydrate 带出 `category`，结算单导出按分类分组，表头版式对齐 demo4（甲方/乙方/双方项目跟进人/联系电话）。
- 明细导出新增「按产品逐行展开」、金额合计行与「复制表格」按钮。
- 客户筛选联动重置项目筛选（`onFilterCustomerChange`）；详情页补「备注 / 制作说明」；导出列仅财务模式显示；订单表单加入 dirty 状态与离开确认。

### 4.4 报销前端

- 财务可代员工录入报销（报销人输入框可编辑，弹窗标题与说明随之变化）。
- 报销表格新增「姓名」列。

### 4.5 测试与文档

- `scripts/smoke-test.mjs` 覆盖：沿用资料库、独立垫付员工、多附件上传、零金额拒绝、自动单据幂等/归档、垫付不可变、demo4 导出格式、未报销筛选、审计与外键检查。
- README 与 `docs/deployment.md` 同步到 demo4 / v20 基线。

## 5. 仓库现状与待收尾项

- 分支：`feature/demo4-design-migration` 已与 main 同步；`feature/demo-fullstack-auth-plan` 落后 2 个提交、`feature/order-entry-overview` 落后 3 个，可评估合并或删除；仓库暂无 tag。
- 文档：`plan.md` 仍以 demo3 与「登录/权限」为基线，与当前「无登录 + demo4」方向不一致，需要同步更新；`docs/demo3-review.md` 同理。
- 清理：`pics/demo4.html:Zone.Identifier` 为 Windows 下载残留文件，可移除。
- 建议下一步：更新 plan.md 到 demo4 基线 → 清理过期分支与残留文件 → 执行一次 `npm test`（check + build + smoke）做最终验证。
