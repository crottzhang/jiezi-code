<script setup lang="ts">
// Markdown 预览：同一文件的文本标签页打开着时显示编辑器里的内容（包括未保存的修改），否则读取磁盘。
// 不允许原始 HTML（html: false），文件里的 <script> 等只会显示成文字，不能在编辑器里执行
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import MarkdownIt from "markdown-it";
import { highlightCode } from "@lezer/highlight";
import { dirName, openExternal, readFile, readFileBytes } from "../api/fs";
import { loadLanguageByName } from "../editor/setup";
import { codeHighlightCss, codeHighlighter } from "../editor/theme";
import { toast } from "../store/ui";
import {
  findTabByPath,
  getState,
  isMarkdownFile,
  openFile,
  previewMarkdown,
  workspace,
  type Tab,
} from "../store/workspace";

const props = defineProps<{ tab: Tab }>();

const md = new MarkdownIt({ html: false, linkify: true });
// 本地图片先不给 src（浏览器会按应用自己的地址去请求），渲染后再读取文件显示
const renderImage = md.renderer.rules.image!;
md.renderer.rules.image = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const src = String(token.attrGet("src") ?? "");
  if (!/^(https?:|data:)/i.test(src)) {
    token.attrs = (token.attrs ?? []).filter(([name]) => name !== "src");
    token.attrSet("data-src", src);
  }
  return renderImage(tokens, idx, options, env, self);
};

const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  ico: "image/x-icon",
  avif: "image/avif",
  svg: "image/svg+xml",
};

/** 各预览标签页的滚动位置，切换回来时恢复 */
const scrollPositions = new Map<number, number>();

let styleInjected = false;

function injectHighlightCss() {
  if (styleInjected) return;
  styleInjected = true;
  const style = document.createElement("style");
  style.textContent = codeHighlightCss;
  document.head.append(style);
}

const root = ref<HTMLElement>();
const html = ref("");
const error = ref("");
/** 本次渲染创建的图片 blob URL，重新渲染或关闭时释放 */
let blobUrls: string[] = [];
let seq = 0;

async function source() {
  const textTab = findTabByPath(props.tab.path);
  const state = textTab && getState(textTab.id);
  return state ? state.doc.toString() : readFile(props.tab.path);
}

async function render(restoreScroll: boolean) {
  const s = ++seq;
  let text: string;
  try {
    text = await source();
  } catch (e) {
    if (s !== seq) return;
    error.value = String(e);
    html.value = "";
    return;
  }
  if (s !== seq) return;
  const scrollTop = root.value?.scrollTop ?? 0;
  revokeImages();
  error.value = "";
  html.value = md.render(text);
  await nextTick();
  if (s !== seq || !root.value) return;
  root.value.scrollTop = restoreScroll ? (scrollPositions.get(props.tab.id) ?? 0) : scrollTop;
  enhance(root.value, s);
}

/** 渲染后的处理：标题锚点、任务列表、代码高亮、本地图片 */
function enhance(el: HTMLElement, s: number) {
  addHeadingIds(el);
  addTaskCheckboxes(el);
  el.querySelectorAll<HTMLElement>("pre > code[class*='language-']").forEach((code) => highlight(code, s));
  el.querySelectorAll<HTMLImageElement>("img[data-src]").forEach((img) => loadImage(img, s));
}

/** 和 GitHub 一样给标题生成 id，文档内的 #锚点 链接才能跳转 */
function addHeadingIds(el: HTMLElement) {
  const used = new Map<string, number>();
  el.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach((h) => {
    const base = (h.textContent ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s_-]/gu, "")
      .replace(/\s/g, "-");
    const n = used.get(base) ?? 0;
    used.set(base, n + 1);
    h.id = n ? `${base}-${n}` : base;
  });
}

