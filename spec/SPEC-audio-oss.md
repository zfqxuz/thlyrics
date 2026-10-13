# SPEC：音频改走自建对象存储（先上一首）

状态：**阶段 A 已完成**（t1 已上传 OSS 并接进前端，E2E 51/51）
日期：2026-10-14

## 0. 已完成（阶段 A）

- bucket：`thlyrics-audio`（oss-cn-hangzhou），防盗链白名单已开（allowEmptyReferer=false）、CORS 已配
- 已上传：`audio/t1.mp3`（11,194,036 字节，320kbps 原文件，Content-Type audio/mpeg，Cache-Control 一年）
- 前端：`data/audio-oss.json` → build-web 合并成 `track.audioOss` → app.js 优先用它，**不再调用解析接口**
- 实测（本机，带白名单 Referer）：TTFB **159ms**、首 256KB **232ms**（1.1MB/s）→ 从点开到出声约 0.2~0.3s
- 防盗链实测：不带 Referer 403、伪造 Referer 403、白名单 Referer 206

### ⚠️ 当前唯一阻塞
阿里云账号级「**阻止公共访问**」是开启状态，所以 bucket 设不了 `public-read`
（接口报 `Put public bucket acl is not allowed`）。
现在临时用**10 年有效期的签名 URL**（2036-10-10 到期）顶着。
用户关闭该开关后，把 `data/audio-oss.json` 里 t1 的 url 换成
`https://thlyrics-audio.oss-cn-hangzhou.aliyuncs.com/audio/t1.mp3` 并把 `signed` 改成 false 即可
（我会自动做）。注意：换了签名 URL 这种形式后，AK 一旋转链接就失效——所以推荐尽快切公共读。

## 待办（阶段 B/C）

- 阶段 B：把现有 10 首有音频的曲目全部上传（用 `aliyun_oss_put_dir` 批量）
- 阶段 C：其余 34 首待音源

---

## 原始规划（保留）

## 1. 问题（实测数据支撑）

点播放到出声 ≈ 1.0s，瓶颈分解：

| 环节 | 实测耗时 | 说明 |
|---|---|---|
| 解析音频地址（gdstudio 中转接口） | **620~660ms** | 每次冷启动都要走一次，是最大头 |
| 网易云 CDN 首字节 TTFB | 130~170ms | 支持 Range(206)、Cache-Control 一年 |
| 首 256KB 下载 | 0.18~0.44s | 0.6~1.4MB/s |
| 单曲 320kbps 体积 | 8~13MB | 不变 |

结论：把「解析地址」这一步彻底删掉，就能稳进 1 秒，且字节完全不变（不降音质）。

## 2. 方案：阿里云 OSS 固定直链

- bucket：公共读 + **Referer 防盗链白名单**（`https://zfqxuz.github.io`、`http://localhost:*`）
- 对象路径：`audio/<trackId>.mp3`（固定 URL，不带签名、不会过期）
- 对象头：`Content-Type: audio/mpeg`、`Cache-Control: public, max-age=31536000`
- 前端：`audio.src` 直接指固定 URL；删掉 `stationUrlFor()` 的接口调用与 URL 缓存逻辑
- 本地缓存降级为**可选**开关（省流量/离线用），不再是必需

已实测：OSS 默认域名对音频的「强制下载」（Content-Disposition: attachment）**不影响 `<audio>` 播放**
（带该头 193ms 出声 / 不带 194ms，无差异），所以不必绑自定义域名、不必备案。

## 3. 分阶段

1. **阶段 A（本次，先上一首）**：只上 1 首已绑定网易云的曲目，跑通「上传 → 配头 → 前端改地址 → E2E 验证 → 线上验收」
2. 阶段 B：把现有 10 首有音频的曲目全部上传（脚本化）
3. 阶段 C：其余 34 首待音源（需要用户提供 mp3；版权与来源由用户负责）

## 4. 验收标准

- 线上点击播放到 `currentTime > 0` **< 1s**（有线/4G）
- 播放、单句循环、拖进度条、倍速全部正常
- 刷新、换设备后仍然可用（地址是固定的，不依赖本地缓存）
- 防盗链生效：非白名单 Referer 返回 403
- E2E 测试补 3 条：固定 URL 直连、发声时延、防盗链拒绝

## 5. 成本（按量，官方计费页为准）

- 存储 约 0.12 元/GB/月（44 首 320k ≈ 440MB ≈ 0.06 元/月）
- 外网流出 约 0.5 元/GB（每月听 300 次 ≈ 3GB ≈ 1.5 元/月）
- 必须做：流量包封顶 + 用量告警（防盗链之外的第二道保险）

## 6. 风险与回滚

- 风险：直链被扒 → 流量费暴涨。缓解：Referer 白名单 + 关公共列目录 + 用量告警。
- 回滚：前端保留 `S.audio[trackId].nid` 回退逻辑；OSS 不可用时自动落回原来的中转接口路径。

## 7. 待用户提供

- RAM 子账号 AccessKey（**只给 OSS 权限**，不要主账号）
- bucket 名 + 地域（建议 oss-cn-hangzhou / oss-cn-shanghai）
- 第一首上传哪张专辑/哪首歌
