# oa-order-sveltekit 路径前缀问题调查报告

- 调查对象仓库：`https://github.com/Gatanot/oa-order-sveltekit`
- 调查基线：最新提交 `48a5c7f6d8e7be832b9e701bbdd63f9622e25792`（feat: 完善额外身份权限并统一中文界面，2026-09-28）
- 调查方式：只读静态排查 + 独立目录内的浏览器实测复现。未修改仓库源码。
- 报告结论：本类问题共发现 **3 类、9 处**，其中 6 处已用真实浏览器复现，其余为代码级判定。

---

## 一、为什么「本地正常、部署后异常」

应用被发布到 Artifact 网关后，浏览器地址是：

```
https://artifact.catsco.cc/oa-order-workbench/admin
                            └──── 路径前缀 ────┘
```

网关在转发给应用之前会**剥掉这段前缀**，所以应用服务端看到的路径是 `/admin`：

| 视角 | 看到的路径 |
| --- | --- |
| 浏览器 | `/oa-order-workbench/admin` |
| 网关转发后应用服务端 | `/admin` |

而本地开发时浏览器地址是 `http://localhost:5173/admin`，**没有前缀**。

这个差异本身没有问题，问题出在代码里对路径的两种写法：**相对路径的层数**、**根绝对路径**。二者在「无前缀」下都恰好正确，加了前缀就错位。

---

## 二、成因机制

### 机制 1：`../` 会多退一层，把前缀退掉

浏览器解析相对链接的规则（RFC 3986 §5.3）：先取当前路径的**目录部分**（去掉最后一段），再拼接相对路径，最后消掉 `.` 和 `..`。

以 `href="../employees"` 为例：

- 本地：当前 `/admin` → 目录 `/` → 拼成 `/../employees` → 消解为 **`/employees`** ✅
- 部署：当前 `/oa-order-workbench/admin` → 目录 `/oa-order-workbench/` → 拼成 `/oa-order-workbench/../employees` → `..` 把 `oa-order-workbench` 消掉 → 消解为 **`/employees`** ❌

`/employees` 在网关上是根路径，没有注册任何应用，于是跳出了工作台。

**规律：只要应用被挂在路径前缀下，`../` 的层数就会比预期多算一层。** 深度为 1 的路由（`/admin`、`/employees`）应使用 `./` 而不是 `../`。

### 机制 2：以 `/` 开头的根绝对路径会直接丢掉前缀

`redirect(303, '/orders')` 这类写法，服务端发出的响应头是 `Location: /orders`。浏览器按「相对协议+主机的绝对路径」解析，即 `https://artifact.catsco.cc/orders` —— 前缀被整段丢弃。

关键点是：**服务端根本不知道前缀存在**（网关已把它剥掉），所以任何由服务端生成的绝对路径都无法自带前缀。

这类问题上游自己已经踩过一次并在 `c8731411`（fix: align Artifact deployment paths）修过首页跳转，把 `redirect(303, '/orders')` 改成了 `redirect(303, './orders')`；但 `admin` 页的两个表单动作仍然是绝对路径，属于同一问题的残留。

### 机制 3：`./` 在深层路由下也不安全

`./x` 的语义是「当前目录下的 x」。当前目录 = 去掉最后一段。

- 在 `/oa-order-workbench/orders/<id>/edit` 下，`./orders` → `/oa-order-workbench/orders/<id>/orders`（错）
- 在 `/oa-order-workbench/admin` 下，`./orders` → `/oa-order-workbench/orders`（对）

所以 `./` 只适用于深度为 1 的路由；深层页面的跨模块跳转需要别的手段。

---

## 三、问题清单

### A 类：`../` 相对链接多退一层（已浏览器实测复现）

