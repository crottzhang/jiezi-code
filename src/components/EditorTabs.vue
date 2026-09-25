<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { showMenu } from "../store/ui";
import { closeTab, workspace, type Tab } from "../store/workspace";

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
  showMenu(e, [
    { label: "关闭", action: () => closeTab(tab.id) },
    { label: "关闭其他", action: () => closeOthers(tab) },
    { label: "复制路径", action: () => navigator.clipboard.writeText(tab.path) },
  ]);
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
