<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { baseName, dirName } from "../api/fs";
import type { FileResult, SearchMatch } from "../api/search";
import {
  clearResults,
  dismissFile,
  matchCount,
  openMatch,
  replaceIn,
  runSearch,
  search,
  setAllCollapsed,
} from "../store/search";
import { openFolder, workspace } from "../store/workspace";
import Icon from "./Icon.vue";

/** 结果列表的行高，列表只渲染可见的行 */
const ROW = 22;

type Row =
  | { kind: "file"; key: string; file: FileResult }
  | { kind: "match"; key: string; file: FileResult; match: SearchMatch };

const queryInput = ref<HTMLInputElement>();
const replaceInput = ref<HTMLInputElement>();
const list = ref<HTMLElement>();
const scrollTop = ref(0);
const viewHeight = ref(0);

const total = computed(() => matchCount());
const hasResults = computed(() => search.files.length > 0);
const allCollapsed = computed(
  () => hasResults.value && search.files.every((f) => search.collapsed[f.path]),
);

const rows = computed(() => {
  const out: Row[] = [];
  for (const file of search.files) {
    out.push({ kind: "file", key: file.path, file });
    if (search.collapsed[file.path]) continue;
    file.matches.forEach((match, i) => out.push({ kind: "match", key: `${file.path}:${i}`, file, match }));
  }
  return out;
});

const visible = computed(() => {
  const start = Math.max(0, Math.floor(scrollTop.value / ROW) - 10);
  const end = Math.min(rows.value.length, Math.ceil((scrollTop.value + viewHeight.value) / ROW) + 10);
  return { offset: start * ROW, rows: rows.value.slice(start, end) };
});

const summary = computed(() => {
  if (!search.done) return "";
  if (!hasResults.value) return "未找到结果。可以检查一下“包含/排除的文件”设置和 .gitignore。";
  const text = `${search.files.length} 个文件中有 ${total.value} 个结果`;
  return search.limitHit ? `${text}（结果太多，只显示了一部分，请缩小搜索范围）` : text;
});

// 新的搜索结果从顶部开始显示
watch(
  () => search.files,
  () => {
    if (list.value) list.value.scrollTop = 0;
  },
);

watch(
  () => search.focus,
  (target) => {
    if (!target) return;
    nextTick(() => {
      const el = target === "replace" ? replaceInput.value : queryInput.value;
      el?.focus();
      el?.select();
      search.focus = null;
    });
  },
  { immediate: true },
);

// 列表在打开文件夹后才出现，跟着 ref 挂上/取下观察
const observer = new ResizeObserver(() => (viewHeight.value = list.value?.clientHeight ?? 0));
watch(list, (el, old) => {
  if (old) observer.unobserve(old);
  if (el) observer.observe(el);
});
onBeforeUnmount(() => observer.disconnect());

function toggleFile(file: FileResult) {
  search.collapsed[file.path] = !search.collapsed[file.path];
}

// 输入框里的快捷键：Alt+C 区分大小写，Alt+W 全字匹配，Alt+R 正则表达式
function onKey(e: KeyboardEvent) {
  if (e.altKey && !e.ctrlKey && !e.metaKey) {
    const key = e.key.toLowerCase();
    if (key === "c") search.caseSensitive = !search.caseSensitive;
    else if (key === "w") search.wholeWord = !search.wholeWord;
    else if (key === "r") search.isRegex = !search.isRegex;
    else return;
    e.preventDefault();
  } else if (e.key === "Enter") {
    e.preventDefault();
    runSearch();
  }
}

function onReplaceKey(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.altKey && e.key === "Enter") {
    e.preventDefault();
    replaceIn(search.files);
  } else {
    onKey(e);
  }
}
</script>

