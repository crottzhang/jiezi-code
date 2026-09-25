<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from "vue";
import { baseName, dirName } from "../api/fs";
import type { GitChange } from "../api/git";
import {
  createBranch,
  pickBranch,
  pickBranchToDelete,
  pickBranchToMerge,
  renameBranch,
} from "../store/branches";
import { openChange, openChangeFile } from "../store/diff";
import {
  OPERATION_LABELS,
  abortOperation,
  absPath,
  addToGitignore,
  cancelAmend,
  cloneRepo,
  commit,
  continueOperation,
  describeStatus,
  discard,
  git,
  groups,
  initRepo,
  kindOf,
  refreshGit,
  remote,
  stage,
  startAmend,
  statusLetter,
  sync,
  undoLastCommit,
  unstage,
  type Group,
} from "../store/git";
import { history, loadHistory, showFileHistory } from "../store/history";
import { showOutput } from "../store/output";
import { popLatestStash, stashChanges } from "../store/stash";
import { SEPARATOR, showMenu, type MenuItem } from "../store/ui";
import { openFolder, workspace } from "../store/workspace";
import HistoryView from "./HistoryView.vue";
import Icon from "./Icon.vue";
import StashView from "./StashView.vue";

const TITLES: Record<Group, string> = {
  merge: "合并更改",
  staged: "暂存的更改",
  changes: "更改",
};

const collapsed = reactive<Record<Group, boolean>>({ merge: false, staged: false, changes: false });
const input = ref<HTMLTextAreaElement>();

const sections = computed(() =>
  (["merge", "staged", "changes"] as Group[])
    .map((id) => ({ id, items: groups.value[id] }))
    .filter((s) => s.items.length),
);

const hasChanges = computed(() => sections.value.length > 0);
const operation = computed(() => git.status?.operation ?? null);

const placeholder = computed(() => {
  if (operation.value === "merge") return "合并提交信息（不填则使用默认的合并信息）";
  if (git.amend) return "修改上次的提交信息（Ctrl+Enter 修改上次提交）";
  const branch = git.status?.branch;
  return branch ? `提交信息（Ctrl+Enter 提交到“${branch}”）` : "提交信息（Ctrl+Enter 提交）";
});

/** 主按钮：进行中的操作→继续；修改上次提交；有更改时提交；没有更改时发布分支或同步 */
const primary = computed(() => {
  const s = git.status;
  if (operation.value) {
    return { label: `继续${OPERATION_LABELS[operation.value]}`, icon: "check" as const, run: continueOperation };
  }
  if (git.amend) return { label: "修改上次提交", icon: "check" as const, run: () => commit() };
  if (!s || hasChanges.value || !s.branch) return { label: "提交", icon: "check" as const, run: () => commit() };
  if (!s.upstream) return { label: "发布分支", icon: "sync" as const, run: () => remote("publish") };
  if (s.ahead || s.behind) {
    const counts = [s.behind && `${s.behind}↓`, s.ahead && `${s.ahead}↑`].filter(Boolean).join(" ");
    return { label: `同步更改 ${counts}`, icon: "sync" as const, run: sync };
  }
  return { label: "提交", icon: "check" as const, run: () => commit() };
});

/** 顶部进度条：远程操作有百分比时显示实际进度 */
const progressWidth = computed(() => {
  const p = git.progress;
  return p?.percent != null ? `${p.percent}%` : null;
});

/** 刷新状态，同时重新读取历史记录（HEAD 没变时状态刷新不会触发历史重新读取） */
function refresh() {
  refreshGit();
  if (history.open) loadHistory();
}

// 提交信息输入框随内容增高
function autosize() {
  const el = input.value;
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
}
watch(
  () => git.message,
  () => nextTick(autosize),
);
// 进入“修改上次提交”模式时把光标放进输入框
watch(
  () => git.amend,
  (on) => on && nextTick(() => input.value?.focus()),
);

function onCommitKey(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    e.preventDefault();
    primary.value.run();
  } else if (e.key === "Escape" && git.amend) {
    cancelAmend();
  }
}

