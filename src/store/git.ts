import { computed, reactive, watch } from "vue";
import { listen } from "@tauri-apps/api/event";
import { ask, message, open } from "@tauri-apps/plugin-dialog";
import { baseName, dirName, fsWatch, joinPath, type FsChange } from "../api/fs";
import * as gitApi from "../api/git";
import type { GitChange, GitOperation, GitStatus, Progress, RemoteOp } from "../api/git";
import { showOutput, watchOutputDir } from "./output";
import { promptInput, toast } from "./ui";
import {
  openFolder,
  openFolderInNewWindow,
  refreshDir,
  refreshTree,
  reloadCleanTabs,
  saveAll,
  workspace,
} from "./workspace";

export const git = reactive({
  /** null 表示没有打开文件夹或不是 Git 仓库 */
  status: null as GitStatus | null,
  /** 第一次查询完成前为 false，用来区分“正在加载”和“不是仓库” */
  loaded: false,
  /** 正在执行的 git 操作数 */
  busy: 0,
  /** 提交信息草稿 */
  message: "",
  /** 修改上次提交模式：输入框里是上次的提交信息，提交按钮变成“修改上次提交” */
  amend: false,
  /** 正在进行的远程操作（拉取、推送、克隆……），可以取消 */
  progress: null as null | { id: number; label: string; phase: string; percent: number | null },
});

export type Group = "merge" | "staged" | "changes";
export type Kind = "added" | "modified" | "deleted" | "renamed" | "untracked" | "conflict";

export const groups = computed(() => {
  const merge: GitChange[] = [];
  const staged: GitChange[] = [];
  const changes: GitChange[] = [];
  for (const c of git.status?.changes ?? []) {
    if (c.conflict) {
      merge.push(c);
      continue;
    }
    if (c.index !== ".") staged.push(c);
    if (c.worktree !== ".") changes.push(c);
  }
  return { merge, staged, changes };
});

/** 更改总数（同一个文件既有暂存又有未暂存的修改时只算一次） */
export const changeCount = computed(() => git.status?.changes.length ?? 0);

/** 某个文件在某个分组里显示的状态字母 */
export function statusLetter(c: GitChange, group: Group) {
  if (group === "merge") return "!";
  const s = group === "staged" ? c.index : c.worktree;
  return s === "?" ? "U" : s;
}

const KINDS: Record<string, Kind> = {
  M: "modified",
  T: "modified",
  A: "added",
  U: "untracked",
  D: "deleted",
  R: "renamed",
  C: "renamed",
  "!": "conflict",
};

const LABELS: Record<string, string> = {
  M: "已修改",
  T: "类型已更改",
  A: "已添加",
  U: "未跟踪",
  D: "已删除",
  R: "已重命名",
  C: "已复制",
  "!": "冲突",
};

export const kindOf = (letter: string) => KINDS[letter] ?? "modified";
export const describeStatus = (letter: string) => LABELS[letter] ?? letter;

export const OPERATION_LABELS: Record<GitOperation, string> = {
  merge: "合并",
  rebase: "变基",
  "cherry-pick": "拣选提交",
  revert: "还原提交",
};

/** 绝对路径转成仓库内的相对路径（分隔符 /），不在仓库里时返回 null */
export function relPath(path: string) {
  const root = git.status?.root;
  if (!root) return null;
  const base = root.replace(/[\\/]+$/, "");
  const sep = path[base.length];
  if (!path.toLowerCase().startsWith(base.toLowerCase()) || (sep !== "\\" && sep !== "/")) {
    return null;
  }
  return path.slice(base.length + 1).replace(/\\/g, "/");
}