<template>
  <aside class="search">
    <header>
      <span class="title">搜索</span>
      <button title="刷新" :disabled="!search.query" @click="runSearch()"><Icon name="refresh" /></button>
      <button title="清除搜索结果" :disabled="!search.query" @click="clearResults()">
        <Icon name="clearAll" />
      </button>
      <button
        :title="allCollapsed ? '全部展开' : '全部折叠'"
        :disabled="!hasResults"
        @click="setAllCollapsed(!allCollapsed)"
      >
        <Icon :name="allCollapsed ? 'expandAll' : 'collapseAll'" />
      </button>
    </header>
    <div class="progress" :class="{ active: search.running }"></div>

    <div v-if="!workspace.root" class="empty">
      <p>打开文件夹后即可在文件中搜索。</p>
      <button class="primary" @click="openFolder()">打开文件夹</button>
    </div>

    <template v-else>
      <div class="form">
        <button
          class="twisty-btn"
          :title="search.showReplace ? '隐藏替换' : '切换替换 (Ctrl+Shift+H)'"
          @click="search.showReplace = !search.showReplace"
        >
          <span class="twisty" :class="{ open: search.showReplace }">›</span>
        </button>
        <div class="inputs">
          <div class="field">
            <input
              ref="queryInput"
              v-model="search.query"
              spellcheck="false"
              placeholder="搜索"
              @keydown="onKey"
            />
            <button
              class="opt"
              :class="{ on: search.caseSensitive }"
              title="区分大小写 (Alt+C)"
              @click="search.caseSensitive = !search.caseSensitive"
            >
              Aa
            </button>
            <button
              class="opt word"
              :class="{ on: search.wholeWord }"
              title="全字匹配 (Alt+W)"
              @click="search.wholeWord = !search.wholeWord"
            >
              ab
            </button>
            <button
              class="opt"
              :class="{ on: search.isRegex }"
              title="使用正则表达式 (Alt+R)"
              @click="search.isRegex = !search.isRegex"
            >
              .*
            </button>
          </div>
          <div v-if="search.showReplace" class="replace-row">
            <div class="field">
              <input
                ref="replaceInput"
                v-model="search.replace"
                spellcheck="false"
                :placeholder="search.isRegex ? '替换（可以用 $1 引用分组）' : '替换'"
                @keydown="onReplaceKey"
              />
            </div>
            <button
              class="icon-btn"
              title="全部替换 (Ctrl+Alt+Enter)"
              :disabled="!hasResults || search.running"
              @click="replaceIn(search.files)"
            >
              <Icon name="replace" />
            </button>
          </div>
        </div>
      </div>

      <div class="details">
        <button
          class="icon-btn"
          :class="{ on: search.showDetails }"
          title="切换搜索详细信息"
          @click="search.showDetails = !search.showDetails"
        >
          <Icon name="more" />
        </button>
      </div>
      <div v-if="search.showDetails" class="globs">
        <label>包含的文件</label>
        <div class="field">
          <input v-model.lazy="search.include" spellcheck="false" placeholder="例如 *.ts, src/**/include" @keydown.enter="($event.target as HTMLInputElement).blur()" />
        </div>
        <label>排除的文件</label>
        <div class="field">
          <input v-model.lazy="search.exclude" spellcheck="false" placeholder="例如 *.min.js, dist" @keydown.enter="($event.target as HTMLInputElement).blur()" />
        </div>
      </div>

      <p v-if="search.error" class="message error">{{ search.error }}</p>
      <p v-else-if="summary" class="message">{{ summary }}</p>

      <div ref="list" class="results" @scroll="scrollTop = ($event.target as HTMLElement).scrollTop">
        <div :style="{ height: `${rows.length * ROW}px` }">
          <div :style="{ transform: `translateY(${visible.offset}px)` }">
            <template v-for="row in visible.rows" :key="row.key">
              <div v-if="row.kind === 'file'" class="row file" :title="row.file.path" @click="toggleFile(row.file)">
                <span class="twisty" :class="{ open: !search.collapsed[row.file.path] }">›</span>
                <span class="name">{{ baseName(row.file.rel) }}</span>
                <span class="dir">{{ dirName(row.file.rel) }}</span>
                <span class="actions" @click.stop>
                  <button
                    v-if="search.showReplace"
                    title="在此文件中全部替换"
                    @click="replaceIn([row.file], false)"
                  >
                    <Icon name="replace" />
                  </button>
                  <button title="从结果中移除" @click="dismissFile(row.file)"><Icon name="close" /></button>
                </span>
                <span class="count">{{ row.file.matches.length }}</span>
              </div>
              <div
                v-else
                class="row match"
                :title="`第 ${row.match.line} 行`"
                @click="openMatch(row.file, row.match)"
              >
                <span class="before">{{ row.match.before }}</span>
                <span class="hit" :class="{ removed: row.match.replacement != null }">{{ row.match.text }}</span>
                <span v-if="row.match.replacement != null" class="inserted">{{ row.match.replacement }}</span>
                <span class="after">{{ row.match.after }}</span>
              </div>
            </template>
          </div>
        </div>
      </div>
    </template>
  </aside>
