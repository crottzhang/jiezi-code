<script setup lang="ts">
import { computed, defineAsyncComponent } from "vue";
import { layout } from "../store/layout";
import {
  addRunCommand,
  closeRunTerminal,
  editRunCommand,
  markRunExited,
  newRunTerminal,
  removeRunCommand,
  run,
} from "../store/run";
import Icon from "./Icon.vue";

// xterm.js 只在第一次运行命令时才加载
const TerminalView = defineAsyncComponent(() => import("./TerminalView.vue"));

const visible = computed(() => layout.sidebarVisible && layout.sidebarView === "run");
</script>

<template>
  <aside class="run-view">
    <header>
      <span class="title">运行</span>
      <button title="添加命令" @click="addRunCommand()"><Icon name="plus" /></button>
    </header>
    <div class="list" :class="{ full: !run.sessions.length }">
      <div
        v-for="(command, i) in run.commands"
        :key="i"
        class="item"
        :title="`在新终端中运行：${command}`"
        @click="newRunTerminal(command)"
      >
        <Icon name="play" class="play" />
        <span class="label">{{ command }}</span>
        <button title="编辑" @click.stop="editRunCommand(i)"><Icon name="edit" /></button>
        <button title="删除" @click.stop="removeRunCommand(i)"><Icon name="trash" /></button>
      </div>
      <div v-if="!run.commands.length" class="empty">
        <p>把常用命令加到这里，点一下就在新终端里运行。</p>
        <button class="add" @click="addRunCommand()">添加命令</button>
      </div>
    </div>

    <template v-if="run.sessions.length">
      <div class="term-header">
        <div class="tabs">
          <div
            v-for="s in run.sessions"
            :key="s.key"
            class="tab"
            :class="{ active: s.key === run.active, exited: s.exited }"
            :title="s.command"
            @mousedown.left="run.active = s.key"
            @mouseup.middle="closeRunTerminal(s.key)"
          >
            <span>{{ s.title }}</span>
            <button title="结束终端" @mousedown.stop @click.stop="closeRunTerminal(s.key)">×</button>
          </div>
        </div>
        <button class="action" title="新建终端" @click="newRunTerminal()"><Icon name="plus" /></button>
      </div>
      <div class="body">
        <TerminalView
          v-for="s in run.sessions"
          v-show="s.key === run.active"
          :key="s.key"
          :info="s"
          :active="visible && s.key === run.active"
          @exited="markRunExited(s.key)"
          @close="closeRunTerminal(s.key)"
        />
      </div>
    </template>
  </aside>
</template>

<style scoped>
.run-view {
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
.item button,
.action {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  flex: none;
  border-radius: 4px;
  color: var(--fg-muted);
}
header button:hover,
.item button:hover,
.action:hover {
  background: var(--hover);
  color: var(--fg-strong);
}
.list {
  flex: none;
  max-height: 40%;
  overflow-y: auto;
  padding-bottom: 6px;
}
.list.full {
  flex: 1;
  max-height: none;
}
.item {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 26px;
  padding: 0 8px 0 16px;
  cursor: pointer;
  user-select: none;
}
.item:hover {
  background: var(--hover);
}
.play {
  color: var(--git-added);
}
.label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.item button {
  visibility: hidden;
}
.item:hover button {
  visibility: visible;
}
.empty {
  padding: 0 20px;
  color: var(--fg-muted);
}
.empty .add {
  width: 100%;
  height: 28px;
  border-radius: 2px;
  background: var(--accent);
  color: var(--accent-fg);
}
.empty .add:hover {
  filter: brightness(1.15);
}
.term-header {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 35px;
  padding: 0 6px 0 8px;
  flex: none;
  border-top: 1px solid var(--border);
}
.tabs {
  display: flex;
  flex: 0 1 auto;
  gap: 2px;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}
.tab {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 2px 0 8px;
  border-radius: 4px;
  color: var(--fg-muted);
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
}
.tab:hover {
  background: var(--hover);
}
.tab.active {
  background: var(--selection);
  color: var(--fg-strong);
}
.tab.exited span {
  text-decoration: line-through;
}
.tab button {
  width: 18px;
  height: 18px;
  border-radius: 4px;
  color: var(--fg-muted);
  visibility: hidden;
}
.tab:hover button,
.tab.active button {
  visibility: visible;
}
.tab button:hover {
  background: var(--hover);
  color: var(--fg-strong);
}
.body {
  flex: 1;
  min-height: 0;
}
</style>
