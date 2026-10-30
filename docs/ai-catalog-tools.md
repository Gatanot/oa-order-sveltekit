# 共享云端 Agent：接入与报价/成本库工具（v2）

> v2 已放弃“把当前员工浏览器身份分发给 Agent”的方式。云端共享 Agent 是管理员授权的独立服务执行者，不需要员工 Cookie，也不依赖用户机器上的 `/api/whoami`。普通网页仍使用原有 Artifact 登录与角色权限。

## 1. 管理员配置

OA 服务端环境：

```dotenv
OA_AI_SERVICE_KEY=<管理员生成的至少32字符随机密钥>
OA_AI_SERVICE_ID=shared-agent
OA_AI_SERVICE_NAME=OA代办Agent
```

可在安全终端生成随机值：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

真实密钥不要写进 git、聊天、模型提示词或工具参数。云端工具执行器在私密配置中持有同一密钥，并自动附加 `X-OA-Agent-Key`。使用自定义头避免将服务密钥与 Artifact 用户 Authorization 混淆。

- 未配置、短于 32 字符、包含空白/控制符或 Agent ID 无效时，AI 接口关闭，返回 401 AGENT_AUTH_REQUIRED。
- 缺少/错误密钥即使附有管理员浏览器 Cookie，也不能使用 AI 接口。不会回退到员工登录态。
- 密钥仅授权 `/api/ai/*`，不能解锁 `/api/employees`、普通订单 API 或管理员页面。
- Agent 获得现有 AI 工具的全量查询与代办能力，可以自主指定订单归属员工；不能因为某员工触发任务就把服务身份误认为该员工。
- 这是一个**高信任集成接口**，不是按聊天发起人隔离的数据沙箱。任何获准使用该共享 Agent 的人，可能通过它发起跨员工业务操作；调用入口的用户准入和操作确认由可信宿主管理。
- 本期没有删除、整库替换、结款、审批、员工管理等工具；没有因此暴露任意 SQL。
- 生产请使用 HTTPS；代理/日志系统应屏蔽 X-OA-Agent-Key，不记录全部请求头。配置好密钥后需重启服务使部署配置生效。
- 轮换密钥同时更新 OA 与云端执行器；保持 OA_AI_SERVICE_ID 不变，可保留订单幂等空间。ID 改变会创建新幂等空间，旧任务重试前必须核对订单。
- 网络/网关必须允许已配置的云端执行器访问应用及保留 X-OA-Agent-Key；若外层发布网关本身要求用户浏览器登录，仍需在平台侧配置受信任的机器访问通道，不能仅靠 OA 代码越过外层网关。上线后需从实际云端验证。

## 2. 服务信息与工具清单

```http
GET <应用根>/api/ai/me
X-OA-Agent-Key: <服务密钥>
```

```json
{
  "data": {
    "kind":"service_agent",
    "agent_id":"shared-agent",
    "display_name":"OA代办Agent",
    "permissions":{
      "catalog":{"read":true,"manage":true},
      "orders":{"read":true,"create":true,"view_all":true,"manage_all":true,"edit_scope":"all"}
    }
  }
}
```

此接口不再返回“当前登录员工”。普通浏览器的 `/api/whoami` 保持原样。

- `GET /api/ai/catalog` 返回资料库工具 JSON Schema、version=2、identity.mode=service_agent。
- `GET /api/ai/orders` 返回 [订单工具](ai-order-tools.md)。
- `POST /api/ai/catalog` 执行 `{"tool":"工具名","arguments":{...}}`。
- 成功 `{data:...}`，失败 `{error:{code,message,path?}}`。401 表示管理员需配置/更新服务接入，不提示员工提供 Cookie。正常与鉴权失败响应均禁止缓存。

## 3. 云端执行器适配器

`src/lib/server/catsco-oa-tools.js` 是无 SvelteKit 依赖的服务端模块，公开 API 已更新：

```js
import { createCatscoOaTools } from './catsco-oa-tools.js';

const oa = createCatscoOaTools({
  appBaseUrl: process.env.OA_BASE_URL, // 例如 https://artifact.catsco.cc/oa-order/
  apiKey: process.env.OA_AI_SERVICE_KEY
});
const definitions = await oa.listTools();
// 模型只看到 definitions，执行回调只收工具名称和业务参数。
const result = await oa.execute(modelToolName, modelArguments);
```

