<script setup lang="ts">
import { computed } from "vue";
import { pickBranch } from "../store/branches";
import { OPERATION_LABELS, cancelRemote, git, remote, sync } from "../store/git";
import { activeTab, workspace } from "../store/workspace";
import Icon from "./Icon.vue";

const tab = computed(activeTab);

const branchLabel = computed(() => {
  const s = git.status;
  if (!s) return "";
  const name = s.branch ?? s.head ?? "HEAD";
  const op = s.operation ? `（${OPERATION_LABELS[s.operation]}中）` : "";
  return `${name}${s.changes.length ? "*" : ""}${op}`;
});

const syncLabel = computed(() => {
  const s = git.status;
  if (!s?.upstream) return "";
  return [s.behind && `${s.behind}↓`, s.ahead && `${s.ahead}↑`].filter(Boolean).join(" ");
});

const progressLabel = computed(() => {
  const p = git.progress;
  if (!p) return "";
  const detail = p.percent != null ? ` ${p.percent}%` : "…";
  return `${p.label}${detail}`;
});
</script>

<template>
  <footer class="statusbar">
    <template v-if="git.status">
      <button
        class="item"
        :title="git.status.branch ? `当前分支：${git.status.branch}（点击切换）` : '游离 HEAD（点击切换分支）'"
        @click="pickBranch()"
      >
        <Icon name="branch" />{{ branchLabel }}
      </button>
      <button
        v-if="git.status.branch && !git.progress"
        class="item"
        :class="{ spinning: git.busy > 0 }"
        :title="git.status.upstream ? `与 ${git.status.upstream} 同步` : '发布分支'"
        :disabled="git.busy > 0"
        @click="git.status.upstream ? sync() : remote('publish')"
      >
        <Icon name="sync" />{{ syncLabel }}
      </button>
    </template>
    <span v-if="git.progress" class="item progress" :title="git.progress.phase">
      <Icon name="sync" class="spin" />{{ progressLabel }}
      <button class="cancel" title="取消" @click="cancelRemote()"><Icon name="close" /></button>
    </span>
    <span v-if="workspace.root" class="item path" :title="workspace.root">{{ workspace.root }}</span>
    <span class="spacer"></span>
    <template v-if="tab">
      <span class="item">
        行 {{ workspace.cursor.line }}，列 {{ workspace.cursor.col }}
        <template v-if="workspace.cursor.selected">（已选择 {{ workspace.cursor.selected }}）</template>
      </span>
      <span class="item">UTF-8</span>
      <span class="item">{{ tab.eol }}</span>
      <span class="item">{{ tab.language }}</span>
    </template>
  </footer>
</template>

<style scoped>
.statusbar {
  display: flex;
  align-items: center;
  height: 22px;
  padding: 0 8px;
  flex: none;
  background: var(--bg-app);
  border-top: 1px solid var(--border-side);
  font-size: 12px;
  color: var(--fg-muted);
  overflow: hidden;
  white-space: nowrap;
}
.spacer {
  flex: 1;
}
.item {
  display: inline-flex;
  align-items: center;
  flex: none;
  gap: 4px;
  height: 100%;
  padding: 0 8px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.item.path {
  display: inline;
  flex: 0 1 auto;
  line-height: 22px;
}
button.item:hover:not(:disabled) {
  background: var(--hover);
  color: var(--fg-strong);
}
.item .icon {
  width: 14px;
  height: 14px;
}
.progress {
  color: var(--fg);
}
.cancel {
  width: 16px;
  height: 16px;
  border-radius: 3px;
}
.cancel:hover {
  background: var(--hover);
  color: var(--fg-strong);
}
.cancel .icon {
  width: 12px;
  height: 12px;
}
.spinning .icon,
.icon.spin {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
