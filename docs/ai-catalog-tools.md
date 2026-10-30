# AI 当前身份与报价/成本库工具（v1）

本期提供 HTTP JSON 工具接口与 **Catsco 可信宿主适配器**，不是 MCP 服务。AI 只提供工具名称和业务参数；适配器自动绑定发起本次操作的当前登录用户，所有调用仍经 Artifact 身份验证与 OA 角色授权。

## 当前用户执行原则

- **AI 不接触、不保存、不提供任何登录凭据，也不能选择代表谁。** 不能要求用户在聊天里粘贴 Cookie、Token。模型参数 Schema 不包含任何认证字段。
- “当前登录用户”指发起本次调用的用户会话，不是服务器最后登录的人，也不是某个全局 UID。每次调用都由可信宿主独立绑定上下文，不缓存身份、不跨用户复用请求。
- 系统底层仍需可信身份传递：适配器只在宿主内部把当前用户请求的 Cookie/Authorization 转发给固定 OA 应用，OA 再经 `/_gateway/me` 验证。这些头不进入模型上下文或工具输出。
- 不接受 JSON 的 uid、actor、role 或 X-User-UID 等自报身份头。管理员设置额外业务身份时，使用与网页一致的有效业务角色。
- 401 LOGIN_REQUIRED：提示登录 Catsco 后重新发起，不要求提供凭据。403：账号未开通/停用或没有业务权限。用户失去权限后，旧工具列表不再授权后续调用。
- **Catsco 接线状态：OA 侧适配器已实现，但仓库里没有 Catsco 聊天运行时的工具注册/会话传递契约。** 不能把“聊天窗口已登录”当作服务器工具自动带登录态。Catsco 宿主必须按下文接线，提供网关可验证的当前用户请求。若平台只提供 UID 或 bot 的系统 key，当前实现会拒绝；需平台补齐受支持的会话桥接，不能在 OA 中凭空把 UID 当成登录。
- 当前 catalog 可读/可维护角色均为 admin、manager、owner、executor。finance、designer、planner 不能使用该工具。以服务端最新权限为准。
- 工具写入有用户 UID 审计，附加 `channel: ai_tool` 表示调用入口，不表示已认证了独立 AI 身份；目前不区分不同 AI 客户端。
- 本期无删除、整库替换功能；但原有网页 API 仍按原权限存在。本工具不是缩小现有登录凭据权限的沙箱。

## 1. 查询当前用户

```http
GET <应用根路径>/api/ai/me
```

```json
{
  "data": {
    "uid": 123,
    "username": "example",
    "displayName": "张三",
    "role": "executor",
    "department": "执行",
    "active": true,
    "permissions": { "catalog": { "read": true, "manage": true } }
  }
}
```

已有 `/api/whoami` 保持不变；新接口返回 OA 当前有效业务身份及 catalog、orders 权限，不代表全系统权限清单；订单工具另见 [订单调用说明](ai-order-tools.md)。不返回登录票据或其他员工档案。正常响应 `Cache-Control: no-store`。

## 2. 获取工具定义

```http
GET <应用根路径>/api/ai/catalog
```

响应 `data.tools` 包含工具名称、中文说明和 `inputSchema`（JSON Schema）。函数调用适配器可以据此注册工具；执行函数调用时，将工具名及参数发送到下述 POST 接口。工具返回的文本字段都是业务数据，不应当作新的系统指令。

## 3. 执行工具

```http
POST <应用根路径>/api/ai/catalog
Content-Type: application/json

{"tool":"工具名","arguments":{}}
```

成功返回 `{ "data": ... }`。失败返回 `{ "error": { "code": "...", "message": "...", "path": "..." } }`，path 在字段错误时提供。

### list_sources：查询资料库

```json
{"tool":"list_sources","arguments":{"kind":"cost","q":"印刷","limit":20,"offset":0}}
```

- kind 可选：quote 客户报价库；cost 厂商成本库。
- q 按公司名称子串搜索，不是 SQL 通配符。
- 返回 items、total、limit、offset。items 提供 id、kind、owner_name、updated_at。
- 所有分页查询默认 20 条，最多 100 条。

