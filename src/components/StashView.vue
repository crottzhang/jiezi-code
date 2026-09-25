<script setup lang="ts">
import { baseName, dirName } from "../api/fs";
import type { CommitFile, Stash } from "../api/git";
import { describeStatus, kindOf } from "../store/git";
import { applyStash, dropStash, openStashFile, stash, toggleStash } from "../store/stash";
import { showMenu } from "../store/ui";
import { formatTime, relativeTime } from "../utils/time";
import Icon from "./Icon.vue";

/** “On main: 说明” / “WIP on main: 1a2b3c 提交说明” → 去掉前缀只留说明 */
function title(s: Stash) {
  return s.message.replace(/^(WIP on|On) [^:]+:\s*/, "") || s.message;
}

function fileDetail(f: CommitFile) {
  const dir = dirName(f.path);
  return f.origPath ? `${dir ? dir + " · " : ""}由 ${baseName(f.origPath)} 重命名` : dir;
}

function onMenu(e: MouseEvent, s: Stash) {
  showMenu(e, [
    { label: "应用储藏", action: () => applyStash(s, false) },
    { label: "弹出储藏（应用后删除）", action: () => applyStash(s, true) },
    { label: stash.expanded[s.hash] ? "收起改动的文件" : "查看改动的文件", action: () => toggleStash(s) },
    { label: "删除储藏", action: () => dropStash(s), danger: true },
  ]);
}
</script>

<template>
  <section v-if="stash.list.length" class="stash">
    <div class="group" @click="stash.open = !stash.open">
      <span class="twisty" :class="{ open: stash.open }">›</span>
      <span class="group-title">储藏</span>
      <span class="count">{{ stash.list.length }}</span>
    </div>

    <template v-if="stash.open">
      <div v-for="s in stash.list" :key="s.hash">
        <div
          class="row item"
          :title="`stash@{${s.index}} · ${formatTime(s.time)}\n${s.message}`"
          @click="toggleStash(s)"
          @contextmenu="onMenu($event, s)"
        >
          <span class="twisty" :class="{ open: stash.expanded[s.hash] }">›</span>
          <span class="subject">{{ title(s) }}</span>
          <span class="actions" @click.stop>
            <button title="应用储藏" @click="applyStash(s, false)"><Icon name="apply" /></button>
            <button title="弹出储藏（应用后删除）" @click="applyStash(s, true)"><Icon name="pop" /></button>
            <button title="删除储藏" @click="dropStash(s)"><Icon name="trash" /></button>
          </span>
          <span class="time">{{ relativeTime(s.time) }}</span>
        </div>

        <template v-if="stash.expanded[s.hash]">
          <div v-if="stash.files[s.hash] === null" class="row file muted">正在读取…</div>
          <div
            v-for="f in stash.files[s.hash] ?? []"
            :key="f.path"
            class="row file"
            :title="`${f.path} · ${describeStatus(f.status)}`"
            @click="openStashFile(s, f)"
          >
            <span class="name" :class="[kindOf(f.status), { deleted: f.status === 'D' }]">{{
              baseName(f.path)
            }}</span>
            <span class="dir">{{ fileDetail(f) }}</span>
            <span class="letter" :class="kindOf(f.status)">{{ f.status }}</span>
          </div>
        </template>
      </div>
    </template>
  </section>
</template>

<style scoped>
.stash {
  margin-top: 6px;
}
.group,
.row {
  display: flex;
  align-items: center;
  height: 22px;
  padding-right: 8px;
  cursor: pointer;
  white-space: nowrap;
  user-select: none;
}
.group {
  padding-left: 4px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}
.group:hover,
.row:hover {
  background: var(--hover);
}
.twisty {
  width: 16px;
  flex: none;
  text-align: center;
  font-size: 14px;
  font-weight: normal;
  color: var(--fg-muted);
  transition: transform 0.1s;
}
.twisty.open {
  transform: rotate(90deg);
}
.group-title {
  flex: 1;
}
.count {
  min-width: 18px;
  height: 16px;
  margin-left: 4px;
  padding: 0 5px;
  border-radius: 8px;
  background: var(--bg-input);
  font-size: 11px;
  font-weight: normal;
  line-height: 16px;
  text-align: center;
  color: var(--fg);
}
.item {
  padding-left: 8px;
}
.subject {
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
.actions button {
  width: 22px;
  height: 22px;
  border-radius: 4px;
  color: var(--fg-muted);
}
.actions button:hover {
  background: var(--hover);
  color: var(--fg-strong);
}
.time {
  flex: none;
  margin-left: 8px;
  font-size: 12px;
  color: var(--fg-muted);
}
.file {
  padding-left: 40px;
}
.file.muted {
  color: var(--fg-muted);
  cursor: default;
}
.name {
  flex: none;
  max-width: 70%;
  overflow: hidden;
  text-overflow: ellipsis;
}
.name.deleted {
  text-decoration: line-through;
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
.letter {
  width: 16px;
  flex: none;
  margin-left: 4px;
  text-align: center;
  font-size: 12px;
  font-weight: 600;
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
</style>
