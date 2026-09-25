import { invoke } from "@tauri-apps/api/core";

export interface SearchQuery {
  pattern: string;
  isRegex: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
}

export interface SearchMatch {
  /** 从 1 开始的行号 */
  line: number;
  /** 行内偏移（UTF-16） */
  col: number;
  endLine: number;
  endCol: number;
  /** 预览：匹配前的文本、匹配本身（只取第一行）、匹配后的文本 */
  before: string;
  text: string;
  after: string;
  replacement: string | null;
}

export interface FileResult {
  path: string;
  /** 相对于文件夹的路径 */
  rel: string;
  matches: SearchMatch[];
}

export interface SearchResult {
  files: FileResult[];
  limitHit: boolean;
  cancelled: boolean;
}

/** include/exclude 是逗号分隔的通配符；replace 给出时每处匹配附带替换后的文本 */
export const searchText = (
  root: string,
  query: SearchQuery,
  include: string,
  exclude: string,
  replace: string | null,
) => invoke<SearchResult>("search_text", { root, query, include, exclude, replace });

/** 在磁盘上的文件中替换，返回替换的数量 */
export const replaceInFiles = (paths: string[], query: SearchQuery, replace: string) =>
  invoke<number>("replace_in_files", { paths, query, replace });

/** 计算一段文本里的所有替换（UTF-16 偏移），用于已打开的文件 */
export const replaceChanges = (text: string, query: SearchQuery, replace: string) =>
  invoke<{ from: number; to: number; insert: string }[]>("replace_changes", { text, query, replace });