| # | 位置 | 写法 | 无前缀结果 | 带前缀结果 | 严重度 |
| --- | --- | --- | --- | --- | --- |
| A1 | `src/routes/admin/+page.svelte:19` | `href="../orders"` | `/orders` ✅ | `/orders` ❌ | 高 |
| A2 | `src/routes/admin/+page.svelte:111` | `href="../employees"` | `/employees` ✅ | `/employees` ❌ | 高 |
| A3 | `src/routes/admin/+page.svelte:111` | `href="../catalog"` | `/catalog` ✅ | `/catalog` ❌ | 高 |
| A4 | `src/routes/admin/+page.svelte:111` | `href="../orders"` | `/orders` ✅ | `/orders` ❌ | 高 |
| A5 | `src/routes/admin/+page.svelte:111` | `href="../reimbursements"` | `/reimbursements` ✅ | `/reimbursements` ❌ | 高 |
| A6 | `src/routes/employees/+page.svelte:51` | `href="../orders"` | `/orders` ✅ | `/orders` ❌ | 高 |

实测输出（浏览器点击，非推断）：

```
[带前缀] 起始=http://127.0.0.1:19851/oa-order-workbench/admin
[带前缀] href属性=../employees
[带前缀] 点击后=http://127.0.0.1:19851/employees          ← 前缀丢失

[无前缀] 起始=http://127.0.0.1:19850/admin
[无前缀] href属性=../employees
[无前缀] 点击后=http://127.0.0.1:19850/employees          ← 正确
```

服务端渲染出的原始 HTML 也印证了这一点：

```html
href="../orders"
href="../employees"
href="../catalog"
href="../orders"
href="../reimbursements"
```

### B 类：表单动作使用根绝对路径跳转（代码级判定）

| # | 位置 | 写法 | 影响 |
| --- | --- | --- | --- |
| B1 | `src/routes/admin/+page.server.ts:23` | `throw redirect(303, '/orders')` | 「保存额外业务身份」提交后跳出工作台 |
| B2 | `src/routes/admin/+page.server.ts:31` | `throw redirect(303, '/admin')` | 「移除额外身份」提交后跳出工作台 |

说明：服务端发出的 `Location` 是字面量 `/orders`，浏览器解析为站点根路径。由于网关已剥离前缀，服务端无法自行补上前缀，因此这类绝对 `Location` 在带前缀部署下必然指向应用外部。

旁证：上游在 `c8731411` 中正是为了修掉同一模式（首页 `redirect(303, '/orders')` → `'./orders'`），提交标题为「align Artifact deployment paths」。`admin` 页这两处是该次修复的遗漏。

### C 类：错误页相对链接在深层路由下偏移（代码级判定）

| # | 位置 | 写法 | 说明 |
| --- | --- | --- | --- |
| C1 | `src/routes/+error.svelte:10` | `href="./orders"` | 在 `/admin`、`/catalog` 等深度为 1 的页面出错时正确；但在 `/orders/<id>/edit` 等深层路径出错时会解析成 `/orders/<id>/orders`，指向不存在的地址 |

### D 类：路径深度计算依赖硬编码白名单（隐患）

| # | 位置 | 说明 |
| --- | --- | --- |
| D1 | `src/lib/api.ts:3` | `APP_ROUTE_SEGMENTS = new Set(['orders','reimbursements','catalog','admin','employees','api'])` |

`appPath()` / `currentAppPath()` 通过「在 URL 段里查找第一个属于该集合的段」来判断应用根位置。新增路由（例如 `/reports`、`/settings`）若未同步加入集合，`findIndex` 返回 `-1`，`routeDepth` 记为 0，`appPath()` 会返回不带 `../` 的路径，导致在深层路由或带前缀场景下请求到错误地址。

这不是当前已发生的故障，而是**每次新增顶级路由都可能踩中的隐患**，且失败时表现为静默错地址，不易排查。

### E 类：网关控制面绝对路径（有意为之，但有前提）

| # | 位置 | 写法 | 说明 |
| --- | --- | --- | --- |
| E1 | `src/lib/components/order-desk/orderDeskState.svelte.ts:490` | `window.location.assign("/_auth/start")` | `/_auth/start` 是 Artifact 网关的登录握手端点，必须是根绝对路径 |
| E2 | `src/lib/components/order-desk/OrderDeskSidebar.svelte:22` | `href="/_auth/start"` | 同上，需 `target="_blank"` 在新窗口完成登录 |

这两处写法正确，但**只在网关域名下成立**。代码已用 `isArtifactGatewayHost()`（判断 hostname 是否为 `artifact.catsco.cc` / `.cn`）限制触发，避免了在直连域名下跳到不存在的路径。需要注意：该判断依赖主机名白名单，若将来更换发布域名，这两处会失效。

