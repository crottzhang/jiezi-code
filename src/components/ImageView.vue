<script setup lang="ts">
// 图片预览：默认缩小到能完整显示，点击在“适应窗口”和 100% 之间切换，Ctrl+滚轮以鼠标位置为中心缩放。
// 工具栏提供缩放、旋转、翻转和背景切换，这些都只影响显示，不会改动文件
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { readFileBytes } from "../api/fs";
import type { Tab } from "../store/workspace";
import Icon from "./Icon.vue";

const props = defineProps<{ tab: Tab }>();

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  ico: "image/x-icon",
  avif: "image/avif",
  // svg 必须带上类型，否则 <img> 不会按矢量图解析
  svg: "image/svg+xml",
};
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 32;
/** 工具栏放大/缩小按钮依次经过的比例 */
const STEPS = [0.05, 0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32];

type Background = "checker" | "none" | "light";
const BACKGROUNDS: Record<Background, string> = {
  checker: "棋盘格",
  none: "透明",
  light: "浅色",
};
const BG_KEY = "jiezi.imageBackground";

const stage = ref<HTMLElement>();
const box = ref<HTMLElement>();
const img = ref<HTMLImageElement>();
const url = ref("");
const error = ref("");
/** 适应窗口模式下缩放比例随窗口大小变化；手动缩放后固定 */
const fit = ref(true);
const zoom = ref(1);
/** 顺时针旋转的角度，90 的倍数 */
const rotation = ref(0);
const flipX = ref(false);
const flipY = ref(false);
const background = ref<Background>(readBackground());
const stageSize = ref({ width: 0, height: 0 });

const info = computed(() => props.tab.image!);
/** 矢量图放大后依然清晰，不需要按像素显示 */
const isSvg = computed(() => props.tab.path.toLowerCase().endsWith(".svg"));
const ready = computed(() => !!url.value && !!info.value.width && !error.value);
/** 旋转 90° 或 270° 后宽高互换 */
const turned = computed(() => rotation.value % 180 !== 0);
const shownWidth = computed(() => (turned.value ? info.value.height : info.value.width));
const shownHeight = computed(() => (turned.value ? info.value.width : info.value.height));
/** 适应窗口：大图缩小到完整显示，小图保持原大小 */
const fitZoom = computed(() => {
  if (!shownWidth.value || !shownHeight.value) return 1;
  const pad = 32;
  return Math.min(
    1,
    (stageSize.value.width - pad) / shownWidth.value,
    (stageSize.value.height - pad) / shownHeight.value,
  );
});
const scale = computed(() => Math.max(MIN_ZOOM, fit.value ? fitZoom.value : zoom.value));
const transformed = computed(() => rotation.value !== 0 || flipX.value || flipY.value);
/** 先旋转再翻转，翻转始终沿屏幕的水平/竖直方向 */
const imgStyle = computed(() => ({
  width: `${info.value.width * scale.value}px`,
  height: `${info.value.height * scale.value}px`,
  transform:
    `translate(-50%, -50%) scale(${flipX.value ? -1 : 1}, ${flipY.value ? -1 : 1}) ` +
    `rotate(${rotation.value}deg)`,
}));

function readBackground(): Background {
  try {
    const saved = localStorage.getItem(BG_KEY);
    // 旧版本的“深色”已改成“透明”
    if (saved === "dark") return "none";
    if (saved && saved in BACKGROUNDS) return saved as Background;
  } catch {
    // 读不到就用默认值
  }
  return "checker";
}

function cycleBackground() {
  const order = Object.keys(BACKGROUNDS) as Background[];
  background.value = order[(order.indexOf(background.value) + 1) % order.length];
  try {
    localStorage.setItem(BG_KEY, background.value);
  } catch {
    // 保存失败不影响使用
  }
}

let seq = 0;

async function load() {
  const s = ++seq;
  const path = props.tab.path;
  try {
    const bytes = await readFileBytes(path);
    if (s !== seq) return;
    const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
    revoke();
    url.value = URL.createObjectURL(new Blob([bytes], { type: MIME[ext] ?? "" }));
    info.value.size = bytes.byteLength;
    error.value = "";
  } catch (e) {
    if (s !== seq) return;
    revoke();
    error.value = String(e);
  }
}

