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

### 跟唱页对齐 / 读音兜底表 / LRC 解析（2026-10-14 下午）

- **「歌词一上一下」= 同句内词的基线不齐**：有罗马音的词上面多一行 `.r`，没读音的没有，
  两者又是 `vertical-align:top` → 没读音的词浮在上面。修法：**每个词都渲染 `.r`
  （没读音就空着）**，让所有词的日文行从同一高度开始。
- 另两个上下跳的原因（同一轮修的）：① `.playing` 用 `font-size:20px` 放大 → 每换一句整屏行高
  都变；改成只加粗。② 跟随滚动用 `scrollIntoView` → 会把整个页面一起滚；改成只滚 `#plyric`，
  且只在当前句跑出 30%~62% 安全带时滚到 42%。
  验证脚本 `.e2e/ui-check.mjs`：切高亮时所有块高度不变、容器 scrollHeight 不变、pageY 恒 0。
- **读音兜底表** `docs/data/readings.json`（由 `build-web.mjs` 生成，82KB / 2256 条）：
  内置 44 首里出现过的**每个 token**（含助词、活用形）→ `[罗马音, 读音, 词性]`。
  导入曲目分词顺序：① 1358 词表（有释义，优先）→ ② 这张表（有读音+词性，没释义）→
  ③ `Intl.Segmenter('ja')` + `kanaRomaji()`（只有假名能补罗马音）。
  实测 Bad Apple：逐词罗马音覆盖 80% → **93%**；剩下的罕见汉字词（無言/啼く）没有读音。
  **没做**浏览器端 kuromoji（17MB + 手机上内存吃紧），除非用户明确要。
- **LRC 解析真 bug**：`\]\s*(.*)` 里的 `\s` 会跨行吃掉换行，导致**空时间戳行（`[00:26.000]`）
  把下一行连时间戳一起吸上来** → 该行时间轴错、歌词里还残留 `[00:57.520]`。
  改成 `\][ \t]*(.*)` 并再 strip 一次行首时间戳。这类"音频和歌词不匹配"有一部分就是它。
- 点词弹层对**词表外的词**现在会显示读音（平假名）和罗马音，文案「词表里没有这个词（读音在上面）」。

### 2026-10-14 13:00：机器人再次被踢 + 「上线即通知」通道

- 12:55 机器人账号又被 QQ 踢下线（这一天第二次）。**注意：机器人在线之前，桥发不出任何消息**
  （日志里是「没有可用的机器人连接，无法发送」），所以"让它扫码"这件事没法用 QQ 通知 ——
  能用的只有：① 宿主 Web GUI 里这个会话；② 用户自己发现 QQ 不回话。
- 快速登录没用：`docker restart napcat` 后日志明确 `快速登录错误：登录态已失效`，必须重新扫码。
  二维码实时页面（每 2 分钟自动换）：`nohup node /home/zfq/qqbot/tools/qq-login-page.mjs &`
  → http://127.0.0.1:8899/ ；快照会同时写到 `thlyrics/qr-qq-login.png`（很快就过期，仅救急）。
- **上线即通知**：给 NapCat 的 `onebot11_2267595782.json` 加了一个**本机** HTTP 接口
  （127.0.0.1:3000，token 在 /tmp/onebot-token.txt；配置文件 root 所有，改法是先在 /tmp 写好再
  `docker cp` 进去）。配合 `/home/zfq/qqbot/tools/notify-on-login.mjs`：轮询 6700 上的连接，
  一旦机器人上线就用 `/send_private_msg` 把 `NOTIFY_TEXT` 发给用户。
  用途：机器人掉线期间没法说的话，在它回来的那一刻补发。
- **前端缓存**：Pages 对 `docs/` 的静态资源是 `cache-control: max-age=600`，普通刷新可能仍拿到旧
  app.js（2026-10-14 就因此让用户以为"修了还是老样子"）。所以 `docs/index.html` 里给
  `app.js` 挂了版本号（`app.js?v=…`），**每次改完前端把 v 往后推一位**；让用户绕过缓存就让他开
  `https://zfqxuz.github.io/thlyrics/?v=N`（换 N 就换了 index.html 的 URL）。

### 读音兜底表扩充（2026-10-14 下午，解决「有的词没罗马音」）

- 现象：导入的歌里有汉字词没有罗马音（揺/咲/纏/奥/温 这类活用形）。**不是 LRC 解析问题**，
  是"浏览器里没有完整日语词典"：只有 1358 词表 + 内置曲目抽出的 2256 条读音，其它汉字词
  查不到读音（规则只能转假名）。
- 做法：`scripts/build-readings.mjs` 用**后台的 kuromoji（IPADIC，和建库同一个词典）**把
  网易云若干日语大歌单的**歌词**（3000 首，取 1683 份有效歌词）跑一遍，抽出
  「表面形 → [罗马音, 读音, 词性]」（含活用形，纯假名词不收，前端自己能转）。
  输出 `data/readings-extra.json`（9570 条 / 360KB，出现≥2 次）。
- `build-web.mjs` 把它当底表、再用内置曲目的 token 覆盖 → `docs/data/readings.json`
  （10355 条 / 398KB，Pages gzip 后约 110KB）。
- 前端：`ensureReadings()` 懒加载（只在有导入曲目时拉），**导入前必须 await 它**，
  否则新导入的歌会用不完整的表分词。boot 时若有导入曲目也会先 await 再建曲目。
- 实测（只统计真词，空格/标点不算）：Bad Apple 93%→**100%**、737955 100%、
  737966 73%→**99%**（剩下 啼/織/抱/靈 这种文语/异体字）。
- ⚠ 不要用 Wikipedia API 当语料：短时间内必被 429（试过，200 篇都拉不下来）。

### LRC 净化 / 失败重试 / 曲库检索与分组（2026-10-14 傍晚）

- **歌词里的非语言符号**：`parseLrc` 现在先去掉装饰符号（`LRC_DECO`：♪★☆►◄✦✧◇◆◎※→←↑↓ 等），
  再去掉没有假名/汉字/英数的整行（纯符号行、以及剥掉符号后为空的空时间戳行）。
  元信息行（作词/作曲/编曲/演唱/原作曲/LRC/来自…）扩容后统一丢弃 —— 歌词列表里最常见的脏东西就是它。
  抽样 341 首有歌词的歌 / 15176 行：含纯符号行的歌 9 首（3%，但那几首能占掉 4.8% 的行）、
  行内夹装饰符号 21%、含元信息行 **85%**。
