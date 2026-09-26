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
  trash: "M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 9h5.8l.6-9",
  apply: "M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10",
  pop: "M8 13.5v-8M4.5 9 8 5.5 11.5 9M3 2.5h10",
  chevron: "m4.5 6.5 3.5 3.5 3.5-3.5",
  up: "M8 12.5v-9M4 7.5l4-4 4 4",
  down: "M8 3.5v9M4 8.5l4 4 4-4",
  split: "M2.5 3.5h11v9h-11zM8 3.5v9",
  inline: "M2.5 3.5h11v9h-11zM2.5 8h11",
  output: "M3 4h10M3 8h10M3 12h6",
  stash: "M2.5 6.5h11v6h-11zM4.5 6.5V4h7v2.5",
  replace: "M3 5h7.5M8.5 3l2 2-2 2M13 11H5.5M7.5 9l-2 2 2 2",
  collapseAll: "M4.5 7.5 8 4l3.5 3.5M4.5 12 8 8.5l3.5 3.5",
  expandAll: "M4.5 4 8 7.5 11.5 4M4.5 8.5 8 12l3.5-3.5",
  play: "M5 3.5v9l7-4.5z",
  edit: "M10.5 2.5l3 3-8 8h-3v-3zM9 4l3 3",
  clearAll:"M2.5 4h11M2.5 7.5h7M2.5 11h4M9.5 10l3.5 3.5M13 10l-3.5 3.5",
  newFile: "M8.5 1.5h-4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h3.5M8.5 1.5l4 4v2M8.5 1.5v4h4M12 10v5M9.5 12.5h5",
  newFolder: "M7.5 13.5h-5v-10h4l1.5 1.5h6v3M12 9v5M9.5 11.5h5",
  collapseFolders: "M5.5 3.5v-1h8v8h-1M2.5 5.5h8v8h-8zM4.5 9.5h4",
  chevronRight: "m6.5 4.5 3.5 3.5-3.5 3.5",
  zoomIn: "M7 2.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9M10.3 10.3l3.2 3.2M7 5v4M5 7h4",
  zoomOut: "M7 2.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9M10.3 10.3l3.2 3.2M5 7h4",
  fitScreen: "M2.5 5.5v-3h3M10.5 2.5h3v3M13.5 10.5v3h-3M5.5 13.5h-3v-3",
  rotateLeft: "M3 8a5 5 0 1 0 1.5-3.55M3 2.5v3h3",
  rotateRight: "M13 8a5 5 0 1 1-1.5-3.55M13 2.5v3h-3",
  flipH: "M8 1.5v13M6 4 2 8l4 4zM10 4l4 4-4 4z",
  flipV: "M1.5 8h13M4 6l4-4 4 4zM4 10l4 4 4-4z",
  contrast: "M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11z",
  pin: "M5.5 2.5h5M6.5 2.5v4l-2 3h7l-2-3v-4M8 9.5v4",
} as const;

/** 需要额外填充的部分，比如对比度图标的左半边 */
const FILLS: Partial<Record<keyof typeof PATHS, string>> = {
  contrast: "M8 2.5a5.5 5.5 0 0 0 0 11z",
};

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
    <path v-if="FILLS[name]" :d="FILLS[name]" fill="currentColor" stroke="none" />
  </svg>
</template>

<style scoped>
.icon {
  width: 16px;
  height: 16px;
  flex: none;
}
</style>
