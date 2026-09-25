<script setup lang="ts">
import { computed } from "vue";
import { baseName } from "../api/fs";
import { showMenu } from "../store/ui";
import { newEntry, openFolder, refreshDir, workspace } from "../store/workspace";
import TreeNode from "./TreeNode.vue";

const root = computed(() => workspace.root);
const rootEntry = computed(() =>
  root.value ? { name: baseName(root.value), path: root.value, isDir: true } : null,
);

function onContextMenu(e: MouseEvent) {
  const dir = root.value;
  if (!dir) return;
  showMenu(e, [
    { label: "新建文件", action: () => newEntry(dir, false) },
    { label: "新建文件夹", action: () => newEntry(dir, true) },
  ]);
}
</script>

<template>
  <aside class="sidebar">
    <header>
      <span class="title" :title="root ?? ''">{{ rootEntry?.name ?? "资源管理器" }}</span>
      <template v-if="root">
        <button title="新建文件" @click="newEntry(root, false)">＋</button>
        <button title="新建文件夹" @click="newEntry(root, true)">▣</button>
        <button title="刷新" @click="refreshDir(root)">⟳</button>
      </template>
    </header>
    <div v-if="rootEntry" class="tree" @contextmenu="onContextMenu">
      <!-- 切换文件夹时整棵树重建 -->
      <TreeNode :key="rootEntry.path" :entry="rootEntry" :depth="-1" root />
    </div>
    <div v-else class="empty">
      <p>尚未打开文件夹。</p>
      <button class="open" @click="openFolder()">打开文件夹</button>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-app);
  border-right: 1px solid var(--border-side);
  overflow: hidden;
}
header {
  display: flex;
  align-items: center;
  height: 35px;
  padding: 0 8px 0 16px;
  flex: none;
}
.title {
  flex: 1;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
header button {
  width: 22px;
  height: 22px;
  border-radius: 4px;
  color: var(--fg-muted);
  opacity: 0;
}
.sidebar:hover header button {
  opacity: 1;
}
header button:hover {
  background: var(--hover);
  color: var(--fg-strong);
}
.tree {
  flex: 1;
  overflow: auto;
  padding-bottom: 20px;
}
.empty {
  padding: 8px 20px;
  color: var(--fg-muted);
}
.empty .open {
  width: 100%;
  height: 28px;
  border-radius: 2px;
  background: var(--accent);
  color: var(--accent-fg);
}
.empty .open:hover {
  filter: brightness(1.15);
}
</style>