- **逐字/逐拍分行的 LRC 合并**：`mergeShortLines()` 把「相邻两行都 ≤2 字、间隔 ≤1.3s」的连续行并回一句
  （続/け/て/く → 続けてく）。抽样里 2 首（722013、30870899）是这种写法。
- **导入失败可重试**：导入面板在失败清单下面给出「重试失败的 N 首」，只重跑失败的那些
  （`importTracks()` 被抽出来公用；失败项连原始 track 对象一起记着）。
- **曲库检索与分组**：曲库页加了搜索框（曲名/社团/专辑/歌单名，含假名归一化）+
  右上角「列表 / 社团 / 专辑」切换（`groupsHtml()`，原生 details 折叠，按曲数排序）。
- **又修一个活用形读音的错**：`vocab.forms[].readingHira/romaji` 以前用的是词条形读音，
  写出了 見→む / 咲い→さう / 続け→tsuzukeru 这种；现在一律用**表面形读音**（み / さい / tsuzuke）。
  改的是 `build-index.mjs`（`fReading = seg.r || seg.l`），重建后差异只有 readingHira 365 处 + romaji 351 处。
  前端 `segsFor()` 也改成用 `forms[].reading` 现推罗马音，避免旧数据带偏。
- E2E 77/77（新增：符号清理、元信息行丢弃、逐字行合并、曲库搜索、社团/专辑分组、重试入口）。

### 「单词页 → 去这句」没声音 / 音频错位（2026-10-14 晚）

- 症状（用户报）：词条页点「去这句」，跳到曲目后不播放，而且听着像另一首。
- 根因：词条页的例句只来自内置 44 首，而内置里**只有 10 首挂了音源**（其余 34 首 audio 为 null）
  → 点过去页面切了、没声。实测 2297 条例句里 75% 指向没音频的曲目。
  另有一个真竞态：进曲目时 `prepAudio()` 和 `playTrack()` 会各挂一次地址，后挂的 `load()`
  把刚起的播放重置 —— 表现也是"跳转后不播放"。
- 修法（四处）：
  1. `showWord()`：把「当前正在听的这首歌」里出现的句子排到最前（导入的歌都有音频，点去这句立刻出声）；
  2. `build-web.mjs`：例句优先选有音频的曲目（分好/坏两类，playable 优先，取 3 条）；
  3. 音频挂载规则放宽：以前「网易云歌词 vs THBWiki 歌词」对不上就一律不挂音频 → 34 首全哑。
     现在 `(歌词≥6 行且一致度≥0.45) || (歌词≤5 行且曲名+艺人核对得上)` 就挂；
     **歌词很多却完全对不上（配错版本）依然不挂**，避免真的播成别的歌。挂上后 16/44 首有音频，
     例句可播放率 25% → 45%。
  4. 没音频不再无声无息：词条页例句标「无音频」；播放器右上出现「绑定音频」按钮
     （点了收起播放器、滚到「音频来源与设置」并聚焦输入框）；状态行写「还没有音频」。
- `prepAudio`/`playTrack` 竞态：attach 改成幂等（同一首已挂就不重复 load），
  playTrack 进场时 `prepToken++` 让在飞的 prepAudio 作废。
- E2E 82/82（新增：正在听的那句排最前、去这句真的切歌并开始播、没音频时给出绑定入口）。

### 导入的歌换设备（云端同步 + 文件导出）（2026-10-14 晚）

- 现状：导入的歌存在 localStorage，**只在这台设备这个浏览器**；内置 44 首是站内的，任何设备都有。
- **云端同步**（新增）：`docs/data/oss-sync.json` 里放两个 10 年有效的**预签名**地址
  （GET / PUT `sync/imports.json`），生词本页「同步到云端 / 从云端拉回」直接读写自己的 OSS，
  不需要后端。生成脚本 `scripts/gen-sync-urls.mjs`（用 ali-oss，注意 **PUT 必须把
  `Content-Type: application/json` 一起签进去**，前端上传要带同样的头，否则 SignatureDoesNotMatch）。
  桶 CORS 需要放通 `PUT`（已加：https://zfqxuz.github.io + http://127.0.0.1:8848）。
  合并策略：**拉回只补本地没有的**（按 trackId），不覆盖本机；推送写全量。
  ⚠️ 这两个地址写在公开页面里，等于任何拿到页面的人都能读写那一个对象（内容只是歌单元数据）。
  在意的话可以改成「同步码」：key 里加一段随机串，只有知道码的设备能同步（需要重做签名方案）。
- **文件导出/导入**：导出的是完整 S（含 `S.imp`），换设备导入即可；导入后现在会自动 `location.reload()`
  （以前导入完要手动刷新才认那些导入的歌）。
- 真机验证：`.e2e/sync-probe.mjs`（不带桩，真读写 OSS）→ GET 200 / PUT 200；
  E2E 里用桩，86/86。

### 账号 / 同步后端：函数计算 + 自己 OSS（2026-10-14 晚，已上线）

- 需求来源：用户问「我导入的只在我浏览器上吗？换设备就看不见了」→ 先做了「自动同步到 OSS 预签名对象」，
  用户接着要求「做用户登录，开个 serverless pgsql 也行」。
- 结论：RDS PostgreSQL **Serverless 在 cn-hangzhou 没有可卖规格**（`DescribeAvailableZones` 空），
  所以账号体系走「**函数计算 FC 3.0 HTTP 函数 + 用户自己 OSS**」，零额外费用、无第三方。
  - API：`https://thlyrics-auth-bybvhpggbp.cn-hangzhou.fcapp.run/api`（函数 `thlyrics-auth`）
  - 代码 `ops/fc/index.js`（无依赖，node:crypto + node:https），部署 `python3 ops/deploy-fc.py`
  - 数据：`thlyrics-audio` 桶 `sync/users/<uid>/{account,data}.json` + `sync/users/_index.json`
  - 令牌密钥：`~/.dsh/thlyrics-fc.secret`（600，不进仓库）；函数环境变量里放的还是账号 AK，
    **建议后续换成只有 `sync/users/*` 权限的 RAM 子账号**（当前 AK 是 PowerUserAccess，不含 RAM 管理，建不了）。
  - 详见 `ops/README.md`。
- 前端：`docs/app.js` 的 `API_BASE` + `ACC`（`localStorage['thlyrics.account.v1']`）；
  **登录后 `syncNow()` 走账号模式**（一次 PUT，服务端按时间戳逐条合并后返回全量），未登录回落到原来的
  「公开预签名对象」路子，所以没登录的人行为不变。界面在「生词本」顶部：注册并登录 / 登录 / 退出 / 改密码。
