# thlyrics（东方同人曲 学唱机）

从**东方同人曲的歌词**里学日语词、练跟唱的小工具。数据管道 + 纯静态前端，不需要后端。

灵感来自 [NakayamaFesta/popipa-tango-dreamer](https://github.com/NakayamaFesta/popipa-tango-dreamer)（Popipa 单词机），
但东方同人曲的结构不同，所以数据模型换了一套：

| | popipa 单词机 | 本项目 |
|---|---|---|
| 键 | 一首歌 = 一份歌词 | 原曲 ↔ 曲目（社团/专辑）↔ 歌词 |
| 词表 | 人工整理 | 从歌词自动分词（kuromoji）+ 辞书形还原 |
| 时间轴 | 无 | LRC 自带时间轴（THBWiki 提供的曲目有） |
| 读音 | 罗马音为主 | 假名为主 + 罗马音可开关 |

## 数据来源

- 歌词：**THBWiki 歌词服务** `https://lyrics.thwiki.cc`（LRC 格式，带 `ti/al/ar/cv` 元数据）
- 搜索：`https://thbwiki.cc/api.php?action=opensearch&namespace=512`（namespace 512 = 歌词命名空间）
- 两者都是公开接口。**歌词版权归各社团 / 原作者所有，仅供个人学习，请勿传播或商用。**

## 目录结构

```
thlyrics/
├── data/
│   ├── raw/            # 抓下来的原始 .lrc（每首一个文件）
│   ├── index.json      # 解析+分词后的完整数据集
│   ├── queries.txt     # 抓取用的关键词清单（每行一个，可自己加）
│   └── fetch-log.json  # 抓取日志（成功/失败/URL）
├── scripts/
│   ├── fetch-lyrics.mjs  # 抓歌词
│   ├── build-index.mjs   # 解析 LRC + 分词 + 生成 JSON
│   ├── kana-romaji.mjs   # 假名 -> 罗马音
│   └── serve.mjs         # 本地静态服务
└── web/                # 前端（无构建、无依赖）
    ├── index.html
    ├── app.js
    └── data/index.json + covers/
```

## 用法

```bash
# 0) 依赖（只需要分词和罗马音用的包）
npm install

# 1) 抓歌词：按关键词搜索并下载
node scripts/fetch-lyrics.mjs --query "少女綺想曲" --limit 5
node scripts/fetch-lyrics.mjs --from data/queries.txt --limit 40   # 批量
node scripts/fetch-lyrics.mjs --title "幽雅に咲かせ、墨染の桜（トマト組）"  # 精确抓某一个

# 2) 生成数据集（加 --covers 会顺带下载专辑封面）
node scripts/build-index.mjs --covers --stats

# 3) 本地打开前端
node scripts/serve.mjs 8848     # 然后访问 http://127.0.0.1:8848/
```

参数说明：
- `--delay` 抓取间隔毫秒数，默认 1200，别调太小（对 wiki 友好）
- `--force` 已存在的文件也重新抓
- `--lang all|ja|zh` 取哪种语言的 LRC（默认 all）

## 前端功能

- **歌词**：按原曲分组的曲目列表；进曲目后有
  - 逐行朗读（浏览器日语 TTS，点句子也能单读）
  - 点任意词弹出读音 / 罗马音 / 词性 / 在库里出现多少首
  - `只高亮没学的词` 开关、`隐藏罗马音` 开关
  - 标记「已能脱稿」
- **单词卡**：卡片翻转（日文 → 假名 + 罗马音 + 词性 + 歌词里的活用形），
  间隔复习 1 / 3 / 7 天，连对 3 次算掌握；空格翻面、←→ 判对错
- **词表**：全库词表，按出现曲数排序，可搜词/读音/罗马音
- **进度**：掌握数、连续学习天数、错得最多的词；进度导出/导入 JSON

进度存在浏览器 localStorage，换设备用「导出进度」带走。

## 数据结构（web/data/index.json）

```
stats      统计（曲目数/词表数/有时间轴的曲目数…）
originals  [{ name, tracks[] }]            原曲 -> 该原曲下的曲目
tracks     [{
  id, title, base, artist, album, coverFile,
  timing,                                 是否有真实时间轴
  lines: [{ t(秒), text, jp, romaji, segs }]
  vocabIds                                这首歌用到的词表 id
}]
vocab      [{
  id, word(辞书形), surface, reading(假名), romaji, pos, count,
  tracks[], forms{ 活用形: {readingHira, romaji, tracks[]} }
}]
```

`segs` 是分词结果，`{s:表面形, w:是否值得学, b:辞书形, l:词条读音, r:表面形读音, y:罗马音, p:词性}`。

## 已知限制

- **读音还原不是词典级**。动词活用形 -> 辞书形的还原是自己写的规则（kuromoji 的 `base_form`
  对五段动词经常给活用形、对一段动词给词干），绝大多数正确，但个别词（如「経つ」「縫う」
  这种在歌词里只以促音便出现的）读音可能不准。发现错读直接改 `vocab.json` 对应条目，
  或者给 `build-index.mjs` 的词表加手工覆盖表。
- 只有 12 / 44 首的 LRC 带真实时间轴，其余是全 0；所以没做卡拉OK级同步，只做逐行朗读。
- 时间轴 = 音频对齐没做（需要本地音频文件）。
- 中文释义还没接（下一期可接 JMDict / 词典 API 或手工补）。
- 纯片假名外来语、纯英文行暂不进词表。

## 下一步可以做的

1. 接音频：本地放 mp3/m4a，按 LRC 时间轴做逐句高亮 + 变速跟读（0.75x / 0.9x）。
2. 词义：接一个日汉词典，或按 CSV 手工补 `meaning` 字段。
3. 语法卡：把 `forms` 里的活用形做成「て形 / た形 / ない形」的练习题。
4. 覆盖更多社团：往 `data/queries.txt` 里加关键词批量抓。
