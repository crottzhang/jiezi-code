<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted } from "vue";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { newWindow, takeInitialOpen } from "./api/fs";
import { clamp, layout, startDrag, toggleView } from "./store/layout";
import { openSearch } from "./store/search";
import { terminal, toggleTerminal } from "./store/terminal";
import { tools } from "./store/tools";
import { openPalette, toast } from "./store/ui";
import {
  activeTab,
  closeTab,
  confirmDiscard,
  cycleTab,
  openFolder,
  openFile,
  revealInExplorer,
  saveAll,
  saveFile,
  workspace,
} from "./store/workspace";
import ActivityBar from "./components/ActivityBar.vue";
import CodeEditor from "./components/CodeEditor.vue";
import DiffBar from "./components/DiffBar.vue";
import EditorTabs from "./components/EditorTabs.vue";
import Overlays from "./components/Overlays.vue";
import QuickOpen from "./components/QuickOpen.vue";
import NotesView from "./components/NotesView.vue";
import RunView from "./components/RunView.vue";
import ScmView from "./components/ScmView.vue";
import SearchView from "./components/SearchView.vue";
import Sidebar from "./components/Sidebar.vue";
import StatusBar from "./components/StatusBar.vue";
import TitleBar from "./components/TitleBar.vue";
import Welcome from "./components/Welcome.vue";

// xterm.js 只在第一次打开终端时才加载
const TerminalPanel = defineAsyncComponent(() => import("./components/TerminalPanel.vue"));
// 左右并排对比（@codemirror/merge 的 MergeView）只在用到时加载
const DiffSplitView = defineAsyncComponent(() => import("./components/DiffSplitView.vue"));
// 图片预览同样按需加载
const ImageView = defineAsyncComponent(() => import("./components/ImageView.vue"));
const imageTab = computed(() => (activeTab()?.image ? activeTab() : undefined));
// Markdown 预览（连同 markdown-it）按需加载
const MarkdownView = defineAsyncComponent(() => import("./components/MarkdownView.vue"));
const markdownTab = computed(() => (activeTab()?.markdown ? activeTab() : undefined));
// 工具菜单里的小工具按需加载
const PortsTool = defineAsyncComponent(() => import("./components/PortsTool.vue"));
// 光标所在行的 Git 作者信息
import("./store/blame");

const splitDiff = computed(() => layout.diffSplit && !!activeTab()?.diff);

function resizeSidebar(e: MouseEvent) {
  const start = layout.sidebarWidth;
  startDrag(e, (dx) => (layout.sidebarWidth = clamp(start + dx, 160, 600)));
}

function resizePanel(e: MouseEvent) {
  const start = layout.panelWidth;
  startDrag(e, (dx) => (layout.panelWidth = clamp(start - dx, 240, window.innerWidth - 400)));
}

function onKeyDown(e: KeyboardEvent) {
  const ctrl = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  // 焦点在终端里时，Ctrl+S / Ctrl+W / Ctrl+R 等按键交给 shell
  const inTerminal = !!(e.target as Element | null)?.closest?.(".xterm");

  if (ctrl && e.code === "Backquote") toggleTerminal();
  else if (ctrl && e.shiftKey && key === "n") newWindow().catch(toast);
  else if (ctrl && !e.shiftKey && key === "b") layout.sidebarVisible = !layout.sidebarVisible;
  else if (ctrl && e.shiftKey && key === "e") toggleView("explorer");
  else if (ctrl && e.shiftKey && key === "g") toggleView("scm");
  else if (ctrl && e.shiftKey && key === "d") toggleView("run");
  else if (ctrl && e.shiftKey && key === "f") openSearch();
  else if (ctrl && e.shiftKey && key === "h") openSearch(true);
  else if (ctrl && key === "p") openPalette(e.shiftKey ? ">" : "");
  else if (inTerminal) return;
  else if (ctrl && !e.shiftKey && key === "g") openPalette(":");
  else if (ctrl && e.altKey && key === "s") saveAll();
  else if (!ctrl && e.shiftKey && e.altKey && key === "r") revealInExplorer();
  else if (ctrl && key === "s") saveFile();
  else if (ctrl && key === "w") closeTab();
  else if (ctrl && !e.shiftKey && key === "o") openFolder();
  else if (ctrl && key === "tab") cycleTab(e.shiftKey ? -1 : 1);
  // 发布版屏蔽 WebView 自带的刷新、打印
  else if (import.meta.env.PROD && (key === "f5" || (ctrl && key === "r"))) {
    /* 吞掉 */
  } else return;
  e.preventDefault();
  e.stopPropagation();
}