- 记录本身（`S`）早在这一轮之前就改成**逐条带时间戳合并 + 删除墓碑 + clearedAt**，
  所以多设备、清空浏览器数据、离线改动都不会丢；`save()` 挂钩 1.8s 去抖自动同步。
- E2E 102/102（第 15 节新增 8 条：账号入口、注册登录、注册时带本机数据、登录后标词进账号、
  退出、密码错提示、清浏览器数据后登录同账号恢复）。账号那节在 `.e2e/run-e2e.mjs` 里是**打桩**的
  （拦 `thlyrics-auth-*.cn-hangzhou.fcapp.run`），别让它打真 API。
- 真机验证脚本：`.e2e/acc-real.mjs <url> [用户名]`（真 API；跑完记得删账号对象 + 重置 _index.json）。
  （旧的 `.e2e/sync-real.mjs` / `sync-probe.mjs` 随公开对象一起删了。）

### 必须登录 + 账号制（2026-10-14 深夜，已上线）

- 用户要求「没注册没登录的人就不让用」。现在 `docs/index.html` 有个 `#gate` 全屏闸门：
  boot 时若没有 `ACC` 就只显示登录/注册卡片，**不渲染任何内容**（注意：`if (!location.hash) history.replaceState(...)`
  而不是 `location.replace(...)`，否则 hashchange 会把闸门后面的页面渲染出来；`hashchange` 监听要在闸门之前挂上）。
  退出登录 → 回到闸门。
- **公开预签名对象已废弃**：`docs/data/oss-sync.json` 和 `scripts/gen-sync-urls.mjs` 已删，
  OSS 里的 `sync/imports.json` / `sync/progress.json` 也删了（旧链接现在 404）。
  同步只有一条路：登录后打函数计算 API（服务端合并）。没登录 = 不联网、不落云端。
- API 端加了每账号存储上限 12MB（`MAX_STORE`），超了返回 413 提示先删歌。
- E2E 96/96（第 0 节：未登录只有闸门、注册后放行；第 14 节整节改成账号制：
  改释义/标词自动同步、删除墓碑、清空进度不被顶回来、清浏览器数据后登录恢复、退出回闸门）。
- 真机验证脚本 `.e2e/acc-real.mjs <url> <用户名>`（线上真 API，跑完记得删账号对象 + 重置 _index.json）。

### 歌单体检 / 管理员模式 / 清空 OSS 音频（2026-10-14 深夜第二批，已上线）

- **OSS 音频全删了**（用户要求「不知道哪来的曲都删掉，确保是干净的」）：
  `audio/` 前缀现在为空，`data/audio-oss.json` 的 tracks 已清空并重建 →
  `docs/data/index.json` 里 `audioOss` 为 0 条；内置那 16 首有 `audio.nid` 的改走解析接口
  （实测解析后 Range 请求 206 · audio/mpeg · TTFB 58ms）。要放回来：往 `data/audio-oss.json.tracks`
  填 trackId→url 再 `node scripts/build-web.mjs`。**同歌只留一份，key 用 `audio/<歌曲id>.mp3`**。
- **歌单体检**：`checkPlaylists()` —— 对每张导入的歌单拉一次线上曲目表，报「线上 N 首 · 库里 M 首 · 新增 X 首」，
  缺的自动补进来；被原作者移出歌单的只报数、不自动删（那是用户的数据）。
  入口在曲库页的导入面板里（`#plchk`）；另外**每 24 小时静默跑一次**（`S.plCheckAt`）。
  测试里用 `window.__NO_PLCHECK = true` 关掉自动那次。
- **管理员模式**：第一个注册的账号自动是管理员（account.json 的 `admin`），可用 `ADMINS` 环境变量追加。
  生词本页给管理员加了一块「管理员模式」卡片：列 OSS 文件（sync/ 账号数据、audio/ 音频）、显示大小、可单个删。
  API：`GET /api/admin/files?prefix=`、`POST /api/admin/delete {key}`（非管理员 403）。
  ⚠️ 实现坑：OSS V1 签名里**只有 sub-resource 才进 CanonicalizedResource**，
  `prefix`/`max-keys` 不算 —— 列表请求的 canonical resource 就是 `/<bucket>/`（写错过一次，会 403）。
- E2E 100/100（新增：内置曲目改走解析、歌单体检手动按钮、管理员列/删文件；去这句那条改成验地址链路，
  因为 headless shell 解不了假 mp3）。

### 重新设计 v3：按 GPT 的 16 条建议（2026-10-14 深夜第三批，进行中）

- 用户把 ChatGPT 的评审（16 条建议 + 5 条"AI 味"成因 + 线框 + P0/P1/P2）以截图发来，要求重新设计。
  **执行清单在 `spec/PLAN-redesign-v3.md`，做一条勾一条。**
- 已上线（E2E 105/105）：视觉体系（墨蓝+暖白+朱红，去渐变/发光/玻璃，字号六档，按钮三档）、
  新首页 `#/home`（大搜索 + 正在学习卡 + 三个小入口 + 今天几个词；首页隐藏 tab 行）、
  显示开关收进「显示」抽屉、播放控制收成一条、换句不跳屏（硬断言）。
- ⚠️ 踩过的坑：**不要把当前句字号放大**——`.line` 的 min-height 挡不住 romaji+放大后的行高，
  块高会变，整屏上下跳（E2E 新增的"切句高度不变"断言就是防这个）。要突出就用 加粗 + 亮色 + 左侧朱红条。
- 第二批也上线了（E2E 117/117）：空状态/反馈全部改成"说清 + 下一步"、搜索与曲库徽章化（无封面不放灰块）、
  词卡收成三个主按钮+「更多」、**新增 `#/review` 复习卡**（看词→看释义→记住了/还不熟）、
  音频设置只在生词本/单曲页、字号六档+间距五档 token、320px 窄屏断言、按歌记住播放位置（首页显示"上次听到 1:23"）。
- 还没做：字体规范彻底化、横屏/软键盘专项、本机 vs 云端说明文案。

### 曲库改成「只放自己导入的」+ 专辑/单曲/163cn 短链 + 后端解析音频（2026-10-14 晚，已上线）

用户要求（原文）：「你可以访问 github，也有我的凭据，为什么你不能动手清除呢？另外必须支持手机从
163cn 的短链接导入歌单，还要支持单曲导入或者专辑导入。下线本地导入的逻辑。移除页面上一切不必要的
描述性文案，尤其是那些把用户当傻子的解释性文案。」

