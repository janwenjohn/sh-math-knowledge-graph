# community 0.3.0

相对 0.2.0 的公开文件变化。

## 本次说明

- 全量去除外部出版物与来源暗示：题库目录、文件名、题目 ID、溯源字段与配图前缀均改为中性命名。
- 前端统一为“配套练习 / 全部题集 / 思路分析 / 解题解析 / 考纲”，并移除维护侧书号与栏目映射。
- 说明文档改用客观表述，界面截图在文案清洗后重新截取。
- 构建流水线新增零版权暗示审计：路径与文本命中禁词即阻断发行。

已知数学内容疑点见 KNOWN_ISSUES.md，技术校验不代替人工审核。

内容由AI辅助分析或生成，可能存在错误或遗漏，请自行核实、审慎使用。

## 内容

- math-g6a@v04: {"points": 90, "relations": 61, "elements": 1301, "mastery": 433, "contexts": 29, "fusedSyllabusPoints": 49}
- g6a-set1: {"questions": 785, "images": 159}

## 变更文件

- content/knowledge_graph/1.数学/6a/fusion_release_v01.json
- content/knowledge_graph/1.数学/6a/g6a_question_knowledge_v01.json
- content/question_bank/ai_generated/1.数学/6a/set_g6a_01/assets.json
- content/question_bank/ai_generated/1.数学/6a/set_g6a_01/difficulty.json
- content/question_bank/ai_generated/1.数学/6a/set_g6a_01/questions.json

## 移除文件

本次调整移除了 38 个旧路径（含内部编号），内容已在新路径下重新发布。