// 只在输入框和其他零散的编辑器里保留系统右键菜单（剪切/复制/粘贴）；
// 主编辑器、左右对比、终端都有自己的右键菜单
function onContextMenu(e: MouseEvent) {
  if (!(e.target as Element).closest(".cm-editor, input, textarea")) e.preventDefault();
}

let unlistenClose: (() => void) | undefined;

onMounted(async () => {
  window.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("contextmenu", onContextMenu);

  unlistenClose = await getCurrentWindow().onCloseRequested(async (e) => {
    if (!(await confirmDiscard(workspace.tabs))) e.preventDefault();
  });

  const initial = await takeInitialOpen();
  if (initial) {
    await openFolder(initial.folder);
    if (initial.file) await openFile(initial.file);
  }
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeyDown, true);
  document.removeEventListener("contextmenu", onContextMenu);
  unlistenClose?.();
});
</script>

<template>
  <div class="app">
    <TitleBar />
    <div class="main">
      <ActivityBar />

      <!-- 收起侧边栏和切换视图都只是隐藏：资源管理器的展开状态、搜索结果、运行中的终端都不会丢 -->
      <div v-show="layout.sidebarVisible" class="side" :style="{ width: `${layout.sidebarWidth}px` }">
        <Sidebar v-show="layout.sidebarView === 'explorer'" />
        <SearchView v-show="layout.sidebarView === 'search'" />
        <ScmView v-show="layout.sidebarView === 'scm'" />
        <RunView v-show="layout.sidebarView === 'run'" />
        <NotesView v-show="layout.sidebarView === 'notes'" />
      </div>
      <div v-show="layout.sidebarVisible" class="sash" @mousedown="resizeSidebar"></div>

      <div class="editor-area">
        <template v-if="workspace.active != null">
          <EditorTabs />
          <DiffBar />
          <ImageView v-if="imageTab" :tab="imageTab" />
          <MarkdownView v-else-if="markdownTab" :tab="markdownTab" />
          <DiffSplitView v-else-if="splitDiff" />
          <CodeEditor v-else />
        </template>
        <Welcome v-else />
      </div>

      <!-- 终端开过之后用 v-show 隐藏，保留 shell 进程和输出 -->
      <template v-if="terminal.sessions.length">
        <div v-show="terminal.visible" class="sash" @mousedown="resizePanel"></div>
        <TerminalPanel
          v-show="terminal.visible"
          class="side terminal-panel"
          :style="{ width: `${layout.panelWidth}px` }"
        />
      </template>
    </div>
    <StatusBar />
    <QuickOpen />
    <PortsTool v-if="tools.ports" />
    <Overlays />
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.main {
  display: flex;
  flex: 1;
  min-height: 0;
}
.side {
  flex: none;
  max-width: calc(100vw - 300px);
}
/* 窗口变窄时终端面板跟着收缩，不然右侧（包括标题栏按钮）会被挤出窗口 */
.side.terminal-panel {
  flex: 0 1 auto;
  min-width: 240px;
}
.sash {
  width: 4px;
  margin: 0 -2px;
  z-index: 10;
  flex: none;
  cursor: col-resize;
}
.sash:hover {
  background: var(--accent);
}
.editor-area {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 200px;
  margin: var(--card-margin);
  border: var(--card-border);
  border-radius: var(--card-radius);
  background: var(--bg-editor);
  overflow: hidden;
}
</style>