function onCommitMenu(e: MouseEvent) {
  const disabled = !!operation.value;
  const items: MenuItem[] = disabled
    ? [{ label: `中止${OPERATION_LABELS[operation.value!]}`, action: abortOperation, danger: true }]
    : [
        { label: "提交", action: () => commit() },
        { label: "提交并推送", action: () => commit("push") },
        { label: "提交并同步", action: () => commit("sync") },
        SEPARATOR,
        git.amend
          ? { label: "取消修改上次提交", action: cancelAmend }
          : { label: "修改上次提交…", action: startAmend },
        { label: "撤销上次提交", action: undoLastCommit },
      ];
  showMenu(e, items);
}

function relDir(c: GitChange) {
  const dir = dirName(c.path);
  return c.origPath ? `${dir ? dir + " · " : ""}由 ${baseName(c.origPath)} 重命名` : dir;
}

function isDeleted(c: GitChange, group: Group) {
  return (group === "staged" ? c.index : c.worktree) === "D";
}

function onItemMenu(e: MouseEvent, c: GitChange, group: Group) {
  const items: MenuItem[] = [];
  if (!isDeleted(c, group)) {
    if (group !== "merge" && c.worktree !== "?") {
      items.push({ label: "打开更改", action: () => openChange(c, group) });
    }
    items.push({ label: "打开文件", action: () => openChangeFile(c) });
  }
  if (group === "staged") items.push({ label: "取消暂存", action: () => unstage([c]) });
  else items.push({ label: group === "merge" ? "标记为已解决（暂存）" : "暂存更改", action: () => stage([c]) });
  if (group === "changes") items.push({ label: "放弃更改", action: () => discard([c]), danger: true });
  items.push(SEPARATOR);
  if (c.worktree === "?") {
    items.push({ label: "添加到 .gitignore", action: () => addToGitignore(absPath(c.path), false) });
  } else {
    items.push({ label: "查看文件历史", action: () => showFileHistory(absPath(c.path)) });
  }
  items.push(
    { label: "复制路径", action: () => navigator.clipboard.writeText(absPath(c.path)) },
    { label: "复制相对路径", action: () => navigator.clipboard.writeText(c.path) },
  );
  showMenu(e, items);
}

function onMoreMenu(e: MouseEvent) {
  const s = git.status;
  if (!s) return;
  const { changes, staged } = groups.value;
  const items: MenuItem[] = [
    { label: "拉取", action: () => remote("pull") },
    { label: "推送", action: () => remote(s.upstream ? "push" : "publish") },
    { label: "同步（拉取并推送）", action: sync },
    { label: "抓取", action: () => remote("fetch") },
    { label: "推送所有标签", action: () => remote("push-tags") },
    SEPARATOR,
    { label: "切换分支…", action: pickBranch },
    { label: "新建分支…", action: () => createBranch() },
    { label: "合并分支到当前分支…", action: pickBranchToMerge },
    { label: "重命名当前分支…", action: renameBranch },
    { label: "删除分支…", action: pickBranchToDelete },
    SEPARATOR,
    { label: "储藏改动…", action: () => stashChanges(false) },
    { label: "储藏改动（包含未跟踪的文件）…", action: () => stashChanges(true) },
  ];
  if (s.stashCount) items.push({ label: "弹出最新的储藏", action: popLatestStash });
  items.push(SEPARATOR);
  if (changes.length) items.push({ label: "暂存所有更改", action: () => stage(changes) });
  if (staged.length) items.push({ label: "取消暂存所有更改", action: () => unstage(staged) });
  if (changes.length) items.push({ label: "放弃所有更改", action: () => discard(changes), danger: true });
  items.push({ label: "显示 Git 输出", action: showOutput });
  showMenu(e, items);
}
</script>

