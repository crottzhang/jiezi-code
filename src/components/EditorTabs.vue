<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { closeDiff } from "../store/diff";
import { git } from "../store/git";
import { showFileHistory } from "../store/history";
import { openInTerminal } from "../store/terminal";
import { SEPARATOR, showMenu, type MenuItem } from "../store/ui";
import {
  closeTab,
  isMarkdownFile,
  isPreviewTab,
  isSvgFile,
  openFile,
  previewImage,
  previewMarkdown,
  revealInExplorer,
  workspace,
  type Tab,
} from "../store/workspace";

const bar = ref<HTMLElement>();

// 激活的标签页滚动到可见区域
watch(
  () => workspace.active,
  async () => {
    await nextTick();
    bar.value?.querySelector(".tab.active")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  },
);

function onWheel(e: WheelEvent) {
  if (bar.value && e.deltaY) bar.value.scrollLeft += e.deltaY;
}

async function closeOthers(keep: Tab) {
  for (const tab of workspace.tabs.filter((t) => t.id !== keep.id)) await closeTab(tab.id);
}

function onContextMenu(e: MouseEvent, tab: Tab) {
  const items: MenuItem[] = [
    { label: "关闭", action: () => closeTab(tab.id) },
    { label: "关闭其他", action: () => closeOthers(tab) },
    { label: "复制路径", action: () => navigator.clipboard.writeText(tab.path) },
  ];
  // svg、Markdown 的文本和预览可以互相切换；只读的虚拟标签页（历史版本等）不对应磁盘文件，不提供
  if (isPreviewTab(tab)) {
    if (tab.markdown || isSvgFile(tab.path)) {
      items.push({ label: "打开源文件", action: () => openFile(tab.path) });
    }
  } else if (!tab.readonly && isSvgFile(tab.path)) {
    items.push({ label: "预览图片", action: () => previewImage(tab.path) });
  } else if (!tab.readonly && isMarkdownFile(tab.path)) {
    items.push({ label: "打开预览", action: () => previewMarkdown(tab.path) });
  }
  if (tab.diff) items.push({ label: "关闭对比", action: () => closeDiff(tab.id) });
  if (git.status) items.push({ label: "查看文件历史", action: () => showFileHistory(tab.path) });
  if (!tab.readonly) {
    items.push(
      SEPARATOR,
      { label: "在文件资源管理器中显示", keys: "Shift+Alt+R", action: () => revealInExplorer(tab.path) },
      { label: "在集成终端中打开", action: () => openInTerminal(tab.path, false) },
    );
  }
  showMenu(e, items);
}
</script>

<template>
  <div ref="bar" class="tabs" @wheel.passive="onWheel">
    <div
      v-for="tab in workspace.tabs"
      :key="tab.id"
      class="tab"
      :class="{ active: tab.id === workspace.active, dirty: tab.dirty }"
      :title="tab.path"
      @mousedown.left="workspace.active = tab.id"
      @mouseup.middle="closeTab(tab.id)"
      @contextmenu="onContextMenu($event, tab)"
    >
      <span class="name">{{ tab.name }}</span>
      <button
        v-if="tab.diff"
        class="diff"
        :title="`正在与${tab.diff.label}对比，点击关闭对比`"
        @mousedown.stop
        @click.stop="closeDiff(tab.id)"
      >
        ↔ {{ tab.diff.label }}
      </button>
      <button class="close" @mousedown.stop @click.stop="closeTab(tab.id)">
        <span class="dot">●</span><span class="x">×</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.tabs {
  display: flex;
  height: 35px;
  flex: none;
  background: var(--bg-tabs);
  box-shadow: inset 0 -1px 0 var(--tabs-divider);
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
}
.tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 6px 0 12px;
  border-right: 1px solid var(--border-side);
  color: var(--fg-muted);
  cursor: pointer;
  white-space: nowrap;
  user-select: none;
}
.tab.active {
  background: var(--tab-active-bg);
  color: var(--fg-strong);
  box-shadow: inset 0 1px 0 var(--tab-indicator);
}
.diff {
  height: 18px;
  padding: 0 6px;
  border-radius: 9px;
  background: var(--bg-input);
  color: var(--fg-muted);
  font-size: 11px;
}
.diff:hover {
  background: var(--hover);
  color: var(--fg-strong);
  text-decoration: line-through;
}
.close {
  width: 20px;
  height: 20px;
  border-radius: 4px;
  font-size: 16px;
  line-height: 1;
  color: inherit;
}
.close:hover {
  background: var(--hover);
}
.dot {
  display: none;
  font-size: 10px;
}
.x {
  visibility: hidden;
}
.tab.active .x,
.tab:hover .x {
  visibility: visible;
}
.tab.dirty .dot {
  display: inline;
}
.tab.dirty .x {
  display: none;
}
.tab.dirty .close:hover .dot {
  display: none;
}
.tab.dirty .close:hover .x {
  display: inline;
  visibility: visible;
}
</style>
