# SQLite 与阿里云 OSS 接入

代码支持本地图片和 OSS 两种模式；默认本地，无需云账号也能启动。尚未对你的真实阿里云账号、域名、CDN 或微信环境进行联调。上线时按本文逐项验证。

## 1. 数据库

需要 Node.js 22.13 或更新的受支持版本。使用内置 SQLite，无需安装 MySQL。

- 首次启动自动把 `DATA_DIR/portfolio.json` 导入 `portfolio.sqlite`，保留旧 JSON 不动。之后以 SQLite 为准，不再同步旧 JSON。
- 作品、顺序、系列、设置、图片存储位置分别保存；修改在事务中提交，启用 WAL。
- 管理员密码哈希仍在 `admin.json`，不迁移明文密码。会话仍在内存中，重启需重新登录。
- 每个数据目录仅允许运行一个网站或迁移进程。不要使用 PM2 cluster、多副本容器或网络共享盘承载同一个库。
- `.writer.lock` 防止同时运行。正常退出释放；意外退出后会检查旧进程是否存在。若提示锁损坏，确认服务已停止后再处理锁文件。

## 2. 开通 OSS 并配置域名

1. 创建标准存储 Bucket，保持**私有读写**。建议选择接近网站服务器及主要访客的地域；常用展示图片不要放归档存储。
2. 准备绑定到 OSS 的 HTTPS 子域名，如 `img.example.com`。完成域名绑定、解析和证书配置；使用中国内地资源时先按阿里云要求完成域名备案。
3. 创建专用 RAM 身份。权限只覆盖该 Bucket 的 `portfolio/*`：`oss:PutObject`、`oss:GetObject`、`oss:DeleteObject`、`oss:PutObjectAcl`。SDK 的 HeadObject 使用 GetObject 权限；不需要授予整个阿里云账号的管理权限。若修改 `OSS_PREFIX`，相应修改授权路径。
4. 在 Bucket 配置 CORS：来源为网站的 HTTPS 根地址，允许 `GET`、`HEAD`，允许请求头 `*`，暴露 `ETag`。全景 WebGL 和分享图片加载需要跨域许可。使用 CDN 时也要配置相同的跨域响应规则。
5. 防盗链白名单填网站域名及图片域名；若希望微信等无 Referer 的客户端抓取分享卡片，允许空 Referer。访问权限仍由私有 Bucket 和签名控制，不能仅依赖 Referer。

把 `.env.example` 复制为 `.env`，填写：

```dotenv
STORAGE_PROVIDER=oss
PUBLIC_BASE_URL=https://www.example.com
OSS_REGION=oss-cn-hangzhou
OSS_BUCKET=你的bucket名称
OSS_ACCESS_KEY_ID=专用RAM身份的AccessKeyId
OSS_ACCESS_KEY_SECRET=对应的AccessKeySecret
OSS_PUBLIC_BASE_URL=https://img.example.com
OSS_PREFIX=portfolio
OSS_URL_TTL=300
```

密钥只在服务器配置，不粘贴到前台或后台表单、不提交 Git。`.env` 已被忽略。Docker Compose 会传入这些变量；非 Docker 使用 `npm start` 会读取 `.env`。

默认服务器也通过 `OSS_PUBLIC_BASE_URL` 请求 OSS，使用官方 SDK V4 签名。如果服务器与 Bucket 在阿里云同地域，可设置 `OSS_ENDPOINT=https://oss-cn-hangzhou-internal.aliyuncs.com` 使用内网；访客签名链接始终使用公开自定义域名，不会跳到内网。

`OSS_STS_TOKEN` 为可选临时凭证；当前不会自动刷新，使用时需在凭证过期前更新环境变量并重启。长期部署可使用上述专用 RAM 身份，定期轮换密钥。

## 3. 图片访问与保护

- 上传后仍转为 WebP、限制尺寸、移除 EXIF。新图片写入 `portfolio/private/`，服务器不保留一份永久上传副本。
- 访问 `/media/:id/...` 时先检查发布状态，按网站保护设置生成展示图，随后返回指向 `portfolio/display/` 的短期签名链接。浏览器直接从 OSS/CDN 取图。
- 服务器的展示缓存仍有 512 MiB 上限；后台缩略图通过登录校验后由服务器读取。底图不会出现在公开接口的图片链接中。
- 全景、个人照片、横版分享卡片、竖版分享海报都支持 OSS。二维码、作品永久链接和分享入口仍使用网站域名，避免在页面元信息中留下过期链接。
- 草稿、删除作品不再签发新链接。已经发出的 OSS 链接默认最多有效 300 秒，浏览器缓存或已保存的图片无法撤回。CDN 有效期由 CDN 控制台决定。
- `portfolio/display/` 是可再生缓存，可以配置 7 天生命周期过期；**不要把过期规则应用到 `portfolio/private/`**。实际存储费、请求费、外网流量与回源费以阿里云账单为准。

## 4. 把已有图片迁到 OSS

先导出完整备份，再**停止网站服务**。环境变量的 `DATA_DIR` 必须指向原来的数据目录。

```sh
# 只查看引用文件数量，不上传
npm run storage:migrate

# 上传、下载校验 SHA-256，校验通过才切换记录；默认保留本地副本
npm run storage:migrate -- --apply

# 确认云端浏览和独立备份都正常后，再停服执行；逐个重新校验后移除本地副本
npm run storage:migrate -- --apply --remove-local
```

中断后可以重跑；已迁移的对象不会重复建立记录。旧文件与新 OSS 文件可以共存。切勿在迁移过程中修改或替换本地图片。

