# 部署、迁移与备份

## 初始化

项目通过 Artifact 网关识别访问者。复制 `.env.example` 为 `.env`，按部署环境设置监听地址、`ORIGIN`、SQLite 路径、请求体大小和 `ARTIFACT_APP_ID`。`ARTIFACT_APP_ID` 必须与发布登记的应用 id 一致；本地未配置时身份状态为 `unavailable`，不会伪装成游客。`ORIGIN` 必须与浏览器实际访问地址一致，否则 adapter-node 会拒绝 Excel 和附件表单上传：

```bash
npm ci
npm run check
npm run build
node build
```

生产环境应通过反向代理提供 HTTPS，并限制工作台只在可信内部网络访问。账户身份通过 Catsco 网关确认，UID 826 且用户名为 catsco 的开发管理员拥有固定 admin 权限；其他员工需由管理员开通。页面模式只影响界面展示，实际权限由服务端 API 校验。

## 数据库迁移

应用启动时在 SQLite 事务中自动执行显式迁移。当前版本为 23，包含订单“策划人”和“执行公司”字段、订单幂等键、员工权限，以及订单和报销的员工 UID 关联。v20 会重建相关业务表并移除旧版 `users`、`sessions` 及其关联；v21 至 v23 为增量 schema 更新。

升级前先停止应用并备份数据库和附件目录；迁移失败时恢复备份后检查日志，不要手工删除业务表。

```bash
mkdir -p backups
cp data/oa.db backups/oa-$(date +%Y%m%d-%H%M%S).db
cp -a data/attachments backups/attachments-$(date +%Y%m%d-%H%M%S)
```

SQLite 使用 WAL 时不要只复制主数据库文件。停机复制，或使用 `VACUUM main INTO` / SQLite backup API 生成一致性备份。

## 附件

附件默认保存于数据库同目录的 `attachments/`。数据库与附件目录必须一起备份和恢复。上传接口校验图片/PDF 魔数、路径和 10MB 单文件限制。

## 验证

每次发布至少执行：

```bash
npm test
```

Smoke 测试自动使用临时数据库，不会改动生产数据。迁移后还可执行 `PRAGMA foreign_key_check` 检查数据完整性，并手工验证 `GET /api/whoami`、Artifact 已登录/游客状态、填写人保存、三种模式切换、订单录入、报销打回重传和财务付款。身份判定必须留在服务端；前端显示的工作模式不是权限边界。