- **站上不再带内置曲目**：`node scripts/build-web.mjs --empty-lib` 会把 `docs/data/index.json` 的
  `tracks`/`originals` 清空，并删掉 `vocab[].examples`（例句改由前端从曲库现算）。
  `data/index.json`（源数据，44 首）**保留**：词表 1358 词、`data/readings-extra.json` 都要靠它生成，
  只是不再发到站上。`docs/data/covers/` 已删。
- **学词/复习/例句全部只看曲库**：前端新增 `LIBW`（曲库词 → 出现次数/出现的歌，`indexLibrary()`）、
  `libStat()`、`examplesFor()`。导入/删除/云端拉回后都要 `indexLibrary()`；`examplesFor` 优先挑
  有音频的曲目（避免"去这句"点过去没声音）。曲库空时各页给空状态 + 导入入口。
- **导入入口统一**：曲库页一个输入框吃下 歌单 / 专辑 / 单曲 / 分享文案 / 裸 ID / 短链。
  解析走自建后端 `GET /api/resolve`（服务端跟 302 → 解析类型 + 曲目表）；后端不可用时回落
  「本地认歌单 ID + `types=playlist`」。歌单曲目表仍走 `types=playlist`（一次能拿整张），
  专辑/单曲用后端返回的曲目表。`S.imp[].plId` 用 `al<id>` / `sg<id>` 区分，歌单体检只跑纯数字 ID 的。
- **音频/歌词改走后端**：`GET /api/audio?id=&br=`（网易云 `/api/song/enhance/player/url`，
  **http 直链要改写成 https**，否则 Pages 上被混合内容拦掉）、`GET /api/lyric?id=`。
  前端 `resolveAudioUrl()` / `resolveLyric()` 都是「后端优先 → 失败回落 gdstudio」。起因：
  gdstudio 限流时错误响应不带 CORS 头，浏览器直接 fetch 失败 → 用户眼里就是"导入的歌没音频/被跳过"。
- **本地导入下线**：`#audiofile`/`#audioclear`、IndexedDB 那套（`idb*`、`S.local`）全删了，
  boot 时 `indexedDB.deleteDatabase('thlyrics')` 清一次旧文件。网易云 ID 绑定（`#nidinput`）保留。
- **文案**：首页/闸门/生词本/空状态里的解释性长句全删，只留功能性标签与反馈。
- **测试**：`.e2e/fixture-index.json`（从旧 `docs/data/index.json` 生成，测试夹具，别当成线上数据）
  由 E2E 用 route 喂给页面，UI 交互照旧测；新增 `/api/resolve|audio|lyric` 桩、专辑/单曲导入、
  「线上曲库不含内置曲目」断言。E2E 124/124。真机脚本 `.e2e/import-real.mjs <url>`（真专辑/单曲导入 +
  后端音频解析，走系统代理跑，因为浏览器要出网）。
- 重建顺序：`node scripts/build-index.mjs --stats` → `node scripts/build-web.mjs --empty-lib`
  （`--covers` 不用再带，封面已删）。函数：`python3 ops/deploy-fc.py`。

### 词库补充（1358→6423）+ 服务端 kuromoji 分词 + 点开即播 / 迷你条封面（2026-10-14 深夜，已上线）

用户反馈三条：「点击曲目不会自动播放」「播放器专辑小图展示不出来」「词库是不是可以补充？感觉识别不准确」。

- **点开就播**：`showTrack()` 里改成 `playTrack(t)`（之前只预解析，要再点一次「进入跟唱」）；
  有上次播放位置的仍然 `jump(p0)`。
- **迷你条封面**：`showTrack` 里原来只认内置曲目的 `coverFile`，导入曲目的 `coverUrl`（网易云图）
  从没被设过 → 迷你条永远没图。现在两者都认，都没有就 `hidden`（不留空占位）。
- **词库补充**：`data/biaori.json` 里躺着《标日》**5706 个去重词条（带中文释义 + 课次）**，
  以前只用来给 1358 词打课次标签。现在 `build-web.mjs` 的 `mergeBiaori()` 把它们并进词表：
  去重后并入 **5065 词**（词性用 kuromoji 猜、课次做难度 `diff = course + lesson/1000`、JLPT 顺带标），
  `docs/data/index.json` 词表 **1358 → 6423**（文件 0.48MB → 2.0MB）。
- **服务端分词**：新增 `POST /api/segment {lines:[…]}` → kuromoji(IPADIC) 的
  `[表面形, 辞书形, 读音(平假名), 词性, 词性细分]`。理由：前端原来的「词表最长匹配 + Intl.Segmenter」
  边界靠贪心猜，导入歌里常切错；kuromoji 是 Viterbi，且能给辞书形（活用形也能对回词表）。
  - 词典 18MB 放 **OSS `kuromoji/dict/`**（`aliyun_oss_put_dir` 上传），FC 冷启动拉到 `/tmp/kuromoji-dict`
    再复用（实测冷 2.0s / 热 0.13s）；kuromoji 的 JS 放 `ops/fc/vendor/`（含 async/doublearray/zlibjs/lodash），
    zip 2.1MB。**FC 内存要从 256MB 提到 1024MB**（kuromoji 常驻约 400MB RSS）。
  - ⚠️ 坑：`unk_char.dat.gz` 只有 306 字节，判断"词典已下载"不能用 `size > 500`（会无限重下）。
  - 导入时存**紧凑分片** `rec.segs[i] = [[表面形, 读音, 词性码, 词表命中词], …]`，加载时 `segsFromCompact()`
    还原（罗马音前端现推），避免把账号存储撑爆；接口挂了就退回 `segsFor()` 老路径。
  - 老数据（已导入、没有 segs）由 `backfillSegs()` 在 boot 后 4s 静默补齐（一次最多 40 首），
    测试里用 `window.__NO_BACKFILL` 关掉。
  - `posKind()` 扩了 助詞/助動詞/接続詞/連体詞/感動詞/接頭詞/形容動詞，颜色沿用既有 `k-*` 类。
- 实测（真网络）：日语词逐词罗马音覆盖 **98%**（英文/ASCII 词不算）；词表命中 56% 的日语 token
  （其余多是助词/助动词，本来就不进学词表）。E2E 127/127。

### 排序 / 专辑网格 / 收藏会唱 / 分享码 / 主题 / 头像 / 我的页 / 管理员页（2026-10-14 深夜第四批，已上线）

