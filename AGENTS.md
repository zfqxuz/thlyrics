# thlyrics 工作区规则与交接（東方同人曲 学唱机）

> 本文件是这个工作区的事实源（Single Source of Truth）。进入本工作区的会话先读完它，
> 再动手；不要重新发明需求，也不要把旧交付里的错误方向再走一遍。

## 0. 背景：这个工作区为什么被重建

- 需求由 QQ 用户 2493922172（Brefeldin A，下称“用户”）于 2026-10-13 提出。
- 旧会话 `qq-7dd0f1b3b62841e13b235aa2-mv6v7uh6` 的 cwd 是 `/home/zfq/dshbot`，
  而工作区登记路径是 `/data/qqbot/thlyrics`，cwd 不匹配导致会话无法并入工作区：
  `cannot attach session ... its cwd resolves to '/home/zfq/dshbot'`。
- 2026-10-14：已把工作区路径修正为宿主路径 `/home/zfq/qqbot/thlyrics`；
  并把旧会话 `qq-7dd0f1b3b62841e13b235aa2-mv6v7uh6` 整体迁移进本工作区：
  session 文件里的 cwd 改成 `/home/zfq/qqbot/thlyrics`，物理目录移到
  `~/.dsh/sessions/--home-zfq-qqbot-thlyrics--/`，DSH 工作区登记从 dshbot 移到 thlyrics。
  宿主桥启动时会直接续接这条旧会话，历史不丢。
- 不要再用已废弃的容器内路径 `/data/qqbot/thlyrics`；也不要重新把会话绑回 dshbot。

## 1. 用户需求原文（按时间顺序，引用关键句）

1. “我正在学习日语，并且喜欢东方同人曲。我希望能将学和唱。你可能看见了我 github follow 了
   nakayamafesta，我的灵感正是来自于他的 popinparty 的学歌词。但是东方的同人音乐和 mygo 的还不一样。”
2. “推送并且用 github 自带的网页……释义是肯定要的，跟唱你找找网易云呢？但是要有单句重复。纯工具就行。”
3. “不用你截图，但是你必须确保任何用户的操作都顺畅丝滑。并且现在音乐资源播放没有缓冲加载？
   每首歌听到一半想重复都要等很长时间？”
4. “你务必做准确严谨全面系统的端到端测试，我不希望你的交付再变成一坨不能用的垃圾。”
5. “为什么不用 playwright？”
6. 用户最激烈的一次反馈（最重要，作为验收标准）：
   > “我很生气，因为你没有按照 nakayamafesta 的‘词汇入手’来设计整个页面交互，你也没有按照
   > ‘从易到难’，也没有针对每首歌提供标准日本语教程的词语。更反人类的是操作：播放和单句重复的
   > 功能简直是灾难，页面完全处于不可用状态。你做了什么？你完全是在瞎做一通。根本不存在歌曲检索。
   > 你做好之后有没有从浏览器执行端到端验证？你有没有自己体验过你做的产品？好好反思！
   > 在你产品打磨的没问题之前，不准做内容的填充了。歌词分词有做吗？同一句里不同词性的单词和
   > 中文翻译用不同颜色区分？”

## 2. 产品必须满足的原则（硬约束）

1. **词汇入手**：首页/入口围绕“今天学哪些词”组织，而不是先给一首歌的完整歌词。
   参考 popipa-tango-dreamer 的 word-first 流程，但数据模型要适配东方同人曲。
2. **从易到难**：按“词在标日课程中的位置 + 在当前曲库里的难度/出现频率”分级，
   不能只按出现曲数拍脑袋排序。
3. **标日对照**：每个词要有“标准日本语 第几课”之类字段；每首歌能列出该歌用到的标日词汇。
4. **歌曲检索**：可检索曲名/社团/专辑/原曲，而不是简单的子串过滤。
5. **交互顺畅**：播放器必须有缓冲/预加载；单句循环切换、点词、倍速、上下句要丝滑；
   点词不能冒泡到“切换循环行”；播放状态与高亮必须统一驱动。
6. **歌词可视化**：同一句里不同词性用不同颜色；中文翻译要能落到词级（至少高亮当前词的中文），
   不能只按整行显示。
7. **纯工具向**：不做卡片复习/连续天数那套；进度用 localStorage，可导出导入即可。
8. **在线可用**：用户通过 QQ 访问，不能依赖 localhost；用 GitHub Pages 从 `docs/` 发布。
9. **内容冻结**：在产品打磨到用户满意之前，**禁止继续填充内容/翻译**。
   `data/myzhtr/` 里 21 个未合并的翻译文件保持原样，不要合并、不要推送。
10. **实机验收**：交付前必须用 Playwright 做端到端测试（打开、播放、点句循环、倍速、点词、
    切曲目、检索、刷新恢复），并自己从用户视角走一遍。做不到“顺畅丝滑”就不算完成。

## 3. 仓库与运行方式

