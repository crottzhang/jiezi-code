<script setup lang="ts">
import { closeTerminal, newTerminal, terminal } from "../store/terminal";
import TempImages from "./TempImages.vue";
import TerminalView from "./TerminalView.vue";
</script>

<template>
  <aside class="panel">
    <header>
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
      <span class="spacer"></span>
      <button
        class="action"
        :class="{ on: terminal.imagesOpen }"
        title="临时图片"
        @click="terminal.imagesOpen = !terminal.imagesOpen"
      >
        <svg viewBox="0 0 16 16">
          <rect x="2" y="3" width="12" height="10" rx="1.5" />
          <circle cx="6" cy="6.5" r="1.2" />
          <path d="M2.5 12l3.5-3.5 2.5 2.5 2-2 3 3" />
        </svg>
      </button>
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
    <Teleport to="body">
      <TempImages v-if="terminal.imagesOpen" />
    </Teleport>
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
  padding: 0 6px 0 8px;
  flex: none;
  background: var(--bg-panel);
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
.action:hover,
.action.on {
  background: var(--hover);
  color: var(--fg-strong);
}
.action svg {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.2;
  stroke-linejoin: round;
}
.spacer {
  flex: 1;
}
.body {
  flex: 1;
  min-height: 0;
}
</style>
