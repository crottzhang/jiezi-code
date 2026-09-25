<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { readDir, type DirEntry } from "../api/fs";
import { addToGitignore, decorationOf, describeStatus, git as gitState } from "../store/git";
import { showFileHistory } from "../store/history";
import { showMenu, toast, type MenuItem } from "../store/ui";
import {
  activeTab,
  deletePath,
  newEntry,
  openFile,
  renamePath,
  workspace,
} from "../store/workspace";

const HIDDEN = new Set([".git"]);

const props = defineProps<{
  entry: DirEntry;
  depth: number;
  /** 根节点：不显示自身，直接展开 */
  root?: boolean;
}>();

const expanded = ref(!!props.root);
const children = ref<DirEntry[] | null>(null);
const isActive = computed(() => activeTab()?.path === props.entry.path);
/** Git 状态：文件显示字母，文件夹只着色 */
const git = computed(() => decorationOf(props.entry.path));
const LETTERS = { added: "A", modified: "M", deleted: "D", renamed: "R", untracked: "U", conflict: "!" };

async function load() {
  try {
    children.value = (await readDir(props.entry.path)).filter((e) => !HIDDEN.has(e.name));
  } catch (e) {
    toast(e);
    children.value = [];
  }
}

if (props.root) load();

// 目录内容变化（新建/删除/重命名）后刷新，未展开过的目录不用管
watch(
  () => [workspace.dirVersions[props.entry.path], workspace.treeVersion],
  () => {
    if (children.value) load();
  },
);

function onClick() {
  if (!props.entry.isDir) {
    openFile(props.entry.path);
    return;
  }
  expanded.value = !expanded.value;
  if (expanded.value && !children.value) load();
}

function onContextMenu(e: MouseEvent) {
  const { path, isDir } = props.entry;
  const items: MenuItem[] = isDir
    ? [
        { label: "新建文件", action: () => newEntry(path, false) },
        { label: "新建文件夹", action: () => newEntry(path, true) },
      ]
    : [{ label: "打开", action: () => openFile(path) }];
  if (!isDir && gitState.status && git.value !== "untracked") {
    items.push({ label: "查看文件历史", action: () => showFileHistory(path) });
  }
  // 文件夹，以及还没被跟踪的文件，可以加入 .gitignore
  if (gitState.status && (isDir || git.value === "untracked")) {
    items.push({ label: "添加到 .gitignore", action: () => addToGitignore(path, isDir) });
  }
  items.push(
    { label: "重命名", action: () => renamePath(path) },
    { label: "复制路径", action: () => navigator.clipboard.writeText(path) },
    { label: "删除", action: () => deletePath(path), danger: true },
  );
  showMenu(e, items);
}
</script>

<template>
  <div
    v-if="!root"
    class="row"
    :class="{ active: isActive }"
    :style="{ paddingLeft: `${depth * 12 + 8}px` }"
    :title="entry.path"
    @click="onClick"
    @contextmenu="onContextMenu"
  >
    <span class="twisty" :class="{ open: expanded, hidden: !entry.isDir }">›</span>
    <span class="name" :class="[{ dir: entry.isDir }, git]">{{ entry.name }}</span>
    <span v-if="git" class="git" :class="git" :title="entry.isDir ? '包含更改' : describeStatus(LETTERS[git])">
      {{ entry.isDir ? "●" : LETTERS[git] }}
    </span>
  </div>
  <template v-if="expanded && children">
    <TreeNode v-for="child in children" :key="child.path" :entry="child" :depth="depth + 1" />
  </template>
</template>

<style scoped>
.row {
  display: flex;
  align-items: center;
  height: 22px;
  padding-right: 8px;
  cursor: pointer;
  white-space: nowrap;
  user-select: none;
}
.row:hover {
  background: var(--hover);
}
.row.active {
  background: var(--selection);
  color: var(--fg-strong);
}
.twisty {
  width: 16px;
  flex: none;
  text-align: center;
  font-size: 14px;
  color: var(--fg-muted);
  transition: transform 0.1s;
}
.twisty.open {
  transform: rotate(90deg);
}
.twisty.hidden {
  visibility: hidden;
}
.name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.git {
  flex: none;
  margin-left: 6px;
  font-size: 12px;
  font-weight: 600;
}
.name.dir + .git {
  font-size: 8px;
  opacity: 0.8;
}
.added {
  color: var(--git-added);
}
.modified {
  color: var(--git-modified);
}
.deleted {
  color: var(--git-deleted);
}
.renamed {
  color: var(--git-renamed);
}
.untracked {
  color: var(--git-untracked);
}
.conflict {
  color: var(--git-conflict);
}
</style>
