# 本机代录入口与报价/成本库工具（v3）

本期取消服务密钥和 Agent 身份配置。代录程序与 OA 在同一台机器上，通过独立的 loopback 进程直接读写同一数据库；**网页用户请求仍走原有 Artifact 登录与权限，不获得本机代录能力**。

## 启动

```bash
npm run build:local
DATABASE_PATH=/绝对路径/oa.db npm run start:local
```

- 默认地址 `http://127.0.0.1:3101/`，可用 OA_LOCAL_PORT 改端口，但不能改监听网卡。
- 必须与网页进程使用同一 DATABASE_PATH、附件目录和兼容版本代码。相对路径基于启动目录，推荐绝对路径。
- `npm start` 只启动网页；本机入口单独启动，不自动发布。
- 无密钥、Cookie、Token、Agent ID 或员工登录上下文配置。
- 网页服务器上的 `/api/ai/*` 已统一关闭，返回 410 LOCAL_ENTRY_ONLY；公网请求即使由本机 Artifact 连接器转发，也不会因此获得本机能力。
- **不得把本机端口配置到 Artifact、Nginx、端口转发或公网代理中。** 本机进程拒绝代理转发头、错误 Host、Origin 和浏览器 Fetch metadata，不提供 CORS。仅支持原始本机 HTTP 客户端。
- loopback 是部署边界，不是进程身份认证。同机任意能访问此端口的进程都具有现有代录工具的全量能力，不能区分获准/未获准 Agent；不要在不受信任的多用户主机上启动此入口。
- 容器/虚拟机有独立网络命名空间，物理上同机不一定能访问 127.0.0.1。当前实现要求同一网络命名空间，不应为方便而改监听 0.0.0.0。

## 模型工具与 CLI

适配器 `src/lib/server/catsco-oa-tools.js`：

```js
import { createCatscoOaTools } from './catsco-oa-tools.js';
const oa = createCatscoOaTools(); // 默认127.0.0.1:3101
const tools = await oa.listTools();
const result = await oa.execute(toolName, businessArguments);
```

地址只能是显式端口的 `http://127.0.0.1:<端口>/` 根路径。没有 apiKey 或用户 context 参数。`oa_entry_info {}` 返回本机入口能力，不代表任何已认证员工。其余工具名前缀为 oa_catalog_、oa_orders_。

```bash
node scripts/ai-catalog-tool.mjs me
node scripts/ai-catalog-tool.mjs tools
printf '%s' '{"name":"oa_catalog_list_sources","arguments":{"kind":"cost"}}' | node scripts/ai-catalog-tool.mjs call
```

非默认端口可设置 OA_LOCAL_URL。默认传输使用 Node 原生 http；Node fetch 可能自动添加 Sec-Fetch-Mode，会被入口拒绝，推荐使用适配器或 curl。

## HTTP 接口

- `GET http://127.0.0.1:3101/api/ai/me` → `{data:{mode:"local_entry",permissions:{catalog,orders}}}`，没有 Agent 标识。
- `GET /api/ai/catalog` → 工具说明和 JSON Schema。
- `POST /api/ai/catalog` → `{"tool":"短工具名","arguments":{...}}`。
- `GET/POST /api/ai/orders` → [订单代录工具](ai-order-tools.md)。

成功 `{data:...}`；失败 `{error:{code,message,path?}}`。请求体最多1MiB；非法Content-Type为415，超限413。本机入口不提供网页登录、员工管理或任意SQL接口。

### 资料库工具

| 工具 | 用途 |
|---|---|
| list_sources | 查询报价/成本库来源 |
| search_items | 搜索有效条目 |
| create_source | 预览/新建资料库 |
| upsert_items | 预览/批量新增或整行更新条目 |

```json
{"tool":"list_sources","arguments":{"kind":"cost","q":"印刷","limit":20,"offset":0}}
```

kind 可选 quote（客户报价库）/cost（厂商成本库）；q 搜索公司名。分页默认20、最多100，结果items/total/limit/offset。

```json
{"tool":"search_items","arguments":{"kind":"cost","source_id":"资料库ID","q":"喷画"}}
```

kind 必填，source_id 可选，q 搜索名称/分类/规格。金额全部为人民币元字符串，不混用旧网页API的整数分。报价字段price_incl_tax（统一价格）、max_quote_unit；成本字段cost_unit（统一价格）。两者都按含税价格处理，不区分税率或不含税价。

```json
{"tool":"create_source","arguments":{"kind":"cost","owner_name":"示例印刷厂"}}
```

默认仅预览，加dry_run=false才提交。返回source.id，同类型同公司重复409，应查询复用。报价库公司名成为可选客户。

```json
{"tool":"upsert_items","arguments":{"source_id":"成本库ID","rows":[{"name":"喷画","category":"广告制作","unit":"平方米","cost_unit":"12.34","remark":"含安装"}]}}
```

- 默认预览，加dry_run=false写入；1–100行，非法行使全批失败。
- 通用字段name必填，可选category/specification/unit/item_no/remark。unit默认项。
- 成本显式cost_unit，可选min_quantity；报价显式price_incl_tax，可选max_quote_unit/project_name/estimated_quantity。
- 所有金额为统一价格，按含税价理解；非负元字符串最多两位小数，可选金额省略置零。
- 自然键成本=分类+名称+厂商+规格；报价=分类+名称+客户+项目+规格+预估数量。客户/厂商取source owner_name，不接受行内customer_name/supplier_name。
- 同键整行更新，不是PATCH，省略字段清空/置零；改自然键新增，不是重命名。跨库冲突拒绝，不自动挪库。输出只读id等不要回传。
- 预览不保存、不锁定版本；本期无删除、整库替换和数据库原始执行能力。

## 记录与测试

本机新增业务记录不写Agent ID、来源channel或Agent工具名。审计保留业务动作/变更，实际提交者未知时actor_uid为空、actor_name为空，不冒充已认证员工。历史记录不修改、不清理。普通网页审计仍按原规则记录真实登录用户。

```bash
npm test
```

含本机边界、网页权限、业务预览/提交/回滚/版本检查测试，使用临时数据库，不修改业务data。