<template>
  <aside class="scm">
    <header>
      <span class="title">源代码管理</span>
      <template v-if="git.status">
        <button title="提交 (Ctrl+Enter)" :disabled="git.busy > 0" @click="primary.run()">
          <Icon name="check" />
        </button>
        <button title="刷新" @click="refresh()"><Icon name="refresh" /></button>
        <button title="更多操作" @click="onMoreMenu"><Icon name="more" /></button>
      </template>
    </header>
    <div class="progress" :class="{ active: git.busy > 0 && !progressWidth }">
      <div v-if="progressWidth" class="bar" :style="{ width: progressWidth }"></div>
    </div>

    <div v-if="!workspace.root" class="empty">
      <p>打开文件夹后即可使用源代码管理。</p>
      <button class="primary" @click="openFolder()">打开文件夹</button>
      <button class="secondary" @click="cloneRepo()">克隆仓库…</button>
    </div>
    <div v-else-if="!git.loaded" class="empty"><p>正在读取 Git 状态…</p></div>
    <div v-else-if="!git.status" class="empty">
      <p>当前文件夹不是 Git 仓库。</p>
      <button class="primary" @click="initRepo()">初始化仓库</button>
      <button class="secondary" @click="cloneRepo()">克隆仓库…</button>
    </div>

    <div v-else class="body">
      <div v-if="operation" class="banner">
        <p>
          正在{{ OPERATION_LABELS[operation] }}。{{
            groups.merge.length
              ? `还有 ${groups.merge.length} 个文件有冲突，解决后暂存它们，再点“继续”。`
              : "冲突都已解决，可以继续了。"
          }}
        </p>
        <div class="banner-actions">
          <button class="secondary" @click="abortOperation()">中止</button>
        </div>
      </div>

      <div class="composer">
        <div v-if="git.amend" class="amend">
          <span>正在修改上次提交</span>
          <button title="取消 (Esc)" @click="cancelAmend()"><Icon name="close" /></button>
        </div>
        <textarea
          ref="input"
          v-model="git.message"
          rows="1"
          spellcheck="false"
          :placeholder="placeholder"
          @keydown="onCommitKey"
        ></textarea>
        <div class="split">
          <button class="primary" :disabled="git.busy > 0" @click="primary.run()">
            <Icon :name="primary.icon" />
            <span>{{ primary.label }}</span>
          </button>
          <button class="primary drop" title="更多提交方式" :disabled="git.busy > 0" @click="onCommitMenu">
            <Icon name="chevron" />
          </button>
        </div>
      </div>

      <div class="list">
        <p v-if="git.status.truncated" class="note">
          更改太多，只显示了前 {{ git.status.changes.length }} 个。可以把不需要跟踪的文件加入 .gitignore。
        </p>
        <p v-if="!hasChanges" class="note">
          没有更改。当前在
          <a @click="pickBranch()">{{ git.status.branch ?? `游离的 ${git.status.head ?? "HEAD"}` }}</a>
          。
        </p>

        <section v-for="s in sections" :key="s.id">
          <div class="group" @click="collapsed[s.id] = !collapsed[s.id]">
            <span class="twisty" :class="{ open: !collapsed[s.id] }">›</span>
            <span class="group-title">{{ TITLES[s.id] }}</span>
            <span class="actions" @click.stop>
              <button v-if="s.id === 'changes'" title="放弃所有更改" @click="discard(s.items)">
                <Icon name="discard" />
              </button>
              <button v-if="s.id === 'staged'" title="取消暂存所有更改" @click="unstage(s.items)">
                <Icon name="minus" />
              </button>
              <button v-else title="暂存所有更改" @click="stage(s.items)"><Icon name="plus" /></button>
            </span>
            <span class="count">{{ s.items.length }}</span>
          </div>

          <template v-if="!collapsed[s.id]">
            <div
              v-for="c in s.items"
              :key="c.path"
              class="row"
              :title="`${c.path} · ${describeStatus(statusLetter(c, s.id))}`"
              @click="openChange(c, s.id)"
              @contextmenu="onItemMenu($event, c, s.id)"
            >
              <span
                class="name"
                :class="[kindOf(statusLetter(c, s.id)), { deleted: isDeleted(c, s.id) }]"
                >{{ baseName(c.path) }}</span
              >
              <span class="dir">{{ relDir(c) }}</span>
              <span class="actions" @click.stop>
                <button v-if="!isDeleted(c, s.id)" title="打开文件" @click="openChangeFile(c)">
                  <Icon name="file" />
                </button>
                <button v-if="s.id === 'changes'" title="放弃更改" @click="discard([c])">
                  <Icon name="discard" />
                </button>
                <button v-if="s.id === 'staged'" title="取消暂存" @click="unstage([c])">
                  <Icon name="minus" />
                </button>
                <button v-else :title="s.id === 'merge' ? '标记为已解决' : '暂存更改'" @click="stage([c])">
                  <Icon name="plus" />
                </button>
              </span>
              <span class="letter" :class="kindOf(statusLetter(c, s.id))">{{ statusLetter(c, s.id) }}</span>
            </div>
          </template>
        </section>

        <StashView />
        <HistoryView />
      </div>
    </div>
  </aside>
