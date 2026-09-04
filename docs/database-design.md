# ORBIT OA 数据库设计（MVP）

## 1. 设计原则

1. `orders` 是项目经营主对象，所有业务事实通过 `order_id` 归属项目。
2. 状态由服务端命令驱动，业务表保存当前状态，历史表保存不可变状态变化。
3. 金额统一使用人民币分（`INTEGER`），禁止使用浮点数保存金额。
4. 核心业务记录默认不物理删除，使用归档/作废状态或后续软删除字段。
5. 外部系统接入必须保留外部单号、原始回调和幂等键。
6. 迁移必须可重复执行、可回滚风险可控，生产迁移前先备份数据库。

## 2. 目标表分层

### 组织与身份

- `departments`：组织/部门树
- `users`：系统用户
- `roles`：系统角色
- `user_roles`：用户角色关系
- `order_members`：项目成员及项目内职责

### 项目主数据

- `orders`：项目/订单主表
- `order_workflows`：项目当前工作流事实
- `status_history`：项目及子实体状态变化
- `audit_logs`：通用操作留痕
- `tasks`：项目任务

### 商务与交付

- `quote_versions`：报价版本
- `material_lines`：物料/制作成本行
- `procurement_items`：采购需求
- `procurement_offers`：供应商报价
- `acceptance_issues`：验收问题
- `attachments`：附件元数据

### 财务

- `expenses`：项目费用/报销单
- `cost_entries`：成本事实流水（目标表，后续迁移）
- `invoices`：开票记录（目标表，后续迁移）
- `payments`：客户回款记录（目标表，后续迁移）

### 集成

- `integration_events`：企业微信等外部事件接收、幂等和处理结果（目标表，后续迁移）

## 3. 当前表结构评价

| 表 | 当前作用 | 结论 |
|---|---|---|
| `orders` | 项目主对象和汇总金额 | MVP 可用；后续补归档、版本和负责人外键 |
| `order_workflows` | 项目当前阶段外的流程事实 | MVP 可用；后续拆分验收、结算、财务子域 |
| `quote_versions` | 报价版本 | 基本完整；需唯一版本和变更审批 |
| `material_lines` | 物料成本明细 | 可用；需关联成本流水和采购来源 |
| `expenses` | 费用与报销 | 当前可用；需审核/驳回/报销人字段 |
| `procurement_items` | 采购需求和定标结果 | 原型可用；正式版需采购订单 |
| `procurement_offers` | 供应商报价 | 基本完整；需供应商主数据外键 |
| `acceptance_issues` | 验收整改问题 | 状态过少，后续拆分整改与复验 |
| `attachments` | 附件元数据 | 当前仅文件名演示，后续接入对象存储 |
| `audit_logs` | 通用审计 | 可保留；不可替代结构化状态历史 |
| `status_history` | 结构化状态历史 | 已加入，作为状态机基础 |

## 4. 目标核心 DDL

以下是目标结构的字段设计摘要。当前迁移不会一次性重建所有旧表，而是按版本逐步实施。

### `users`

```sql
id TEXT PRIMARY KEY,
username TEXT NOT NULL UNIQUE,
display_name TEXT NOT NULL,
department_id TEXT,
email TEXT,
phone TEXT,
status TEXT NOT NULL DEFAULT '正常',
created_at TEXT NOT NULL,
updated_at TEXT NOT NULL,
archived_at TEXT
```

### `roles` / `user_roles`

```sql
roles(id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);
user_roles(user_id TEXT NOT NULL, role_id TEXT NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY(user_id, role_id));
```

### `order_members`

```sql
id TEXT PRIMARY KEY,
order_id TEXT NOT NULL,
user_id TEXT NOT NULL,
role TEXT NOT NULL,
is_primary INTEGER NOT NULL DEFAULT 0,
created_at TEXT NOT NULL,
UNIQUE(order_id, user_id, role),
FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE,
FOREIGN KEY(user_id) REFERENCES users(id)
```

### `cost_entries`

```sql
id TEXT PRIMARY KEY,
order_id TEXT NOT NULL,
source_type TEXT NOT NULL,
source_id TEXT NOT NULL,
cost_type TEXT NOT NULL,
amount INTEGER NOT NULL,
tax_amount INTEGER NOT NULL DEFAULT 0,
status TEXT NOT NULL,
occurred_on TEXT,
reversal_of TEXT,
created_by TEXT,
created_at TEXT NOT NULL,
UNIQUE(source_type, source_id, reversal_of)
```

### `invoices` / `payments`

金额事实不再只放在 `order_workflows`：

```sql
invoices(id, order_id, invoice_no, amount, status, issued_on, created_by, created_at)
payments(id, order_id, amount, paid_on, reference_no, created_by, created_at)
```

`order_workflows.invoice/payment` 在迁移完成前保留为兼容汇总字段。

### `integration_events`

```sql
id TEXT PRIMARY KEY,
provider TEXT NOT NULL,
event_type TEXT NOT NULL,
external_id TEXT NOT NULL,
idempotency_key TEXT NOT NULL UNIQUE,
payload TEXT NOT NULL,
status TEXT NOT NULL DEFAULT 'received',
error_message TEXT,
received_at TEXT NOT NULL,
processed_at TEXT,
UNIQUE(provider, external_id)
```

## 5. 迁移路线

- **V1（已有）**：基础项目、报价、采购、费用、验收、附件、审计表。
- **V2（本次）**：迁移版本表；组织、用户、角色、项目成员基础表；为后续权限接入准备。
- **V3**：增加核心表的 `created_by/updated_by/version/archived_at`，同步改写所有插入和更新语句。
- **V4**：增加验收状态历史字段和费用审核字段，迁移旧状态。
- **V5**：建立 `cost_entries`，从物料、已定标采购和有效费用生成初始成本流水。
- **V6**：建立 `invoices`、`payments`，把旧工作流金额转为兼容汇总。
- **V7**：建立 `integration_events`，接入企业微信审批回调和幂等处理。
- **V8**：对核心表重建并加入数据库级 `CHECK` 约束、严格外键和软删除策略。

每个版本必须：

- 在事务中执行；
- 写入 `schema_migrations`；
- 可在已有 `oa.db` 和空库上执行；
- 不直接删除旧字段；
- 迁移后执行数据一致性检查。
