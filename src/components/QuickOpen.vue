<script setup lang="ts">
import { computed, nextTick, ref, shallowRef, watch } from "vue";
import { baseName, dirName, joinPath, listFiles } from "../api/fs";
import { commands, isEnabled, runCommand } from "../commands";
import { getEditorView, goToLine } from "../editor/view";
import { closePalette, toast, ui } from "../store/ui";
import { openFile, workspace } from "../store/workspace";
import { fuzzyMatch, highlight } from "../utils/fuzzy";

interface Item {
  key: string;
  label: string;
  /** label 里需要高亮的字符下标 */
  hits?: number[];
  detail?: string;
  keys?: string;
  disabled?: boolean;
  run?: () => void;
}

const MAX_RESULTS = 60;

const input = ref<HTMLInputElement>();
const list = ref<HTMLElement>();
const selected = ref(0);
const files = shallowRef<string[]>([]);
const loading = ref(false);

const text = computed({
  get: () => ui.palette?.text ?? "",
  set: (v) => {
    if (ui.palette) ui.palette.text = v;
  },
});

const mode = computed(() =>
  text.value.startsWith(">") ? "command" : text.value.startsWith(":") ? "line" : "file",
);

const placeholder = computed(
  () =>
    ({
      file: "按名称搜索文件（输入 > 搜索命令，: 跳转到行）",
      command: "输入命令名称",
      line: "输入行号",
    })[mode.value],
);

async function loadFiles() {
  const root = workspace.root;
  if (!root) {
    files.value = [];
    return;
  }
  loading.value = true;
  try {
    const list = await listFiles(root);
    if (workspace.root === root) files.value = list;
  } catch (e) {
    toast(e);
  } finally {
    loading.value = false;
  }
}

function commandItems(query: string): Item[] {
  return commands
    .map((c) => ({ c, m: fuzzyMatch(query, c.label) }))
    .filter((x) => x.m && isEnabled(x.c))
    .sort((a, b) => b.m!.score - a.m!.score)
    .map(({ c, m }) => ({
      key: c.id,
      label: c.label,
      hits: m!.positions,
      keys: c.keys,
      run: () => runCommand(c),
    }));
}

function lineItems(query: string): Item[] {
  const view = getEditorView();
  if (!view) return [{ key: "none", label: "请先打开一个文件", disabled: true }];
  const total = view.state.doc.lines;
  const line = parseInt(query, 10);
  if (!query || Number.isNaN(line)) {
    return [{ key: "hint", label: `输入 1 到 ${total} 之间的行号`, disabled: true }];
  }
  const target = Math.min(Math.max(1, line), total);
  return [{ key: "go", label: `转到第 ${target} 行`, run: () => goToLine(target) }];
}

function fileItems(query: string): Item[] {
  const root = workspace.root;
  if (!root) {
    return [{ key: "none", label: "打开文件夹后才能搜索文件（输入 > 可以搜索命令）", disabled: true }];
  }
  if (!query) {
    // 没有输入时列出已打开的文件
    return workspace.tabs.map((t) => ({
      key: t.path,
      label: t.name,
      detail: dirName(t.path),
      run: () => openFile(t.path),
    }));
  }
  const matches: { rel: string; score: number; positions: number[] }[] = [];
  for (const rel of files.value) {
    const m = fuzzyMatch(query, rel);
    if (m) matches.push({ rel, ...m });
  }
  matches.sort((a, b) => b.score - a.score || a.rel.length - b.rel.length);
  return matches.slice(0, MAX_RESULTS).map(({ rel, positions }) => {
    const name = baseName(rel);
    const offset = rel.length - name.length;
    return {
      key: rel,
      label: name,
      hits: positions.filter((p) => p >= offset).map((p) => p - offset),
      detail: dirName(rel),
      run: () => openFile(joinPath(root, rel)),
    };
  });
}

const items = computed<Item[]>(() => {
  const t = text.value;
  if (mode.value === "command") return commandItems(t.slice(1).trim());
  if (mode.value === "line") return lineItems(t.slice(1).trim());
  return fileItems(t.trim());
});

watch(items, () => (selected.value = 0));

watch(
  () => ui.palette?.id,
  async (id) => {
    if (id == null) return;
    selected.value = 0;
    await nextTick();
    input.value?.focus();
    // 每次打开都重新扫描，保证新建/删除的文件能搜到；扫描期间先用上次的结果
    loadFiles();
  },
);

function close(refocus = true) {
  closePalette();
  if (refocus) document.querySelector<HTMLElement>(".cm-content")?.focus();
}

function accept(index = selected.value) {
  const item = items.value[index];
  if (!item || item.disabled) return;
  close(false);
  item.run?.();
}

function move(delta: number) {
  const n = items.value.length;
  if (!n) return;
  selected.value = (selected.value + delta + n) % n;
  nextTick(() => list.value?.querySelector(".item.selected")?.scrollIntoView({ block: "nearest" }));
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key === "ArrowDown") move(1);
  else if (e.key === "ArrowUp") move(-1);
  else if (e.key === "Enter") accept();
  else if (e.key === "Escape") close();
  else return;
  e.preventDefault();
}
</script>

<template>
  <div v-if="ui.palette" class="mask" @mousedown.self="close()">
    <div class="palette">
      <input
        ref="input"
        v-model="text"
        :placeholder="placeholder"
        spellcheck="false"
        @keydown="onKeyDown"
        @blur="close(false)"
      />
      <!-- mousedown.prevent 让输入框保持焦点，否则点击列表会先触发 blur 关闭面板 -->
      <ul ref="list" class="list" @mousedown.prevent>
        <li
          v-for="(item, i) in items"
          :key="item.key"
          class="item"
          :class="{ selected: i === selected, disabled: item.disabled }"
          @mousemove="selected = i"
          @click="accept(i)"
        >
          <span class="label">
            <span
              v-for="(part, k) in highlight(item.label, item.hits ?? [])"
              :key="k"
              :class="{ hit: part.hit }"
              >{{ part.text }}</span
            >
          </span>
          <span v-if="item.detail" class="detail">{{ item.detail }}</span>
          <span v-if="item.keys" class="keys">{{ item.keys }}</span>
        </li>
        <li v-if="items.length === 0" class="item disabled">
          {{ loading ? "正在扫描文件…" : "没有匹配的结果" }}
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  z-index: 100;
}
.palette {
  position: absolute;
  top: 4px;
  left: 50%;
  transform: translateX(-50%);
  width: 600px;
  max-width: calc(100% - 32px);
  padding: 6px;
  border: 1px solid var(--widget-border);
  border-radius: 8px;
  background: var(--bg-widget);
  box-shadow: var(--shadow);
}
input {
  width: 100%;
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--accent);
  border-radius: 4px;
  outline: none;
  background: var(--bg-input);
  color: var(--fg-strong);
  font: inherit;
}
.list {
  max-height: min(420px, 60vh);
  margin: 6px 0 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
}
.item {
  display: flex;
  align-items: baseline;
  gap: 10px;
  height: 24px;
  padding: 3px 8px;
  border-radius: 4px;
  white-space: nowrap;
  cursor: pointer;
}
.item.selected:not(.disabled) {
  background: var(--selection);
}
.item.disabled {
  color: var(--fg-muted);
  cursor: default;
}
.label {
  flex: none;
  color: var(--fg-strong);
}
.item.disabled .label {
  color: inherit;
}
.hit {
  color: var(--hl);
  font-weight: 600;
}
.detail {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 12px;
  color: var(--fg-muted);
}
.keys {
  margin-left: auto;
  flex: none;
  font-size: 12px;
  color: var(--fg-muted);
}
</style>