Docker 示例（沿用 compose 中的命名卷）：

```sh
docker compose stop portfolio
docker compose run --rm portfolio node scripts/migrate-storage.mjs --apply
docker compose up -d
```

更换 Bucket、地域，或把已有 OSS 作品库直接改成 `local`，启动会被拒绝，避免静默读取旧的本地副本。要恢复本地模式，使用下一节的完整备份还原到新数据目录。

## 5. 后台状态与备份

后台「存储与备份」提供：

| 接口 | 作用 |
|---|---|
| `GET /api/admin/storage` | SQLite、本地/OSS 模式、已登记 OSS 用量、待清理数量；不返回密钥 |
| `POST /api/admin/storage/check` | 写入临时探针、读取校验、删除探针；只验证服务器读写，不替代浏览器 CORS/CDN 验证 |
| `POST /api/admin/storage/retry-deletes` | 重试已删除作品的失败文件清理 |
| `GET /api/admin/backup` | 完整备份，包含 SQLite、通用 JSON、全部引用图片及个人照片 |

这些接口都需要后台登录，写操作还校验本站来源。备份不包含密码、云密钥或相机原片。

备份期间暂时不能修改作品。云端图片会下载到服务器临时目录后压缩输出，需留出接近作品库总大小的临时磁盘空间，并可能产生 OSS 下载流量。不要把“迁到 OSS”当作独立备份；完成后将压缩包存到其他设备。

恢复时停止服务，把压缩包解压到**全新的数据目录**，设置 `STORAGE_PROVIDER=local` 后启动。不依赖原 OSS Bucket 即可恢复；新目录需重新设置管理员密码。不要覆盖运行中的 `.sqlite`，也不要混入旧的 `-wal`、`-shm` 文件。

后台 OSS 用量只统计本站登记的作品文件，不包括云端展示缓存、历史版本或未完成请求留下的孤立对象。可在阿里云查看实际用量；若启用版本控制，另外管理历史版本生命周期。

## 6. 可选 CDN

先验证 OSS 直连，再启用 CDN：

1. 添加图片加速域名，源站选择 OSS Bucket，并开启私有 Bucket 回源授权。
2. 全路径开启 **A 类型 URL 鉴权**，控制台有效时长设为 **300 秒**。不能仅给展示路径开启鉴权后让其他路径公开。
3. 开启 HTTPS，配置 CORS，缓存键忽略 `auth_key`（但每次访问仍需先鉴权）。展示文件名包含内容摘要，可设置缓存规则；水印/图片变更会使用新对象名。
4. 在 `.env` 填入 `CDN_BASE_URL=https://cdn.example.com`、`CDN_AUTH_KEY=控制台配置的鉴权密钥`，重启网站。
5. 验证无签名、篡改路径、过期签名均被拒绝；确认全景和微信抓图正常。`OSS_URL_TTL` 不控制 CDN 的有效时长。

代码只为展示图签发 CDN URL，绝不为私有底图签发公开链接。不要把 CDN 配成不鉴权的整个 Bucket 镜像。

## 7. 上线验收

1. 后台检查存储连接通过；上传一张照片和一张 2:1 全景，刷新及重启后仍能编辑。
2. 未登录直接访问底图路径、草稿图片被拒绝；已发布展示图带正确水印，图片请求跳转至预期 HTTPS 域名。
3. 手机和电脑检查轮播、画廊、全景拖动；控制台无跨域错误。
4. 用公网作品链接测试微信缩略图、小红书分享卡片；不要使用 localhost 测试第三方抓取。
5. 修改水印、下架作品，确认新请求不再获得旧版本或草稿链接；已签发链接和浏览器缓存有短暂有效期。
6. 下载完整备份，在全新数据目录、本地模式恢复并核对图片数量；之后再决定移除服务器上的迁移副本。

参考：[阿里云 OSS 自定义域名](https://help.aliyun.com/zh/oss/user-guide/access-buckets-via-custom-domain-names)、[官方 SDK](https://github.com/ali-sdk/ali-oss)、[CDN A 类型鉴权](https://help.aliyun.com/zh/cdn/user-guide/type-a-signing)。

## 自动备份、回收站与图片替换

后台“存储与备份”可以设置每天的备份时间（北京时间）和保留份数，也可立即备份、下载历史版本。计划默认关闭。备份包含已上传的展示图片、个人照片、数据库、网站设置以及回收站内容，不含管理员密码、云密钥、相机原片或历史备份自身。

`BACKUP_DIR` 指定备份目录，默认是数据目录下的 `auto-backups`。备份暂存和归档都需要足够磁盘空间。使用 OSS 时会把当前引用的源图片取回归档，可能产生下载流量。此功能不会自动将备份上传到 OSS；建议将该目录挂载到独立磁盘，再由服务器备份服务同步到异地。仅同盘备份不能应对磁盘故障。

Docker 可在 compose 的 environment 设置 `BACKUP_DIR: /app/backups`，并在 volumes 增加 `/你的独立备份目录:/app/backups`。计划和历史索引存放在数据目录的 `backup-state.json`；修改备份目录时，需一并迁移历史归档。网站进程需保持运行；停机错过的计划会在启动后补一次。手动和定时备份期间暂时禁止修改资料。

删除作品会先移入回收站，保留 30 天；服务启动和每小时清理到期作品。恢复会保留原链接及发布状态。彻底删除不可撤回，备份下载前请留意其中也包含回收站作品。图片替换保留作品编号与资料，新图片保存成功后才切换；旧图不进入回收站，请自行保管旧版原片。
