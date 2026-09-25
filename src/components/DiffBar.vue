<script setup lang="ts">
import { computed } from "vue";
import { getEditorView } from "../editor/view";
import { closeDiff, goToChunk } from "../store/diff";
import { layout } from "../store/layout";
import { activeTab } from "../store/workspace";
import Icon from "./Icon.vue";

const tab = computed(activeTab);

/** 右边是什么：历史版本就是那个提交，普通文件就是工作区 */
const right = computed(() => (tab.value?.readonly ? "此版本" : "工作区"));
</script>

<template>
  <div v-if="tab?.diff" class="diffbar">
    <span class="label">
      对比：<b>{{ tab.diff.label }}</b> ↔ <b>{{ right }}</b>
      <span v-if="!tab.readonly && !tab.diff.rev && !layout.diffSplit" class="hint">每处改动旁的“暂存”只暂存这一处</span>
    </span>
    <button title="上一处更改" @click="goToChunk(-1, getEditorView())"><Icon name="up" /></button>
    <button title="下一处更改" @click="goToChunk(1, getEditorView())"><Icon name="down" /></button>
    <button
      :title="layout.diffSplit ? '改为行内显示' : '改为左右并排显示'"
      @click="layout.diffSplit = !layout.diffSplit"
    >
      <Icon :name="layout.diffSplit ? 'inline' : 'split'" />
    </button>
    <button title="关闭对比" @click="closeDiff(tab.id)"><Icon name="close" /></button>
  </div>
</template>

<style scoped>
.diffbar {
  display: flex;
  align-items: center;
  gap: 2px;
  height: 28px;
  padding: 0 8px 0 12px;
  flex: none;
  border-bottom: 1px solid var(--border);
  font-size: 12px;
  color: var(--fg-muted);
}
.label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.label b {
  font-weight: 600;
  color: var(--fg);
}
.hint {
  margin-left: 12px;
  opacity: 0.8;
}
button {
  width: 24px;
  height: 22px;
  border-radius: 4px;
  color: var(--fg-muted);
}
button:hover {
  background: var(--hover);
  color: var(--fg-strong);
}
</style>
