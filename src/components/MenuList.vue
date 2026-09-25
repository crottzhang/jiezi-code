<script setup lang="ts">
import { ref } from "vue";
import type { MenuNode } from "../menu";

defineProps<{ items: MenuNode[] }>();
const emit = defineEmits<{ close: [] }>();

/** 当前展开子菜单的下标 */
const open = ref<number | null>(null);

function onEnter(node: MenuNode, i: number) {
  open.value = "separator" in node || !node.children || node.disabled ? null : i;
}

function onClick(node: MenuNode, i: number) {
  if ("separator" in node || node.disabled) return;
  if (node.children) {
    open.value = i;
    return;
  }
  emit("close");
  node.run?.();
}
</script>

<template>
  <ul class="menu" role="menu">
    <template v-for="(node, i) in items" :key="i">
      <li v-if="'separator' in node" class="sep" role="separator"></li>
      <li
        v-else
        class="item"
        role="menuitem"
        :class="{ disabled: node.disabled, open: open === i }"
        @mouseenter="onEnter(node, i)"
        @click.stop="onClick(node, i)"
      >
        <span class="check">{{ node.checked ? "✓" : "" }}</span>
        <span class="label">{{ node.label }}</span>
        <span class="keys">{{ node.keys }}</span>
        <span class="arrow">{{ node.children ? "›" : "" }}</span>
        <MenuList
          v-if="node.children && open === i"
          class="submenu"
          :items="node.children"
          @close="emit('close')"
        />
      </li>
    </template>
  </ul>
</template>

<style scoped>
.menu {
  min-width: 220px;
  max-width: 520px;
  margin: 0;
  padding: 4px;
  list-style: none;
  border: 1px solid var(--widget-border);
  border-radius: calc(var(--radius) + 2px);
  background: var(--bg-widget);
  box-shadow: var(--shadow);
  color: var(--fg-strong);
  cursor: default;
  user-select: none;
}
.item {
  position: relative;
  display: flex;
  align-items: center;
  height: 26px;
  padding: 0 8px 0 4px;
  border-radius: 4px;
  white-space: nowrap;
}
.item:hover:not(.disabled),
.item.open {
  background: var(--menu-hover-bg);
  color: var(--menu-hover-fg);
}
.item.disabled {
  color: var(--fg-muted);
  opacity: 0.6;
}
.check {
  width: 20px;
  flex: none;
  text-align: center;
}
.label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
}
.keys {
  margin-left: 32px;
  flex: none;
  font-size: 12px;
  opacity: 0.8;
}
.arrow {
  width: 12px;
  margin-left: 8px;
  flex: none;
  text-align: right;
}
.sep {
  height: 1px;
  margin: 4px 8px;
  background: var(--border);
}
.submenu {
  position: absolute;
  top: -5px;
  left: 100%;
  z-index: 1;
}
</style>
