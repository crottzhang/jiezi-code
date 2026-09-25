<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { ask } from "@tauri-apps/plugin-dialog";
import {
  deleteClipboardImages,
  listClipboardImages,
  readClipboardImage,
  revealClipboardImage,
  type ClipboardImage,
} from "../api/clipboard";
import { pastePathToTerminal, terminal } from "../store/terminal";
import { toast } from "../store/ui";

const dir = ref("");
const images = ref<ClipboardImage[]>([]);
const loading = ref(true);
/** 文件名 -> blob URL，关闭时统一释放 */
const urls = reactive(new Map<string, string>());
const preview = ref<ClipboardImage | null>(null);
const copied = ref<string | null>(null);

const totalSize = computed(() => images.value.reduce((sum, img) => sum + img.size, 0));

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatTime(ms: number) {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

async function loadThumb(name: string) {
  if (urls.has(name)) return;
  try {
    const data = await readClipboardImage(name);
    urls.set(name, URL.createObjectURL(new Blob([data])));
  } catch {
    // 文件可能刚被删掉，缩略图留空即可
  }
}

async function refresh() {
  try {
    const list = await listClipboardImages();
    dir.value = list.dir;
    images.value = list.images;
    const names = new Set(list.images.map((img) => img.name));
    for (const [name, url] of urls) {
      if (!names.has(name)) {
        URL.revokeObjectURL(url);
        urls.delete(name);
      }
    }
    list.images.forEach((img) => loadThumb(img.name));
  } catch (e) {
    toast(`读取临时图片失败：${e}`);
  } finally {
    loading.value = false;
  }
}

function close() {
  terminal.imagesOpen = false;
}

async function insert(img: ClipboardImage) {
  close();
  await pastePathToTerminal(img.path);
}

async function copyPath(img: ClipboardImage) {
  await navigator.clipboard.writeText(img.path);
  copied.value = img.name;
  setTimeout(() => {
    if (copied.value === img.name) copied.value = null;
  }, 1200);
}

async function remove(names: string[]) {
  try {
    await deleteClipboardImages(names);
  } catch (e) {
    toast(e);
  }
  if (preview.value && names.includes(preview.value.name)) preview.value = null;
  await refresh();
}

async function removeAll() {
  const ok = await ask(`确定要删除全部 ${images.value.length} 张临时图片吗？`, {
    title: "删除临时图片",
    kind: "warning",
    okLabel: "删除",
    cancelLabel: "取消",
  });
  if (ok) await remove(images.value.map((img) => img.name));
}

function reveal(name?: string) {
  revealClipboardImage(name).catch(toast);
}

function onKey(e: KeyboardEvent) {
  if (e.key !== "Escape") return;
  e.stopPropagation();
  if (preview.value) preview.value = null;
  else close();
}

watch(() => terminal.imagesVersion, refresh);

onMounted(() => {
  refresh();
  window.addEventListener("keydown", onKey, true);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKey, true);
  urls.forEach((url) => URL.revokeObjectURL(url));
});
</script>

