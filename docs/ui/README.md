ui/ 层：**视图**，可以有 DOM。
不许直接调平台 API（localStorage / fetch / new Audio / indexedDB），一律走 platform/。
目前为空，M3 会把 app.js 里的页面渲染拆进来。