/** `- [ ] 待办` / `- [x] 已完成` 显示成复选框 */
function addTaskCheckboxes(el: HTMLElement) {
  el.querySelectorAll("li").forEach((li) => {
    let node = li.firstChild;
    if (node instanceof HTMLParagraphElement) node = node.firstChild;
    if (!(node instanceof Text)) return;
    const m = /^\[([ xX])\]\s/.exec(node.data);
    if (!m) return;
    node.data = node.data.slice(m[0].length);
    const box = document.createElement("input");
    box.type = "checkbox";
    box.disabled = true;
    box.checked = m[1] !== " ";
    node.parentNode!.insertBefore(box, node);
    li.classList.add("task");
    li.parentElement?.classList.add("tasks");
  });
}

async function highlight(code: HTMLElement, s: number) {
  const lang = /language-(\S+)/.exec(code.className)?.[1];
  const support = lang && (await loadLanguageByName(lang));
  if (!support || s !== seq || !code.isConnected) return;
  const text = code.textContent ?? "";
  const tree = support.language.parser.parse(text);
  const out = document.createDocumentFragment();
  highlightCode(
    text,
    tree,
    codeHighlighter,
    (piece, classes) => {
      if (!classes) {
        out.append(piece);
        return;
      }
      const span = document.createElement("span");
      span.className = classes;
      span.textContent = piece;
      out.append(span);
    },
    () => out.append("\n"),
  );
  code.replaceChildren(out);
}

async function loadImage(img: HTMLImageElement, s: number) {
  const path = resolveLocal(img.dataset.src ?? "");
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  try {
    const bytes = await readFileBytes(path);
    if (s !== seq) return;
    const url = URL.createObjectURL(new Blob([bytes], { type: IMAGE_MIME[ext] ?? "" }));
    blobUrls.push(url);
    img.src = url;
  } catch {
    img.classList.add("missing");
    img.title = `找不到图片：${path}`;
  }
}

function revokeImages() {
  blobUrls.forEach((url) => URL.revokeObjectURL(url));
  blobUrls = [];
}

/** 把文档里的相对路径转成磁盘路径：以 / 开头的相对于打开的文件夹，其他的相对于 Markdown 文件所在目录 */
function resolveLocal(rel: string) {
  let decoded = rel;
  try {
    decoded = decodeURIComponent(rel);
  } catch {
    // 不是合法的 URL 编码时按原样使用
  }
  const file = props.tab.path;
  const sep = file.includes("\\") ? "\\" : "/";
  const base = decoded.startsWith("/") && workspace.root ? workspace.root : dirName(file);
  const parts = base.split(/[\\/]/);
  for (const seg of decoded.split(/[\\/]/)) {
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      if (parts.length > 1) parts.pop();
    } else parts.push(seg);
  }
  return parts.join(sep);
}

