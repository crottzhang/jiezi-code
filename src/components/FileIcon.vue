<script setup lang="ts">
// 资源管理器里的文件类型图标，风格和配色参照 VS Code 默认的 Seti 图标主题
import { computed } from "vue";

interface Glyph {
  color: string;
  /** 16×16 线条路径 */
  path?: string;
  /** 路径改为填充 */
  fill?: boolean;
  /** 文字图标，比如 TS、{} */
  text?: string;
  size?: number;
  /** 文字放在实心圆角方块上 */
  badge?: boolean;
}

const C = {
  blue: "#519aba",
  green: "#8dc149",
  yellow: "#cbcb41",
  orange: "#e37933",
  red: "#cc3e44",
  pink: "#f55385",
  purple: "#a074c4",
  grey: "#6d8086",
  white: "#d4d7d6",
};

const P = {
  lines: "M3 4h10M3 7h10M3 10h10M3 13h6",
  vue: "M1.5 3 8 13.5 14.5 3M4.5 3 8 9l3.5-6",
  bolt: "M9.5 1 3.5 9h4l-1 6 6-8h-4z",
  diamond: "M8 1.2 14.8 8 8 14.8 1.2 8z",
  angle: "M5.5 4 1.5 8l4 4M10.5 4l4 4-4 4",
  info: "M8 1.8a6.2 6.2 0 1 0 0 12.4A6.2 6.2 0 0 0 8 1.8zM8 7v4.5M8 4.7v.1",
  markdown: "M1.5 11.5v-7l3 3.5 3-3.5v7M11.5 4.5v7M9 9l2.5 2.5L14 9",
  circle: "M8 1.8a6.2 6.2 0 1 0 0 12.4A6.2 6.2 0 0 0 8 1.8z",
  react:
    "M1.5 8a6.5 2.4 0 1 0 13 0 6.5 2.4 0 1 0-13 0M4.75 2.37a6.5 2.4 60 1 0 6.5 11.26 6.5 2.4 60 1 0-6.5-11.26M11.25 2.37a6.5 2.4 120 1 0-6.5 11.26 6.5 2.4 120 1 0 6.5-11.26M8 8h.01",
  image: "M2.5 3.5h11v9h-11zM2.5 11l3.5-3.5 3 3 2-2 2.5 2.5M10.5 6.5h.01",
  shell: "M2.5 4.5 6 8l-3.5 3.5M8 12h5.5",
  database:
    "M2.5 4c0-1 2.5-2 5.5-2s5.5 1 5.5 2v8c0 1-2.5 2-5.5 2s-5.5-1-5.5-2zM2.5 4c0 1 2.5 2 5.5 2s5.5-1 5.5-2",
};

const gear: Glyph = { text: "⚙︎", size: 13, color: C.grey };
const image: Glyph = { path: P.image, color: C.purple };
const react: Glyph = { path: P.react, color: C.blue };
const git: Glyph = { path: P.diamond, fill: true, color: C.grey };
const fallback: Glyph = { path: P.lines, color: C.white };

const t = (text: string, color: string, size?: number): Glyph => ({ text, color, size });