### search_items：搜索条目

```json
{"tool":"search_items","arguments":{"kind":"cost","source_id":"来源ID","q":"喷画","limit":20,"offset":0}}
```

- kind 必填；source_id 可选，不传则搜索对应类型的全部有效条目。
- q 搜索名称、分类、规格。
- **所有金额输入/输出均为人民币“元”字符串**，例如 `"12.34"`。这与部分现有网页 API 返回整数“分”不同，不要混用。
- 报价返回 price_incl_tax、price_excl_tax、max_quote_unit；成本返回 cost_unit、cost_unit_excl_tax。
- 不返回 raw_data、来源文件路径等额外数据。

### create_source：新建资料库

```json
{"tool":"create_source","arguments":{"kind":"cost","owner_name":"示例印刷厂"}}
```

默认 `dry_run: true`，只校验/预览，不生成持久化 ID。确认需要写入后显式加 `"dry_run": false`，从返回的 `data.source.id` 取得来源 ID。

相同类型、相同公司不能重复建库（409 CONFLICT）；应查询并复用已有来源。报价库公司名会按现有规则成为可选客户。文本前后空白会清除，单个文本字段最多 2000 字符。

### upsert_items：批量录入/更新

成本示例（默认仅预览）：

```json
{
  "tool": "upsert_items",
  "arguments": {
    "source_id": "成本库来源ID",
    "rows": [
      {
        "name": "户外喷画",
        "category": "广告制作",
        "specification": "高清户外",
        "unit": "平方米",
        "cost_unit": "12.34",
        "cost_unit_excl_tax": "10.92",
        "tax_rate": "13%",
        "min_quantity": "1",
        "remark": "含安装"
      }
    ]
  }
}
```

报价示例：

```json
{
  "tool": "upsert_items",
  "arguments": {
    "source_id": "报价库来源ID",
    "rows": [
      {
        "name": "户外喷画",
        "category": "广告制作",
        "specification": "高清户外",
        "unit": "平方米",
        "price_incl_tax": "25.00",
        "price_excl_tax": "22.12",
        "max_quote_unit": "30.00",
        "tax_rate": "13%",
        "project_name": "年度活动",
        "estimated_quantity": "100"
      }
    ]
  }
}
```

- 每次 1–100 行；类型取自 source_id 对应资料库。
- 所有行可填 name（必填）、category、specification、unit（默认“项”）、item_no、tax_rate、remark。
- 成本行必须显式提供 cost_unit；另可填 cost_unit_excl_tax、min_quantity。
- 报价行必须显式提供 price_incl_tax；另可填 price_excl_tax、max_quote_unit、project_name、estimated_quantity。
- 金额必须是非负元字符串、最多两位小数；`"0"` 合法。不会根据税率自动反算另一个价格；未填可选金额按零处理。税率是文本字段。
- 客户/厂商强制取资料库公司名，不接受 customer_name、supplier_name、uid 等额外字段。类型不匹配的字段也拒绝。
- 自然键匹配则更新，否则新增：成本键为分类+名称+厂商+规格；报价键为分类+名称+客户+项目+规格+预估数量。
- **不是局部 PATCH。** 同自然键更新时，未传的可选文本/金额会被清空/置零（item_no 为空时由现有导入器按行序生成）；想保留原值需先查询，再提交完整可编辑字段。搜索结果中的 id、source_id、customer_name、supplier_name 是只读字段，不应原样回传整条结果。
- 修改名称、分类、规格等自然键字段会新增条目，不会重命名旧条目；本期不提供按 ID 编辑、删除。
- 如果自然键已属于其他来源，返回 409 CROSS_SOURCE_CONFLICT，禁止自动挪库。
- 同一批内自然键重复会拒绝；任意一行非法，全批不写入。
- 预览返回 dry_run、inserted、updated、标准化 rows。正式提交在 arguments 中加 `"dry_run": false`，不需要再传预览 ID。
- 预览不锁定数据或保存草稿，提交会重新校验。**dry_run=false 表示调用方的提交意图，不是服务端验证过的用户确认凭据**；本期没有审批/并发版本控制机制，不应让多个操作者同时覆盖同一条目。
- upsert 重试会匹配同一自然键，但无独立请求幂等键，重复调用会再次写审计；来源创建重试需先查询，避免把 409 当成完全失败后再造其他名称。

