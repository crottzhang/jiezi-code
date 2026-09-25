import { reactive } from "vue";
import { EditorState, type StateEffect, type Text, type TransactionSpec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { ask, message, open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import * as fsApi from "../api/fs";
import { baseName, dirName, isUnder } from "../api/fs";
import { createEditorState, loadLanguage, tabId } from "../editor/setup";
import { getEditorView } from "../editor/view";
import { promptInput, toast } from "./ui";

export interface Tab {
  id: number;
  path: string;
  name: string;
  dirty: boolean;
  language: string;
  eol: "LF" | "CRLF";
  /** 正在与 Git 中的版本对比：rev 为 "HEAD" 或 ""（暂存区），rel 是仓库内的相对路径 */
  diff: { rev: string; rel: string; label: string } | null;
  /** 只读标签页（比如历史提交里的文件版本），path 是虚拟路径，不对应磁盘文件 */
  readonly?: boolean;
  /** 图片预览标签页：没有 EditorState，由 ImageView 显示。version 加一时重新读取图片 */
  image?: { version: number; width: number; height: number; size: number };
}

/** 这些扩展名用图片预览打开（svg 是文本，和 VS Code 一样按文本打开） */
const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "avif"]);

export function isImageFile(path: string) {
  const name = baseName(path).toLowerCase();
  return IMAGE_EXTS.has(name.slice(name.lastIndexOf(".") + 1));
}

// 编辑器状态不放进响应式对象：EditorState 体积大且不可变，没必要让 Vue 去代理。
// 只有一个 EditorView，切换标签页时换上对应的 EditorState（撤销历史也跟着保留）。
const states = new Map<number, EditorState>();
const savedDocs = new Map<number, Text>();
export const scrollSnapshots = new Map<number, StateEffect<unknown>>();
let nextTabId = 1;

export const workspace = reactive({
  root: null as string | null,
  tabs: [] as Tab[],
  active: null as number | null,
  cursor: { line: 1, col: 1, selected: 0 },
  /** 目录版本号，变化时文件树重新读取该目录 */
  dirVersions: {} as Record<string, number>,
  /** 文件被保存、新建、删除、重命名时加一，Git 面板据此刷新 */
  fsVersion: 0,
  /** 加一时文件树里所有展开的目录都重新读取（比如切换分支后） */
  treeVersion: 0,
  /** 加一时文件树折叠所有文件夹 */
  collapseVersion: 0,
});

const editorListener = EditorView.updateListener.of((u) => {
  const id = u.state.facet(tabId);
  states.set(id, u.state);
  if (u.docChanged) {
    const tab = findTab(id);
    const saved = savedDocs.get(id);
    // 只读标签页（历史版本、输出日志）的内容由程序更新，不算未保存
    if (tab && saved && !tab.readonly) tab.dirty = !u.state.doc.eq(saved);
  }
  if (u.docChanged || u.selectionSet) updateCursor(u.state);
});

export const getState = (id: number) => states.get(id);
export const findTab = (id: number | null) => workspace.tabs.find((t) => t.id === id);
export const activeTab = () => findTab(workspace.active);
export const hasDirty = () => workspace.tabs.some((t) => t.dirty);
export const findTabByPath = (path: string) => workspace.tabs.find((t) => t.path === path);

/** 修改某个标签页的编辑器状态；当前显示的标签页通过 EditorView 派发，其余的直接替换保存的状态 */
export function updateTabState(id: number, spec: TransactionSpec) {
  const view = getEditorView();
  if (view && view.state.facet(tabId) === id) {
    view.dispatch(spec);
    return;
  }
  const state = states.get(id);
  if (!state) return;
  const next = state.update(spec).state;
  states.set(id, next);
  // 不在 EditorView 里的状态不会经过 editorListener，这里自己更新未保存标记
  const tab = findTab(id);
  const saved = savedDocs.get(id);
  if (tab && saved && !tab.readonly && next.doc !== state.doc) tab.dirty = !next.doc.eq(saved);
}

export function updateCursor(state: EditorState) {
  const head = state.selection.main.head;
  const line = state.doc.lineAt(head);
  workspace.cursor = {
    line: line.number,
    col: head - line.from + 1,
    selected: state.selection.ranges.reduce((n, r) => n + r.to - r.from, 0),
  };
}

// ---------------- 文件夹 ----------------

const RECENT_KEY = "jiezi.recentFolders";

