# MNDict

MNDict 是 MarginNote 5 的离线词典插件，支持在 macOS 和 iPadOS 上划选 PDF 文字查词。词典采用 Yomitan 格式，数据保存在本机。

## 安装

到 [GitHub Releases](https://github.com/kekeqwq/MNDict/releases/latest) 下载：

- **`.mnaddon`**：插件包。通过 MarginNote 的插件管理导入；在 iPad 上也可从「文件」App 分享给 MarginNote。
- **`.mntemplate`**：可选的场景模板包，已包含插件。通过 MarginNote 的场景模板管理导入，可直接使用底部工具栏的 MNDict 入口。

如遇到未认证插件提示，请先在 MarginNote 设置中允许。安装包不包含词典，打开 **MNDict 设置**后导入 Yomitan v3 `.zip`，再打开「PDF 划词后自动显示释义」。请用有文字层的 PDF；单击未选中的词不会查词。

## 功能

- **划词查词**：左侧卡片显示词条、读音、标签和结构化释义，保留词典排版；支持英文词形还原。
- **词典管理**：在设置中导入、启用或停用、排序、删除词典；导入过程显示实时日志。
- **本地存储**：使用原生 SQLite 保存词典索引并保留导入的 ZIP 备份，不需要联网查词。
- **发音与 Ask AI**：可点按播放发音或开启自动发音；Ask AI 交给 MarginNote 原生对话。在线发音与原生 AI 不属于离线查询。
- **Catppuccin**：跟随 MarginNote 界面模板，白色和棕褐色用 Latte；灰色、暗黑和绿色用 Macchiato。

## 开发

```bash
npm ci
npm run check     # ESLint + TypeScript
npm test          # 词典、备份传输与主题映射测试
npm run build     # 构建到 dist/
npm run package   # 生成 release/ 下的安装包
npm run sync      # 部署到本机 MarginNote 并重启（仅 macOS）
```

安装包作为 GitHub Release 附件分发，不提交到 Git。

## 致谢

词典格式参考 [Yomitan](https://github.com/yomidevs/yomitan)，英文词形还原使用 [wink-lemmatizer](https://github.com/winkjs/wink-lemmatizer)，ZIP 解析使用 [zip.js](https://gildas-lormeau.github.io/zip.js/)，配色来自 [Catppuccin](https://catppuccin.com/palette/)。
