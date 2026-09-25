# Jiezi Code

基于 Tauri 2 + Vue 3 + CodeMirror 6 的轻量代码编辑器。

## 开发

```bash
npm install
npm run tauri dev     # 开发
npm run tauri build   # 打包
```

## 结构

```
src-tauri/src/
  fs.rs         文件读写、目录读取（按需一层）、新建/重命名/删除到回收站
  window.rs     多窗口：同一进程内开新窗口，共享 WebView2 浏览器进程
  terminal.rs   终端：portable-pty（Windows 下为 ConPTY + PowerShell），输出走 Channel 原始字节
src/
  api/                  Rust 命令的前端封装
  editor/setup.ts       CodeMirror 配置、语言包按需加载
  store/workspace.ts    文件夹、标签页、保存等核心状态
  store/terminal.ts     终端会话列表、显示/隐藏
  store/layout.ts       侧边栏/终端面板宽度（持久化）
  store/ui.ts           输入框、右键菜单、提示
  components/           活动栏、文件树、标签栏、编辑器、终端面板、状态栏、欢迎页
```

布局：`活动栏 | 侧边栏 | 编辑区 | 终端面板`，底部状态栏。

## 主题

`src/theme/themes.ts` 定义了两套主题（VS Code Dark Modern、Linear），每套是一组 CSS 变量加一份终端配色。
界面、CodeMirror 语法高亮都只引用 CSS 变量，切换主题时只改 `:root` 上的变量，不重建编辑器状态。
加新主题：在 `themes` 数组里加一项即可，菜单和命令面板会自动出现。

## 命令行

```bash
jiezi-code <文件夹>   # 打开文件夹
jiezi-code <文件>     # 打开所在文件夹并打开该文件
```

## 省内存的设计

- 整个窗口只有一个 `EditorView`，每个标签页只保存一个不可变的 `EditorState`（包含撤销历史），切换标签页时替换状态。
- 语言高亮通过 `@codemirror/language-data` 动态 import，打开某种文件时才加载对应的语言包。
- 文件树只在展开目录时读取这一层，不扫描整个项目。
- 终端面板（含 xterm.js）是异步组件，第一次按 Ctrl+` 时才加载并启动 PowerShell。
- 多个项目用 Ctrl+Shift+N 开新窗口：同一个进程，WebView2 的浏览器/GPU 进程共享，每多一个窗口只多一个渲染进程。
