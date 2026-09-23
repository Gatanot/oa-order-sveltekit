# Artifact 访问者身份识别与权限控制修正指南

**核对说明**：本文件已逐条对照 `skills/artifact-publish/SKILL.md` 正文（189 行，md5 `b38eccbe4e9ba6bdc646ff8bc693b0b8`）核对。全文标注两种来源：

- **【契约】** 直接来自 Skill 正文，可直接依赖；
- **【建议】** 实践建议，正文未规定，可按项目调整。

---

## 0. 适用范围【契约】

- **适用**：把本机运行的前后端应用发布成固定公网地址，并让应用识别访问者身份用于权限控制；查询、修改、下架自己已发布的应用。
- **不适用**：静态网页托管；需要公网 IP 或开放入站端口的环境。

---

## 1. 会得到什么【契约】

```
本机 127.0.0.1:<本地端口>   →   https://artifact.catsco.cc/<应用id>/
                                https://artifact.catsco.cn/<应用id>/   （同一份，双域名）
```

不需要 root、不需要公网 IP、不需要在网关机器上改任何配置 —— 应用自己发起**出站**连接，网关把公网请求转进来。

数据完全留在本机（JSON / JSONL / SQLite 都行），网关只登记路由，不碰业务数据。

---

## 2. 前提【契约】

| 需要 | 说明 |
| --- | --- |
| node | ≥ 20 |
| ssh 客户端 | 系统自带即可（连接器用它建隧道） |
| `ws` 依赖 | 在 `<SKILL_DIR>/connector/` 跑一次 `npm install --omit=dev` |
| 发布凭据 | 环境变量 `CATSCOMPANY_API_KEY`（**bot 自己的平台 key**，平台创建 bot 时下发，不用手工填） |
| 网关主机公钥 | 已内置：`<SKILL_DIR>/connector/gateway_host.pub`（用来钉住隧道对端） |

**应用 id 规则**：`^[a-z][a-z0-9_-]{0,47}$` —— 小写字母开头，只能用字母/数字/下划线/连字符。它就是 URL 里的路径段。

---

## 3. 四步发布【契约】

### 3.1 起本地服务

应用监听 `127.0.0.1:<本地端口>`，提供页面和（可选的）`/api/*`。记下这个端口。

### 3.2 生成密钥（端口先不用定）

```sh
cd <SKILL_DIR>/connector && npm install --omit=dev

node init-connector.mjs <状态目录> <应用id> artifact.catsco.cc 22443 \
  auto <本地端口> <SKILL_DIR>/connector/gateway_host.pub \
  wss://artifact.catsco.cc/_gateway/tunnel \
  --agent $CATSCOMPANY_BOT_UID --title "显示名"
```

`auto` 表示"远端端口由网关分配"：这一步只生成密钥并**报出 `publicKey`**，不写连接器配置。把输出的 `publicKey` 抄下来。

### 3.3 发布

```sh
curl -sS -X POST "$CATSCOMPANY_HTTP_BASE_URL/api/artifacts/apps" \
  -H "Authorization: ApiKey $CATSCOMPANY_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"id":"<应用id>","title":"显示名",
       "publicKey":"<第 2 步报出的 publicKey>","localPort":<本地端口>}'
```

成功返回 `201`：

```json
{ "status": "registered", "id": "...", "agent": "...",
  "remote_port": 28201,
  "url": "https://artifact.catsco.cc/<应用id>/",
  "urls": ["https://artifact.catsco.cc/<应用id>/", "https://artifact.catsco.cn/<应用id>/"],
  "transport_url": "wss://artifact.catsco.cc/_gateway/tunnel" }
```

**记下 `remote_port`。**

### 3.4 收尾并起连接器

```sh
node init-connector.mjs <状态目录> <应用id> artifact.catsco.cc 22443 \
  <remote_port> <本地端口> <SKILL_DIR>/connector/gateway_host.pub \
  wss://artifact.catsco.cc/_gateway/tunnel \
  --agent $CATSCOMPANY_BOT_UID --title "显示名"

node connector.mjs <状态目录>/connector.json
```

连接器常驻（掉线会自动重连）。之后 `https://artifact.catsco.cc/<应用id>/` 就能打开了。

### 3.5 归属规则

归属自动取凭据对应的账号，不要也不能自己指定：

- 用 **bot 自己的 key**（`CATSCOMPANY_API_KEY`）发布 → 归**这个 bot** → 出现在**它自己的侧栏**里；
- 用某个人的登录态发布 → 归**那个人** → **任何 bot 的侧栏都看不到**（侧栏按 bot 的 uid 查）。

所以要"从侧栏能打开"，就必须用 bot 的 key 发布。

---

## 4. 管理自己已发布的应用【契约】

