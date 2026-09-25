<script setup lang="ts">
import { closeTerminal, hideTerminal, newTerminal, terminal } from "../store/terminal";
import TerminalView from "./TerminalView.vue";
</script>

<template>
  <aside class="panel">
    <header>
      <span class="title">终端</span>
      <div class="tabs">
        <div
          v-for="s in terminal.sessions"
          :key="s.key"
          class="tab"
          :class="{ active: s.key === terminal.active, exited: s.exited }"
          @mousedown.left="terminal.active = s.key"
          @mouseup.middle="closeTerminal(s.key)"
        >
          <span>{{ s.title }}</span>
          <button title="结束终端" @mousedown.stop @click.stop="closeTerminal(s.key)">×</button>
        </div>
      </div>
      <button class="action" title="新建终端" @click="newTerminal()">＋</button>
      <button class="action" title="隐藏面板 (Ctrl+`)" @click="hideTerminal()">⟩</button>
    </header>
    <div class="body">
      <TerminalView
        v-for="s in terminal.sessions"
        v-show="s.key === terminal.active"
        :key="s.key"
        :info="s"
        :active="terminal.visible && s.key === terminal.active"
      />
    </div>
  </aside>
</template>

<style scoped>
.panel {
  display: flex;
  flex-direction: column;
  background: var(--bg-panel);
  margin: var(--card-margin);
  border: var(--card-border);
  border-radius: var(--card-radius);
  border-left: var(--panel-divider);
  overflow: hidden;
}
header {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 35px;
  padding: 0 6px 0 12px;
  flex: none;
  background: var(--bg-panel);
}
.title {
  flex: none;
  margin-right: 6px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.5px;
}
.tabs {
  display: flex;
  flex: 1;
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
.tab button,
.action {
  width: 22px;
  height: 22px;
  flex: none;
  border-radius: 4px;
  color: var(--fg-muted);
}
.tab button {
  width: 18px;
  height: 18px;
  visibility: hidden;
}
.tab:hover button,
.tab.active button {
  visibility: visible;
}
.tab button:hover,
.action:hover {
  background: var(--hover);
  color: var(--fg-strong);
}
.body {
  flex: 1;
  min-height: 0;
}
</style>
