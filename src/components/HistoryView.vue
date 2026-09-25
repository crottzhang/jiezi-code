<script setup lang="ts">
import { baseName, dirName } from "../api/fs";
import type { CommitFile, GitCommit } from "../api/git";
import { createBranchAt } from "../store/branches";
import { describeStatus, kindOf } from "../store/git";
import {
  cherryPickCommit,
  clearFileHistory,
  formatTime,
  history,
  loadHistory,
  showCurrentBranchHistory,
  openCommitFile,
  pickHistoryBranch,
  revertCommit,
  shortTime,
  tagCommit,
  toggleCommit,
} from "../store/history";
import { SEPARATOR, showMenu, type MenuItem } from "../store/ui";
import Icon from "./Icon.vue";

function tooltip(c: GitCommit) {
  const text = c.body ? `${c.subject}\n\n${c.body}` : c.subject;
  return `${c.short} · ${c.author} <${c.email}> · ${formatTime(c.time)}\n\n${text}`;
}

function fileDetail(f: CommitFile) {
  const dir = dirName(f.path);
  return f.origPath ? `${dir ? dir + " · " : ""}由 ${baseName(f.origPath)} 重命名` : dir;
}

function onGroupMenu(e: MouseEvent) {
  const items: MenuItem[] = [{ label: "查看其他分支的历史…", action: () => pickHistoryBranch() }];
  if (history.rev) items.push({ label: "回到当前分支的历史", action: () => showCurrentBranchHistory() });
  showMenu(e, items);
}

function onCommitMenu(e: MouseEvent, c: GitCommit) {
  const message = c.body ? `${c.subject}\n\n${c.body}` : c.subject;
  const items: MenuItem[] = [
    { label: history.expanded[c.hash] ? "收起改动的文件" : "查看改动的文件", action: () => toggleCommit(c) },
    { label: "复制提交哈希", action: () => navigator.clipboard.writeText(c.hash) },
    { label: "复制提交信息", action: () => navigator.clipboard.writeText(message) },
    SEPARATOR,
    { label: "基于此提交新建分支…", action: () => createBranchAt(c.hash, c.short) },
    { label: "在此提交上打标签…", action: () => tagCommit(c) },
  ];
  // 看的是其他分支的历史时，可以把提交拣选过来；当前分支上的提交可以还原
  if (history.rev) items.push({ label: "拣选到当前分支", action: () => cherryPickCommit(c) });
  else items.push({ label: "还原此提交（生成反向提交）", action: () => revertCommit(c) });
  showMenu(e, items);
}
</script>

<template>
  <section class="history">
    <div class="group" @click="history.open = !history.open" @contextmenu="onGroupMenu">
      <span class="twisty" :class="{ open: history.open }">›</span>
      <span class="group-title">历史记录</span>
      <span class="search" @click.stop>
        <input
          v-model="history.query"
          placeholder="搜索提交、作者、SHA"
          spellcheck="false"
          @keydown.esc="history.query = ''"
        />
        <button v-if="history.query" title="清除搜索" @click="history.query = ''"><Icon name="close" /></button>
      </span>
      <!-- 只在看其他分支时显示；当前分支名底部状态栏已经有了 -->
      <span v-if="history.rev" class="filter" :title="`正在看 ${history.rev} 的历史，点击切换`" @click.stop>
        <span class="filter-name" @click="pickHistoryBranch()">{{ history.rev }}</span>
        <button title="回到当前分支的历史" @click="showCurrentBranchHistory()"><Icon name="close" /></button>
      </span>
      <span v-if="history.filter" class="filter" :title="`只显示改动过 ${history.filter} 的提交`" @click.stop>
        <span class="filter-name">{{ baseName(history.filter) }}</span>
        <button title="显示全部提交" @click="clearFileHistory()"><Icon name="close" /></button>
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
          <span class="time">{{ shortTime(c.time) }}</span>
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
        {{
          history.query.trim()
            ? "没有匹配的提交。"
            : history.filter
              ? "这个文件还没有提交记录。"
              : "还没有任何提交。"
        }}
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
  flex: none;
  margin-right: 6px;
}
.search {
  display: flex;
  flex: 1;
  align-items: center;
  min-width: 0;
  height: 18px;
  margin-right: 4px;
  border: 1px solid var(--border-input);
  border-radius: 9px;
  background: var(--bg-input);
  font-weight: normal;
  text-transform: none;
  letter-spacing: 0;
}
.search:focus-within {
  border-color: var(--accent);
}
.search input {
  flex: 1;
  min-width: 0;
  height: 100%;
  padding: 0 7px;
  border: none;
  outline: none;
  background: none;
  color: var(--fg-strong);
  font: inherit;
  font-size: 12px;
  user-select: text;
}
.search input::placeholder {
  color: var(--fg-muted);
}
.search button {
  flex: none;
  width: 16px;
  height: 16px;
  border-radius: 8px;
}
.search .icon {
  width: 12px;
  height: 12px;
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
  flex: none;
  align-items: center;
  max-width: 35%;
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
