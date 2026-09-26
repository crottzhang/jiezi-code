import { reactive } from "vue";
import { ask } from "@tauri-apps/plugin-dialog";
import * as notesApi from "../api/notes";
import type { NoteMeta } from "../api/notes";
import { layout } from "./layout";
import { toast } from "./ui";
import { dropNoteTabs, openNoteTab, syncNoteTabs, workspace } from "./workspace";

export const notes = reactive({
  list: [] as NoteMeta[],
  /** 搜索框里的文字 */
  query: "",
  /** 第一次读取完成前显示“正在读取” */
  loaded: false,
});

let seq = 0;

/** 重新读取笔记列表；数据库在第一次打开笔记视图时才创建 */
export async function refreshNotes() {
  const s = ++seq;
  try {
    const list = await notesApi.listNotes(notes.query);
    if (s !== seq) return;
    notes.list = list;
  } catch (e) {
    if (s === seq) toast(`读取笔记失败：${e}`);
  } finally {
    if (s === seq) notes.loaded = true;
  }
}

let searchTimer: ReturnType<typeof setTimeout> | undefined;

export function setNoteQuery(query: string) {
  notes.query = query;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(refreshNotes, 150);
}

export async function openNote(id: number) {
  try {
    await openNoteTab(await notesApi.getNote(id));
  } catch (e) {
    toast(e);
    refreshNotes();
  }
}

export async function newNote() {
  try {
    const meta = await notesApi.createNote();
    layout.sidebarView = "notes";
    layout.sidebarVisible = true;
    // 新笔记可能不符合当前的搜索条件
    if (notes.query) setNoteQuery("");
    await openNote(meta.id);
  } catch (e) {
    toast(`新建笔记失败：${e}`);
  }
}

export function togglePin(note: NoteMeta) {
  notesApi.pinNote(note.id, !note.pinned).catch(toast);
}

export async function deleteNote(note: NoteMeta) {
  const ok = await ask(`确定要删除笔记“${note.title}”吗？\n删除后无法恢复。`, {
    title: "删除笔记",
    kind: "warning",
    okLabel: "删除",
    cancelLabel: "取消",
  });
  if (ok) await notesApi.deleteNote(note.id).catch(toast);
}

// 任一窗口改动笔记后刷新列表，并同步已打开的标签页
notesApi.onNotesChanged(async ({ id, deleted }) => {
  if (notes.loaded) refreshNotes();
  if (deleted) {
    dropNoteTabs(id);
    return;
  }
  const path = notesApi.notePath(id);
  if (!workspace.tabs.some((t) => t.path === path)) return;
  try {
    syncNoteTabs(await notesApi.getNote(id));
  } catch {
    // 读取失败时保留标签页里的内容
  }
});