</template>

<style scoped>
.scm {
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
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
header button,
.actions button,
.amend button {
  width: 22px;
  height: 22px;
  border-radius: 4px;
  color: var(--fg-muted);
}
header button:hover,
.actions button:hover,
.amend button:hover {
  background: var(--hover);
  color: var(--fg-strong);
}
button:disabled {
  opacity: 0.5;
  cursor: default;
}

/* 执行 git 命令时顶部的进度条：有百分比时显示实际进度，否则来回滚动 */
.progress {
  height: 2px;
  flex: none;
  overflow: hidden;
  position: relative;
}
.progress .bar {
  height: 100%;
  background: var(--accent);
  transition: width 0.2s;
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
.primary,
.secondary {
  display: flex;
  gap: 6px;
  width: 100%;
  height: 28px;
  border-radius: var(--radius);
}
.primary {
  background: var(--accent);
  color: var(--accent-fg);
}
.secondary {
  border: 1px solid var(--border-input);
  background: var(--bg-input);
  color: var(--fg);
}
.primary:not(:disabled):hover {
  filter: brightness(1.15);
}
.secondary:hover {
  background: var(--hover);
  color: var(--fg-strong);
}

.body {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.banner {
  margin: 2px 12px 8px 16px;
  padding: 8px 10px;
  border: 1px solid var(--git-conflict);
  border-radius: var(--radius);
  color: var(--fg);
}
.banner p {
  margin: 0 0 8px;
}
.banner-actions {
  display: flex;
  gap: 6px;
}
.banner-actions .secondary {
  width: auto;
  height: 24px;
  padding: 0 12px;
}

.composer {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 2px 12px 8px 16px;
  flex: none;
}
.amend {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  color: var(--git-modified);
}
textarea {
  width: 100%;
  min-height: 28px;
  padding: 5px 8px;
  border: 1px solid var(--border-input);
  border-radius: var(--radius);
  outline: none;
  background: var(--bg-input);
  color: var(--fg-strong);
  font: inherit;
  line-height: 1.4;
  resize: none;
  overflow-y: auto;
}
textarea:focus {
  border-color: var(--accent);
}
textarea::placeholder {
  color: var(--fg-muted);
}
.split {
  display: flex;
  gap: 1px;
}
.split .primary:first-child {
  flex: 1;
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
}
.split .drop {
  width: 28px;
  flex: none;
  border-top-left-radius: 0;
  border-bottom-left-radius: 0;
}

.list {
  flex: 1;
  overflow: auto;
  padding-bottom: 20px;
}
.note {
  margin: 4px 16px 8px;
  color: var(--fg-muted);
}
.note a {
  color: var(--hl);
  cursor: pointer;
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
.actions {
  display: none;
  flex: none;
}
.group:hover .actions,
.row:hover .actions {
  display: flex;
}

.row {
  padding-left: 24px;
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
.untracked {
  color: var(--git-untracked);
}
.conflict {
  color: var(--git-conflict);
}
</style>
