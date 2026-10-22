# Zotero One-Key PDF Annotations · v0.3.0

为 Zotero 内置 PDF 阅读器添加**无修饰键的单键标注**。不使用 AutoHotkey，不修改 Zotero 的已有标注数据，不会在普通 Zotero 条目列表或正文输入框中覆盖打字。

## 快捷键

| 物理按键 | 操作 | Zotero 原生颜色 | 自定义含义 |
|:--:|---|---|---|
| `Q` | 高亮 | 黄色 `#ffd400` | General note |
| `W` | 高亮 | 红色 `#ff6666` | Intention |
| `E` | 高亮 | 绿色 `#5fb236` | Method they use |
| `R` | 高亮 | 蓝色 `#2ea8e5` | Results |
| `T` | 高亮 | 紫色 `#a28ae5` | Inference |
| `Y` | 高亮 | 品红 `#e56eee` | Jargon |
| `G` | 高亮 | 橙色 `#f19837` | Explanation |
| `F` | 高亮 | 灰色 `#aaaaaa` | Limitation |
| `Z`、`X`、`C`、`V` | 便签注释 | 依次黄／红／绿／蓝 | 四个便签颜色 |
| `M` | 矩形区域标注 | 采用原生区域工具颜色 | Area / Image annotation |
| `D` | 删除当前选中的一条/多条标注 | 不适用 | Zotero 原生删除（多选有确认） |
| `Alt+H` | 隐藏全部标注 | 不适用 | 仅隐藏，不删除 |
| `Alt+S` | 显示全部标注 | 不适用 | 恢复显示 |

### 使用方式

- 未选中文字时，`Q/W/E/R/T/Y/G/F` **切换**到相应颜色的高亮工具；随后鼠标拖选文本即可标注。
- 已选中文字时，直接按颜色键就**立即保存**对应颜色的高亮，不需要另点弹窗。
- `Z/X/C/V` 切换不同颜色的**便签**工具，然后在页面上点一下放置。
- `M` 切换到 Zotero 的 **Area/Image** 工具，再拖拽一个矩形区域。注意：**这不是矩形边框绘图**，而是 Zotero 原生矩形区域标注。
- `D` 只有选中一个或多个标注时才会删除，**没有选中标注时不操作**。多选交给 Zotero 原生的确认对话框处理。
- `Alt+H` 只将当前阅读器所有标注**隐藏**，不修改标注数据。`Alt+S` 重新显示。两者在只读 PDF 中也有效；不会影响其他 PDF 阅读器标签的永久标注数据。
- `Esc`、复制粘贴组合键及其他未映射的 Zotero 快捷键仍按原生方式使用；阅读器内的 `R` 则让位给 Results 高亮。

## 安装 / 升级

1. 在 [GitHub Releases](https://github.com/Molaison/zotero-onekey-annotations/releases) 下载 `onekey-pdf-annotations-0.3.0.xpi`（**不需要**解压）。
2. Zotero → **工具 → 插件 → 右上角齿轮 → 从文件安装插件**。
3. 选择 `.xpi`，确认；若已经安装 v0.1.0，则是同一插件 ID 的就地升级。
4. 关闭并重新打开现有 PDF 标签页。若新快捷键仍不生效，重启 Zotero。
5. 在一份可修改的 PDF 上测试 `Q`、再 `R`、再 `Z` 与 `M`。右下会出现一秒提示。

**兼容声明：**清单覆盖 Zotero **7.0～10.0.x**；按 Zotero **10.0** 接口逻辑编写和审查。但此环境没有可运行的 Zotero GUI，因此**没有真实 Zotero 10/Windows 中文输入法联调验证**，不能将模拟测试当作安装验证。此插件使用内部 reader 接口，未来 Zotero 更新可能要求适配。

## 中文输入法／输入保护

- 采用物理键 `KeyboardEvent.code`；只要按键事件进入阅读器，不依赖 `event.key` 是 `q`、`Q` 还是 `Process`，通常无需切换英文输入法。
- 编辑批注、搜索框、文本框、`contenteditable`、工具栏交互控件时**不会**抢键。
- 正在输入法组词时，同时依靠 `isComposing` 和 `compositionstart/compositionend` 阻止触发。
- Ctrl、Shift、Cmd 组合一律放行；仅保留明确指定的 `Alt+H` / `Alt+S`，其余 Alt 组合放行；长按重复事件被吞掉而不重复创建批注。
- 修复 Zotero 10 中同一标注工具连续换色可能因为引用不变而没有刷新 PDF 视图的问题。
- 同样使用物理字母键的 Zotero Vim 等插件可能与本插件冲突，请避免重叠绑定。

**技术边界：**操作系统或某些输入法可能在把按键交给 Zotero 之前就拦截它。软件插件无法强制获取这些丢失的键盘事件；它只能安全处理 Zotero 收到的按键。

## 故障排查

| 现象 | 排查方向 |
|---|---|
| 按字母只是滚动／搜索／无反应 | 确保打开的是内置 PDF，焦点在 PDF 页面而不是输入框；关闭重开 PDF 标签页 |
| `R` 同时触发 Read Aloud | 插件对 `_onKeyDown` 的前向转发补丁可能因 Zotero 私有 API 更新失效，请在 Zotero Error Console 查看 `OneKeyPDFAnnotations` 日志 |
| 选区无法直接高亮 | 某些 PDF 为扫描图像无可选文本；尝试先 `Q` 再拖选另一段可复制的文字 |
| `M` 不画出永久矩形外框 | 按设计调用的是 Zotero Area/Image 选区工具，不是矢量描框 |
| 按键在中文输入法下无法生效 | 确认已经退出任何批注编辑／组词状态；若事件被 OS 层吞掉，需配置输入法的按键处理 |
| 想回到原生 Zotero 快捷键 | 在 **工具 → 插件** 中禁用/卸载插件并重启 PDF 标签页 |

## 开发与测试

源码目录：`manifest.json`、`bootstrap.js`、`content/onekey.js`、`tests/onekey.test.cjs`、`build.py`。

本地运行：

```bash
node --check bootstrap.js
node --check content/onekey.js
node --test tests/onekey.test.cjs
python build.py
```

包含 25 组 Node 模拟测试：八色映射、便签/矩形、直接保存高亮、连按同类型工具换色、选区去重、IME 组词、输入字段及工具栏控件屏蔽、Read Aloud 冲突、只读保护、分栏与 iframe 重建、插件退出后的清理、清单兼容字段等。**均非真实 GUI 联调**。

打包 `.xpi` 只包含 `manifest.json`、`bootstrap.js`、`content/onekey.js`，不依赖网络访问或外部服务。插件使用本地占位 `update_url`（Zotero 清单字段要求），**不会自动收到新版本**，后续升级手动安装新版 `.xpi`。

## 设计依据

- [Zotero 10 for Developers](https://www.zotero.org/support/dev/zotero_10_for_developers)
- [Zotero 官方 PDF Reader 快捷键](https://www.zotero.org/support/kb/keyboard_shortcuts)
- [Zotero reader 源码](https://github.com/zotero/reader)：`src/common/reader.js`、`src/common/keyboard-manager.js`、`src/pdf/pdf-view.js`
- [Zotero Vim Plus](https://github.com/ZorroStardust/zotero-vim-plus)：说明了内部 iframe `_onKeyDown` 前向转发与 Zotero 原生处理冲突的机制


## GitHub 自动化构建

每次 push 和 PR 都运行 Node 测试，并打包 `.xpi` 供检查。`v*` tag 自动触发 Release workflow（需 GitHub Actions 写入权限）。