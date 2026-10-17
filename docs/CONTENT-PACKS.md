# 内容包：词库、等级词表、释义层

学词用的是「共享词库 + 等级词表 + 语言对释义层」三层结构，不是每种语言、每个考试复制一本词典。

```
docs/data/<lang>/lexicon.json     共享词库（一条词 = 一个条目，含 id/word/pos/释义/等级/词形）
docs/data/<lang>/lists/<x>.json   等级词表（只存 wordIds，指向 lexicon）
docs/data/<lang>/pairs/<a>-<b>.json  语言对释义层（a 语词条 → b 语解释）
docs/data/<lang>/manifest.json    该语言有哪些词表（前端「学习范围」chips 就来自这里）
docs/data/content-report.json     覆盖率报告（每种语言 top1000/3000/10000 的覆盖率）
```

## 现有内容

| 语言 | 词条 | 等级/范围 | 释义来源 |
| --- | --- | --- | --- |
| 日语 | 6,604 | 标日初级上/下、中级上/下、JLPT N5–N1 | 现有 THBWiki/标日/JLPT 词库 + ja-zh 释义层 |
| 英语 | 14,936 | 中考、高考、CET-4/6、考研、IELTS、TOEFL、GRE | ECDICT（MIT） |
| 法语 | 10,674 | 核心虚词、最高频 1k/3k/6k/10k/20k | 中文维基词典（CC BY-SA 3.0） |
| 德语 | 19,399 | 同上 | 中文维基词典 |
| 西班牙语 | 12,782 | 同上 | 中文维基词典 |
| 葡萄牙语 | 8,482 | 同上 | 中文维基词典 |
| 俄语 | 10,831 | 同上 | 中文维基词典 |
| 韩语 | 9,604 | NIKL A/B/C、TOPIK 초급/중급、频率档 | 中文维基词典 + NIKL/TOPIK 词表 |

覆盖率（`content-report.json`，语料前 N 高频词能在词库里查到的比例，含活用形）：

| 语言 | top1000 | top3000 | top10000 |
| --- | --- | --- | --- |
| 法语 | 80.1% | 72.3% | 62.2% |
| 德语 | 89.1% | 86.9% | 78.8% |
| 西班牙语 | 78.5% | 73.0% | 64.9% |
| 葡萄牙语 | 61.8% | 50.7% | 41.4% |
| 俄语 | 73.6% | 65.7% | 58.6% |
| 韩语 | 45.8% | 32.3% | 26.1% |

> 频率档 = OpenSubtitles 语料词频分档（最高频 1000 / 3000 / 6000 / 10000 / 20000）；
> 它是「覆盖率档位」，**不是官方 CEFR / TRKI 词表**，manifest 里也是这么写的。
> 韩语的 NIKL(A/B/C) 与 TOPIK(초급/중급) 是真实官方等级标签。

## 数据来源与许可

| 数据 | 用途 | 许可 |
| --- | --- | --- |
| [ECDICT](https://github.com/skywind3000/ECDICT) | 英语词条 + 考试标签 + 中文释义 | MIT |
| [kaikki.org 中文维基词典导出](https://kaikki.org/dictionary/downloads/zh/zh-extract.jsonl.gz) | 法/德/西/葡/俄/韩词条的中文释义 | CC BY-SA 3.0 |
| [FrequencyWords](https://github.com/hermitdave/FrequencyWords) | 语料词频（分档、覆盖率） | MIT |
| [NIKL + TOPIK 合并词表](https://github.com/julienshim/combined_korean_vocabulary_list) | 韩语等级标签 | MIT |
| `data/function-words/<lang>.json` | 高频虚词人工核对表（der/und/de/para 这类词典里常缺的词） | 本项目 |

## 重建

原始数据不进 git（体积太大），放在：

```
data/ecdict/ecdict.csv                 英语
data/freq/zh-extract.jsonl.gz          中文维基词典导出（约 234MB）
data/freq/<lang>_50k.txt               语料词频
data/ko-topik.tsv                      韩语等级词表（已进 git）
```

```bash
node scripts/build-lang-packs.mjs        # 日语 + 英语
node scripts/build-multilang-packs.mjs   # 法/德/西/葡/俄/韩 + content-report
```

## 词形匹配

歌词里出现的是活用形，词库收的是原形。两层兜底：

1. **构建期**：`scripts/lang-forms.mjs` 按规则生成变位/复数/格变化（只挂词库里没有独立词条的形），
   写进 `forms.exchange`；中文维基词典里「X 的复数/属主格」这类条目也挂成 X 的别名。
2. **运行时**：`lookupWord()` 去变音符号 + 常见屈折后缀回退（先补回原形词尾再查，
   避免 `maisons → mais`、`chante → chant` 这种同形撞车）。

## 已知缺口

- 中文维基词典对葡萄牙语、韩语覆盖偏薄（见上表），补法要换词源，不是调参数能解决的。
- 不规则变位（être→suis、ir→voy、идти→шёл）没有规则可推，只靠词典自带的活用条目。
- 「语言对释义层」目前只有 `<lang>-zh`；`learnLang ≠ zh` 且 `explainLang ≠ zh` 的语言对还没预生成。
- 学习语言为「中文」时还没有 HSK 词表与 zh→外语释义层。
