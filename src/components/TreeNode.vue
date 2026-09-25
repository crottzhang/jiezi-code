<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { dirName, readDir, type DirEntry } from "../api/fs";
import { gitCheckIgnore } from "../api/git";
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
import FileIcon from "./FileIcon.vue";
import Icon from "./Icon.vue";

const HIDDEN = new Set([".git"]);
/** 每层缩进。比 VS Code 默认的 8 稍宽，参考线才不会贴着下一级的文件图标 */
const INDENT = 10;

const props = defineProps<{
  entry: DirEntry;
  depth: number;
  /** 根节点：不显示自身，直接展开 */
  root?: boolean;
  /** 被 .gitignore 忽略（显示成灰色），子项跟着忽略 */
  ignored?: boolean;
}>();

const expanded = ref(!!props.root);
const children = ref<DirEntry[] | null>(null);
/** 子项里被忽略的名字 */
const ignoredNames = ref(new Set<string>());
const isActive = computed(() => activeTab()?.path === props.entry.path);
/** Git 状态：文件显示字母，文件夹只着色 */
const git = computed(() => decorationOf(props.entry.path));
const LETTERS = { added: "A", modified: "M", deleted: "D", renamed: "R", untracked: "U", conflict: "!" };

/** 缩进参考线：当前文件所在文件夹的那一条高亮，返回它的层级，没有时为 -1 */
const activeGuide = computed(() => {
  const path = activeTab()?.path;
  if (!path) return -1;
  const dir = dirName(path);
  let p = props.entry.path;
  for (let level = props.depth - 1; level >= 0; level--) {
    p = dirName(p);
    if (p === dir) return level;
  }
  return -1;
});

async function load() {
  try {
    children.value = (await readDir(props.entry.path)).filter((e) => !HIDDEN.has(e.name));
  } catch (e) {
    toast(e);
    children.value = [];
  }
  checkIgnored();
}

let ignoreSeq = 0;

async function checkIgnored() {
  const seq = ++ignoreSeq;
  // 自己已被忽略时子项都算忽略，不在仓库里时没有忽略的概念
  if (props.ignored || !gitState.status || !children.value?.length) {
    ignoredNames.value = new Set();
    return;
  }
  const names = await gitCheckIgnore(props.entry.path, children.value.map((c) => c.name)).catch(
    () => [],
  );
  if (seq === ignoreSeq) ignoredNames.value = new Set(names);
}

if (props.root) load();

// 目录内容变化（新建/删除/重命名）后刷新，未展开过的目录不用管
watch(
  () => [workspace.dirVersions[props.entry.path], workspace.treeVersion],
  () => {
    if (children.value) load();
  },
);

// Git 状态变化（比如改了 .gitignore、打开的文件夹变成了仓库）后重新检查忽略
watch(
  () => gitState.status,
  () => {
    if (children.value) checkIgnored();
  },
);

watch(
  () => workspace.collapseVersion,
  () => {
    if (!props.root) expanded.value = false;
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
  if (gitState.status && !props.ignored && (isDir || git.value === "untracked")) {
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
    :class="{ active: isActive, ignored }"
    :style="{ paddingLeft: `${depth * INDENT + 8}px` }"
    :title="entry.path"
    @click="onClick"
    @contextmenu="onContextMenu"
  >
    <!-- 参考线对准各级文件夹的折叠箭头中心 -->
    <span
      v-for="level in depth"
      :key="level"
      class="guide"
      :class="{ active: level - 1 === activeGuide }"
      :style="{ left: `${(level - 1) * INDENT + 16}px` }"
    />
    <Icon v-if="entry.isDir" name="chevronRight" class="twisty" :class="{ open: expanded }" />
    <FileIcon v-else :name="entry.name" />
    <span class="name" :class="git">{{ entry.name }}</span>
    <span
      v-if="git"
      class="git"
      :class="[git, { dot: entry.isDir }]"
      :title="entry.isDir ? '包含更改' : describeStatus(LETTERS[git])"
    >
      {{ entry.isDir ? "●" : LETTERS[git] }}
    </span>
  </div>
  <template v-if="expanded && children">
    <TreeNode
      v-for="child in children"
      :key="child.path"
      :entry="child"
      :depth="depth + 1"
      :ignored="ignored || ignoredNames.has(child.name)"
    />
  </template>
</template>

<style scoped>
.row {
  position: relative;
  display: flex;
  align-items: center;
  height: 22px;
  padding-right: 12px;
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
/* 缩进参考线平时透明，鼠标移到文件树上时显示（由 Sidebar 控制） */
.guide {
  position: absolute;
  top: 0;
  bottom: 0;
  border-left: 1px solid transparent;
  transition: border-color 0.1s;
  pointer-events: none;
}
.twisty,
.file-icon {
  margin-right: 6px;
}
.twisty {
  color: var(--fg);
  transition: transform 0.1s;
}
.twisty.open {
  transform: rotate(90deg);
}
.name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* 被忽略的文件整体变淡，参照 VS Code 的 gitDecoration.ignoredResourceForeground */
.row.ignored > :not(.guide) {
  opacity: 0.55;
}
.git {
  flex: none;
  width: 14px;
  margin-left: 6px;
  text-align: center;
  font-size: 12px;
  font-weight: 600;
}
.git.dot {
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
