# ops/：账号 / 同步后端（阿里云函数计算）

前端是 GitHub Pages 上的纯静态页，账号和同步靠一个**函数计算 FC 3.0 的 HTTP 函数**顶着，
数据存在用户自己 OSS 桶的 `sync/users/` 前缀下。**没有第三方服务、没有常驻服务器。**

## 线上地址

- API base：`https://thlyrics-auth-bybvhpggbp.cn-hangzhou.fcapp.run/api`
  （函数名 `thlyrics-auth`，地域 cn-hangzhou，HTTP 触发器 anonymous）
- 数据：`oss://thlyrics-audio/sync/users/<uid>/account.json`（账号 + scrypt 口令哈希）
  `oss://thlyrics-audio/sync/users/<uid>/data.json`（学习记录）
  `oss://thlyrics-audio/sync/users/_index.json`（用户名 → uid）

## 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 存活探测 |
| POST | `/api/register` | `{name, pass, data?}` → `{token, recovery, user}`；用户名唯一，密码 ≥6 位；恢复码只返回一次 |
| POST | `/api/login` | `{name, pass}` → `{token, user}`；老账号首次登录会补发一次恢复码 |
| POST | `/api/recover` | `{name, code, new}` → `{token, recovery, user}`；恢复码一次性，重置后换新 |
| GET | `/api/me` | 需要 `Authorization: Bearer <token>` |
| POST | `/api/avatar` | `{avatar}`（data URL，≤80KB，128×128 jpeg）；头像存在 account.json 里 |
| POST | `/api/password` | `{old, new}`，改完返回新 token |
| GET | `/api/data` | 取记录 |
| PUT | `/api/data` | `{data}`，**服务端按时间戳逐条合并**后返回全量（多设备不会互相覆盖） |
| GET | `/api/resolve` | `?q=<链接/分享文案/裸ID>` → `{type: playlist\|album\|song, id, name, cover, tracks[]}`；认网易云链接、**163cn.tv 手机短链**（服务端跟 302） |
| GET | `/api/audio` | `?id=<歌曲id>&br=320` → `{url, br, size, expi}`（https 直链；无版权/下架 → 404） |
| GET | `/api/lyric` | `?id=<歌曲id>` → `{lyric, tlyric}` |
| POST | `/api/segment` | `{lines:[…]}` → kuromoji 分词 `{segs:[[[表面形,辞书形,读音,词性,细分]…]…]}`（词典在 OSS `kuromoji/dict/`，冷启动拉 /tmp） |
| GET | `/api/admin/files?prefix=` | 管理员：列 OSS 对象（key/size/LastModified），prefix 一般是 `sync/` 或 `audio/` |
| POST | `/api/admin/delete` | 管理员：`{key}` 删对象（只允许 `sync/` 或 `audio/` 前缀） |

管理员判定：`_index.json` 为空时**第一个注册的账号**自动是管理员（写进 account.json 的 `admin` 字段）；
也可以用函数环境变量 `ADMINS=名字1,名字2` 追加。普通用户看不到 `/api/admin/*`（403）。

令牌是 HMAC-SHA256 签名的自包含 token（180 天），密钥在
`~/.dsh/thlyrics-fc.secret`（600，不进仓库）。

## 部署 / 改代码

```bash
python3 ops/deploy-fc.py        # 把 ops/fc/ 打包上传，并设置环境变量
```

- `ops/fc/index.js`：全部逻辑（无第三方依赖，只用 node:crypto / node:https）
- `ops/acs3.py`：手写的阿里云 OpenAPI V3 客户端（FC 是 ROA 接口）
- `ops/aliyun_api.py`：手写的 RPC 版（查 VPC/RDS/STS 等用）
- 函数环境变量：`OSS_AK/OSS_SK/OSS_BUCKET/OSS_HOST/TOKEN_SECRET/ALLOW_ORIGINS`
  - ⚠️ 现在用的是账号的 PowerUserAccess AK（RAM 用户 `dsh`）。**更好的做法**是
    建一个只有 `oss:GetObject/PutObject` on `thlyrics-audio/sync/users/*` 的 RAM 子账号，
    换掉 `OSS_AK/OSS_SK`。当前 AK 没有被 RAM 权限授权建子账号（PowerUserAccess 不含 RAM 管理）。
- 免费额度足够：一个月几十次调用、256MB×几十毫秒。

## 前端怎么接的

`docs/app.js`：
- `API_BASE` 常量 = 上面那个地址；账号态存 `localStorage['thlyrics.account.v1']`
- 登录后 `syncNow()` 走账号模式（一次 PUT，服务端合并后返回全量）
- **音频直链 / 歌词优先走 `/api/audio`、`/api/lyric`**，失败才回落到 `music-api.gdstudio.xyz`
  （第三方会限流、错误响应还不带 CORS 头，之前"导入的歌没音频"多半是它）
- 界面在「生词本」页顶部：注册并按登录 / 登录 / 退出 / 改密码

## 音频：现在 OSS 里没有音频

用户 2026-10-14 要求把 OSS 里的 mp3 全部删掉（来源不明的曲目不留副本），
`audio/` 前缀现在是空的，44 首内置曲目里那 16 首有网易云 nid 的都改走解析接口
（首次播放多等约 1.8s，之后 18 分钟复用）。`data/audio-oss.json` 的 `tracks` 已清空，
将来要重新放固定直链，把 trackId→url 填回去再 `node scripts/build-web.mjs` 即可。
**同一首歌只留一份**：真要放音频就用 `audio/<歌曲id>.mp3` 命名（不按用户分目录），
管理员面板会直接列出 audio/ 下的文件。

## 没做 / 可做

- RDS PostgreSQL Serverless：cn-hangzhou 查下来没有可卖规格（`DescribeAvailableZones` 为空），
  所以先用 OSS 当存储（每个账号两个小 JSON）。真要 SQL，等有规格时换 `dataKey/ossGetJson` 这一层即可。
- 邮件找回密码：没做；改用注册/登录时下发的一次性恢复码。
- 账号注销、多设备会话列表：没做。
