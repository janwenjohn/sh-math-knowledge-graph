# 数学知识探索平台 · Community 0.3.2

本文件记录本次发行相对上一版本的变化，供升级前核对。运行方式与内容范围见同目录 `README.md`。

## 内容统计

- math-g6a@v04: {"points": 90, "relations": 61, "elements": 1301, "mastery": 433, "contexts": 29, "fusedSyllabusPoints": 49}
- g6a-set1: {"questions": 785, "images": 159}

## 本次说明

- 根路径 / 改为宣传落地页，知识库应用移至 /app（应用内 hash 路由与绝对资源路径不变）。
- 落地页保留原有分享标签与 canonical，并新增 hash 跳转脚本：旧链接 /#view=... 自动转到 /app#view=...。
- 服务端静态白名单新增 landing.html 与 app.html，版本号替换只作用于应用页。

## 校验

* `release-manifest.json` 记录数据集、题集映射与逐文件 SHA-256；`SHA256SUMS` 另行覆盖清单本身。
* 修改说明文档不影响启动；代码或内容文件被改动时，服务启动会拒绝加载并提示摘要不一致。
* 包内知识、考纲映射与练习题的审阅状态仍为 `PENDING`，技术校验不代替人工审核。
