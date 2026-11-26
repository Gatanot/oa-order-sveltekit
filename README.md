# ORBIT OA 广告订单工作台

基于 SvelteKit 5、TypeScript、SQLite 与 adapter-node 的广告订单 OA。项目以 `pics/demo4.html` 的业务路径和视觉为参考，订单、报价成本、报销、附件和导出均持久化到服务端。

## 使用模型

项目通过 Artifact 网关识别平台访问者，不在本地解析票据，也不提供独立账号或角色管理。固定系统管理员 UID 为 `826`（Catsco）和 `406`，其他员工由管理员开通。打开工作台后可在左侧切换三种前端工作模式：

| 模式 | 开放功能 |
|---|---|
| 查看 | 浏览订单详情、筛选统计和查看本人报销进度 |
| 填写 | 查看功能，以及新建/编辑订单、提交报销、补传发票 |
| 财务 | 代员工录入报销、全量审核与付款、删除订单、资料库维护和导出 |

模式只是工作界面的功能切换，不是安全权限。填写人（订单录入人和报销人）使用员工管理里设置的员工姓名（未设置时回退到 Catsco 登录用户名），不能在浏览器中自行设置。

## 已实现能力

- 可刷新/分享的 `/orders`、订单详情/编辑、`/reimbursements`、`/catalog` 路由；
- 订单筛选、排序、统计、字段显示、产品与成本（同名自动匹配厂商成本）、员工垫付、备注详情和 Excel/表格导出；
- 客户报价库（`catalog_quote_items`，统一价格、限价）与厂商成本库（`catalog_cost_items`，统一价格、供应商）分表存储、来源新增/沿用、CSV/XLS/XLSX 服务端解析和替换导入；
- 客户管理（`customer_profiles`）是订单客户的唯一来源，订单/项目通过客户档案 id 关联；报价库仍按客户名称归属，客户改名时同步报价库来源与条目快照；
- 订单勾选员工垫付后自动进入“我的报销 → 待上传证明”，员工补传付款截图和发票并提交后才进入审批；
- 报销金额修改走“申请修改金额”，不改订单成本；已进入审核的报销修改后退回上一审核节点重审，并在列表标记“已修改”；
- 报销按部门配置的三级审核（每级可多人）和“待执行 → 已执行”付款状态机，支持“已打回 → 补传 → 重新进入一级审核”；
- 员工与权限管理页可维护各部门三级审核人，报销详情保留逐级审批记录；
- 批量审核/打回/付款、待付款汇总、幂等单据编号和单据归档；
- 图片/PDF 魔数校验、10MB 限制和附件落盘存储；
- 订单明细规范化快照、金额按分存储和关键操作审计；
- demo4 风格深色侧栏、响应式表格、状态标签、抽屉和统一反馈；
- 每条员工垫付可独立指定员工，审核通过自动生成幂等单据，付款前提供金额确认。

## 环境要求

- Node.js `>=20.19 <21`
- npm `>=10`

## 本地启动

```bash
npm ci
cp .env.example .env
npm run dev
```

生产环境推荐使用 `npm start`（会自动加载 `.env` 并把附件请求体上限设为 12MB）；直接使用 `node build` 时，应将 `ORIGIN` 设置为浏览器实际访问地址（例如 `https://oa.example.com`），否则服务端会拒绝 Excel 和附件表单上传。构建已把 adapter-node 默认 512KB 请求体上限调整为 12MB，仍可用 `BODY_SIZE_LIMIT` 显式覆盖。通过 Artifact 发布时还必须把 `ARTIFACT_APP_ID` 设置为发布登记使用的应用 id；服务端会把请求的 Cookie 与 Authorization 原样转发到网关的 `/_gateway/me`，并通过 `api/whoami` 返回最小化后的访问者信息。

打开 `http://localhost:5173`。登录后即可切换工作模式并录入订单，录入人会取自员工管理里设置的员工姓名（未设置时回退到 Catsco 登录用户名）。

## 常用命令

```bash
npm run check       # Svelte/TypeScript 静态检查
npm run build       # adapter-node 生产构建
npm run test:smoke  # 需先 build；使用临时数据库做业务闭环验证
npm test            # check + build + smoke
npm start           # 启动 build 目录（加载 .env，默认 12MB 上传上限）
```

