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
  git.rs        Git：调用系统的 git 命令行（沿用用户的配置、钩子和凭据），解析 porcelain v2 状态
src/
  api/                  Rust 命令的前端封装
  editor/setup.ts       CodeMirror 配置、语言包按需加载
  store/workspace.ts    文件夹、标签页、保存等核心状态
  store/terminal.ts     终端会话列表、显示/隐藏
  store/git.ts          Git 状态、暂存/提交/同步、分支切换、行内对比
  store/history.ts      提交历史、提交改动的文件、文件历史
  store/layout.ts       侧边栏视图、侧边栏/终端面板宽度（持久化）
  store/ui.ts           输入框、右键菜单、提示
  components/           活动栏、文件树、源代码管理、标签栏、编辑器、终端面板、状态栏、欢迎页
```

布局：`活动栏 | 侧边栏 | 编辑区 | 终端面板`，底部状态栏。

## 源代码管理

活动栏第二个图标（Ctrl+Shift+G）打开 Git 面板：

- 按“合并更改 / 暂存的更改 / 更改”分组列出文件，可以暂存、取消暂存、放弃更改（未跟踪的文件移到回收站）。
- 点击文件在编辑器里显示行内差异：未暂存的更改与暂存区对比，已暂存的更改与 HEAD 对比；每处差异旁有“还原”按钮。点标签页上的 “↔” 标记关闭对比。
- 输入提交信息后 Ctrl+Enter 提交；没有暂存内容时可以一键全部暂存并提交。
- 状态栏显示当前分支和领先/落后提交数，点击分支名切换或新建分支，点击同步图标拉取并推送（没有上游时发布分支）。
- 资源管理器里的文件和文件夹按 Git 状态着色。
- 面板底部的“历史记录”列出当前分支的提交（每次 50 条，可加载更多），显示分支/标签标记。展开提交可以看到改动的文件，点击文件以只读标签页打开该版本并与父提交对比。右键提交可以复制哈希、复制提交信息、基于此提交新建分支。
- 在资源管理器、标签页或更改列表里右键文件选“查看文件历史”，历史记录只显示改动过这个文件的提交（跟随重命名）。
- 状态在保存文件、窗口获得焦点时刷新，窗口在前台时每 5 秒轮询一次（能发现终端里执行的 git 命令）。

需要系统里装有 git 并加入 PATH。

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
- 行内差异视图（@codemirror/merge）在第一次打开对比时才加载。
- 多个项目用 Ctrl+Shift+N 开新窗口：同一个进程，WebView2 的浏览器/GPU 进程共享，每多一个窗口只多一个渲染进程。