不再传入 currentUserRequest/context。配置只由运行环境提供，模型不能修改目标 URL 或认证头。固定 HTTPS 目标、不跟随重定向、不自动重试写入；错误不返回原始网络异常或密钥。

模型身份工具为 `oa_agent_info {}`；旧 `oa_current_user {}` 仅保留兼容别名，语义是“当前服务 Agent”，不是员工身份。资料库工具前缀为 oa_catalog_，订单为 oa_orders_。

CLI 示例（环境由管理员预先配置，勿让模型读取环境）：

```bash
node scripts/ai-catalog-tool.mjs me
node scripts/ai-catalog-tool.mjs tools
printf '%s' '{"name":"oa_catalog_list_sources","arguments":{"kind":"cost"}}' | node scripts/ai-catalog-tool.mjs call
```

CLI 输入为适配器工具名称 `name`，不同于 HTTP 请求的短名称 `tool`。服务密钥不是员工凭据，仅需配置一次，不按员工切换。

## 4. 资料库工具

### list_sources / oa_catalog_list_sources

```json
{"tool":"list_sources","arguments":{"kind":"cost","q":"印刷","limit":20,"offset":0}}
```

kind 可选 quote（客户报价库）/cost（厂商成本库）；q 按公司名称子串搜索。返回 items、total、limit、offset。默认 20 条、最多 100。

### search_items / oa_catalog_search_items

```json
{"tool":"search_items","arguments":{"kind":"cost","source_id":"资料库ID","q":"喷画"}}
```

kind 必填，source_id 可选，q 搜索名称/分类/规格。金额输入输出统一为人民币**元字符串**，例如 `"12.34"`，不要混用旧网页 API 的整数分。

报价字段 price_incl_tax、price_excl_tax、max_quote_unit；成本字段 cost_unit、cost_unit_excl_tax。结果不返回 raw_data 或内部存储路径。

### create_source / oa_catalog_create_source

```json
{"tool":"create_source","arguments":{"kind":"cost","owner_name":"示例印刷厂"}}
```

默认 dry_run=true，仅预览；加 dry_run=false 才创建。正式结果 data.source.id 是后续录入使用的 source_id。同类型同公司不能重复创建（409 CONFLICT），应查询后复用。报价库公司名按原规则成为可选客户。

### upsert_items / oa_catalog_upsert_items

```json
{
  "tool":"upsert_items",
  "arguments":{
    "source_id":"成本库ID",
    "rows":[{"name":"户外喷画","category":"广告制作","specification":"高清户外","unit":"平方米","cost_unit":"12.34","cost_unit_excl_tax":"10.92","tax_rate":"13%","min_quantity":"1","remark":"含安装"}]
  }
}
```

- 默认预览；加 dry_run=false 写入。每批 1–100 行，任意一行非法全批不写。
- 通用字段 name（必填）、category、specification、unit（默认项）、item_no、tax_rate、remark。
- 成本必须显式 cost_unit，可选 cost_unit_excl_tax、min_quantity。
- 报价必须显式 price_incl_tax，可选 price_excl_tax、max_quote_unit、project_name、estimated_quantity。
- 非负金额元字符串、最多两位小数；不根据税率反算价格，可选金额未填置零。
- 自然键：成本=分类+名称+厂商+规格；报价=分类+名称+客户+项目+规格+预估数量。
- 客户/厂商取资料库 owner_name，不接受行内 customer_name/supplier_name；这属于资料库结构规则，与订单代录归属不同。
- 同键整行更新，不是 PATCH；未传可选文本/金额清空/置零，item_no 未填按行序生成。变更自然键会新增条目，不是重命名。
- 搜索结果的 id/source_id 等只读字段不要原样回传。所有文本最多 2000 字符。
- 跨库自然键冲突返回 CROSS_SOURCE_CONFLICT，不自动挪库；批内重复条目拒绝。
- 预览不保存、不锁定版本。dry_run=false 是提交意图，不是平台验证的用户确认票据。

## 5. 审计与测试

真实执行者记录为 Agent 显示名，actor_uid=null，明确审计 detail.channel=ai_service、agent_id；不是管理员 UID 或被代录员工。资料库 import_catalog 的内部日志同事务保留，并另写带 Agent ID 的工具审计。

```bash
npm test
```

测试使用虚构服务密钥、本地模拟网关、临时数据库，验证无员工浏览器依赖、密钥边界、工具执行和网页原权限不变。不使用真实密钥，不修改业务 data/。真实公网网关到云端的连通性需部署后联调。