Smoke 测试覆盖无登录访问、资料库导入/沿用、项目和订单写入、录入人快照、金额计算、报销筛选与状态机、单据幂等/归档、对齐 demo4 的 Excel 导出、审计和外键检查，不会修改 `data/oa.db`。

## 主要路由

| 页面 | 用途 |
|---|---|
| `/orders` | 订单总览、筛选和统计 |
| `/orders/new` | 新建订单，填写模式开放 |
| `/orders/[id]` | 订单详情 |
| `/orders/[id]/edit` | 编辑订单，填写模式开放 |
| `/reimbursements` | 我的报销，所有身份都可提交并跟踪本人报销 |
| `/reimbursements/review` | 报销审核队列，按部门配置的三级审核人可见（未配置时按财务/老板/管理员角色兜底），审核者不能处理本人报销 |
| `/catalog` | 报价库与成本库，可查看该页面的身份（管理员/商务/老板/执行）均可新增、导入和维护 |

## 本机代录工具

v3 取消服务密钥与 Agent 身份配置，改为独立的本机入口。普通网页的 Artifact 登录、员工权限和审计保持原规则；网页 `/api/ai/*` 返回410，不开放或转发本机能力。

```bash
npm run build:local
DATABASE_PATH=/绝对路径/oa.db npm run start:local
```

仅监听 `127.0.0.1:3101`，应与网页使用同一数据库。不要发布或反向代理这个端口；同一网络命名空间的本机进程都可以使用，无密钥、Cookie或员工登录要求。

- 本机 `GET /api/ai/me`：返回入口能力，不返回Agent身份。
- 本机 `GET/POST /api/ai/catalog`：资料库查询、搜索、新建、批量录入更新。
- 本机 `GET/POST /api/ai/orders`：全量订单搜索、详情、参考数据、单笔/批量代录、局部修改与重新归属。调用方填写员工 `created_by_uid` 及其它业务数据，不自动添加Agent痕迹。写入默认预览，不开放删除或结款。
- 适配器 `src/lib/server/catsco-oa-tools.js` 默认连接本机，无apiKey/context配置。CLI：`node scripts/ai-catalog-tool.mjs me|tools|call`。

Excel由同机程序解析后调用结构化批量接口；新增审计不写Agent标识，未知提交者留空，不冒充已验证员工。详见 [本机入口说明](docs/ai-catalog-tools.md) 和 [订单代录说明](docs/ai-order-tools.md)。

## 数据与备份

SQLite 默认位于 `data/oa.db`，附件默认位于数据库同级 `attachments/`。数据库和附件必须成对备份。应用启动时在事务内升级 schema；当前版本为 **v35**，部门统一为设计/执行/商务/策划/财务/老板，员工身份完全由所属部门决定，历史“管理人员”身份并入老板；v34 个人垫付先进入“待上传证明”，员工上传付款截图和发票并提交后才进入一级审核；v34 增加金额修改原因、内容修改标记，并把尚未上传任何附件的历史自动垫付一并迁回“待上传证明”。v33 订单和项目客户改为外键引用 `customer_profiles`，历史 `customers_simple` 客户（含历史报价库 owner）迁移为客户档案后移除旧表；客户改名会自动同步报价库来源和条目客户快照，已有订单/项目/报价库的客户不能删除。v32 新增 `department_approvers`（按部门配置三级审核人）和 `reimbursement_approvals`（逐级审批留痕）两张表，并为报销记录补充部门快照；未配置审核人的部门继续按原角色兜底。v28 将报价库与成本库拆分为 `catalog_quote_items`/`catalog_cost_items` 两张表，价格统一按含税价处理并移除税率/不含税价列；订单行分别外键到对应库并移除 `orders_simple.catalog_id`。此前的 v20 移除了旧版登录表和用户 ID 关联；v21 至 v31 为增量字段与权限结构调整。

详细生产部署、迁移、WAL 一致性备份和恢复说明见 [`docs/deployment.md`](docs/deployment.md)。
