import { markRaw, nextTick, reactive, watch } from "vue";
import { EditorView } from "@codemirror/view";
import { listen } from "@tauri-apps/api/event";
import { ask } from "@tauri-apps/plugin-dialog";
import type { FsChange } from "../api/fs";
import * as api from "../api/search";
import type { FileResult, SearchMatch } from "../api/search";
import { tabId } from "../editor/setup";
import { getEditorView } from "../editor/view";
import { layout } from "./layout";
import { toast } from "./ui";
import { getState, openFile, saveFile, updateTabState, workspace } from "./workspace";

const KEY = "jiezi.search";

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
}

const saved = load();

export const search = reactive({
  query: "",
  replace: "",
  /** 逗号分隔的通配符 */
  include: (saved.include as string) ?? "",
  exclude: (saved.exclude as string) ?? "",
  caseSensitive: (saved.caseSensitive as boolean) ?? false,
  wholeWord: (saved.wholeWord as boolean) ?? false,
  isRegex: (saved.isRegex as boolean) ?? false,
  showReplace: false,
  /** 显示“包含/排除的文件”输入框 */
  showDetails: (saved.showDetails as boolean) ?? false,
  /** 结果可能有上万条，不需要 Vue 深度代理，整体替换 */
  files: markRaw([]) as FileResult[],
  limitHit: false,
  running: false,
  error: "",
  /** 当前结果对应一次完成的搜索（用来区分“没有结果”和“还没搜索”） */
  done: false,
  /** 折叠的文件（按路径） */
  collapsed: {} as Record<string, boolean>,
  /** 请求搜索视图把焦点放到哪个输入框 */
  focus: null as null | "query" | "replace",
});

watch(
  () => [search.include, search.exclude, search.caseSensitive, search.wholeWord, search.isRegex, search.showDetails],
  () => {
    const { include, exclude, caseSensitive, wholeWord, isRegex, showDetails } = search;
    try {
      localStorage.setItem(KEY, JSON.stringify({ include, exclude, caseSensitive, wholeWord, isRegex, showDetails }));
    } catch {
      // 存储不可用时不影响使用
    }
  },
);

const queryOf = (): api.SearchQuery => ({
  pattern: search.query,
  isRegex: search.isRegex,
  caseSensitive: search.caseSensitive,
  wholeWord: search.wholeWord,
});

export const matchCount = (files: FileResult[] = search.files) =>
  files.reduce((n, f) => n + f.matches.length, 0);

// ---------------- 搜索 ----------------

let seq = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

export function scheduleSearch(delay = 300) {
  clearTimeout(timer);
  timer = setTimeout(runSearch, delay);
}

export async function runSearch() {
  clearTimeout(timer);
  const id = ++seq;
  const root = workspace.root;
  if (!root || !search.query) {
    search.files = markRaw([]);
    search.limitHit = false;
    search.error = "";
    search.running = false;
    search.done = false;
    return;
  }
  search.running = true;
  try {
    const replace = search.showReplace ? search.replace : null;
    const r = await api.searchText(root, queryOf(), search.include, search.exclude, replace);
    // 期间又开始了新的搜索
    if (id !== seq || r.cancelled) return;
    search.files = markRaw(r.files);
    search.limitHit = r.limitHit;
    search.error = "";
    search.done = true;
  } catch (e) {
    if (id !== seq) return;
    search.files = markRaw([]);
    search.error = String(e);
    search.done = false;
  } finally {
    if (id === seq) search.running = false;
  }
}

watch(
  () => [search.query, search.caseSensitive, search.wholeWord, search.isRegex, search.include, search.exclude],
  () => scheduleSearch(),
);
// 替换预览跟着替换文本更新
watch(
  () => [search.replace, search.showReplace],
  () => search.query && scheduleSearch(),
);
watch(
  () => workspace.root,
  () => {
    search.collapsed = {};
    runSearch();
  },
);

/** 文件有变化（保存、外部修改）时重新搜索，保持结果是最新的 */
function refreshLater() {
  if (search.done) scheduleSearch(600);
}
watch(() => workspace.fsVersion, refreshLater);
listen<FsChange>("fs-changed", ({ payload: c }) => {
  if (c.all || c.files.length) refreshLater();
});