/** 仓库内相对路径转成绝对路径 */
export function absPath(rel: string) {
  const root = git.status!.root;
  return joinPath(root, root.includes("\\") ? rel.replace(/\//g, "\\") : rel);
}

// ---------------- 资源管理器里的文件着色 ----------------

const RANK: Record<Kind, number> = {
  conflict: 5,
  modified: 4,
  deleted: 3,
  renamed: 2,
  added: 1,
  untracked: 1,
};

/** 小写绝对路径 → 状态。文件夹取其中最“严重”的状态 */
export const decorations = computed(() => {
  const map = new Map<string, Kind>();
  const status = git.status;
  if (!status) return map;
  const rootLen = status.root.length;
  for (const c of status.changes) {
    const letter = c.conflict ? "!" : c.worktree === "?" ? "U" : c.index !== "." ? c.index : c.worktree;
    const kind = kindOf(letter);
    let path = absPath(c.path).toLowerCase();
    map.set(path, kind);
    // 往上标记所属文件夹；遇到已经有同级或更高状态的文件夹，它的上级也一定有，可以停下
    while ((path = dirName(path)).length > rootLen) {
      const existing = map.get(path);
      if (existing && RANK[existing] >= RANK[kind]) break;
      map.set(path, kind);
    }
  }
  return map;
});

export const decorationOf = (path: string) => decorations.value.get(path.toLowerCase());

// ---------------- 刷新 ----------------

let refreshSeq = 0;
/** 同样的错误只提示一次 */
let lastError = "";

export async function refreshGit() {
  const dir = workspace.root;
  const seq = ++refreshSeq;
  if (!dir) {
    git.status = null;
    git.loaded = true;
    return;
  }
  try {
    const status = await gitApi.gitStatus(dir);
    if (seq !== refreshSeq) return;
    // 仓库根目录就是打开的文件夹时沿用文件夹路径的写法，保证路径和资源管理器、标签页一致
    if (status && status.root.toLowerCase() === dir.toLowerCase()) status.root = dir;
    // 没有变化时不替换，避免列表、文件树、对比视图无意义地刷新
    if (JSON.stringify(status) !== JSON.stringify(git.status)) git.status = status;
    lastError = "";
  } catch (e) {
    if (seq !== refreshSeq) return;
    git.status = null;
    if (String(e) !== lastError) toast(e);
    lastError = String(e);
  } finally {
    if (seq === refreshSeq) git.loaded = true;
  }
}

let timer: ReturnType<typeof setTimeout> | undefined;

/** 稍后刷新一次。连续触发时不会一直往后推（构建时文件一直在变），而是最多每 delay 毫秒刷新一次 */
export function scheduleRefresh(delay = 300) {
  if (timer) return;
  timer = setTimeout(() => {
    timer = undefined;
    refreshGit();
  }, delay);
}

watch(
  () => workspace.root,
  () => {
    git.status = null;
    git.loaded = false;
    git.message = "";
    git.amend = false;
    refreshGit();
  },
  { immediate: true },
);

// 应用内的保存、新建、删除等操作
watch(() => workspace.fsVersion, () => scheduleRefresh());
// 从别的程序切回来
window.addEventListener("focus", () => scheduleRefresh(0));

// 监听文件夹（以及在文件夹之外的 .git 目录），外部改动时刷新文件树、已打开的文件和 Git 状态
watch(
  () => [workspace.root, git.status?.gitDir] as const,
  ([root, gitDir]) => {
    fsWatch(root, gitDir).catch((e) => toast(`无法监听文件变化：${e}`));
  },
  { immediate: true },
);

listen<FsChange>("fs-changed", ({ payload: c }) => {
  if (c.all) {
    // 改动太多（切换分支、构建等），整体刷新
    refreshTree();
    reloadCleanTabs();
  } else {
    for (const dir of c.dirs) refreshDir(dir, false);
    if (c.files.length) reloadCleanTabs(c.files);
  }
  if (c.git) scheduleRefresh();
});

// ---------------- 操作 ----------------

// git 操作排队执行，避免连续点击时抢 index.lock
let queue: Promise<unknown> = Promise.resolve();

function showError(e: unknown) {
  if (String(e) === "已取消") toast("已取消", { kind: "info" });
  else toast(e, { action: { label: "查看输出", run: showOutput } });
}

/**
 * 执行 git 操作，成功返回 true；失败时弹出错误。
 * changesFiles 表示操作会改动工作区的文件（切换分支、拉取等），完成后刷新文件树和已打开的文件
 */
export function runGit(
  fn: (root: string) => Promise<unknown>,
  options: { changesFiles?: boolean } = {},
): Promise<boolean> {
  const root = git.status?.root;
  if (!root) return Promise.resolve(false);
  git.busy++;
  const task = queue.then(async () => {
    try {
      await fn(root);
      return true;
    } catch (e) {
      showError(e);
      return false;
    } finally {
      if (options.changesFiles) {
        await reloadCleanTabs();
        refreshTree();
      }
      git.busy--;
      await refreshGit();
    }
  });
  queue = task;
  return task;
}

/** 暂存时要连同重命名前的路径一起处理，否则只会处理新路径 */
const pathsOf = (changes: GitChange[]) =>
  changes.flatMap((c) => (c.origPath ? [c.path, c.origPath] : [c.path]));

export const stage = (changes: GitChange[]) =>
  changes.length ? runGit((root) => gitApi.gitStage(root, pathsOf(changes))) : Promise.resolve(false);

export const unstage = (changes: GitChange[]) =>
  changes.length ? runGit((root) => gitApi.gitUnstage(root, pathsOf(changes))) : Promise.resolve(false);

export async function discard(changes: GitChange[]) {
  if (!changes.length) return;
  const untracked = changes.filter((c) => c.worktree === "?");
  const tracked = changes.filter((c) => c.worktree !== "?");
  const name = baseName(changes[0].path);
  const text =
    changes.length > 1
      ? `确定要放弃 ${changes.length} 个文件的更改吗？` +
        (untracked.length ? `\n其中 ${untracked.length} 个未跟踪的文件会被移到回收站。` : "")
      : untracked.length
        ? `确定要删除未跟踪的文件“${name}”吗？\n它会被移到回收站。`
        : `确定要放弃对“${name}”的更改吗？`;
  const ok = await ask(`${text}\n此操作无法通过 Git 撤销。`, {
    title: "放弃更改",
    kind: "warning",
    okLabel: "放弃更改",
    cancelLabel: "取消",
  });
  if (!ok) return;
  const done = await runGit(
    (root) =>
      gitApi.gitDiscard(
        root,
        tracked.map((c) => c.path),
        untracked.map((c) => c.path),
      ),
    { changesFiles: true },
  );
  if (done) for (const c of untracked) refreshDir(dirName(absPath(c.path)));
}

/** 提交前处理未保存的文件，返回 false 表示用户取消 */
async function saveBeforeCommit() {
  if (!workspace.tabs.some((t) => t.dirty)) return true;
  const choice = await message("有未保存的文件，是否先保存再提交？", {
    title: "提交",
    kind: "warning",
    buttons: { yes: "保存并提交", no: "直接提交", cancel: "取消" },
  });
  if (choice === "保存并提交") {
    await saveAll();
    await refreshGit();
    return !workspace.tabs.some((t) => t.dirty);
  }
  return choice === "直接提交";
}

/** 提交之后顺便做的事 */
export type AfterCommit = "none" | "push" | "sync";

export async function commit(after: AfterCommit = "none") {
  const status = git.status;
  if (!status || git.busy) return;
  // 合并、变基等进行中时，提交按钮就是“继续”
  if (status.operation) {
    await continueOperation();
    return;
  }
  const amend = git.amend;
  const text = git.message.trim();
  if (!text && !amend) {
    toast("请输入提交信息", { kind: "info" });
    return;
  }
  if (!(await saveBeforeCommit())) return;
  const { merge, staged, changes } = groups.value;
  if (merge.length) {
    toast("请先解决合并冲突，并暂存解决后的文件", { kind: "info" });
    return;
  }
  let toStage: GitChange[] = [];
  if (!staged.length && !amend) {
    if (!changes.length) {
      toast("没有可提交的更改", { kind: "info" });
      return;
    }
    const ok = await ask("没有暂存的更改。是否暂存所有更改并直接提交？", {
      title: "提交",
      kind: "info",
      okLabel: "全部暂存并提交",
      cancelLabel: "取消",
    });
    if (!ok) return;
    toStage = changes;
  }
  const done = await runGit(async (root) => {
    if (toStage.length) await gitApi.gitStage(root, pathsOf(toStage));
    await gitApi.gitCommit(root, text, amend);
  });
  if (!done) return;
  git.message = "";
  git.amend = false;
  if (after === "push") await remote(git.status?.upstream ? "push" : "publish");
  else if (after === "sync") await sync();
}

/** 进入“修改上次提交”模式，把上次的提交信息填进输入框 */
export async function startAmend() {
  const status = git.status;
  if (!status?.head) {
    toast("还没有任何提交", { kind: "info" });
    return;
  }
  try {
    git.message = await gitApi.gitLastMessage(status.root);
    git.amend = true;
  } catch (e) {
    showError(e);
  }
}

export function cancelAmend() {
  git.amend = false;
  git.message = "";
}

/** 撤销上一次提交：改动回到暂存区，提交信息放回输入框 */
export async function undoLastCommit() {
  const status = git.status;
  if (!status?.head) {
    toast("还没有任何提交", { kind: "info" });
    return;
  }
  // 有上游且不领先，说明上一次提交已经在远程了
  const pushed = !!status.upstream && status.ahead === 0;
  const ok = await ask(
    pushed
      ? "上一次提交已经推送到远程。撤销后本地会落后于远程，重新提交后需要强制推送才能同步。\n确定要撤销吗？"
      : "撤销上一次提交？提交里的改动会回到暂存区，不会丢失。",
    { title: "撤销上次提交", kind: pushed ? "warning" : "info", okLabel: "撤销提交", cancelLabel: "取消" },
  );
  if (!ok) return;
  let undone = "";
  const done = await runGit(async (root) => {
    undone = await gitApi.gitUndoCommit(root);
  });
  if (done && !git.message.trim()) git.message = undone;
}

/** 把文件或文件夹加入仓库根目录的 .gitignore */
export async function addToGitignore(path: string, isDir: boolean) {
  const rel = relPath(path);
  if (!rel) {
    toast("这个文件不在 Git 仓库中");
    return;
  }
  await runGit((root) => gitApi.gitIgnore(root, [`/${rel}${isDir ? "/" : ""}`]));
}

// ---------------- 合并、变基等进行中的操作 ----------------

export async function continueOperation() {
  const op = git.status?.operation;
  if (!op) return;
  if (groups.value.merge.length) {
    toast("还有未解决的冲突。解决后暂存这些文件，再继续。", { kind: "info" });
    return;
  }
  if (!(await saveBeforeCommit())) return;
  let again = false;
  const done = await runGit(
    async (root) => {
      again = await gitApi.gitOpContinue(root, op, git.message.trim());
    },
    { changesFiles: true },
  );
  if (!done) return;
  git.message = "";
  if (again) toast(`${OPERATION_LABELS[op]}的下一步又遇到了冲突，请解决后继续`, { kind: "info" });
}

export async function abortOperation() {
  const op = git.status?.operation;
  if (!op) return;
  const ok = await ask(`确定要中止${OPERATION_LABELS[op]}吗？\n工作区会恢复到开始之前的状态。`, {
    title: `中止${OPERATION_LABELS[op]}`,
    kind: "warning",
    okLabel: "中止",
    cancelLabel: "取消",
  });
  if (ok) await runGit((root) => gitApi.gitOpAbort(root, op), { changesFiles: true });
}

// ---------------- 远程 ----------------

let opSeq = 0;

const REMOTE_LABELS: Record<RemoteOp, string> = {
  pull: "拉取",
  push: "推送",
  fetch: "抓取",
  publish: "发布分支",
  "push-tags": "推送标签",
};

function trackProgress(label: string) {
  const id = ++opSeq;
  git.progress = { id, label, phase: "", percent: null };
  const onProgress = (p: Progress) => {
    if (git.progress?.id !== id) return;
    git.progress.phase = p.phase;
    git.progress.percent = p.percent;
  };
  const done = () => {
    if (git.progress?.id === id) git.progress = null;
  };
  return { id, onProgress, done };
}

async function remoteStep(root: string, op: RemoteOp) {
  const p = trackProgress(REMOTE_LABELS[op]);
  try {
    await gitApi.gitRemote(root, op, p.id, p.onProgress);
  } finally {
    p.done();
  }
}

export const remote = (op: RemoteOp) =>
  runGit((root) => remoteStep(root, op), { changesFiles: op === "pull" });

/** 同步：先拉取再推送；还没有上游分支时发布当前分支 */
export async function sync() {
  const status = git.status;
  if (!status?.branch) return;
  if (!status.upstream) {
    await remote("publish");
    return;
  }
  await runGit(
    async (root) => {
      await remoteStep(root, "pull");
      await remoteStep(root, "push");
    },
    { changesFiles: true },
  );
}

export function cancelRemote() {
  if (git.progress) gitApi.gitCancel(git.progress.id);
}

// 远程操作需要账号密码时，后端通过 askpass 让这里弹出输入框
listen<{ id: number; prompt: string; secret: boolean }>("git-askpass", async ({ payload }) => {
  const value = await promptInput(payload.prompt.trim(), "", { secret: payload.secret });
  gitApi.gitAskpassReply(payload.id, value);
});

export async function initRepo() {
  const dir = workspace.root;
  if (!dir) return;
  try {
    await gitApi.gitInit(dir);
  } catch (e) {
    showError(e);
  }
  await refreshGit();
}

/** 克隆仓库：输入地址、选择父文件夹，完成后询问是否打开 */
export async function cloneRepo() {
  const url = (
    await promptInput("要克隆的仓库地址", "", { placeholder: "https://github.com/用户名/仓库.git" })
  )?.trim();
  if (!url) return;
  const parent = await open({ directory: true, title: "选择克隆到哪个文件夹下" });
  if (typeof parent !== "string") return;
  watchOutputDir(parent);
  const p = trackProgress("克隆");
  git.busy++;
  let target: string;
  try {
    target = await gitApi.gitClone(url, parent, p.id, p.onProgress);
  } catch (e) {
    showError(e);
    return;
  } finally {
    p.done();
    git.busy--;
  }
  const choice = await message(`已克隆到 ${target}`, {
    title: "克隆完成",
    kind: "info",
    buttons: { yes: "打开", no: "在新窗口打开", cancel: "暂不打开" },
  });
  if (choice === "打开") await openFolder(target);
  else if (choice === "在新窗口打开") await openFolderInNewWindow(target);
}
