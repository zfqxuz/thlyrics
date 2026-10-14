core/ 层：**纯逻辑**，不许出现 DOM / localStorage / fetch / Audio / navigator（门禁脚本会检查）。
这一层要能在 node 里直接跑，便于单测。
目前为空，M2 会把 LRC 解析、罗马音、词库、排序、分享码、合并等纯函数搬进来。
