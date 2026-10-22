# Changelog

## v0.3.1

- 修复 Highlighter 单键可能在 Zotero 内层转发中被拦截却未执行的问题。将 `_onKeyDown` 桥接从「只消费」调整为「执行并消费」。
- 修复 `Alt+H` 在 PDF 视图中调用未实现的 `setShowAnnotations()` 路径的问题：用可恢复的 PDF 标注覆盖层 CSS 控制可见性。
- 在 Zotero 10 Reading Mode 新增键盘监听、真实选区高亮和显示切换支持；分栏与 iframe 重建继续保持。
- 新增 3 项模拟回归测试，共 28/28 通过。真实 Zotero Windows GUI 尚未验证。

## v0.3.0

- `D`：只删除当前选中的 Zotero 标注；多选沿用原生确认对话框；无选中不拦截。
- `Alt+H`：仅隐藏阅读器全部标注；`Alt+S`：恢复显示。只读 PDF 仍可用。
- 延续现有 IME / 编辑区安全屏蔽及物理键映射；扩展模拟测试和 GitHub CI。
- 尚未在真实 Zotero GUI 中完成联调。

## v0.2.0

- 修复同种 PDF 标注工具连续切换颜色时 UI/reader canvas 不刷新的问题。
- 添加 `compositionstart` / `compositionend` 状态跟踪，处理某些 Windows IME 不可靠的 `isComposing`。
- 缩小 Zotero 主窗口按键响应范围，避免在 PDF 标签页显示期间抢占侧边面板的按键。
- 对 toolbar buttons、interactive roles 等交互控件放行。
- 已消费完的 PDF 文本选区不能再被过期的弹窗状态重复转换成批注。
- 重新声明与正式版 Zotero 10.0.x 兼容；保留 Zotero 7+ 最低版本。
- 新增八项回归测试，共 17 项模拟测试；没有 Zotero GUI 实测。

## v0.1.0

- `Q/W/E/R/T/Y/G/F` 八色高亮。
- `Z/X/C/V` 四色便签，`M` 矩形区域工具。
- 原生阅读器 PDF.js 键盘转发拦截、焦点与 IME 初始保护。