export function clearResults() {
  search.query = "";
  search.collapsed = {};
  runSearch();
  search.focus = "query";
}

/** 从结果中移除一个文件 */
export function dismissFile(file: FileResult) {
  search.files = markRaw(search.files.filter((f) => f !== file));
}

export function setAllCollapsed(collapsed: boolean) {
  search.collapsed = collapsed ? Object.fromEntries(search.files.map((f) => [f.path, true])) : {};
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Ctrl+Shift+F / Ctrl+Shift+H：打开搜索视图，编辑器里选中的文字作为搜索内容 */
export function openSearch(replace = false) {
  layout.sidebarView = "search";
  layout.sidebarVisible = true;
  if (replace) search.showReplace = true;
  const view = getEditorView();
  if (view) {
    const sel = view.state.selection.main;
    const text = view.state.sliceDoc(sel.from, sel.to);
    if (text && !text.includes("\n") && text.length <= 200) {
      search.query = search.isRegex ? escapeRegex(text) : text;
    }
  }
  search.focus = replace && search.query ? "replace" : "query";
}

// ---------------- 打开结果 ----------------

/** Windows 上路径不区分大小写，分隔符也可能不同 */
const pathKey = (p: string) => p.replace(/\//g, "\\").toLowerCase();

function tabFor(path: string) {
  const key = pathKey(path);
  return workspace.tabs.find((t) => !t.readonly && pathKey(t.path) === key);
}

/** 打开文件并选中这处匹配 */
export async function openMatch(file: FileResult, m: SearchMatch) {
  await openFile(tabFor(file.path)?.path ?? file.path);
  const tab = tabFor(file.path);
  if (!tab || workspace.active !== tab.id) return;
  // 等编辑器换上这个标签页的状态
  await nextTick();
  const view = getEditorView();
  if (!view || view.state.facet(tabId) !== tab.id) return;
  const doc = view.state.doc;
  // 文件可能已经改过，位置超出范围时就近选择
  const pos = (line: number, col: number) => {
    if (line > doc.lines) return doc.length;
    const l = doc.line(line);
    return Math.min(l.from + col, l.to);
  };
  const from = pos(m.line, m.col);
  const to = Math.max(from, pos(m.endLine, m.endCol));
  view.dispatch({
    selection: { anchor: from, head: to },
    effects: EditorView.scrollIntoView(from, { y: "center" }),
  });
  view.focus();
}

// ---------------- 替换 ----------------

/**
 * 替换这些文件里的所有匹配。已打开的文件在编辑器里替换（可以撤销），
 * 原本没有未保存修改的顺便保存；其余文件直接在磁盘上替换。
 */
export async function replaceIn(files: FileResult[], confirm = true) {
  if (!files.length || !search.query) return;
  const query = queryOf();
  const replace = search.replace;
  if (confirm) {
    const count = matchCount(files);
    const where = files.length === 1 ? `“${files[0].rel}”中` : `${files.length} 个文件中`;
    const ok = await ask(`将${where}的 ${count} 处匹配替换为“${replace}”？`, {
      title: "全部替换",
      kind: "warning",
      okLabel: "替换",
      cancelLabel: "取消",
    });
    if (!ok) return;
  }

  let replaced = 0;
  const onDisk: string[] = [];
  try {
    for (const file of files) {
      const tab = tabFor(file.path);
      const state = tab && getState(tab.id);
      if (!tab || !state) {
        onDisk.push(file.path);
        continue;
      }
      const changes = await api.replaceChanges(state.doc.toString(), query, replace);
      // 计算期间用户又改了内容，位置已经对不上
      if (getState(tab.id)?.doc !== state.doc) {
        toast(`“${tab.name}”在替换时被修改，已跳过`);
        continue;
      }
      if (!changes.length) continue;
      const wasDirty = tab.dirty;
      updateTabState(tab.id, { changes, userEvent: "input.replace.all" });
      replaced += changes.length;
      if (!wasDirty) await saveFile(tab.id);
    }
    if (onDisk.length) replaced += await api.replaceInFiles(onDisk, query, replace);
  } catch (e) {
    toast(e);
  } finally {
    // 刷新 Git 状态和搜索结果
    workspace.fsVersion++;
  }
  if (replaced) toast(`已替换 ${replaced} 处`, { kind: "info" });
}
