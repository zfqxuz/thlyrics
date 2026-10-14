# 美术资源：提示词与规格（交给 GPT 出图）

现状：App 图标 / 网站 favicon / 启动页已用用户提供的像素图生成完毕（`#A52628` 底）。
本文件是「后续让 GPT 产出一致风格素材」的提示词库。**拿回来的图直接丢给我，我负责裁切落位。**

## 0. 固定风格块（每次都贴上，保证一套图是一个人画的）

```
Retro 16-bit pixel art, chibi anime shrine maiden (original Touhou-inspired design, not an existing character),
flat solid colors only — no gradients, no glow, no blur, no 3D shading, no anti-aliasing, crisp hard-edged pixels,
bold dark outline (#301820) 1–2px. Limited palette:
vermilion red #A52628, dark red #781818, highlight red #C03030, off-white #F8F8F8, cream #F8F0F0,
dark brown-black #301820, hair brown #503038, skin #F8E0D8, gold #F8C070.
```

**负面词（每次都加）：**
```
no text, no letters, no watermark, no signature, no logo text, no gradient, no glow, no lens flare,
no drop shadow, no 3D render, no photo, no realistic shading, no noise, no dithering artifacts,
no extra fingers/limbs, no modern UI elements, no frame, no border artifacts
```

## 1. App 主图标（1024×1024，正方形）→ 也是网站 icon-512 / 192 / apple-touch 的来源

```
[风格块] Single square app icon: solid vermilion red #A52628 rounded-square (corner radius ≈ 22% of the side)
with a thin off-white #F8F8F8 inner border. Centered: a chibi shrine maiden with a dark brown bob, red hair ribbon,
white-and-red miko outfit with a gold bow, holding a gohei wand. Behind her: a white torii gate silhouette on the right,
a small black-and-white yin-yang orb at the top right, 3–5 pale pink sakura petals drifting.
Character occupies ~70% of the frame, face slightly below center. Keep the outer 8% as plain red (safe margin). Square, centered.
```

## 2. 自适应图标前景（1024×1024，**透明底**）→ 安卓 8+ 用，缺了它图标会被裁成奇怪形状

```
[风格块] Same chibi shrine maiden as the app icon, but: FULLY TRANSPARENT background (PNG alpha), no red square,
no border, no petals touching the edges. Only the character + her wand, centered, occupying just the middle 60% of the canvas,
with generous transparent margin on all four sides. Flat, crisp pixels.
```

## 3. 启动页（竖版 1280×1920）→ 冷启动那 1 秒

```
[风格块] Vertical splash screen, 1280x1920: solid vermilion red #A52628 background.
One centered rounded-square app icon (same shrine maiden) at ~35% of the width, placed slightly above the middle.
Everything else is empty flat red — no pattern, no vignette, no text.
```

## 4. 社交分享卡（1200×630，横版）→ 微信/QQ 转发时的缩略图

```
[风格块] Horizontal share card 1200x630: flat vermilion red #A52628 background,
the chibi shrine maiden icon on the RIGHT third (about 40% of the height), the LEFT two-thirds left empty for a title,
one thin off-white horizontal rule and 2–3 sakura petals as the only decoration. No text.
```

## 5. 空状态插画（512×512，透明底，可选）

```
[风格块] Small spot illustration on transparent background: the same chibi shrine maiden sitting cross-legged,
looking at a floating music note, extremely minimal — at most 3 colors, low detail, readable at 96px.
```

## 6. 字标（**建议不做**，见下）

```
[风格块] Pixel-art logotype reading "TH LYRICS", bold 8-bit capitals, off-white #F8F8F8 with dark #301820 outline,
letter-spacing tight, on transparent background.
```
⚠️ 图像模型写英文单词经常缺笔画/拼错。字标建议我来排（找一个开源像素字体排版导出 PNG），只让模型出装饰元素。

## 7. 出图与交付要求

- 一次生成 4 张，挑最干净的那张；**同一个对话里连着出**，风格更稳。
- **必须正方形**（启动页竖版、分享卡横版除外），尺寸不精确也没关系，我会重采样（LANCZOS）。
- **绝对不要有文字/签名/水印**。
- 透明底拿不到就给纯白底，我来抠（已有的那张就是白底，我是按 flood fill 处理圆角的）。
- 出完把原图发我，我会自动产出：
  - 安卓：`mipmap-{mdpi..xxxhdpi}/{ic_launcher,ic_launcher_round,ic_launcher_foreground}.png`（5 档 × 3 种）
  - 启动页：`drawable{,-port-*,-land-*}/splash.png`（11 张）
  - 网站：`favicon.ico`（16/32/48/64）+ `icon-192.png` + `icon-512.png` + `apple-touch-icon.png` + `manifest.webmanifest` 底色
  - 分享卡：`docs/og.png` + `<meta property="og:image">`
- 换图流程：替换 `app/android/app/src/main/res/...` 与 `docs/icon-*.png` → `npx cap sync android` → `./gradlew assembleDebug` → 推 Pages。
