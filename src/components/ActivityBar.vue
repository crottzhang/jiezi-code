<script setup lang="ts">
import { layout } from "../store/layout";
</script>

<template>
  <nav class="activitybar">
    <button
      :class="{ active: layout.sidebarVisible }"
      title="资源管理器 (Ctrl+B)"
      @click="layout.sidebarVisible = !layout.sidebarVisible"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round">
        <path d="M14 3H7.5A1.5 1.5 0 0 0 6 4.5v11A1.5 1.5 0 0 0 7.5 17h9a1.5 1.5 0 0 0 1.5-1.5V7z" />
        <path d="M14 3v4h4" />
        <path d="M6 7H4.5A1.5 1.5 0 0 0 3 8.5v11A1.5 1.5 0 0 0 4.5 21h9a1.5 1.5 0 0 0 1.5-1.5V17" />
      </svg>
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
</style>
