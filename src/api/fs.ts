import { invoke } from "@tauri-apps/api/core";

export interface DirEntry {
  name: string;
  path: string;
  isDir: boolean;
}

export const readDir = (path: string) => invoke<DirEntry[]>("read_dir", { path });
export const readFile = (path: string) => invoke<string>("read_file", { path });
export const writeFile = (path: string, content: string) =>
  invoke<void>("write_file", { path, content });
export const createEntry = (dir: string, name: string, isDir: boolean) =>
  invoke<string>("create_entry", { dir, name, isDir });
export const renameEntry = (path: string, newName: string) =>
  invoke<string>("rename_entry", { path, newName });
export const deleteEntry = (path: string) => invoke<void>("delete_entry", { path });
/** 文件夹下所有文件的相对路径（遵守 .gitignore） */
export const listFiles = (root: string) => invoke<string[]>("list_files", { root });

export const newWindow = (folder?: string) => invoke<void>("new_window", { folder });
export const takeInitialOpen = () =>
  invoke<{ folder: string; file: string | null } | null>("take_initial_open");

export function baseName(path: string) {
  return path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
}

export function dirName(path: string) {
  return path.slice(0, Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")));
}

export function joinPath(dir: string, rel: string) {
  const sep = dir.includes("\\") ? "\\" : "/";
  return dir.replace(/[\\/]+$/, "") + sep + rel;
}

/** `path` 是否等于 `parent` 或位于其目录之下 */
export function isUnder(path: string, parent: string) {
  return path === parent || path.startsWith(parent + "\\") || path.startsWith(parent + "/");
}
