import { invoke } from "@tauri-apps/api/core";

export interface GitChange {
  /** 相对仓库根目录的路径，分隔符是 / */
  path: string;
  origPath: string | null;
  /** 暂存区状态：M A D R C T，"." 表示无变化 */
  index: string;
  /** 工作区状态：M D T，"?" 表示未跟踪，"." 表示无变化 */
  worktree: string;
  conflict: boolean;
}

export interface GitStatus {
  /** 仓库根目录（本机路径格式） */
  root: string;
  branch: string | null;
  head: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  changes: GitChange[];
  truncated: boolean;
}

export type RemoteOp = "pull" | "push" | "fetch" | "publish";

/** 不在仓库里时返回 null */
export const gitStatus = (dir: string) => invoke<GitStatus | null>("git_status", { dir });
export const gitInit = (dir: string) => invoke<void>("git_init", { dir });
export const gitStage = (root: string, paths: string[]) => invoke<void>("git_stage", { root, paths });
export const gitUnstage = (root: string, paths: string[]) =>
  invoke<void>("git_unstage", { root, paths });
export const gitDiscard = (root: string, paths: string[], untracked: string[]) =>
  invoke<void>("git_discard", { root, paths, untracked });
export const gitCommit = (root: string, message: string, amend: boolean) =>
  invoke<void>("git_commit", { root, message, amend });
/** rev 为空字符串表示暂存区；文件在该版本中不存在时返回 null */
export const gitShow = (root: string, rev: string, path: string) =>
  invoke<string | null>("git_show", { root, rev, path });
export const gitBranches = (root: string) => invoke<string[]>("git_branches", { root });
/** create 为 true 时新建分支，start 是新分支的起点提交（默认当前提交） */
export const gitCheckout = (root: string, branch: string, create: boolean, start?: string) =>
  invoke<void>("git_checkout", { root, branch, create, start: start ?? null });
export const gitRemote = (root: string, op: RemoteOp) => invoke<void>("git_remote", { root, op });

export interface GitCommit {
  hash: string;
  short: string;
  parents: string[];
  author: string;
  email: string;
  /** 作者时间，Unix 秒 */
  time: number;
  /** 如 "HEAD -> master"、"origin/master"、"tag: v1.0" */
  refs: string[];
  subject: string;
  body: string;
}

export interface CommitFile {
  path: string;
  origPath: string | null;
  /** A M D R C T */
  status: string;
}

/** 当前分支的提交历史；path 为仓库内相对路径时只列出改动过这个文件的提交 */
export const gitLog = (root: string, skip: number, limit: number, path?: string | null) =>
  invoke<GitCommit[]>("git_log", { root, skip, limit, path: path ?? null });
export const gitCommitFiles = (root: string, hash: string) =>
  invoke<CommitFile[]>("git_commit_files", { root, hash });