/** 链接不能让整个窗口跳走：锚点在预览里滚动，网址交给系统浏览器，本地文件在编辑器里打开 */
function onClick(e: MouseEvent) {
  const a = (e.target as Element).closest("a");
  if (!a) return;
  e.preventDefault();
  const href = a.getAttribute("href") ?? "";
  if (href.startsWith("#")) {
    const id = decodeURIComponent(href.slice(1));
    root.value?.querySelector(`[id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "start" });
  } else if (/^(https?:|mailto:)/i.test(href)) {
    openExternal(href).catch(toast);
  } else if (href) {
    const target = resolveLocal(href.split("#")[0]);
    if (isMarkdownFile(target)) previewMarkdown(target);
    else openFile(target);
  }
}

function saveScroll(id: number) {
  if (root.value) scrollPositions.set(id, root.value.scrollTop);
}

onMounted(injectHighlightCss);

// 切换到别的预览标签页时换内容并恢复各自的滚动位置；文件变化时原地刷新
watch(
  () => props.tab.id,
  (_, old) => {
    if (old != null) saveScroll(old);
    render(true);
  },
  { immediate: true },
);
watch(
  () => props.tab.markdown?.version,
  () => render(false),
);

onBeforeUnmount(() => {
  seq++;
  saveScroll(props.tab.id);
  revokeImages();
});
</script>

<template>
  <div ref="root" class="md-preview" @click="onClick">
    <p v-if="error" class="md-error">{{ error }}</p>
    <!-- 内容来自 markdown-it，原始 HTML 已被禁用并转义 -->
    <article v-else class="md-body" v-html="html"></article>
  </div>
</template>

<style>
/* 预览内容由 v-html 生成，样式不能用 scoped；统一以 .md-preview 为前缀 */
.md-preview {
  flex: 1;
  min-height: 0;
  overflow: auto;
  background: var(--bg-editor);
  color: var(--ed-fg);
  user-select: text;
}
.md-error {
  margin: 40px auto;
  text-align: center;
  color: var(--fg-muted);
}
.md-preview .md-body {
  max-width: 880px;
  margin: 0 auto;
  padding: 24px 40px 80px;
  font-size: 14px;
  line-height: 1.65;
  word-wrap: break-word;
}
.md-preview .md-body > :first-child {
  margin-top: 0;
}
.md-preview h1,
.md-preview h2,
.md-preview h3,
.md-preview h4,
.md-preview h5,
.md-preview h6 {
  margin: 1.4em 0 0.6em;
  color: var(--fg-strong);
  font-weight: 600;
  line-height: 1.3;
}
.md-preview h1 {
  font-size: 2em;
  padding-bottom: 0.3em;
  border-bottom: 1px solid var(--border);
}
.md-preview h2 {
  font-size: 1.5em;
  padding-bottom: 0.3em;
  border-bottom: 1px solid var(--border);
}
.md-preview h3 {
  font-size: 1.25em;
}
.md-preview h4 {
  font-size: 1em;
}
.md-preview h5,
.md-preview h6 {
  font-size: 0.875em;
  color: var(--fg-muted);
}
.md-preview p,
.md-preview blockquote,
.md-preview ul,
.md-preview ol,
.md-preview table,
.md-preview pre {
  margin: 0 0 1em;
}
.md-preview a {
  color: var(--hl);
  text-decoration: none;
  cursor: pointer;
}
.md-preview a:hover {
  text-decoration: underline;
}
.md-preview ul,
.md-preview ol {
  padding-left: 2em;
}
.md-preview li + li {
  margin-top: 0.25em;
}
.md-preview ul.tasks {
  padding-left: 1.2em;
}
.md-preview li.task {
  list-style: none;
}
.md-preview li.task > input,
.md-preview li.task > p > input {
  margin: 0 0.4em 0 -1.2em;
  vertical-align: middle;
}
.md-preview blockquote {
  padding: 0 1em;
  color: var(--fg-muted);
  border-left: 3px solid var(--border-input);
}
.md-preview code {
  font-family: "Cascadia Code", Consolas, "Courier New", monospace;
  font-size: 0.9em;
}
.md-preview :not(pre) > code {
  padding: 0.15em 0.4em;
  border-radius: 4px;
  background: var(--bg-input);
}
.md-preview pre {
  padding: 12px 16px;
  overflow: auto;
  border-radius: var(--radius);
  background: var(--bg-input);
  line-height: 1.5;
}
.md-preview hr {
  height: 1px;
  margin: 1.5em 0;
  border: 0;
  background: var(--border);
}
.md-preview table {
  display: block;
  width: max-content;
  max-width: 100%;
  overflow: auto;
  border-collapse: collapse;
}
.md-preview th,
.md-preview td {
  padding: 6px 13px;
  border: 1px solid var(--border-input);
}
.md-preview th {
  font-weight: 600;
  background: var(--bg-input);
}
.md-preview img {
  max-width: 100%;
}
.md-preview img.missing {
  display: inline-block;
  min-width: 24px;
  min-height: 24px;
  outline: 1px dashed var(--danger);
}
</style>
