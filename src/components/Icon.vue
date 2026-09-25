<script setup lang="ts">
// 16×16 线条图标，颜色跟随 currentColor
const PATHS = {
  check: "m3 8.5 3 3 7-7",
  refresh: "M13 8a5 5 0 1 1-1.5-3.55M13 2.5v3h-3",
  plus: "M8 3v10M3 8h10",
  minus: "M3 8h10",
  discard: "M4 6h6a3 3 0 0 1 0 6H6M6.5 3.5 4 6l2.5 2.5",
  file: "M9.5 1.5h-5a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1v-9zM9.5 1.5v3h3",
  more: "M3.5 8h.01M8 8h.01M12.5 8h.01",
  branch: "M5 2.5v8M5 10.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4M11 2.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4M11 6.5c0 3-6 2-6 4",
  sync: "M2.5 8a5.5 5.5 0 0 1 9.5-3.75M13.5 8A5.5 5.5 0 0 1 4 11.75M12 1.5v3H9M4 14.5v-3h3",
  close: "m4 4 8 8M12 4l-8 8",
} as const;

defineProps<{ name: keyof typeof PATHS }>();
</script>

<template>
  <svg
    class="icon"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    :stroke-width="name === 'more' ? 2.4 : 1.3"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path :d="PATHS[name]" />
  </svg>
</template>

<style scoped>
.icon {
  width: 16px;
  height: 16px;
  flex: none;
}
</style>