/** 按扩展名（小写，不带点）；以点开头的文件名整个当扩展名，比如 gitignore */
const BY_EXT: Record<string, Glyph> = {
  ts: t("TS", C.blue),
  mts: t("TS", C.blue),
  cts: t("TS", C.blue),
  js: t("JS", C.yellow),
  mjs: t("JS", C.yellow),
  cjs: t("JS", C.yellow),
  tsx: react,
  jsx: react,
  vue: { path: P.vue, color: C.green },
  svelte: t("S", C.red, 12),
  json: t("{}", C.yellow, 10),
  jsonc: t("{}", C.yellow, 10),
  json5: t("{}", C.yellow, 10),
  css: t("#", C.blue, 13),
  scss: t("#", C.pink, 13),
  sass: t("#", C.pink, 13),
  less: t("#", C.blue, 13),
  html: { path: P.angle, color: C.orange },
  htm: { path: P.angle, color: C.orange },
  xml: { path: P.angle, color: C.orange },
  md: { path: P.markdown, color: C.blue },
  markdown: { path: P.markdown, color: C.blue },
  rs: { path: P.circle, text: "R", size: 8, color: C.grey },
  toml: gear,
  ini: gear,
  cfg: gear,
  conf: gear,
  env: gear,
  editorconfig: gear,
  npmrc: gear,
  yaml: { path: P.lines, color: C.purple },
  yml: { path: P.lines, color: C.purple },
  gitignore: git,
  gitattributes: git,
  gitmodules: git,
  gitkeep: git,
  py: t("py", C.blue, 9),
  go: t("go", C.blue, 9),
  java: t("J", C.red, 12),
  kt: t("K", C.orange, 12),
  c: t("C", C.blue, 12),
  h: t("h", C.purple, 12),
  cpp: t("C+", C.blue, 9),
  cc: t("C+", C.blue, 9),
  hpp: t("h+", C.purple, 9),
  cs: t("C#", C.green, 9),
  php: t("php", C.purple, 7),
  rb: t("rb", C.red, 9),
  swift: t("S", C.orange, 12),
  lua: t("lua", C.blue, 7),
  dart: t("D", C.blue, 12),
  sh: { path: P.shell, color: C.grey },
  bash: { path: P.shell, color: C.grey },
  zsh: { path: P.shell, color: C.grey },
  ps1: { path: P.shell, color: C.blue },
  psm1: { path: P.shell, color: C.blue },
  bat: { path: P.shell, color: C.white },
  cmd: { path: P.shell, color: C.white },
  sql: { path: P.database, color: C.pink },
  db: { path: P.database, color: C.pink },
  png: image,
  jpg: image,
  jpeg: image,
  gif: image,
  webp: image,
  bmp: image,
  ico: image,
  svg: image,
  pdf: t("PDF", C.red, 6),
  zip: t("zip", C.grey, 7),
  "7z": t("7z", C.grey, 8),
  rar: t("rar", C.grey, 7),
  gz: t("gz", C.grey, 8),
};

function glyphOf(name: string): Glyph {
  const lower = name.toLowerCase();
  if (lower.startsWith("readme")) return { path: P.info, color: C.blue };
  if (/^vite(st)?\.config\./.test(lower)) return { path: P.bolt, fill: true, color: C.yellow };
  if (/^tsconfig.*\.json$/.test(lower)) return { text: "TS", badge: true, color: C.blue };
  if (/^jsconfig.*\.json$/.test(lower)) return { text: "JS", badge: true, color: C.yellow };
  if (lower.startsWith(".env")) return gear;
  const dot = lower.lastIndexOf(".");
  return (dot >= 0 && BY_EXT[lower.slice(dot + 1)]) || fallback;
}

const props = defineProps<{ name: string }>();
const icon = computed(() => glyphOf(props.name));
/** 文字越长字号越小 */
const fontSize = computed(() => icon.value.size ?? (icon.value.text!.length > 1 ? 8.5 : 12));
</script>

<template>
  <svg class="file-icon" viewBox="0 0 16 16" :style="{ color: icon.color }">
    <rect v-if="icon.badge" x="1" y="2.5" width="14" height="11" rx="2" fill="currentColor" />
    <path
      v-if="icon.path"
      :d="icon.path"
      :fill="icon.fill ? 'currentColor' : 'none'"
      :stroke="icon.fill ? 'none' : 'currentColor'"
      stroke-width="1.3"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
    <text
      v-if="icon.text"
      x="8"
      y="8.5"
      text-anchor="middle"
      dominant-baseline="central"
      :font-size="fontSize"
      :fill="icon.badge ? 'var(--bg-app)' : 'currentColor'"
    >
      {{ icon.text }}
    </text>
  </svg>
</template>

<style scoped>
.file-icon {
  width: 16px;
  height: 16px;
  flex: none;
}
text {
  font-family: "Segoe UI", system-ui, sans-serif;
  font-weight: 700;
}
</style>