---

## 四、已正确处理的部分（对照参考）

以下写法经排查没有前缀问题，可作为改造范本：

| 位置 | 做法 |
| --- | --- |
| `src/lib/api.ts:21` | `fetch(appPath(path))` —— 统一包装所有 `api.get/post/patch/delete` 请求 |
| `orderDeskState.svelte.ts:8` | `apiFetch` 对字符串入参走 `appPath()` |
| `orderDeskState.svelte.ts:636 / 1121 / 1273 / 1282` | `pushState(appPath(...))`、`replaceState(appPath(...))` |
| `orderDeskState.svelte.ts:801 / 827 / 1463` | `window.location.href = appPath(...)`（导出下载） |
| `ReimbursementReview.svelte:150` | `href={appPath(...)}`（单据下载链接） |
| `src/routes/+page.server.ts:5` | `redirect(303, './orders')` —— 服务端用相对 Location |
| `AttachmentPreviewModal.svelte` | 预览用 `URL.createObjectURL(blob)`，不涉及路径 |
| `admin/+page.svelte:34/45/78/96` | 表单 `action="?/xxx"`，查询串形式与路径无关 |

结论：**客户端的动态跳转基本都已收口到 `appPath()`，问题集中在「模板里手写的静态链接」和「服务端 redirect 的绝对路径」两类**。

---

## 五、修复方向建议（未代为修改）

按优先级：

1. **A 类（6 处静态链接）**：深度为 1 的路由（`/admin`、`/employees`）把 `../x` 改为 `./x`。改动小、无副作用、本地与带前缀两种场景都正确。
2. **B 类（2 处服务端 redirect）**：改为相对 Location。表单动作提交地址是 `/<prefix>/admin?/saveExtraIdentity`，服务端返回相对路径时浏览器会以当前页面为基准解析，从而保留前缀。注意不要改成 `/orders` 之外的另一种绝对写法。
3. **C 类**：错误页可改为不依赖相对层级的方式（例如由客户端脚本按 `currentAppPath()` 计算，或统一指向应用根）。当前风险较低，可延后。
4. **D 类**：建议把「应用根位置」的判定从白名单改为更稳的推导（例如由构建期注入基路径、或按已知前缀长度计算），并在新增顶级路由时同步维护该集合。
5. **E 类**：保持现状，但更换发布域名时需要同步更新主机名白名单。

更彻底的做法是在 SvelteKit 配置里显式声明基路径（`kit.paths.base`），让框架统一处理前后端所有路径。但本项目同时存在「带前缀（网关）」与「无前缀（本地/直连）」两种访问方式，静态 base 无法同时满足，需要按环境注入，改动面更大，建议作为中期方案。

---

## 六、回归自查清单

每次新增页面或跳转时，按此清单检查：

- [ ] 模板里的 `href` 是否使用了 `../` —— 深度为 1 的页面不应出现 `../`
- [ ] 服务端 `redirect()` 的第二个参数是否以 `/` 开头 —— 应改为相对写法
- [ ] 新增顶级路由是否已加入 `api.ts` 的 `APP_ROUTE_SEGMENTS`
- [ ] 客户端跳转是否走 `appPath()` / `apiFetch`，而非裸 `fetch('/api/...')`
- [ ] 绝对路径是否确实属于网关控制面（`/_auth/start` 等）
- [ ] 是否在「带前缀」与「无前缀」两种环境下各点一遍受影响页面

推荐的验证方式：本地起一个会剥离前缀的反向代理，把应用挂在 `/<应用id>/` 下访问，再走一遍主要跳转路径。这样能在提交前暴露本类问题，不必等到部署后才发现。

---

## 七、证据与复现环境

- 复现方式：把应用挂在本地模拟网关上（`/oa-order-workbench/` 前缀，转发前剥离），用无头浏览器点击真实链接，观察跳转后的 URL；同一操作在无前缀直连环境下做对照。
- 数据库使用生产库的**副本**，未触碰生产数据。
- 结论仅针对上述提交 `48a5c7f6d`；上游后续提交可能已改动相关文件，使用前请重新核对行号。