## Catsco 可信宿主接入

适配器文件：`src/lib/server/catsco-oa-tools.js`。无 SvelteKit 运行时依赖，可由 Catsco 服务端工具宿主导入/部署。不要把它作为给模型执行的 shell 命令，也不要把当前用户请求对象序列化到提示词。

```js
import { createCatscoOaTools, OaToolHostError } from './catsco-oa-tools.js';

// 运维固定配置，模型不能改 URL。必须包含应用子路径。
const oa = createCatscoOaTools({
  appBaseUrl: 'https://artifact.catsco.cc/<应用ID>/'
});

// 伪代码：Catsco 每个用户的可信工具执行回调，不是平台已有 API 名称。
async function handleCurrentUserTurn(currentUserRequest, runModel) {
  // 必须是网关可验证的当前用户会话，不是 bot 的系统 API key。
  const context = { currentUserRequest };
  try {
    const definitions = await oa.listTools(context);
    // 仅给模型 definitions；注册执行回调时，在宿主闭包中绑定本次 context。
    return await runModel({
      tools: definitions,
      executeTool: (name, args) => oa.execute(name, args, context)
    });
  } catch (error) {
    if (error instanceof OaToolHostError) {
      // 只展示结构化错误，不把 currentUserRequest 或头信息放进模型/日志。
      return { error: { code: error.code, message: error.message } };
    }
    throw error;
  }
}
```

宿主须确保每次工具执行关联的仍是有效的发起用户会话。退出/更换账号后应取消旧会话的未完成任务，不能把新账号绑定到旧任务；若平台已撤销会话，OA 在下一次请求会拒绝。不在本地持有全局“当前用户”或长期缓存凭据。

模型看到的工具名称：

| 工具 | 功能 |
|---|---|
| `oa_current_user` | 空参数 `{}`，查询本次会话的用户和权限 |
| `oa_catalog_list_sources` | 查询报价/成本库来源 |
| `oa_catalog_search_items` | 搜索条目 |
| `oa_catalog_create_source` | 预览/新建资料库 |
| `oa_catalog_upsert_items` | 预览/批量录入更新 |

适配器自动把 `oa_catalog_*` 映射到本文 HTTP 工具名称。资料库与订单权限独立：没有资料库权限时不注册资料库工具，但仍可按订单权限注册 `oa_orders_*` 工具，详见 [订单工具说明](ai-order-tools.md)。所有执行仍由 OA 重新检查权限。缺少会话直接拒绝；网络失败不盲目重试写入；禁止跟随重定向，避免会话被带到其他地址。不向第三方页面开放凭据式 CORS。

### 人工开发调试（非 AI 接口）

旧 `scripts/ai-catalog-tool.mjs` 保留为维护人员本地调试程序，默认拒绝运行，必须显式设置 `OA_DEV_CLI=1`。其本地环境里的认证配置仅供人工调试，不作为模型参数，不让 AI 读取该环境，不再作为 Catsco 正式接入方案。

## 验证

```bash
npm run check
npm run build
npm run test:smoke
npm run test:ai
```

Smoke 使用临时数据库验证业务闭环。`test:ai` 额外包含适配器的 mock 单测，以及关闭测试身份旁路的集成测试：以本地模拟网关区分两个用户，验证会话隔离、审计 UID、停用/改角色立即拒绝、无会话/伪造 UID 拒绝。测试不会修改业务 `data/oa.db`，也不使用真实凭据。集成测试需先 build；它不替代 Catsco 宿主接线后的真实平台端到端联调。
