# iOS 风 UI（第二套皮肤）· 灵感调研与落地

日期：2026-10-18
范围：只换视觉层，不改业务逻辑；「我的 → 外观 → 界面风格」在「经典 / iOS」之间切换。

## 一、调研的公开来源（14 个）

以下页面于 2026-10-18 用桌面 / 移动两种视口抓取 HTML、计算样式并截图（截图只在本机分析，不进仓库）。
用途是提炼共同语言，不把任何站点素材复制进产品。

| # | 来源 | 类型 | 观察到的设计语言 | 本项目的取舍 |
|---|---|---|---|---|
| 1 | [Apple Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/) | 平台规范 | SF Pro、系统色、tab bar、sheet、inset grouped list、克制的半透明 | 作为 iOS 皮肤的第一基准：系统字体栈、底部 tab、圆角 sheet、分组卡片 |
| 2 | [Mobbin · iOS apps](https://mobbin.com/browse/ios/apps) | 移动 UI 素材库 | 大量真实 iOS App 的 tab bar / sheet / 大标题 / 控件状态 | 底部毛玻璃 tab bar、页面大标题、卡片内缩分隔线 |
| 3 | [v0 by Vercel](https://v0.dev) | Vibe coding / AI 生成 UI | 近白背景、近黑文字、8/12px 圆角、提示词居中的空白感 | 浅色底 + 高对比文字 + 克制的圆角和阴影 |
| 4 | [Bolt](https://bolt.new) | Vibe coding | 深色画布、蓝色渐变、pipeline 状态、胶囊标签 | 深色模式用蓝色光晕与胶囊按钮，不用重描边 |
| 5 | [Cursor](https://www.cursor.com) | AI 编程工具 | 暖白纸感、editorial 大字、细线、黑底反白按钮 | 标题层级与留白；按钮用 filled / tinted 两档 |
| 6 | [Framer](https://www.framer.com) | AI 设计工具 | 黑底高对比、超大标题、圆角卡片、短过渡 | 首页主视觉卡、48–64px 触控按钮、短 easing |
| 7 | [21st.dev](https://21st.dev) | Vibe coding 组件库 | 8/6/12px 圆角、胶囊 chip、紫色强调、极细边框 | 筛选 chip 与 tab 的胶囊形态 |
| 8 | [Aceternity UI](https://ui.aceternity.com) | Vibe coding 组件库 | 9.6/13.6px 圆角、bento 卡片、轻边框、hover 微光 | 卡片圆角统一到 14–20px，阴影很浅 |
| 9 | [Magic UI](https://magicui.design) | Vibe coding 组件库 | Geist、透明图层、dot/grid 背景、毛玻璃 | 底部 tab bar 与迷你播放条的 backdrop-filter |
| 10 | [shadcn/ui](https://ui.shadcn.com) | 设计系统 | 语义 token、8/10px 圆角、中性灰层级 | 用 CSS 变量一次性换整套色板，而不是逐组件硬编码 |
| 11 | [Subframe](https://www.subframe.com) | Vibe coding 设计工具 | 浅灰底、超大无衬线标题、999px 胶囊按钮 | 大标题 + 胶囊次级操作 |
| 12 | [Onlook](https://onlook.com) | Vibe coding 可视化开发 | 深色半透明面板、69 处 backdrop-filter、细描边 | 深色 iOS 的 glass 面板与浮层 |
| 13 | [Godly](https://godly.website) | 网页设计灵感库 | 白底、8px 卡片、胶囊筛选、编辑式网格 | 内容优先、控件弱化、无装饰性边框 |
| 14 | [Awwwards](https://www.awwwards.com) | 网页设计奖项库 | 超大 display type、8/14px 圆角、强留白 | 大标题与列表之间的呼吸感 |

补充看过但因 403 / 网络切换未纳入计数的站点：Lovable、Uiverse、Land-book、Lapa Ninja、Pageflows、Screenlane。
公开素材只用于观察；产品内图标继续使用仓库已有的 Lucide v0.468.0（ISC），未引入第三方图片或字体文件。

## 二、提炼出的 6 条 iOS / Vibe coding 共同语言

1. **系统字体优先**：标题不再用宋体/明朝体，改用 SF Pro / PingFang 栈，字重 600–700，负字距。
2. **两层表面**：页面底是 grouped background，内容放在白色/深灰 surface 卡片上；分隔线内缩、颜色很淡。
3. **玻璃只在“浮起来”的东西上**：底部 tab bar、迷你播放条、sheet、下拉菜单、播放器控制区；正文区域不用玻璃。
4. **触控尺寸**：按钮 44–52px 高，开关 51×31，chip 32px，列表行 ≥52px；圆角 10/14/18/26 四档。
5. **色彩克制**：系统蓝作唯一主强调色，绿色只表示成功/开关开启，红色只表示危险；词性色保留但换成 iOS system palette。
6. **动效短而直接**：160–220ms、cubic-bezier(.2,.8,.2,1)，只做位移/透明度/背景色，不做弹跳。

## 三、落地方式

- 第二套皮肤全部写在 `docs/index.html` 末尾的 `body.ui-ios` 作用域里；不复制 DOM 结构，避免两份页面逻辑。
- 设计令牌集中在 `body.ui-ios`（深色）与 `body.ui-ios.warm`（浅色）两组变量：surface / ink / accent / field / hairline / shadow / radius。
- 经典皮肤的选择器不受影响；`applyUI()` 只切 `body.ui-ios` 一个类。
- 新增入口：`renderMe()` 的「外观」分组里增加「界面风格 · 经典 / iOS」，状态存 `S.ui`，写入本机并跟随账号数据。
- 底部 tab bar 使用原有 `#tabs` 四个按钮，增加四个 Lucide 图标；经典模式下图标 `display:none`，保持原样。
- 没有新增图片请求；iOS 皮肤的视觉重量来自排版、留白、材质和系统色。

## 四、验证

- `npm run check`：分层检查 + 文案门禁通过。
- Playwright（400×850 / 390×844）验证：切换后 `body.ui-ios` 生效、刷新后保持、tab bar 固定底部、没有横向溢出、深色/浅色两套令牌都正确。
- 原有 E2E 分组回归（`me` / `player` / `songs`）继续通过。
