import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface NoteMeta {
  id: number;
  /** 正文第一行非空文字 */
  title: string;
  /** 标题之后第一行非空文字 */
  summary: string;
  pinned: boolean;
  /** Unix 秒 */
  updatedAt: number;
}

export interface Note extends NoteMeta {
  content: string;
}

/** 置顶的在前，其余按修改时间从新到旧；query 非空时只返回标题或正文包含它的笔记 */
export const listNotes = (query = "") => invoke<NoteMeta[]>("note_list", { query });
export const getNote = (id: number) => invoke<Note>("note_get", { id });
export const createNote = (content = "") => invoke<NoteMeta>("note_create", { content });
export const saveNote = (id: number, content: string) => invoke<NoteMeta>("note_save", { id, content });
export const pinNote = (id: number, pinned: boolean) => invoke<void>("note_pin", { id, pinned });
export const deleteNote = (id: number) => invoke<void>("note_delete", { id });

/** 任一窗口里的笔记被新建、保存、置顶或删除时通知所有窗口 */
export const onNotesChanged = (handler: (change: { id: number; deleted: boolean }) => void) =>
  listen<{ id: number; deleted: boolean }>("notes-changed", (e) => handler(e.payload));

/** 笔记标签页的虚拟路径 */
export const notePath = (id: number) => `note:${id}`;

/** 笔记标签页（或它的预览）路径里的笔记 id，不是笔记时返回 null */
export function noteIdOf(path: string) {
  const m = /^note:(\d+)$/.exec(path);
  return m ? Number(m[1]) : null;
}