- 工作目录（宿主）：`/home/zfq/qqbot/thlyrics`
  （历史/容器内路径 `/data/qqbot/thlyrics` 不再使用）
- GitHub：`https://github.com/zfqxuz/thlyrics`（Pages 从 `docs/` 发布）
- 在线版：`https://zfqxuz.github.io/thlyrics/`
- 技术：无后端；`docs/` 纯静态前端，`scripts/` Node 数据管道，`data/` 数据与中间产物。
- 常用命令：
  ```bash
  npm install                # kuromoji 等
  node scripts/fetch-lyrics.mjs --from data/queries.txt --limit 40
  node scripts/build-index.mjs --covers --stats
  node scripts/build-web.mjs
  node scripts/serve.mjs 8848      # http://127.0.0.1:8848/
  ```
- 数据版权：歌词归各社团/原作者，仅供个人学习，勿传播或商用。

## 4. 当前状态（截至 2026-10-14）

### 已交付
- 44 首东方同人曲、1358 个词的人工释义（`data/meanings.mine.json`）。
- 10 首网易云音频可用，且都通过“网易云歌词 vs THBWiki 歌词”一致度校验（100%）。
- 基础单句循环、倍速、上下句、点词弹层、音频来源手工绑定、中文翻译（部分）。

### 用户判定不合格 / 未完成
- 页面结构是“歌词入手 + 查词弹层”，不是“词汇入手”。
- 没有按标日/难度分级；没有每首歌的标日词汇。
- 没有真正的歌曲检索。
- 播放器/单句循环有 bug，交互灾难；点词冒泡会切行。
- 播放没有预加载/缓冲，重复要等。
- 词性颜色、词级中文翻译没有做（分词数据已有）。
- 没有从浏览器做端到端验证。

### 工作树现状（不要无意覆盖）
- `git status`：`docs/app.js`、`docs/index.html` 有未提交改动（上一轮播放器重写，未验证完成）；
  `data/lyricsrc/`、`data/myzhtr/` 未跟踪。
- `data/myzhtr/` 的 21 个文件是上一轮自行翻译的歌词，**在用户明确解冻前不要合并、不要提交**。
- 中间产物 `index.json` 有一条已修复的教训：只读，不要回写运行态字段；每轮重建先清运行时字段，
  避免音频字段跨轮污染数据。

### 已知数据约定
- `docs/data/index.json`：stats / originals / tracks / vocab；
  track 有 `lines[{t,text,jp,romaji,segs}]`，vocab 有 `word/reading/romaji/pos/count/tracks/forms`。
- `segs` 是分词结果 `{s,w,b,l,r,y,p}`，做词性着色和词级交互就用它，不要再另调分词。
- `data/meanings.mine.json` 优先级最高；前端 localStorage 可改释义。

## 5. 接手人建议的下一步（用户尚未验收）

1. 先恢复“用户视角可验证”的环境：安装/运行 Playwright，对线上和本地做 E2E 基线。
2. 重构信息架构为 word-first；把 `segs`、标日课程映射、难度分级数据补齐到管道里。
3. 重写播放器状态机与预加载；解决点词冒泡。
4. 做完一条完整链路后再让用户验收；不要在此期间碰 `data/myzhtr/` 和任何内容填充。

## 6. 工作区规则

- 用户是 owner（QQ 2493922172）；群 176628359 是开发群但角色为 owner，注意泄露风险。
- 用中文回复，先结论后依据；不要暴露无关的技术细节到普通群聊。
- 不要用 `git add -A` 一把梭；不要提交/推送用户没让推的内容。
- 任何涉及内容填充、翻译、大规模生成的任务，先确认“冻结已解除”。

## 7. 待开发（2026-10-14 已与用户对齐，等条件就绪）

用户已点头三项，但**在条件就绪前不要开工**：

1. **音频改走阿里云 OSS**（不要卡、不要本地缓存也能稳进 1 秒）
   → 见 `spec/SPEC-audio-oss.md`。先上 1 首跑通，再上 10 首，其余 34 首等音源。
   阻塞：用户需提供 RAM 子账号 AK（只给 OSS 权限）+ bucket 名 + 地域。
2. ~~UI / 交互重做~~ → **2026-10-14 已完成并上线**（见 `spec/PLAN-ui-redesign.md`）：
   迷你播放条 + 全屏跟唱页、分段控件、点句子=继续播（双击/长按=单句循环）、难度点阵、词义/中文/罗马音开关。
   E2E 51/51。**注意：不要再按旧版结构改（旧版是卡片列表 + 页内播放键）。**
3. **DSH × 阿里云插件**（优先级最高，独立于本仓库）
   → 规格在 `/home/zfq/dev/dsh-plugins/docs/SPEC-aliyun.md`：
   DSH 自带 MCP 客户端可直接挂阿里云官方 MCP server；官方 OSS MCP 只有 3 个只读工具，
   缺上传/列对象/删除，需要自研 `dsh-aliyun-oss` 插件补齐。

### 本轮已完成（不要再重做）

