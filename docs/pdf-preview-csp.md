# 页面内 PDF 预览「内容被屏蔽」：成因与修复

- 现象：在 Artifact 网关入口打开附件里的 PDF，预览区显示「内容被屏蔽」。
- 复现环境：**已部署的服务端（走 Artifact 网关）**，不是本地开发实例。
- 结论：网关注入的 CSP 未声明 `frame-src`，回退到 `default-src 'none'`，导致预览用的 `<iframe>` 被拦截。
- 处置：应用侧改为 pdf.js 渲染到 canvas，绕开 `frame-src` / `object-src`，不依赖平台改 CSP。

---

## 一、根因

网关对经它代理的**每一个**响应都注入同一条 CSP（取自真实响应头，逐字核对）：

```
default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';
connect-src https://artifact.catsco.cc/oa-order-workbench/ wss://artifact.catsco.cc/oa-order-workbench/
             https://artifact.catsco.cn/oa-order-workbench/ wss://artifact.catsco.cn/oa-order-workbench/;
img-src 'self' data: blob:; font-src 'self' data:; base-uri 'none'; form-action 'none';
worker-src 'self' blob:; object-src 'none'
```

关键点：**这条 CSP 里没有 `frame-src`**。按 CSP 规范，未声明 `frame-src` 时回退到 `default-src`，而 `default-src` 是 `'none'` —— 于是页面内**任何 iframe 都无法加载**。原实现正是「用 iframe 加载 PDF blob」，因此在加载阶段被浏览器拦下。

浏览器控制台的原话：

```
Framing 'blob:...' violates the following Content Security Policy directive:
"default-src 'none'". The request has been blocked. Note that 'frame-src' was not explicitly set
```

CSP 只能收紧、不能放宽，多条 CSP 取交集，所以应用自己再声明宽松 CSP 也无法覆盖网关注入的那条。

## 二、为什么图片附件不受影响

CSP 里 `img-src 'self' data: blob:` 明确允许 blob，图片用 `<img>` 渲染不走 iframe，因此正常。只有 PDF 这条 iframe 路径被拦。

## 三、修复（应用侧，路径 B）

把 PDF 预览从 `<iframe>` 改为用 **pdf.js 画到 canvas**：

- `src/lib/components/order-desk/AttachmentPreviewModal.svelte`：动态 `import('pdfjs-dist')`，逐页 `getDocument` → `page.render` 到 `<canvas>`；带渲染进度与失败兜底；关闭/切换时 `destroy()`。
- `src/lib/components/order-desk/orderDeskState.svelte.ts`：新增 `attachmentPreviewBlob`，在线与本地文件两种入口都保存 Blob，pdf.js 直接取 `arrayBuffer()`，不再二次请求。
- `src/lib/api.ts`：新增 `appBaseUrl()`，返回**带网关前缀的绝对地址**。pdf.js 在 worker 里按「目录 + 文件名」请求 cMap / 标准字体，必须用绝对地址。这些请求的目标是 `<前缀>/pdfjs/...`，落在网关 CSP 的 `connect-src <前缀>/` 允许范围内。
- `scripts/sync-pdfjs-assets.mjs` + `package.json` 的 `predev` / `prebuild`：把 `pdfjs-dist/cmaps`、`pdfjs-dist/standard_fonts`（约 2.5MB）复制到 `static/pdfjs/`；该目录进 `.gitignore`，不进 Git。
- 新增依赖 `pdfjs-dist@^4.10.38`。
- 网关上对 PDF 隐藏「新窗口打开」：该路径同样受 `object-src 'none'` 限制，避免用户再次看到「内容被屏蔽」；「下载附件」始终保留。

## 四、验证

搭建**模拟网关**：应用挂在 `/oa-order-workbench/` 前缀下，代理剥离前缀并注入与真实网关逐字一致的 CSP；用无头 Chromium 走「选择 PDF → 页面内预览」：

```
hasIframe: false
canvasWidth: 863  canvasHeight: 1116  nonWhitePixels: 1901
errorShown: false
CSP 相关控制台消息: 0 条
PASS: PDF 在网关 CSP 下通过 pdf.js canvas 正常渲染
```

同样的 `default-src 'none'` / 无 `frame-src` / `object-src 'none'` 条件下，PDF 已能渲染，且不再触发 iframe 拦截。

其他检查：`npm run check` 0 error / 0 warning；`npm run build` 通过；`npm run test:smoke` 全绿。

## 五、上线与边界

- `npm ci && npm run build` 自动执行 `prebuild` 同步 pdf.js 资源，无需手工步骤；产物多出 `build/client/pdfjs/`（约 2.5MB）。
- 不依赖平台改 CSP，网关与直连两条入口都可用。
- `appBaseUrl()` 沿用既有的 `APP_ROUTE_SEGMENTS` 白名单推导应用前缀，与 `bugs.md` 的 D1 是同一处隐患：将来新增顶级路由时需同步维护该集合。当前 PDF 预览只在订单/报销等已有路由内触发，不受影响。
- 备选方案（平台侧）：给网关 CSP 补 `frame-src 'self' blob:`（必要时再放开 `object-src`），可治本且不改应用；本次未采用，因为平台侧改动不在本仓库范围。