用户一次提了 9 条 + 追加 3 条：入库时间排序、专辑两列网格、检索按首字母升降序、白天暖色调、独立"我的"页、
独立管理员页、标记会唱、收藏、分享数据给别人、注册上传头像、头像下拉菜单收纳用户页/管理员页、黑白开关。

- **页面骨架**：tab 从 3 个变 4 个（学词 / 曲库 / 生词本 / 我的）；新增 `#/me`、`#/admin` 两个视图。
  生词本只留"词"（已掌握、改释义、复习）；账号 / 同步 / 主题 / 显示 / 数据 / 分享码 / 管理入口都搬到「我的」。
  `#srcslot`（音频来源设置）跟着「我的」和单曲页。
- **主题**：颜色全部收进 `:root` token（含 `--warm-ink`/`--track`/`--shadow` 等语义色），
  `body.warm` 覆盖成暖白。`S.theme = dark|warm|auto`（auto 跟 `prefers-color-scheme`）。
  顶栏头像菜单里有黑白开关（一键 dark ⇄ warm），我的页里有三档选择器。E2E 验了"切了能记住、刷新还在"。
- **头像**：注册闸门可选头像（`pickAvatar()` 用 canvas 压到 128×128 jpeg，约 6~12KB，data URL）。
  FC：`/register`、`/login`、`/me` 都带 `avatar`，新增 `POST /api/avatar`；`cleanAvatar()` 只收
  `data:image/(png|jpg|webp);base64,` 且 ≤ 80KB。**头像存在 account.json 里，不占 OSS 独立对象**。
  没设头像就显示用户名首字母。
- **头像下拉菜单**：顶栏 `#btn-av` + `#avdrop`，里面有：账号名、黑白开关、首页/曲库/搜索、我的、管理员（仅 admin）、退出。
- **排序**：`S.tSort = new|old|az|azd`（默认 `new` = 入库时间倒序；`addedAt` 来自导入记录 `at`），
  曲库列表 / 专辑 / 社团分组 / 搜索结果统一用 `sortTracks()`；词表多了「五十音 ↓」。
- **专辑页**：两列网格（`albumGridHtml()`：封面 + 专辑名 + 艺人 + 曲数），点卡片 = 按专辑过滤曲库。
- **收藏 / 会唱**：`S.fav` / `S.sing` 存时间戳（取消存负数，和 `known` 同一套合并规则），
  单曲页有开关、列表行有标签、曲库有筛选 chip；**函数计算的 mergeStates 也加了这两个字段**（不然换设备丢）。
- **分享码**：只分享「歌单 / 专辑 / 单曲的来源」`{v:1, pl:[], al:[], sg:[]}` → base64url，前缀 `TL1.`
  （几十字节，不含歌词本体）。对方 `importShareCode()` 逐条重新解析导入（已入库的自动跳过）。
- **管理员页**：OSS 文件列表 + 删除 + 前缀切换（sync/ · audio/ · kuromoji/）；后端删除白名单加了 `kuromoji/`。
- 坑：`showTrack()` 现在会**预渲染** `#plyric`（跟唱页一点即开）；分享结果提示存模块变量 `shMsg`，
  否则 `renderMe()` 重渲染会把提示抹掉。E2E 里 `page.goto()` 从带 `?query` 的 URL 跳到不带 query 的
  `#/track/...` 会**整页重载**（旧测试依赖同文档 hash 切换，已修）。
- 测试：E2E **143/143**（新增 16 条：头像入口、黑白开关+持久化、入库序/标题升降序、专辑两列网格+封面、
  收藏会唱+筛选、分享码生成/导入、我的页、管理员独立页）；真机验过注册带头像 + `POST /avatar` 换头像
  （用完删了临时账号 + 还原 `sync/users/_index.json`）。

### 罗马音纠正：只对「当前位置」生效（2026-10-15，已上线）

用户要求：「用户听歌发现读音和标注不一致，可以直接编辑歌词里的罗马音；系统给几个备选、也允许自己输入；
改完立刻生效；过程中播放暂停，改完继续。」随后特别强调：**「改动仅可对当前位置的改动生效，
既不能拓展到这首歌其他同写法词，更不能应用于其他歌。」**

- 存储：`S.roma = { '<trackId>|<行号>|<词位>': { y: 用户写的罗马音, u: 时间戳 } }` —— **位置即身份**，
  换句话说是"这一处歌词的标注"。跟着账号同步（前后端 mergeStates 白名单都加了 `roma`，按 `u` 取新的）。
  ⚠️ 曾经写成「词面|读音」级别（会扩散到同词），被用户否掉，**不要再改回去**。
- 渲染：`renderLyrics()` 里 `romaOf(t.id, i, ti) || sg.y`；改过的那一处加 `data-fixed="1"`，
  CSS 把它的罗马音标成朱红（用户一眼能看出自己改过哪儿）。
- 入口：跟唱页点词 → 弹层「罗马音」按钮（`#p-roma`）→ `#p-romabox`：
  打开时 `audio.pause()`（记住之前是否在播）→ 备选 chips（`romaVariants()`：赫本 / 训令式 /
  长音不标 / 长音符 / 促音不双写 / ん→m）+ 自由输入 → 保存/回车立刻重渲染并 `playTrack()` 续播；
  「还原」删掉这一处的覆盖。关弹层（`hidePop`）也会续播，不会把人晾在暂停上。
- 备选是**现推**的（由读音 kanaRomaji 变换），不存进数据；同一处如果改过，会先把用户的值列出来。
- 词条页 / 复习卡**不套用**歌词纠正（纠正跟"位置"绑，不跟"词"绑）。
- E2E 13.2 节 11 条：打开即暂停、备选 ≥1（有可变假名时 ≥2）、保存后立刻生效 + 续播、
  "同曲同词其它位置不动"、"键里带曲目+行+词位"、自由输入、刷新后仍在（并随账号同步）。
  headless 播不出声 → 用 `Object.defineProperty(a,'paused',...)` + 钩 play/pause 调用来验续播。
- E2E 155/155。

### 兼容 QQ 音乐：单曲 / 专辑 / 歌单（2026-10-15，已上线）

用户问：「能不能兼容 qq 音乐单曲专辑和歌单？」

- **发现**：第三方中继 `music-api.gdstudio.xyz` **不支持 QQ 源**（`source=tencent` 直接报
  "Value of `source` is not supported"），所以 QQ 只能走自建后端。