<template>
  <div class="mask" @mousedown.self="close">
    <div class="dialog" role="dialog" aria-label="临时图片">
      <header>
        <span class="title">临时图片</span>
        <span class="meta">{{ images.length }} 张 · {{ formatSize(totalSize) }}</span>
        <span class="spacer"></span>
        <button class="text-btn" title="在文件管理器中打开截图目录" @click="reveal()">打开文件夹</button>
        <button class="text-btn danger" :disabled="!images.length" @click="removeAll">全部删除</button>
        <button class="icon-btn" title="关闭 (Esc)" @click="close">
          <svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8" /></svg>
        </button>
      </header>

      <div v-if="preview" class="preview">
        <div class="preview-bar">
          <button class="text-btn" @click="preview = null">← 返回</button>
          <span class="preview-name" :title="preview.path">{{ preview.name }}</span>
          <span class="spacer"></span>
          <button class="text-btn" @click="insert(preview)">粘贴到终端</button>
          <button class="text-btn" @click="copyPath(preview)">
            {{ copied === preview.name ? "已复制" : "复制路径" }}
          </button>
          <button class="text-btn danger" @click="remove([preview.name])">删除</button>
        </div>
        <div class="preview-img">
          <img v-if="urls.get(preview.name)" :src="urls.get(preview.name)" :alt="preview.name" />
        </div>
      </div>

      <div v-else class="grid-wrap">
        <div v-if="!loading && !images.length" class="empty">
          还没有临时图片。<br />在终端里按 Ctrl+V 粘贴截图，就会保存到这里。
        </div>
        <div v-else class="grid">
          <div v-for="img in images" :key="img.name" class="card">
            <button class="thumb" title="查看大图" @click="preview = img" @dblclick="insert(img)">
              <img v-if="urls.get(img.name)" :src="urls.get(img.name)" :alt="img.name" loading="lazy" />
            </button>
            <div class="info">
              <span :title="img.name">{{ formatTime(img.modified) }}</span>
              <span class="size">{{ formatSize(img.size) }}</span>
            </div>
            <div class="actions">
              <button class="icon-btn" title="粘贴到终端" @click="insert(img)">
                <svg viewBox="0 0 16 16"><path d="M3 4l4 4-4 4M8.5 12H13" /></svg>
              </button>
              <button class="icon-btn" :title="copied === img.name ? '已复制' : '复制路径'" @click="copyPath(img)">
                <svg v-if="copied === img.name" viewBox="0 0 16 16"><path d="M3 8.5l3 3 7-7" /></svg>
                <svg v-else viewBox="0 0 16 16">
                  <rect x="5.5" y="5.5" width="8" height="8" rx="1" />
                  <path d="M10.5 5.5V3.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
                </svg>
              </button>
              <button class="icon-btn" title="在文件管理器中显示" @click="reveal(img.name)">
                <svg viewBox="0 0 16 16"><path d="M2 4.5v8h12v-7H7.5L6 4H2.5z" /></svg>
              </button>
              <button class="icon-btn danger" title="删除" @click="remove([img.name])">
                <svg viewBox="0 0 16 16"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 8.5h5.6l.7-8.5" /></svg>
              </button>
            </div>
          </div>
        </div>
      </div>

      <footer>
        <span>截图保存 7 天后自动清理 · 双击图片粘贴到终端</span>
        <span class="spacer"></span>
        <span class="dir" :title="dir">{{ dir }}</span>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  z-index: 90;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px 16px;
  background: rgba(0, 0, 0, 0.4);
}
.dialog {
  display: flex;
  flex-direction: column;
  width: 880px;
  max-width: 100%;
  height: 600px;
  max-height: 100%;
  border: 1px solid var(--widget-border);
  border-radius: 6px;
  background: var(--bg-widget);
  box-shadow: var(--shadow);
  overflow: hidden;
}
header,
.preview-bar,
footer {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: none;
}
header {
  height: 40px;
  padding: 0 8px 0 14px;
  border-bottom: 1px solid var(--border);
}
.title {
  color: var(--fg-strong);
  font-weight: 600;
}
.meta {
  margin-left: 4px;
  color: var(--fg-muted);
  font-size: 12px;
}
.spacer {
  flex: 1;
}
.text-btn {
  height: 24px;
  padding: 0 8px;
  border-radius: 4px;
  color: var(--fg);
  font-size: 12px;
}
.text-btn:hover:not(:disabled),
.icon-btn:hover {
  background: var(--hover);
  color: var(--fg-strong);
}
.text-btn.danger:hover:not(:disabled),
.icon-btn.danger:hover {
  color: var(--danger);
}
.text-btn:disabled {
  opacity: 0.4;
  cursor: default;
}
.icon-btn {
  width: 24px;
  height: 24px;
  border-radius: 4px;
  color: var(--fg-muted);
}
.icon-btn svg {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.grid-wrap {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 12px;
}
.empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--fg-muted);
  line-height: 1.8;
  text-align: center;
}
.card {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-panel);
  overflow: hidden;
}
.card:hover {
  border-color: var(--widget-border);
}
.thumb {
  display: flex;
  aspect-ratio: 16 / 10;
  width: 100%;
  padding: 6px;
  background: var(--bg-input);
}
.thumb img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.info {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px 0;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.size {
  color: var(--fg-muted);
}
.actions {
  display: flex;
  gap: 2px;
  padding: 4px;
}

.preview {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
.preview-bar {
  height: 36px;
  padding: 0 8px;
  border-bottom: 1px solid var(--border);
}
.preview-name {
  min-width: 0;
  overflow: hidden;
  color: var(--fg-muted);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.preview-img {
  display: flex;
  flex: 1;
  min-height: 0;
  align-items: center;
  justify-content: center;
  padding: 12px;
  background: var(--bg-input);
}
.preview-img img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

footer {
  height: 28px;
  padding: 0 14px;
  border-top: 1px solid var(--border);
  color: var(--fg-muted);
  font-size: 12px;
}
footer .dir {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