</template>

<style scoped>
.search {
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
  gap: 2px;
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
}
header button,
.icon-btn,
.actions button {
  width: 22px;
  height: 22px;
  flex: none;
  border-radius: 4px;
  color: var(--fg-muted);
}
header button:not(:disabled):hover,
.icon-btn:not(:disabled):hover,
.actions button:hover {
  background: var(--hover);
  color: var(--fg-strong);
}
button:disabled {
  opacity: 0.4;
  cursor: default;
}

.progress {
  height: 2px;
  flex: none;
  overflow: hidden;
  position: relative;
}
.progress.active::after {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  width: 30%;
  background: var(--accent);
  animation: progress 1.2s ease-in-out infinite;
}
@keyframes progress {
  from {
    left: -30%;
  }
  to {
    left: 100%;
  }
}

.empty {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 20px;
  color: var(--fg-muted);
}
.empty p {
  margin: 0 0 4px;
}
.primary {
  width: 100%;
  height: 28px;
  border-radius: var(--radius);
  background: var(--accent);
  color: var(--accent-fg);
}
.primary:hover {
  filter: brightness(1.15);
}

.form {
  display: flex;
  align-items: flex-start;
  padding: 2px 12px 0 4px;
  flex: none;
}
.twisty-btn {
  width: 16px;
  height: 26px;
  margin-right: 2px;
  flex: none;
  border-radius: 3px;
}
.twisty-btn:hover {
  background: var(--hover);
}
.inputs {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  min-width: 0;
}
.replace-row {
  display: flex;
  align-items: center;
  gap: 2px;
}
.replace-row .field {
  flex: 1;
}
.field {
  display: flex;
  align-items: center;
  height: 26px;
  padding: 0 2px 0 6px;
  border: 1px solid var(--border-input);
  border-radius: var(--radius);
  background: var(--bg-input);
}
.field:focus-within {
  border-color: var(--accent);
}
.field input {
  flex: 1;
  min-width: 0;
  height: 100%;
  padding: 0;
  border: 0;
  outline: none;
  background: none;
  color: var(--fg-strong);
  font: inherit;
}
.field input::placeholder {
  color: var(--fg-muted);
}
.opt {
  width: 22px;
  height: 20px;
  flex: none;
  border: 1px solid transparent;
  border-radius: 3px;
  color: var(--fg-muted);
  font-size: 12px;
}
.opt.word {
  text-decoration: underline;
  text-underline-offset: 2px;
}
.opt:hover {
  background: var(--hover);
  color: var(--fg-strong);
}
.opt.on,
.icon-btn.on {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 25%, transparent);
  color: var(--fg-strong);
}

.details {
  display: flex;
  justify-content: flex-end;
  padding: 2px 12px 0;
  flex: none;
}
.details .icon-btn {
  height: 16px;
  border: 1px solid transparent;
}
.globs {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 0 12px 4px 22px;
  flex: none;
}
.globs label {
  font-size: 11px;
  color: var(--fg-muted);
}

.message {
  margin: 4px 12px 6px 22px;
  flex: none;
  color: var(--fg-muted);
  font-size: 12px;
  overflow-wrap: anywhere;
}
.message.error {
  color: var(--danger);
  white-space: pre-wrap;
}

.results {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
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
.row.file {
  padding-left: 4px;
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
.name {
  flex: none;
  max-width: 70%;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dir {
  flex: 1;
  min-width: 0;
  margin-left: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 12px;
  color: var(--fg-muted);
}
.count {
  min-width: 18px;
  height: 16px;
  margin-left: 4px;
  padding: 0 5px;
  border-radius: 8px;
  background: var(--bg-input);
  font-size: 11px;
  line-height: 16px;
  text-align: center;
}
.actions {
  display: none;
  flex: none;
}
.row:hover .actions {
  display: flex;
}

.row.match {
  display: block;
  padding-left: 36px;
  line-height: 22px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.hit {
  border-radius: 2px;
  background: var(--ed-find);
  color: var(--fg-strong);
}
.hit.removed {
  background: var(--diff-removed-text);
  text-decoration: line-through;
}
.inserted {
  border-radius: 2px;
  background: var(--diff-inserted-text);
  color: var(--fg-strong);
}
.before,
.after,
.hit,
.inserted {
  white-space: pre;
  tab-size: 4;
}
</style>
