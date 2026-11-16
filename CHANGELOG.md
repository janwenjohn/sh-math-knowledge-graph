# community 0.3.2

相对 0.3.1 的公开文件变化。

## 本次说明

- 根路径 / 改为宣传落地页，知识库应用移至 /app（应用内 hash 路由与绝对资源路径不变）。
- 落地页保留原有分享标签与 canonical，并新增 hash 跳转脚本：旧链接 /#view=... 自动转到 /app#view=...。
- 服务端静态白名单新增 landing.html 与 app.html，版本号替换只作用于应用页。

已知数学内容疑点见 KNOWN_ISSUES.md，技术校验不代替人工审核。

内容由AI辅助分析或生成，可能存在错误或遗漏，请自行核实、审慎使用。

## 内容

- math-g6a@v04: {"points": 90, "relations": 61, "elements": 1301, "mastery": 433, "contexts": 29, "fusedSyllabusPoints": 49}
- g6a-set1: {"questions": 785, "images": 159}

## 变更文件

- apps/knowledge_review/portal/src/catalog.py
- apps/knowledge_review/portal/src/fusion.py
- apps/knowledge_review/portal/src/practice.py
- apps/knowledge_review/portal/src/resources.py
- apps/knowledge_review/portal/src/server.py
- apps/knowledge_review/portal/web/app.html
- apps/knowledge_review/portal/web/landing.html

## 移除文件

本次调整移除了 6 个旧路径，内容已在新路径下发布。