- 后端（`ops/fc/index.js`）新增：
  - `/api/resolve`：认 `y.qq.com`（`/n/ryqq/songDetail/<mid>`、`albumDetail/<mid>`、`playlist/<disstid>`、
    老版 `/n/yqq/xxx/<mid>.html`）与手机分享短链（`c6.y.qq.com/base/fcgi-bin/u?__=`、`url.cn`）→ 跟 302 → 解析；
    接口用 `c.y.qq.com` 的 `fcg_play_single_song` / `fcg_v8_album_info_cp` / `fcg_v8_playlist_cp`（Referer: y.qq.com）。
  - `/api/audio?source=tencent&id=<songmid>`：`u.y.qq.com/cgi-bin/musicu.fcg` 的 `vkey.GetVkeyServer`
    → `sip[0] + midurlinfo[0].purl`，**http 要改成 https**；`purl` 为空 = 会员/下架 → 404（前端会提示"可能要会员"）。
    ⚠️ `/api/audio` 的 id 校验**不能再用纯数字**（`numId()` 会把 songmid 洗成数字），按 source 分支。
  - `/api/lyric?source=tencent&id=`：`c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?...&nobase64=1`
    （Referer 要 `y.qq.com/portal/player.html`），`trans` 当翻译。
- 前端：导入记录加 `src: 'netease'|'tencent'`；`resolveAudioUrl/resolveLyric(id, src)` 按平台走
  （tencent 只走后端；netease 后端优先、第三方回落）；`urlCache` 键加平台前缀；
  `plId` 用 `txpl:/txal:/txsg:` 前缀区分平台与种类（老的纯数字/`al`/`sg` 仍是网易云），
  `plInfoOf()` 统一解析；歌单体检对 QQ 歌单改用 `/api/resolve` 重新拉曲目表；列表里 QQ 曲目标「QQ音乐」；
  分享码升到 **v2**（`{v:2, items:[{s,k,i}]}`，兼容读 v1）。
- QQ 与网易云的 id 类型不同：网易云是纯数字，QQ 是 14 位字母数字 songmid —— 凡是要"数字 id"的地方都要判平台。
- 测试：E2E 加了 QQ 单曲/专辑/平台标记用例；`.e2e/import-real.mjs` 用**真·免费 Touhou 曲**
  （GET IN THE RING「Thank you for dears.」`00113JQa3vgrwr`）验真机取流（`aqqmusic.tc.qq.com`）。

### 导入规则调整：拿不到音源也入库 + 「导入歌单」（2026-10-15）

用户反馈两条：「导入不了，提示取不到音频」+「外面还叫导入网易云，就叫导入歌单就好」。

- **文案**：`<summary>导入网易云</summary>` → **`<summary>导入歌单</summary>`**；
  单曲页的绑定输入也从「网易云歌曲 ID／链接」改成「歌曲 ID／链接」，现在**网易云数字 ID 或 QQ songmid/链接都能绑**
  （`S.audio[track.id] = {type:'tencent'|'netease', nid}`）。
- **规则**：以前「有歌词 + 有音源」才入库，QQ 会员曲（vkey 返回 `result: 104003`、purl 为空，**连试听都拿不到**）
  会被整首丢掉 → 用户眼里就是"导入不了"。现在改成：**歌词够（带时间轴）就入库**，拿不到音源只标
  `rec.noAudio = 1`（列表显示「无音源」，单曲页出现「绑定音频」入口），导入结果里单列
  `N 首暂无音源（会员曲等，可在单曲页绑）`。失败（`fail`）只留给"歌词拉不到"。
  ⚠️ QQ 会员曲是硬边界（没有账号凭据拿不到地址），别再试图用公共中继兜底（i-meto/qjqq/injahow 对 QQ 全是坏的）。
- E2E 跟着改：桩里新增一首"取不到歌词"（777777777，两个源都 502）保证失败+重试路径仍被测；
  没音源的那首断言"照样入库 + 列表标无音源"。分享码那条改成轮询等待（源多了，1.5s 不够）。

### 罗马音编辑器：真暂停 + 手机键盘（2026-10-15）

用户反馈：「编辑罗马音时没有暂停播放」「手机端键盘会把下方抽屉盖住」。

- **暂停**：以前是"只在 `!audio.paused` 时暂停"，现在**无条件 `audio.pause()`**（没在播也无害），
  并把编辑器里的提示写成「已暂停播放，改完自动继续」/「播放本来就是停着的，改完不会自己响」，
  用户一眼知道发生了什么；`romaWasPlaying` 仍决定保存后要不要续播。
  （本地用**真能解码的 WAV** 复现过：paused false → true → false；headless shell 解不了 mp3，
  所以 E2E 里用 `.e2e/test-tone.wav` 路由桩换源，别再退回"假装 paused"的钩子。）
- **键盘遮挡**：`setupKeyboardAwareSheet()` —— 监听 `visualViewport` 的 resize/scroll，
  键盘高度 = `innerHeight - vv.height - vv.offsetTop`，抽屉 `#pop` 用这个值抬 `bottom`，
  同时把 `maxHeight` 收到可视高度，并把聚焦的 INPUT/TEXTAREA `scrollIntoView({block:'center'})`；
  键盘收起自动复位。测试钩子 `window.__kb(gap)` 可模拟任意键盘高度。
- 罗马音输入框补了 `autocapitalize/autocorrect/spellcheck=off`、`enterkeyhint=done`、`inputmode=latin`
  （手机键盘不再自动大写/纠错）。
- E2E 164/164。

### 安卓 App（Capacitor 壳）：结构、构建、真机验证（2026-10-15，已跑通）

**用户要求**：先只做安卓；音源默认走链接（除非用户自己下载到本地）；自用不传播。

#### 一、仓库结构（M0+M1 已完成并上线）

```
docs/            前端源码 = 发布产物（无构建步骤，原生 ESM）
  app.js         组装：状态/路由/渲染（还没拆完）
  core/          纯逻辑：禁 DOM / 禁平台 API（目前只放了 README，M2 往里搬）
  platform/      平台适配层：kv / net / player / media-session（业务只 import 这里）
  ui/            视图（M3 再拆）
  version.js     版本号唯一来源
app/             Capacitor 工程（webDir = ../docs，前端改一次两端同时生效）
  android/       原生工程（提交进仓库；build/ .gradle/ local.properties 走 .gitignore）
.e2e/            Playwright（网页层 164 条）
.e2e/android/    ★ adb + CDP 的真机验收脚本（cdp.mjs 是页面级 CDP 小客户端）
```