export function recentFolders(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function rememberFolder(path: string) {
  try {
    const list = [path, ...recentFolders().filter((p) => p !== path)].slice(0, 10);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    // 存储不可用时不影响使用
  }
}

async function pickFolder() {
  const picked = await open({ directory: true });
  return typeof picked === "string" ? picked : null;
}

export async function openFolder(path?: string | null) {
  path ??= await pickFolder();
  if (!path) return;
  if (!(await confirmDiscard(workspace.tabs))) return;
  for (const tab of [...workspace.tabs]) dropTab(tab.id);
  workspace.root = path;
  workspace.dirVersions = {};
  rememberFolder(path);
  await getCurrentWindow().setTitle(`${baseName(path)} - Jiezi Code`);
}

export async function closeFolder() {
  if (!(await confirmDiscard(workspace.tabs))) return;
  for (const tab of [...workspace.tabs]) dropTab(tab.id);
  workspace.root = null;
  workspace.dirVersions = {};
  await getCurrentWindow().setTitle("Jiezi Code");
}

export async function openFolderInNewWindow(path?: string | null) {
  path ??= await pickFolder();
  if (path) await fsApi.newWindow(path).catch(toast);
}

// ---------------- 标签页 ----------------

export async function openFile(path: string) {
  const existing = workspace.tabs.find((t) => t.path === path);
  if (existing) {
    workspace.active = existing.id;
    return;
  }
  if (isImageFile(path)) {
    openImage(path);
    return;
  }
  try {
    const [content, lang] = await Promise.all([
      fsApi.readFile(path),
      loadLanguage(baseName(path)),
    ]);
    // 等待期间可能已经被打开（比如连点两次）
    const opened = workspace.tabs.find((t) => t.path === path);
    if (opened) {
      workspace.active = opened.id;
      return;
    }
    const id = nextTabId++;
    const state = createEditorState(id, content, lang.support, editorListener);
    states.set(id, state);
    savedDocs.set(id, state.doc);

    const crlf = content.split("\r\n").length - 1;
    const lf = content.split("\n").length - 1;
    const index = workspace.tabs.findIndex((t) => t.id === workspace.active);
    workspace.tabs.splice(index + 1, 0, {
      id,
      path,
      name: baseName(path),
      dirty: false,
      language: lang.name,
      eol: crlf > 0 && crlf * 2 >= lf ? "CRLF" : "LF",
      diff: null,
    });
    workspace.active = id;
  } catch (e) {
    toast(e);
  }
}

/** 图片按只读标签页打开，内容由 ImageView 读取，读取失败时在预览区里提示 */
function openImage(path: string) {
  const id = nextTabId++;
  const index = workspace.tabs.findIndex((t) => t.id === workspace.active);
  workspace.tabs.splice(index + 1, 0, {
    id,
    path,
    name: baseName(path),
    dirty: false,
    language: "图片",
    eol: "LF",
    diff: null,
    readonly: true,
    image: { version: 0, width: 0, height: 0, size: 0 },
  });
  workspace.active = id;
}

/**
 * 打开一个只读的虚拟标签页，内容由调用方给出。
 * path 用来区分标签页（同一个 path 只打开一次），fileName 用来选择语法高亮。
 */
export async function openVirtualFile(path: string, name: string, fileName: string, content: string) {
  const existing = workspace.tabs.find((t) => t.path === path);
  if (existing) {
    workspace.active = existing.id;
    return existing;
  }
  const lang = await loadLanguage(fileName);
  const opened = workspace.tabs.find((t) => t.path === path);
  if (opened) {
    workspace.active = opened.id;
    return opened;
  }
  const id = nextTabId++;
  const state = createEditorState(id, content, lang.support, editorListener, [
    EditorState.readOnly.of(true),
  ]);
  states.set(id, state);
  savedDocs.set(id, state.doc);
  const index = workspace.tabs.findIndex((t) => t.id === workspace.active);
  workspace.tabs.splice(index + 1, 0, {
    id,
    path,
    name,
    dirty: false,
    language: lang.name,
    eol: content.includes("\r\n") ? "CRLF" : "LF",
    diff: null,
    readonly: true,
  });
  workspace.active = id;
  return findTab(id)!;
}

export async function saveFile(id = workspace.active) {
  const tab = findTab(id);
  const state = id != null ? states.get(id) : undefined;
  if (!tab || !state) return false;
  if (tab.readonly) return true;
  const doc = state.doc;
  try {
    await fsApi.writeFile(tab.path, doc.sliceString(0, doc.length, tab.eol === "CRLF" ? "\r\n" : "\n"));
    savedDocs.set(tab.id, doc);
    workspace.fsVersion++;
    // 写盘期间用户可能继续输入了
    tab.dirty = !states.get(tab.id)!.doc.eq(doc);
    return true;
  } catch (e) {
    toast(`保存失败：${e}`);
    return false;
  }
}

/** 文件在外部被改动（比如 Git 放弃更改、切换分支）后，重新读取没有未保存修改的标签页 */
/** paths 给出时只重新读取这些文件（小写比较），否则检查所有标签页 */
export async function reloadCleanTabs(paths?: string[]) {
  const wanted = paths && new Set(paths.map((p) => p.toLowerCase()));
  for (const tab of workspace.tabs) {
    if (tab.image && (!wanted || wanted.has(tab.path.toLowerCase()))) tab.image.version++;
  }
  await Promise.all(
    workspace.tabs
      .filter((t) => !t.dirty && !t.readonly && (!wanted || wanted.has(t.path.toLowerCase())))
      .map(async (tab) => {
        let content: string;
        try {
          content = await fsApi.readFile(tab.path);
        } catch {
          return; // 文件被删除或无法读取时保留原内容
        }
        const state = states.get(tab.id);
        if (!state || tab.dirty || state.doc.toString() === content.replace(/\r\n?/g, "\n")) return;
        // 用一次整体替换来更新，撤销历史里可以找回之前的内容
        updateTabState(tab.id, { changes: { from: 0, to: state.doc.length, insert: content } });
        const doc = states.get(tab.id)!.doc;
        savedDocs.set(tab.id, doc);
        tab.dirty = false;
      }),
  );
}

export async function saveAll() {
  for (const tab of workspace.tabs.filter((t) => t.dirty)) await saveFile(tab.id);
}

/** 有未保存修改时询问用户，返回 false 表示用户取消 */
export async function confirmDiscard(tabs: Tab[]) {
  const dirty = tabs.filter((t) => t.dirty);
  if (dirty.length === 0) return true;
  const text =
    dirty.length === 1
      ? `是否保存对“${dirty[0].name}”的更改？`
      : `有 ${dirty.length} 个文件未保存，是否保存？`;
  const choice = await message(`${text}\n如果不保存，更改将会丢失。`, {
    title: "Jiezi Code",
    kind: "warning",
    buttons: { yes: "保存", no: "不保存", cancel: "取消" },
  });
  if (choice === "保存") {
    for (const tab of dirty) if (!(await saveFile(tab.id))) return false;
    return true;
  }
  return choice === "不保存";
}

export async function closeTab(id = workspace.active) {
  const tab = findTab(id);
  if (!tab || !(await confirmDiscard([tab]))) return;
  dropTab(tab.id);
}

function dropTab(id: number) {
  const index = workspace.tabs.findIndex((t) => t.id === id);
  if (index < 0) return;
  workspace.tabs.splice(index, 1);
  states.delete(id);
  savedDocs.delete(id);
  scrollSnapshots.delete(id);
  if (workspace.active === id) {
    workspace.active = (workspace.tabs[index] ?? workspace.tabs[index - 1])?.id ?? null;
  }
}

export function cycleTab(delta: number) {
  const n = workspace.tabs.length;
  if (n < 2) return;
  const index = workspace.tabs.findIndex((t) => t.id === workspace.active);
  workspace.active = workspace.tabs[(index + delta + n) % n].id;
}

// ---------------- 文件操作 ----------------

export function refreshDir(dir: string, notify = true) {
  workspace.dirVersions[dir] = (workspace.dirVersions[dir] ?? 0) + 1;
  if (notify) workspace.fsVersion++;
}

export function refreshTree() {
  workspace.treeVersion++;
}

export async function newEntry(dir: string, isDir: boolean) {
  const name = (
    await promptInput(isDir ? "新建文件夹" : "新建文件（可以带子路径，如 src/main.ts）")
  )?.trim();
  if (!name) return;
  try {
    const path = await fsApi.createEntry(dir, name, isDir);
    refreshDir(dir);
    refreshDir(dirName(path));
    if (!isDir) await openFile(path);
  } catch (e) {
    toast(e);
  }
}

export async function renamePath(path: string) {
  const oldName = baseName(path);
  const name = (await promptInput("重命名", oldName))?.trim();
  if (!name || name === oldName) return;
  try {
    const newPath = await fsApi.renameEntry(path, name);
    refreshDir(dirName(path));
    for (const tab of workspace.tabs) {
      if (isUnder(tab.path, path)) {
        tab.path = newPath + tab.path.slice(path.length);
        tab.name = baseName(tab.path);
      }
    }
  } catch (e) {
    toast(e);
  }
}

export async function deletePath(path: string) {
  const ok = await ask(`确定要删除“${baseName(path)}”吗？\n它会被移动到回收站。`, {
    title: "删除",
    kind: "warning",
    okLabel: "移到回收站",
    cancelLabel: "取消",
  });
  if (!ok) return;
  try {
    await fsApi.deleteEntry(path);
    refreshDir(dirName(path));
    for (const tab of workspace.tabs.filter((t) => isUnder(t.path, path))) dropTab(tab.id);
  } catch (e) {
    toast(e);
  }
}