- 词性分色、词级中文、按句分块的歌词排版、单曲页词汇前置、真正的检索、生词本
- 难度分级接入《标日》+JLPT 词表（并修掉读音误配与 36 个动词读音）
- E2E 48/48（`.e2e/run-e2e.mjs`）
- 已实测结论（别重复踩）：OSS 默认域名的 Content-Disposition: attachment **不影响** `<audio>` 播放；
  点句子会开单句循环是当前设计，用户认为像"只能一句一句播"，要按 PLAN 改。

### 本轮补充（2026-10-14 上午，session mv73e2a0 → mv7ht1t1）

- **QQ 机器人掉线事故**：07:02 机器人账号（2267595782）被 QQ 踢下线（KickedOffLine），
  桥本身没挂。10:33 用户重新扫码后恢复；NapCat 掉线期间收到的消息会在重连后补投。
  二维码每 2 分钟过期，别再发 PNG 截图，用实时页面：
  `nohup node /home/zfq/qqbot/tools/qq-login-page.mjs &` → http://127.0.0.1:8899/
  （自动刷新二维码 + 显示在线状态/解码链接；状态靠 ss 看 6700 上有没有连接）。
- **逐词罗马音修了个真 bug**：`segs[].y` 以前取的是**词典形**读音（咲い→saku、来→kuru、
  し→shisuru、待っ→tsu），跟唱时看到的是错的。现在取**表面形**读音 + 词尾促音按下一词补辅音
  （待ってて→mattete）。全量重建后"不符"从 990 处降到 0。
  `segs[].l`（词典形读音）与词表 `v.romaji` 保持词典形，不要动。
- 重建顺序：`node scripts/build-index.mjs --stats` → `node scripts/build-web.mjs`
  （`build-web` 会把 `data/audio-oss.json` 里的 OSS 地址合回 `track.audioOss`，不要手工改
  `docs/data/index.json` 的音频字段）。
- 待办仍在：①账号级"阻止公共访问"（不关也能跑，现在是 10 年签名 URL）；
  ②剩下 34 首等音源；③QQ 发工作区文件报 ENOENT（容器没挂 thlyrics，两个修法待用户选）。

### 曲库导入网易云歌单（2026-10-14 新增，已上线）

- 入口在「曲库」页顶部的 details「导入网易云歌单」；粘 `playlist?id=…` 链接或数字 ID。
- 纯前端，无后端：歌单/歌词/音频地址都走 `https://music-api.gdstudio.xyz/api.php`
  （`types=playlist|lyric|url`，带 `access-control-allow-origin: *`，所以浏览器能直连）。
  网易官方 `/api/song/lyric` 没有 CORS 头，不能用。
- 收歌规则：**有带时间轴的歌词** + **能取到音频地址** 才入库；缺哪样就逐首报原因，不阻塞其它首。
  已在内置曲库里的歌（同 nid 或同名）自动跳过。
- 数据落在 `localStorage`（`S.imp`）：只存 `{nid,title,artist,album,cover,lines[{t,text,zh}],plId,plName}`，
  约几十 KB/首；分词/分词性/罗马音是**加载时**用现有词表现算的（`segsFor()`），不落盘。
- 分词链路：现有词表（1358 词 + 活用形）最长匹配 → 未收录的部分交给浏览器 `Intl.Segmenter('ja')`
  切词 → 纯假名块用 `kanaRomaji()`（`scripts/kana-romaji.mjs` 的精简移植）补罗马音。
  实测导入曲目的逐词罗马音覆盖约 80%；**词表里没有的汉字词没有读音**（已知限制，要全覆盖
  就得在浏览器里挂 kuromoji 词典，约 17MB 一次性下载）。
- 测试：`.e2e/run-e2e.mjs` 第 12 节（歌单/歌词全打桩，63/63）；
  真网络下的手动验证曾用 737955 / 22645196 / 752043 这三首。

### QQ 发图 / 发文件（2026-10-14 修好，无需重建容器）

- 症状：`qq_send_image` / `qq_send_file` 传工作区路径报 `ENOENT`。原因：NapCat 容器只挂了
  `/app/napcat/cache`（宿主 `/home/zfq/qqbot/napcat-cache`）等三个目录，工作区没挂进去。
- 修法：`/home/zfq/qqbot/tools/qq-send.sh <文件>` —— 它把文件 `docker cp` 进挂载目录，
  并在容器里建软链 `/home/zfq/qqbot/napcat-cache -> /app/napcat/cache`，
  于是"宿主路径"在容器里也能解析。脚本会打印该传给 qq_send_image 的路径，例如：
  `/home/zfq/qqbot/napcat-cache/foo.png`。
- 容器被 **重建** 后软链会丢（重启不丢），重跑一次脚本即可。
- 想彻底解决就给 napcat 服务加一句挂载 `-v /home/zfq/qqbot:/home/zfq/qqbot:ro`（要重建容器，
  会断一次 QQ 连接，需要重新快速登录/扫码），目前没做。