- **分层门禁**：`npm run check`（scripts/check-layers.mjs）——core 禁 DOM/平台 API、
  platform 禁 import ui、ui 与 app.js 禁直接调平台 API。改完前端必须跑，0 违规才算过。
- **版本号**：改前端后跑 `node scripts/bump-version.mjs`（自动把 `20261015d` → `20261015e`，
  同时改 index.html 与所有模块 import 上的 `?v=`）。**必须推**，否则 Pages 的 10 分钟缓存会
  让用户拿到"旧 index.html + 新 app.js"（app.js 已变成 ESM，经典脚本加载会直接语法错误白屏）。
- 删掉了孤儿目录 `web/`（1.3MB，无引用）与两个临时截图。

#### 二、构建（WSL 里，无需 sudo）

```bash
# 一次性：JDK21（清华 Adoptium）+ Android SDK 36（腾讯 AndroidSDK 镜像）
#   ~/tools/jdk-21.0.12.1+1 、~/android-sdk（platforms/android-36 + build-tools/36.0.0）
#   ~/.gradle/init.gradle 已配阿里云 Maven 镜像
export JAVA_HOME=~/tools/jdk-21.0.12.1+1 ANDROID_HOME=~/android-sdk
cd app && npx cap sync android          # 把 docs/ 拷进 android/app/src/main/assets/public
cd android && ./gradlew assembleDebug --no-daemon
# 产物：app/android/app/build/outputs/apk/debug/app-debug.apk
```

- Capacitor 8 要求 **Java 21**、compileSdk/targetSdk **36**、Gradle **8.14.3**（wrapper 已指向腾讯镜像）。
- `app/.npmrc` 指向 npmmirror（npmjs 直连 12s 起步）。
- **坑**：`androidx.media:media:1.7.0` 里 `MediaSessionCompat` / `PlaybackStateCompat` /
  `MediaMetadataCompat` 仍在 **`android.support.v4.media.*`** 旧包名下，只有
  `MediaStyle` 在 `androidx.media.app.NotificationCompat.*`。按 androidx 包名 import 会编译不过。

#### 三、播放层结论（真机实测，别再猜）

| 结论 | 证据 |
|---|---|
| WebView 里 `<audio>` 能播、能 seek、能流式 | 真机 `readyState=4`、进度实时推进、源是网易云 CDN |
| Capacitor 默认已放开自动播放 | `Bridge.java` 里 `setMediaPlaybackRequiresUserGesture(false)` |
| **没有前台服务，后台播放保不住** | 切后台后 WebView 被挂起：CDP 失去响应、回前台进度重置 |
| **挂上 mediaPlayback 前台服务后，息屏后台稳定播放** | 真机连续 90 秒：37.3→112.9s，`isForeground=true` 全程在 |
| WebView **不支持** Media Session Web API | 官方插件原话 + 实测；所以自研插件转 MediaSessionCompat |
| 媒体键闭环可用 | `input keyevent 127/126` → `state=2/3`，音频真的暂停/续播，App 未重启 |
| 媒体会话通知豁免 POST_NOTIFICATIONS | Android 官方文档明文（真机上确实不用申请权限） |

- 前台服务：`PlaybackService`（`foregroundServiceType="mediaPlayback"`，通知带 3 个按钮）。
- 桥：`MediaSessionPlugin`（`update()` 推状态 / `action` 事件回传按键）。
- 前端：`docs/platform/media-session.js`（网页走 navigator.mediaSession，原生走插件，同一接口）。

#### 四、后端 CORS 必须带 App 的 origin（踩过）

App 里页面 origin 是 **`https://localhost`**（iOS 是 `capacitor://localhost`）。
不在 `ALLOW_ORIGINS` 里 → **所有 /api/* 被 CORS 拦死**（登录/注册/同步/解析全废），
而网页端完全正常，很容易漏。`ops/fc/index.js` 默认值与 `ops/deploy-fc.py` 的环境变量都要有。
改后端后别忘了 `python3 ops/deploy-fc.py`。

#### 五、真机验证怎么做（可复用）

- 手机 USB 连 Windows 即可：WSL 里直接调 `adb.exe`（`/mnt/c/Users/zfq/AppData/Local/Android/Sdk/platform-tools/adb.exe`）。
- **CDP 直连 WebView**：Playwright 的 `connectOverCDP` 连不上（WebView 只有页面级端点，
  浏览器级会 1006 断开）。用 `.e2e/android/cdp.mjs`（Node 自带 WebSocket 直连页面）。
  取 socket：`adb shell cat /proc/net/unix | grep webview_devtools_remote` → `adb forward tcp:9222 localabstract:<socket>`。
- 骚扰点：安装/截图需要**手机解锁亮屏**（锁屏时 adb install 会一直挂着）；
  华为 USB 连接会自动弹 HiSuite 抢前台，注意把 App 拉回来。
- 临时账号用完要清：`/tmp/oss.py`（V1 签名小工具）删 `sync/users/<uid>/*` 并从
  `sync/users/_index.json` 移除。清理后索引里只应剩 `zfq` 和 `seki`。

#### 六、Windows 模拟器：当前不可用

- Windows 那套 SDK/模拟器是 **30.8.4（2021）**，且 **WHPX 初始化失败**
  （`Failed to setup partition hr=c0350005`）——因为这台 Windows 跑着 WSL2/Hyper-V 且未开嵌套虚拟化。
- 纯软件模拟（`-accel off`）能起（API 30 / WebView 仅 **Chrome 83**），但极慢：CDP evaluate 会卡死，
  只能做"装上能开"级别的验证，不能当验收环境。**真机才是验收环境。**
- WSL 里 `/dev/kvm` 存在且 `kvm_intel.nested=Y`，docker 可用（镜像站 `dockerproxy.net` 可拉）——
  以后想要自动化回归，可以走"容器里的 Linux 模拟器 + KVM"，但没做。

#### 七、已知待办（真机暴露的）

1. **部分歌只有 30 秒试听**：后端返回的直链 `size≈481KB`（如 752043、Bad Apple 22645196），
   完整曲是 13MB（如 737955）。这是网易云的版权限制，不是 bug；可考虑在导入时提示"试听片段"。
2. **后台恢复时的进度异常**：一次采样里进度从 112.9s 变成 40.8s（App 进程没重启），
   疑似 URL 过期后的 healing 重解析把进度带回去了，待查。
3. **"用户自己下载到本地"这条支线还没做**：按设计是 `local` provider
   （App 端存沙盒 + `convertFileSrc`，网页端 IndexedDB/文件句柄）。注意 `.ncm/.uc!/.qmc*/mflac/mgg`
   这些网易云/QQ 的下载文件是加密容器，**不能直接用，也不要去解密**（规避技术措施是独立违法）。
4. M2（core 抽纯逻辑）/ M3（ui 拆页面）还没做——不影响使用，属于可维护性投资。

### 品牌资源 / 本机音源 / 进度回跳（2026-10-15，真机验证）

#### 一、图标与品牌资源

- 用户给了主图（1254×1254 像素画，**白底 + 内嵌圆角方块**）。处理要点：
  - 先用「非白外接框」裁掉白边，再取**红像素的众数**当背景色 → `#A52628`（别在边中点采样，会取到白底）
  - 四个圆角用 flood fill 填成背景色 → 得到满幅方图
