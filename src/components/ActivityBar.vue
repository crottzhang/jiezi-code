<script setup lang="ts">
import { changeCount } from "../store/git";
import { layout, toggleView } from "../store/layout";

const isActive = (view: string) => layout.sidebarVisible && layout.sidebarView === view;
</script>

<template>
  <nav class="activitybar">
    <button
      :class="{ active: isActive('explorer') }"
      title="资源管理器 (Ctrl+Shift+E)"
      @click="toggleView('explorer')"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round">
        <path d="M14 3H7.5A1.5 1.5 0 0 0 6 4.5v11A1.5 1.5 0 0 0 7.5 17h9a1.5 1.5 0 0 0 1.5-1.5V7z" />
        <path d="M14 3v4h4" />
        <path d="M6 7H4.5A1.5 1.5 0 0 0 3 8.5v11A1.5 1.5 0 0 0 4.5 21h9a1.5 1.5 0 0 0 1.5-1.5V17" />
      </svg>
    </button>
    <button :class="{ active: isActive('scm') }" title="源代码管理 (Ctrl+Shift+G)" @click="toggleView('scm')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
        <circle cx="7" cy="5" r="2" />
        <circle cx="7" cy="19" r="2" />
        <circle cx="17" cy="7" r="2" />
        <path d="M7 7v10M17 9c0 4.5-10 3-10 8" />
      </svg>
      <span v-if="changeCount" class="badge">{{ changeCount > 999 ? "999+" : changeCount }}</span>
    </button>
  </nav>
</template>

<style scoped>
.activitybar {
  display: flex;
  flex-direction: column;
  width: 48px;
  flex: none;
  background: var(--bg-app);
  border-right: 1px solid var(--border-side);
}
button {
  position: relative;
  width: 48px;
  height: 48px;
  color: var(--fg-muted);
}
button svg {
  width: 24px;
  height: 24px;
}
button:hover,
button.active {
  color: var(--fg-strong);
}
button.active::before {
  content: "";
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--accent);
}
.badge {
  position: absolute;
  top: 26px;
  left: 24px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background: var(--accent);
  color: var(--accent-fg);
  font-size: 9px;
  font-weight: 600;
  line-height: 16px;
  text-align: center;
}
</style>
