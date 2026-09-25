<script setup lang="ts">
import { computed } from "vue";
import { activeTab, workspace } from "../store/workspace";

const tab = computed(activeTab);
</script>

<template>
  <footer class="statusbar">
    <span v-if="workspace.root" class="item" :title="workspace.root">{{ workspace.root }}</span>
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
  padding: 0 8px;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
