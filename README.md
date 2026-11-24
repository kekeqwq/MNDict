# MNDict

MarginNote 5（MN5）的离线词典插件，从 Yomitan 词典生态出发，为阅读 PDF 时的查词而写。非浏览器移植，是按 MN5 场景插件 + 经典 JSB 混合形态（MN Rails 规范）重构的独立工程。

## 功能

- **词典管理（插件设置窗口）**：导入 Yomitan `.zip`（v3：`index.json` + `term_bank_*.json`），列表中可启用/停用、上移/下移调整查询优先级、删除（级联清理词条）。导入全程显示解压/解析/写入日志与进度。
- **离线查询**：词条、读音、标签、结构化释义（渲染为纯文本，不执行词典 HTML/JS）；英文走词形还原（复数/时态），NFKC 归一化匹配。
- **持久化**：词典索引存 IndexedDB（`io.github.kekeqwq.mndict.library`）；划词开关存 `NSUserDefaults`。
- **PDF 划词自动查**：场景内划选文字即弹出释义（不创建摘录、不改文档）。开关在插件设置里，默认关闭。
- **试查**：设置窗口内置手动查词，导入后可立即验证。

## 安装

构建产物在 `release/`：

- `MNDict-0.1.0.mntemplate` — 场景模板包（含插件）。场景界面 → 顶部「场景模板」菜单 → 编辑场景模板… → 管理场景模板 → 导入场景模板…
- `MNDict-0.1.0.mnaddon` — 仅插件包。设置 → 三个点 → 插件 → 导入。

未认证插件需先在设置里允许。导入模板后，MNDict 按钮出现在底部工具条（胶囊按钮）。

## 开发

```bash
npm install
npm test          # 词典导入/查询/持久化的单元测试（fake-indexeddb + 内存 ZIP）
npm run check     # ESLint + TypeScript
npm run build     # 产物进 dist/
npm run package   # 安装包进 release/
npm run sync      # 同步到本机 MarginNote 并重启（仅 macOS，会重启 App）
```

## 结构

```
native/main.js        # JSB 入口：划词通知 PopupMenuOnSelection、面板生命周期、查询命令
native/PanelBridge.js # 原生持久化：NSUserDefaults 划词开关
src/App.tsx           # 设置窗口 + 迷你释义浮层（同一面板两种模式）
src/dictionary.ts     # IndexedDB 词典库：导入、查询、启停、排序、删除
src/yomitan.ts        # Yomitan v3 ZIP 解析、词条校验、结构化释义纯文本化
template/             # 场景模板（底部工具条接入插件入口）
```

## 状态与计划

- [x] Yomitan v3 词典导入、管理、离线查询
- [x] IndexedDB 持久化（单测覆盖重开后仍在；App 重启待真机验证）
- [x] PDF 划词自动查（`PopupMenuOnSelection`，macOS/iPadOS 同一路径）
- [ ] 单击未选中单词直接查词（需在 MN5 阅读器里验证「点击坐标 → 词」，不行就保持划词）
- [ ] macOS / iPadOS 双端真机验证：IndexedDB 持久化、文件导入、触控

## 致谢

词典格式与词形还原思路来自 [Yomitan](https://github.com/yomidevs/yomitan)（GPL-3.0）；英文词形还原使用 [wink-lemmatizer](https://github.com/winkjs/wink-lemmatizer)（MIT）；ZIP 解析使用 [zip.js](https://gildas-lormeau.github.io/zip.js/)（BSD-3-Clause）。
