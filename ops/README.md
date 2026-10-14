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
| POST | `/api/register` | `{name, pass, data?}` → `{token, user}`；用户名唯一，密码 ≥6 位 |
| POST | `/api/login` | `{name, pass}` → `{token, user}` |
| GET | `/api/me` | 需要 `Authorization: Bearer <token>` |
| POST | `/api/password` | `{old, new}`，改完返回新 token |
| GET | `/api/data` | 取记录 |
| PUT | `/api/data` | `{data}`，**服务端按时间戳逐条合并**后返回全量（多设备不会互相覆盖） |

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
- 登录后 `syncNow()` 走账号模式（一次 PUT，服务端合并后返回全量），
  未登录则回落到「公开预签名对象」的老路子
- 界面在「生词本」页顶部：注册并按登录 / 登录 / 退出 / 改密码

## 没做 / 可做

- RDS PostgreSQL Serverless：cn-hangzhou 查下来没有可卖规格（`DescribeAvailableZones` 为空），
  所以先用 OSS 当存储（每个账号两个小 JSON）。真要 SQL，等有规格时换 `dataKey/ossGetJson` 这一层即可。
- 邮件找回密码、账号注销、多设备会话列表：没做。