| 操作 | 命令 |
| --- | --- |
| 列出自己的 | `curl -sS "$CATSCOMPANY_HTTP_BASE_URL/api/artifacts/apps" -H "Authorization: ApiKey $CATSCOMPANY_API_KEY"` |
| 查看单个 | 同上，路径加 `/<应用id>` |
| 改名 | 再 POST 一次同一个 id，**带上你自己的公钥**（见下） |
| 换本地端口 | 再 POST，带新的 `localPort`（公钥同样要带） |
| 轮换密钥 | 生成新密钥后 POST，带**新的** `publicKey` |
| 下架 | `curl -sS -X DELETE "$CATSCOMPANY_HTTP_BASE_URL/api/artifacts/apps/<应用id>" -H "Authorization: ApiKey $CATSCOMPANY_API_KEY"` |

三条规则：

1. **改 = 再 POST 一次同一个 id**（不是另一个接口）。同 id 就是更新。
2. **要带上你现有的公钥**：它就在你的状态目录里（`<状态目录>/id_ed25519.pub`），自己随时能读。
   - 带的是**原来那把** → 密钥不变，只是改了别的字段；
   - 带的是**新生成那把** → 等于轮换密钥，**正在跑的连接器会断开重连**；
   - ⚠️ 目前**必须带**：不带会被拒（`artifact_app_key_invalid`）。"不传就沿用原配"这个便利还在评审中，上线后可以省略。
3. **远端端口、归属、应用 id 都改不了**：远端端口更新时保持不变（换了会断隧道），归属看凭据，换 id 等于新建。

---

## 5. 下架的真相【契约】

下架**只移除网关侧路由**，公网立刻 404。但：

- 你本机那个连接器进程**不会自己退出**，它会重连；
- 重连时它的公钥已经被移出 `authorized_keys`，所以会被拒（`Permission denied`）；
- 连接器把这个当**致命错误**处理：状态变 `blocked` 并**退出**（exit code 78）。

所以"下架"的实际效果是：**路由立即消失，隧道在下一次断开后不会再起来**。要立刻停服，自己把 `connector.mjs` 进程停掉。

---

## 6. 让应用识别访问者【契约】

应用**不解析任何票据**，只把浏览器带来的凭据原样转发给网关，读结论：

```js
// 应用后端，任意请求里
const me = await fetch(`https://artifact.catsco.cc/_gateway/me?app=${APP_ID}`, {
  headers: {
    cookie: req.headers.cookie || '',
    authorization: req.headers.authorization || '',
  },
}).then(r => r.json());
```

返回样例：

```json
{ "authenticated": true,
  "viewer": { "id": "ap_c2lCBwUAH4EPquaUMbXpF-", "uid": 116, "username": "Lin", "kind": "user" },
  "app_id": "my-board", "topic_id": "grp_4133", "expires_at": "..." }
