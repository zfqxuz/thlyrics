# β 视觉重设计截图（demo 数据）

每个页面都拍了两张：warm（暖纸）+ dark（夜墨）。
Demo 数据是浏览器侧临时注入的（8 首东方同人曲），所以曲库/学词页都可见内容。

## 5 个主路由

| 路由 | warm | dark |
|---|---|---|
| 首页 `/#/home` | [warm-home.png](demo-warm-home.png) | [dark-home.png](demo-dark-home.png) |
| 曲库 `/#/songs` | [warm-songs.png](demo-warm-songs.png) | [dark-songs.png](demo-dark-songs.png) |
| 学词 `/#/learn` | [warm-learn.png](demo-warm-learn.png) | [dark-learn.png](demo-dark-learn.png) |
| 生词本 `/#/mine` | [warm-mine.png](demo-warm-mine.png) | [dark-mine.png](demo-dark-mine.png) |
| 我的 `/#/me` | [warm-me.png](demo-warm-me.png) | [dark-me.png](demo-dark-me.png) |

## 单曲 + 跟唱 + 词条（demo 数据）

| 视图 | 截图 |
|---|---|
| 单曲页（warm） | [demo-warm-track.png](demo-warm-track.png) |
| 单曲页（dark） | [demo-dark-track.png](demo-dark-track.png) |
| 跟唱页（warm） | [demo-warm-player.png](demo-warm-player.png) |
| 跟唱页（dark） | [demo-dark-player.png](demo-dark-player.png) |
| 词条弹层（warm） | [demo-warm-pop.png](demo-warm-pop.png) |

## 本地预览这个截图集

```bash
git checkout beta/visual-redesign
node scripts/serve.mjs 8848
# 然后打开这些链接（带 # 后缀跳到对应路由）：
# http://127.0.0.1:8848/#/home
# http://127.0.0.1:8848/#/songs
# http://127.0.0.1:8848/#/learn
# http://127.0.0.1:8848/#/mine
# http://127.0.0.1:8848/#/me
# 单曲 + 跟唱需要先在曲库里有点歌，demo 数据需要本地注入（见 scripts/shoot.mjs）
```
