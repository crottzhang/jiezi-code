import { Channel, invoke } from "@tauri-apps/api/core";

export interface GitChange {
  /** 相对仓库根目录的路径，分隔符是 / */
  path: string;
  origPath: string | null;
  /** 暂存区状态：M A D R C T，"." 表示无变化 */
  index: string;
  /** 工作区状态：M D T，"?" 表示未跟踪，"." 表示无变化 */
  worktree: string;
  conflict: boolean;
  /** 暂存区里这个文件的对象哈希 */
  indexHash: string | null;
}

export type GitOperation = "merge" | "rebase" | "cherry-pick" | "revert";

export interface GitStatus {
  /** 仓库根目录（本机路径格式） */
  root: string;
  gitDir: string;
  branch: string | null;
  head: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  /** 进行中的合并、变基等操作 */
  operation: GitOperation | null;
  stashCount: number;
  changes: GitChange[];
  truncated: boolean;
}

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

export interface Branch {
  /** 本地分支是 main，远程分支是 origin/main */
  name: string;
  remote: boolean;
  current: boolean;
  upstream: string | null;
  time: number;
}

export interface Stash {
  index: number;
  hash: string;
  message: string;
  time: number;
}

export interface BlameCommit {
  hash: string;
  author: string;
  time: number;
  summary: string;
  uncommitted: boolean;
}

export interface Blame {
  commits: BlameCommit[];
  /** 每一行（从 0 开始）对应 commits 里的下标 */
  lines: number[];
}

export interface Progress {
  phase: string;
  percent: number;
}

export type RemoteOp = "pull" | "push" | "fetch" | "publish" | "push-tags";

// ---------------- 状态与暂存 ----------------

/** 不在仓库里时返回 null */
export const gitStatus = (dir: string) => invoke<GitStatus | null>("git_status", { dir });
export const gitInit = (dir: string) => invoke<void>("git_init", { dir });
export const gitStage = (root: string, paths: string[]) => invoke<void>("git_stage", { root, paths });
export const gitUnstage = (root: string, paths: string[]) =>
  invoke<void>("git_unstage", { root, paths });
/** 把暂存区里的文件内容直接替换成 content（只暂存一处改动） */
export const gitStageContent = (root: string, path: string, content: string) =>
  invoke<void>("git_stage_content", { root, path, content });
export const gitDiscard = (root: string, paths: string[], untracked: string[]) =>
  invoke<void>("git_discard", { root, paths, untracked });
export const gitCommit = (root: string, message: string, amend: boolean) =>
  invoke<void>("git_commit", { root, message, amend });
export const gitLastMessage = (root: string) => invoke<string>("git_last_message", { root });
/** 撤销上次提交（改动回到暂存区），返回被撤销的提交信息 */
export const gitUndoCommit = (root: string) => invoke<string>("git_undo_commit", { root });
/** rev 为空字符串表示暂存区；文件在该版本中不存在时返回 null */
export const gitShow = (root: string, rev: string, path: string) =>
  invoke<string | null>("git_show", { root, rev, path });
export const gitIgnore = (root: string, patterns: string[]) =>
  invoke<void>("git_ignore", { root, patterns });

// ---------------- 历史 ----------------

/**
 * 提交历史；rev 为空时是当前分支，path 为仓库内相对路径时只列出改动过这个文件的提交，
 * query 不为空时只列出提交信息、作者或哈希匹配的提交
 */
export const gitLog = (
  root: string,
  skip: number,
  limit: number,
  path?: string | null,
  rev?: string | null,
  query?: string | null,
) =>
  invoke<GitCommit[]>("git_log", {
    root,
    skip,
    limit,
    path: path ?? null,
    rev: rev ?? null,
    query: query || null,
  });
export const gitCommitFiles = (root: string, hash: string) =>
  invoke<CommitFile[]>("git_commit_files", { root, hash });
/** content 是编辑器里的当前内容；文件没被跟踪时返回 null */
export const gitBlame = (root: string, path: string, content: string | null) =>
  invoke<Blame | null>("git_blame", { root, path, content });
/** 返回 true 表示有冲突，需要解决后继续 */
export const gitRevert = (root: string, hash: string, isMerge: boolean) =>
  invoke<boolean>("git_revert", { root, hash, isMerge });
export const gitCherryPick = (root: string, hash: string, isMerge: boolean) =>
  invoke<boolean>("git_cherry_pick", { root, hash, isMerge });
export const gitTag = (root: string, name: string, hash: string, message: string | null) =>
  invoke<void>("git_tag", { root, name, hash, message });

// ---------------- 分支 ----------------

export const gitBranches = (root: string) => invoke<Branch[]>("git_branches", { root });
/** create 为 true 时新建分支（start 是起点提交）；track 为 true 时从远程分支新建同名的本地跟踪分支 */
export const gitCheckout = (
  root: string,
  branch: string,
  create: boolean,
  start?: string,
  track?: boolean,
) =>
  invoke<void>("git_checkout", { root, branch, create, start: start ?? null, track: track ?? null });
export const gitBranchDelete = (root: string, name: string, force: boolean) =>
  invoke<void>("git_branch_delete", { root, name, force });
export const gitBranchRename = (root: string, old: string, name: string) =>
  invoke<void>("git_branch_rename", { root, old, new: name });
/** 返回 true 表示有冲突 */
export const gitMerge = (root: string, branch: string) => invoke<boolean>("git_merge", { root, branch });
/** 继续合并/变基等；返回 true 表示又遇到了冲突 */
export const gitOpContinue = (root: string, op: GitOperation, message: string) =>
  invoke<boolean>("git_op_continue", { root, op, message });
export const gitOpAbort = (root: string, op: GitOperation) => invoke<void>("git_op_abort", { root, op });

// ---------------- 储藏 ----------------

export const gitStashList = (root: string) => invoke<Stash[]>("git_stash_list", { root });
export const gitStashPush = (root: string, message: string, untracked: boolean) =>
  invoke<void>("git_stash_push", { root, message, untracked });
export const gitStashApply = (root: string, index: number, pop: boolean) =>
  invoke<void>("git_stash_apply", { root, index, pop });
export const gitStashDrop = (root: string, index: number) =>
  invoke<void>("git_stash_drop", { root, index });

// ---------------- 远程 ----------------

function progressChannel(onProgress: (p: Progress) => void) {
  const channel = new Channel<Progress>();
  channel.onmessage = onProgress;
  return channel;
}

/** id 用于取消（gitCancel） */
export const gitRemote = (root: string, op: RemoteOp, id: number, onProgress: (p: Progress) => void) =>
  invoke<void>("git_remote", { root, op, id, onProgress: progressChannel(onProgress) });
/** 克隆到 parent 下的同名文件夹，返回新文件夹路径 */
export const gitClone = (url: string, parent: string, id: number, onProgress: (p: Progress) => void) =>
  invoke<string>("git_clone", { url, parent, id, onProgress: progressChannel(onProgress) });
export const gitCancel = (id: number) => invoke<void>("git_cancel", { id });
export const gitAskpassReply = (id: number, value: string | null) =>
  invoke<void>("git_askpass_reply", { id, value });