```

正文明确说明用途的字段：

| 字段 | 用途 |
| --- | --- |
| `viewer.id` | **应用内稳定伪名**，同一用户在你的应用里永远同一个值、跨应用对不上 → **当本地 ACL 主键** |
| `viewer.username` / `viewer.uid` | 平台账号标识；跨应用可关联，需要显示账号名时用 |
| `topic_id` | 从哪个会话进来的（直接开网址时为 `null`） |
| `authenticated: false` | 游客，`viewer` 为 `null` |

正文只给出样例、**未在字段表中定义用途**的字段（不要自行约定语义）：

- `viewer.kind`：样例里是 `"user"`，正文未说明取值集合与用途；
- `app_id`：样例里回显应用 id，正文未说明用途；
- `expires_at`：样例里是 `"..."`，正文未说明有效期规则。

**判定放后端**（前端可被改），未知身份**降级**而不是当管理员：

```js
const viewer = me.authenticated ? me.viewer : null;
if (!viewer)                  return renderGuest();
if (await isOwner(viewer.id)) return renderAdmin(viewer.username);
return renderReadOnly();
```

---

## 7. 应用侧接入清单

### 7.1 路径与入口【契约】

- [ ] 页面里的请求**用相对路径**：写 `fetch('api/whoami')`，**不要**写 `fetch('/api/whoami')` —— 会打到网关根，且不在页面 CSP 的 `connect-src` 范围内，浏览器报 `Failed to fetch`。
- [ ] 只有跳 `/_auth/start`、`/_launch/<code>` 这类**网关控制面**地址才用绝对路径。
- [ ] **三条入口**：侧栏点开 / 直接粘网址 / 都没有时顶层跳一次 `/_auth/start` 握手。
- [ ] **不要在 iframe 里发起握手**（会把登录页塞进小框），框里没身份就提示用「新页面打开」。

### 7.2 身份接口【建议】

正文只给了"转发凭据取结论"和"判定放后端"的片段；下面是把两者接起来的常规写法：

```js
app.get('/api/whoami', async (req, res) => {
  const raw = await fetch(`https://artifact.catsco.cc/_gateway/me?app=${APP_ID}`, {
    headers: {
      cookie: req.headers.cookie || '',
      authorization: req.headers.authorization || '',
    },
  }).then(r => r.json());

  const viewer = raw.authenticated ? raw.viewer : null;
  if (!viewer) return res.json({ authenticated: false, role: 'guest' });

  await upsertLocalUser(viewer.id, viewer.username);
  res.json({
    authenticated: true,
    name: viewer.username,
    role: await roleOf(viewer.id),
  });
});
```

### 7.3 权限落地【建议】

- [ ] 每个受保护接口先取 `viewer.id`，再查本地角色表；无角色即只读或拒绝；
- [ ] 数据表用 `viewer.id` 做归属列，实现"只看自己的数据"；
- [ ] 角色表放本机存储（JSON / SQLite），不信任前端传来的角色；
- [ ] 操作日志同时写 `viewer.id` 与 `topic_id`，便于回溯从哪个会话进来；
- [ ] 前端只拿展示所需字段，不把网关原始响应整体回传。

---

## 8. 权限模型【建议】

| 角色 | 判定依据 | 能力 |
| --- | --- | --- |
| owner | 首次发布者 / 显式指定 `viewer.id` | 全部，含改权限 |
| editor | 本地角色表 | 读写业务数据 |
| viewer | 已登录但无角色 | 只读 |
| guest | `authenticated: false` | 仅公开内容 |

两条关键认知：

- **应用地址是公开可达的**（【契约】）。侧栏列表只影响"显示什么"，**不是权限边界** —— 要控权限就在应用内部用 `viewer.id` 做。
- 冷启动时还没有角色数据：把**发布者本人**初始化为 owner，其余一律 guest / 只读，再由 owner 在应用内授权。

---

## 9. 坑【契约，均为正文原列】

1. **页面里的请求用相对路径**，写错直接 `Failed to fetch`。
2. **三条入口都要有**，且不要在 iframe 里发起握手。
3. **网关故障不等于没身份**：平台不可达时网关返回的是**游客**。别把"游客"和"身份服务坏了"混为一谈。
4. **`gateway_host.pub` 是钉住隧道对端的**（防中间人）。文件变了要显式轮换，不要自动覆盖。
5. **应用地址是公开可达的**，侧栏列表不是权限边界。

---

## 10. 验证【契约】

```sh
APP=<应用id>
# 1) 两个域名都可达
for H in artifact.catsco.cc artifact.catsco.cn; do
  printf '%s → %s\n' "$H" "$(curl -s -o /dev/null -w '%{http_code}' "https://$H/$APP/")"
done
# 2) 身份端点如实回答（不带凭据时是游客，不是报错）
curl -s "https://artifact.catsco.cc/_gateway/me?app=$APP"
# 3) 带凭据时能识别出账号名和 uid
# 4) 已登录与未登录看到的内容不同 ← 这才是权限真的生效
```

路由通了但应用没起（连接器没跑）：`/<应用id>/` 会返回 **502** —— 那是"路通了、屋里没人"，不是配置错。

补充检查项【建议】：未登录直接访问受保护接口应被拒。

---

## 11. 安全红线

【契约】

- 应用**不解析、不验签**任何票据，只做凭据转发 → 结论；
- 未知身份**降级**，不当管理员；
- 权限判定放后端，前端可被改；
- 侧栏可见性不是权限边界。

【建议】

- 网关身份结论与原始响应不要长期缓存或整体下发给页面；
- 本地用户表只存 `viewer.id` 与显示名，不把身份结论当长期凭证；
- 平台凭据（`CATSCOMPANY_API_KEY`）只用于发布与管理接口，不下发给应用页面。

---

## 12. 权威契约与核对记录

正文结语：完整字段、错误码、权限示例见仓库文档 `docs/ARTIFACT-API.md`（网关仓库 `buildsense-ai/catsco-artifact-gateway`）。**本 Skill 与它同源；冲突时以 Skill 本文档为准。**

核对记录：

- 核对对象：`/home/xiaoba/app/skills/artifact-publish/SKILL.md`，189 行，md5 `b38eccbe4e9ba6bdc646ff8bc693b0b8`；
- 安装来源：SkillHub `yii/artifact-publish` v1.0.1，签名 keyId `catsco-skillhub-prod-2026-07-30`，包 sha256 `0969464b…96fa327`；
- 技能目录仅含 `SKILL.md` 与 `connector/`（config.mjs、connector.mjs、gateway_host.pub、init-connector.mjs、package.json、package-lock.json、ws-proxy.mjs），无额外参考文档；
- 网关仓库文档未在本机，`docs/ARTIFACT-API.md` 的完整字段与错误码待线上核对。
