<script setup lang="ts">
import { baseName, dirName } from "../api/fs";
import type { CommitFile, GitCommit } from "../api/git";
import { createBranchAt, describeStatus, kindOf } from "../store/git";
import {
  clearFileHistory,
  formatTime,
  history,
  loadHistory,
  openCommitFile,
  relativeTime,
  toggleCommit,
} from "../store/history";
import { showMenu } from "../store/ui";
import Icon from "./Icon.vue";

type RefKind = "head" | "tag" | "remote" | "branch";

/** "HEAD -> master" 显示成当前分支，"tag: v1" 显示成标签 */
function parseRef(ref: string): { label: string; kind: RefKind } {
  if (ref.startsWith("HEAD -> ")) return { label: ref.slice(8), kind: "head" };
  if (ref === "HEAD") return { label: "HEAD", kind: "head" };
  if (ref.startsWith("tag: ")) return { label: ref.slice(5), kind: "tag" };
  return { label: ref, kind: ref.includes("/") ? "remote" : "branch" };
}

function tooltip(c: GitCommit) {
  const text = c.body ? `${c.subject}\n\n${c.body}` : c.subject;
  return `${c.short} · ${c.author} <${c.email}> · ${formatTime(c.time)}\n\n${text}`;
}

function fileDetail(f: CommitFile) {
  const dir = dirName(f.path);
  return f.origPath ? `${dir ? dir + " · " : ""}由 ${baseName(f.origPath)} 重命名` : dir;
}

function onCommitMenu(e: MouseEvent, c: GitCommit) {
  const message = c.body ? `${c.subject}\n\n${c.body}` : c.subject;
  showMenu(e, [
    { label: history.expanded[c.hash] ? "收起改动的文件" : "查看改动的文件", action: () => toggleCommit(c) },
    { label: "复制提交哈希", action: () => navigator.clipboard.writeText(c.hash) },
    { label: "复制提交信息", action: () => navigator.clipboard.writeText(message) },
    { label: "基于此提交新建分支…", action: () => createBranchAt(c.hash, c.short) },
  ]);
}
</script>

<template>
  <section class="history">
    <div class="group" @click="history.open = !history.open">
      <span class="twisty" :class="{ open: history.open }">›</span>
      <span class="group-title">历史记录</span>
      <span v-if="history.filter" class="filter" :title="`只显示改动过 ${history.filter} 的提交`" @click.stop>
        <span class="filter-name">{{ baseName(history.filter) }}</span>
        <button title="显示全部提交" @click="clearFileHistory()"><Icon name="close" /></button>
      </span>
      <span class="actions" @click.stop>
        <button title="刷新历史记录" @click="loadHistory()"><Icon name="refresh" /></button>
      </span>
    </div>

    <template v-if="history.open">
      <div v-for="c in history.commits" :key="c.hash">
        <div
          class="row commit"
          :class="{ expanded: history.expanded[c.hash] }"
          :title="tooltip(c)"
          @click="toggleCommit(c)"
          @contextmenu="onCommitMenu($event, c)"
        >
          <span class="twisty" :class="{ open: history.expanded[c.hash] }">›</span>
          <span class="subject">{{ c.subject }}</span>
          <span
            v-for="r in c.refs.map(parseRef)"
            :key="r.label"
            class="ref"
            :class="r.kind"
            >{{ r.label }}</span
          >
          <span class="time">{{ relativeTime(c.time) }}</span>
        </div>

        <template v-if="history.expanded[c.hash]">
          <div class="meta">
            <span>{{ c.author }} · {{ formatTime(c.time) }} · {{ c.short }}</span>
            <p v-if="c.body" class="body">{{ c.body }}</p>
          </div>
          <div v-if="history.files[c.hash] === null" class="row file muted">正在读取…</div>
          <div v-else-if="history.files[c.hash]?.length === 0" class="row file muted">没有改动的文件</div>
          <div
            v-for="f in history.files[c.hash] ?? []"
            :key="f.path"
            class="row file"
            :title="`${f.path} · ${describeStatus(f.status)}`"
            @click="openCommitFile(c, f)"
          >
            <span class="name" :class="[kindOf(f.status), { deleted: f.status === 'D' }]">{{
              baseName(f.path)
            }}</span>
            <span class="dir">{{ fileDetail(f) }}</span>
            <span class="letter" :class="kindOf(f.status)">{{ f.status }}</span>
          </div>
        </template>
      </div>

      <p v-if="!history.loading && history.commits.length === 0" class="note">
        {{ history.filter ? "这个文件还没有提交记录。" : "还没有任何提交。" }}
      </p>
      <button v-if="history.loading" class="more" disabled>正在读取…</button>
      <button v-else-if="!history.done" class="more" @click="loadHistory(false)">加载更多</button>
    </template>
  </section>
</template>

<style scoped>
.history {
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
  overflow: hidden;
  text-overflow: ellipsis;
}
.actions {
  display: none;
  flex: none;
}
.group:hover .actions {
  display: flex;
}
button {
  width: 22px;
  height: 22px;
  border-radius: 4px;
  color: var(--fg-muted);
}
button:hover {
  background: var(--hover);
  color: var(--fg-strong);
}

.filter {
  display: flex;
  align-items: center;
  max-width: 55%;
  height: 18px;
  margin-right: 4px;
  padding-left: 7px;
  border-radius: 9px;
  background: var(--bg-input);
  font-weight: normal;
  text-transform: none;
  letter-spacing: 0;
  color: var(--fg);
}
.filter-name {
  overflow: hidden;
  text-overflow: ellipsis;
}
.filter button {
  width: 18px;
  height: 18px;
  border-radius: 9px;
}
.filter .icon {
  width: 12px;
  height: 12px;
}

.commit {
  padding-left: 8px;
}
.subject {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.commit.expanded .subject {
  color: var(--fg-strong);
}
.ref {
  flex: none;
  max-width: 40%;
  margin-left: 6px;
  padding: 0 6px;
  border: 1px solid var(--border-input);
  border-radius: 9px;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 11px;
  line-height: 16px;
  color: var(--fg-muted);
}
.ref.head {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--accent-fg);
}
.ref.tag {
  border-color: var(--git-modified);
  color: var(--git-modified);
}
.time {
  flex: none;
  margin-left: 8px;
  font-size: 12px;
  color: var(--fg-muted);
}

.meta {
  padding: 2px 8px 4px 40px;
  font-size: 12px;
  color: var(--fg-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.body {
  max-height: 8.4em;
  margin: 4px 0 0;
  overflow: auto;
  white-space: pre-wrap;
  color: var(--fg);
}

.file {
  padding-left: 40px;
}
.file.muted {
  color: var(--fg-muted);
  cursor: default;
}
.file.muted:hover {
  background: none;
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

.note {
  margin: 4px 16px 8px;
  color: var(--fg-muted);
}
.more {
  width: calc(100% - 32px);
  height: 24px;
  margin: 4px 16px;
  border: 1px solid var(--border-input);
  border-radius: var(--radius);
  font-size: 12px;
}
.more:disabled {
  cursor: default;
  opacity: 0.7;
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