function revoke() {
  if (url.value) URL.revokeObjectURL(url.value);
  url.value = "";
}

function onLoad() {
  const el = img.value!;
  info.value.width = el.naturalWidth;
  info.value.height = el.naturalHeight;
}

function onError() {
  error.value = "无法显示这张图片（文件可能已损坏，或格式不受支持）";
}

/** 缩放到 next，保持屏幕上 (clientX, clientY) 处的那个点不动 */
async function zoomAt(next: number, clientX: number, clientY: number) {
  const el = box.value;
  const view = stage.value;
  if (!el || !view) return;
  const before = el.getBoundingClientRect();
  const fx = (clientX - before.left) / before.width;
  const fy = (clientY - before.top) / before.height;
  fit.value = false;
  zoom.value = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
  await nextTick();
  const after = el.getBoundingClientRect();
  view.scrollLeft += after.left + fx * after.width - clientX;
  view.scrollTop += after.top + fy * after.height - clientY;
}

/** 以可视区域中心缩放（工具栏按钮） */
function zoomCenter(next: number) {
  const r = stage.value?.getBoundingClientRect();
  if (r) zoomAt(next, r.left + r.width / 2, r.top + r.height / 2);
}

function zoomIn() {
  zoomCenter(STEPS.find((s) => s > scale.value * 1.001) ?? MAX_ZOOM);
}

function zoomOut() {
  zoomCenter([...STEPS].reverse().find((s) => s < scale.value * 0.999) ?? MIN_ZOOM);
}

function rotate(delta: number) {
  rotation.value = (rotation.value + delta + 360) % 360;
}

function reset() {
  rotation.value = 0;
  flipX.value = false;
  flipY.value = false;
  fit.value = true;
}

function onWheel(e: WheelEvent) {
  if (!e.ctrlKey) return;
  e.preventDefault();
  zoomAt(scale.value * (e.deltaY < 0 ? 1.2 : 1 / 1.2), e.clientX, e.clientY);
}

function onClick(e: MouseEvent) {
  if (fit.value && fitZoom.value < 1) zoomAt(1, e.clientX, e.clientY);
  else fit.value = true;
}

let observer: ResizeObserver | undefined;

onMounted(() => {
  observer = new ResizeObserver(([entry]) => {
    stageSize.value = { width: entry.contentRect.width, height: entry.contentRect.height };
  });
  observer.observe(stage.value!);
});

// 切换到别的图片标签页、重命名、文件在外部被修改时重新读取；换了图片时恢复默认的显示方式
watch(
  () => [props.tab.path, info.value.version],
  (_, old) => {
    if (old && old[0] !== props.tab.path) reset();
    load();
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  seq++;
  observer?.disconnect();
  revoke();
});

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
</script>