- 生成物（`PYTHONPATH=~/pylibs python3 …`，Pillow 是解包 wheel 装的，系统没有 pip）：
  - 安卓 `mipmap-{mdpi..xxxhdpi}/{ic_launcher,ic_launcher_round,ic_launcher_foreground}.png`
  - 启动页 `drawable{,-port-*,-land-*}/splash.png`（11 张，红底 + 居中图标）
  - 自适应图标前景 = 满幅图缩到画布的 **66%** 居中、四周透明；底色写进 `values/ic_launcher_background.xml`
  - 网站 `favicon.ico`(16/32/48/64) + `icon-192/512.png` + `apple-touch-icon.png` + `manifest.webmanifest`
    （顺带修掉了之前 favicon 404 的控制台报错；登录闸门加了 `.glogo`）
- **后续素材的提示词库在 `spec/ART-assets.md`**（固定风格块 + 负面词 + 6 张图规格）。用户额度用完后暂时没新图。

#### 二、本机音源（用户自己带的文件）

- 原生 `LocalAudioPlugin`：`ACTION_OPEN_DOCUMENT` 选音频 → 复制进 `filesDir/audio/<sha1>.<ext>`（**零权限**）→ 返回 `{key,path,name,size}`。
- 前端 `docs/platform/media-store.js`：原生走插件 + `Capacitor.convertFileSrc(path)`；
  网页端退化成 `<input type=file>` + IndexedDB(Blob) + `createObjectURL`。接口只有 `pick / url / remove`。
- 绑定形态 `S.audio[trackId] = {type:'local', key, path, name}`；`urlFor()` 里 local 分支要**放在 nid 判断之前**，
  `prepAudio()` 也要对本机音频短路（否则会走到「还没有音频」）。
- 真机验证：选择器唤起 → 沙盒落盘字节一致 → `https://localhost/_capacitor_file_/…` 能播 →
  **关掉 Wi-Fi + 数据后仍能播**（`paused:false`、进度推进）。
- ⚠️ 网易云/QQ 客户端下载的 `.ncm/.uc!/.qmc*/.mflac` 是加密容器，**不做解密**，选了也放不了。
- 待办：孤儿文件清理（解绑/删除曲目后沙盒里的副本没人删）。

#### 三、两个真机才暴露的播放 bug（已修）

1. **进度回跳**：地址失效自愈时把播放位置丢了 → 重解析后从头开始（真机后台恢复时 112s → 0s）。
   现在自愈会带上原进度（`currentTime > 3` 用它，否则回落 `S.pos`）。
2. **播完不清进度**：整首听完后再点开，「续播」会直接跳到结尾（看起来像坏了）。现在 `ended` 时清 `S.pos`。

#### 四、测试基建的坑（很值钱）

- **`page.route().fulfill()` 不支持 HTTP Range** → 媒体元素的 `seekable` 恒为 `[0,0]`，
  测试里 `audio.currentTime = x` **静默失效**。自愈续播那条用例因此一直测不出来（假象：
  "失效前 0.44s"）。给桩加 `accept-ranges` + 处理 `Range` 头返回 206 之后，seek 才真正生效。
  但注意：**老用例（罗马音编辑器）依赖原来的无 Range 行为**，所以只有新加的 8 秒长音频桩开了 Range。
- **门禁 `npm run check` 现在带语法检查**（`node --check` 每个前端文件）。真踩过：块注释里写了
  `.qmc*/` 会把注释提前结束 → 整个前端白屏。这类错误以后必须在门禁就被拦下。
- E2E 里新增 `.e2e/test-tone-long.wav`（8 秒）：自愈续播的主路径要求进度 > 3s，3 秒的老文件够不到。

#### 五、真机自动化两个坑（都踩过）

1. **adb 的 `input tap` 用屏幕坐标，页面 `clientY` 从 WebView 顶部算** —— 两者差一个状态栏高度
   （本机实测差 **108 设备像素 / 36 CSS 像素**）。小目标（按钮）不校正就点不到，大目标（歌词区）无所谓，
   所以"有时能点到、有时点不到"最容易误判成代码 bug。
   校正办法：随便点一下，用 `touchstart` 读回 `clientY`，`偏移 = 屏幕y - clientY*dpr`。
2. **合成 click ≠ 真实触摸**：用 `element.click()` 验交互只能证明"逻辑对"，
   证明不了"手指点得到"（弹层位置、遮挡、手势冲突都测不出来）。涉及手势/弹层的交互，
   必须用 `adb shell input tap/swipe` 真打一遍。

#### 六、词抽屉（底部弹层）的交互契约 —— 改之前先读这段

用户连着反馈过三轮，最终形态是：

| 操作 | 行为 |
|---|---|
| 点「词」 | 打开抽屉；已开着时点**另一个词** = 直接切过去看那个词（查词顺手，不要改成收起） |
| 点抽屉外任意区域 | **只关抽屉**，且这一次点击不许穿透到下面的歌词（穿透会"顺手跳到那一句"） |
| 在弹层上往下拖 | 关闭（内容滚到顶才生效，否则会把正常滚动误判成关闭） |
| ✕「关闭」/ Esc | 关闭 |

- **穿透必须在 `click` 的捕获阶段吞掉**：`pointerdown` 拦不住后续的 `click`
  （click 是独立事件），而 `#plyric` 的歌词点击处理函数正是绑在 click 上。
  实现见 app.js 里那条 `document.addEventListener('click', ..., true)`。
- 别用"点同一个词收起"：E2E 的查词/罗马音流程依赖"点别的词切过去"，那样会打断它（踩过，被 E2E 拦下）。
- 有 3 条 E2E 用例守着这个契约（点外部关、点别的词切词、点歌词行不跳句）。
