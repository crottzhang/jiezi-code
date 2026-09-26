<script setup lang="ts">
import { computed, watch } from "vue";
import { noteIdOf, type NoteMeta } from "../api/notes";
import { deleteNote, newNote, notes, openNote, refreshNotes, setNoteQuery, togglePin } from "../store/notes";
import { layout } from "../store/layout";
import { SEPARATOR, showMenu } from "../store/ui";
import { activeTab } from "../store/workspace";
import { formatTime, relativeTime } from "../utils/time";
import Icon from "./Icon.vue";

const activeId = computed(() => {
  const tab = activeTab();
  return tab ? noteIdOf(tab.path) : null;
});

function onMenu(e: MouseEvent, note: NoteMeta) {
  showMenu(e, [
    { label: "打开", action: () => openNote(note.id) },
    { label: note.pinned ? "取消置顶" : "置顶", action: () => togglePin(note) },
    SEPARATOR,
    { label: "删除笔记", action: () => deleteNote(note), danger: true },
  ]);
}

function onKey(e: KeyboardEvent) {
  if (e.key === "Escape" && notes.query) setNoteQuery("");
  else if (e.key === "Enter" && notes.list.length) openNote(notes.list[0].id);
  else return;
  e.preventDefault();
}

// 第一次显示笔记视图时才读取（也就是这时才打开笔记数据库）
watch(
  () => layout.sidebarVisible && layout.sidebarView === "notes",
  (shown) => {
    if (shown && !notes.loaded) refreshNotes();
  },
  { immediate: true },
);
</script>

<template>
  <aside class="notes">
    <header>
      <span class="title">笔记</span>
      <button title="新建笔记" @click="newNote()"><Icon name="newFile" /></button>
      <button title="刷新" @click="refreshNotes()"><Icon name="refresh" /></button>
    </header>

    <div class="field">
      <input
        :value="notes.query"
        spellcheck="false"
        placeholder="搜索笔记"
        @input="setNoteQuery(($event.target as HTMLInputElement).value)"
        @keydown="onKey"
      />
    </div>

    <div class="list">
      <div
        v-for="note in notes.list"
        :key="note.id"
        class="row"
        :class="{ active: note.id === activeId }"
        :title="`${note.title}\n修改于 ${formatTime(note.updatedAt)}`"
        @click="openNote(note.id)"
        @contextmenu="onMenu($event, note)"
      >
        <div class="line">
          <Icon v-if="note.pinned" name="pin" class="pinned" />
          <span class="name">{{ note.title }}</span>
          <span class="actions" @click.stop>
            <button :title="note.pinned ? '取消置顶' : '置顶'" @click="togglePin(note)"><Icon name="pin" /></button>
            <button title="删除笔记" @click="deleteNote(note)"><Icon name="trash" /></button>
          </span>
        </div>
        <div class="line detail">
          <span class="time">{{ relativeTime(note.updatedAt) }}</span>
          <span class="summary">{{ note.summary }}</span>
        </div>
      </div>

      <div v-if="notes.loaded && !notes.list.length" class="empty">
        <template v-if="notes.query">没有找到包含“{{ notes.query }}”的笔记。</template>
        <template v-else>
          <p>还没有笔记。</p>
          <button class="primary" @click="newNote()">新建笔记</button>
        </template>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.notes {
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
.actions button {
  width: 22px;
  height: 22px;
  flex: none;
  border-radius: 4px;
  color: var(--fg-muted);
}
header button:hover,
.actions button:hover {
  background: var(--hover);
  color: var(--fg-strong);
}

.field {
  display: flex;
  align-items: center;
  height: 26px;
  margin: 2px 12px 6px;
  padding: 0 6px;
  flex: none;
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
  color: inherit;
  font: inherit;
}

.list {
  flex: 1;
  overflow: auto;
  padding-bottom: 20px;
}
.row {
  padding: 4px 8px 4px 16px;
  cursor: pointer;
  user-select: none;
}
.row:hover {
  background: var(--hover);
}
.row.active {
  background: var(--selection);
  color: var(--fg-strong);
}
.line {
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 22px;
  white-space: nowrap;
}
.pinned {
  color: var(--fg-muted);
}
.name,
.summary {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.actions {
  display: none;
  flex: none;
}
.row:hover .actions {
  display: flex;
}
.detail {
  min-height: 18px;
  gap: 8px;
  font-size: 12px;
  color: var(--fg-muted);
}
.time {
  flex: none;
}

.empty {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 16px;
  color: var(--fg-muted);
}
.empty p {
  margin: 0;
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
</style>