<template>
  <div class="image-view">
    <div class="toolbar">
      <button title="缩小" :disabled="!ready" @click="zoomOut"><Icon name="zoomOut" /></button>
      <span class="zoom">{{ ready ? `${Math.round(scale * 100)}%` : "" }}</span>
      <button title="放大" :disabled="!ready" @click="zoomIn"><Icon name="zoomIn" /></button>
      <button
        class="text"
        title="原始大小"
        :class="{ on: ready && !fit && zoom === 1 }"
        :disabled="!ready"
        @click="zoomCenter(1)"
      >
        1:1
      </button>
      <button title="适应窗口" :class="{ on: ready && fit }" :disabled="!ready" @click="fit = true">
        <Icon name="fitScreen" />
      </button>
      <span class="sep"></span>
      <button title="向左旋转" :disabled="!ready" @click="rotate(-90)"><Icon name="rotateLeft" /></button>
      <button title="向右旋转" :disabled="!ready" @click="rotate(90)"><Icon name="rotateRight" /></button>
      <button title="水平翻转" :class="{ on: flipX }" :disabled="!ready" @click="flipX = !flipX">
        <Icon name="flipH" />
      </button>
      <button title="垂直翻转" :class="{ on: flipY }" :disabled="!ready" @click="flipY = !flipY">
        <Icon name="flipV" />
      </button>
      <button title="重置" :disabled="!ready || (fit && !transformed)" @click="reset">
        <Icon name="discard" />
      </button>
      <span class="sep"></span>
      <button :title="`背景：${BACKGROUNDS[background]}（点击切换）`" @click="cycleBackground">
        <Icon name="contrast" />
      </button>
      <span class="spacer"></span>
      <span v-if="ready" class="info">
        {{ info.width }} × {{ info.height }} · {{ formatSize(info.size) }}
      </span>
    </div>
    <div ref="stage" class="stage" @wheel="onWheel">
      <p v-if="error" class="error">{{ error }}</p>
      <div v-else-if="url" class="canvas">
        <!-- 外框按旋转后的尺寸占位，图片在里面居中旋转 -->
        <div
          ref="box"
          class="box"
          :class="[background, { 'zoom-in': fit && fitZoom < 1, 'zoom-out': !fit }]"
          :style="
            info.width
              ? { width: `${shownWidth * scale}px`, height: `${shownHeight * scale}px` }
              : undefined
          "
          :title="fit && fitZoom < 1 ? '点击查看原始大小，Ctrl+滚轮缩放' : '点击适应窗口，Ctrl+滚轮缩放'"
          @click="onClick"
        >
          <img
            ref="img"
            :src="url"
            :class="{ pixelated: scale > 1 && !isSvg }"
            :style="info.width ? imgStyle : undefined"
            draggable="false"
            @load="onLoad"
            @error="onError"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.image-view {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-editor);
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 2px;
  height: 34px;
  padding: 0 10px;
  flex: none;
  border-bottom: 1px solid var(--border);
  user-select: none;
  white-space: nowrap;
  overflow: hidden;
}
.toolbar button {
  width: 26px;
  height: 26px;
  flex: none;
  border-radius: var(--radius);
  color: var(--fg);
}
.toolbar button.text {
  width: auto;
  padding: 0 6px;
  font-size: 12px;
  font-weight: 600;
}
.toolbar button:hover:not(:disabled) {
  background: var(--hover);
  color: var(--fg-strong);
}
.toolbar button.on {
  background: var(--selection);
  color: var(--fg-strong);
}
.toolbar button:disabled {
  opacity: 0.4;
  cursor: default;
}
.zoom {
  min-width: 44px;
  text-align: center;
  font-size: 12px;
  color: var(--fg-muted);
  font-variant-numeric: tabular-nums;
}
.sep {
  width: 1px;
  height: 16px;
  margin: 0 6px;
  background: var(--border);
}
.spacer {
  flex: 1;
}
.info {
  font-size: 12px;
  color: var(--fg-muted);
}
.stage {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
/* 至少铺满可视区域，图片小于窗口时居中，大于窗口时可以滚动 */
.canvas {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 100%;
  min-height: 100%;
  width: max-content;
  padding: 16px;
}
.box {
  position: relative;
  flex: none;
  box-shadow: 0 0 0 1px var(--border);
}
/* 透明区域的背景 */
.box.checker {
  background: repeating-conic-gradient(rgba(128, 128, 128, 0.18) 0 25%, transparent 0 50%) 0 0 / 16px 16px;
}
/* 透明：不画背景和边框，图片和编辑区背景融为一体 */
.box.none {
  box-shadow: none;
}
.box.light {
  background: #ffffff;
}
.box.zoom-in {
  cursor: zoom-in;
}
.box.zoom-out {
  cursor: zoom-out;
}
img {
  position: absolute;
  left: 50%;
  top: 50%;
  display: block;
  max-width: none;
  transition: transform 0.15s;
}
img.pixelated {
  image-rendering: pixelated;
}
.error {
  margin: 40px auto;
  text-align: center;
  color: var(--fg-muted);
}
</style>
