import { computed, reactive, watch } from "vue";
import { ask, message } from "@tauri-apps/plugin-dialog";
import { baseName, dirName, joinPath } from "../api/fs";
import * as gitApi from "../api/git";
import type { GitChange, GitStatus, RemoteOp } from "../api/git";
import { diffCompartment } from "../editor/setup";
import { openPicker, promptInput, toast } from "./ui";
import {
  findTab,
  findTabByPath,
  getState,
  openFile,
  refreshDir,
  refreshTree,
  reloadCleanTabs,
  saveAll,
  updateTabState,
  workspace,
  type Tab,
} from "./workspace";

/** 窗口在前台时每隔这么久查询一次状态，用来发现终端里执行的 git 命令 */
const POLL_INTERVAL = 5000;

export const git = reactive({
  /** null 表示没有打开文件夹或不是 Git 仓库 */
  status: null as GitStatus | null,
  /** 第一次查询完成前为 false，用来区分“正在加载”和“不是仓库” */
  loaded: false,
  /** 正在执行的 git 操作数 */
  busy: 0,
  /** 提交信息草稿 */
  message: "",
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

/** 仓库内相对路径转成绝对路径 */
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
let refreshing = false;
/** 轮询时同样的错误只提示一次 */
let lastError = "";

export async function refreshGit() {
  const dir = workspace.root;
  const seq = ++refreshSeq;
  if (!dir) {
    git.status = null;
    git.loaded = true;
    return;
  }
  refreshing = true;
  try {
    const status = await gitApi.gitStatus(dir);
    if (seq !== refreshSeq) return;
    // 仓库根目录就是打开的文件夹时沿用文件夹路径的写法，保证路径和资源管理器、标签页一致
    if (status && status.root.toLowerCase() === dir.toLowerCase()) status.root = dir;
    // 没有变化时不替换，避免列表和文件树无意义地重新渲染
    if (JSON.stringify(status) !== JSON.stringify(git.status)) git.status = status;
    lastError = "";
  } catch (e) {
    if (seq !== refreshSeq) return;
    git.status = null;
    if (String(e) !== lastError) toast(e);
    lastError = String(e);
  } finally {
    if (seq === refreshSeq) {
      refreshing = false;
      git.loaded = true;
    }
  }
  refreshDiffs();
}

let timer: ReturnType<typeof setTimeout> | undefined;

export function scheduleRefresh(delay = 300) {
  clearTimeout(timer);
  timer = setTimeout(refreshGit, delay);
}

watch(
  () => workspace.root,
  () => {
    git.status = null;
    git.loaded = false;
    git.message = "";
    refreshGit();
  },
  { immediate: true },
);

watch(() => workspace.fsVersion, () => scheduleRefresh());

window.addEventListener("focus", () => scheduleRefresh(0));
setInterval(() => {
  if (document.hasFocus() && !refreshing && git.busy === 0) refreshGit();
}, POLL_INTERVAL);

// ---------------- 操作 ----------------

// git 操作排队执行，避免连续点击时抢 index.lock
let queue: Promise<unknown> = Promise.resolve();

/** 执行 git 操作，成功返回 true；失败时弹出错误。changesFiles 表示操作会改动工作区的文件 */
function run(fn: (root: string) => Promise<unknown>, changesFiles = false): Promise<boolean> {
  const root = git.status?.root;
  if (!root) return Promise.resolve(false);
  git.busy++;
  const task = queue.then(async () => {
    try {
      await fn(root);
      return true;
    } catch (e) {
      toast(e);
      return false;
    } finally {
      if (changesFiles) {
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
  changes.length ? run((root) => gitApi.gitStage(root, pathsOf(changes))) : Promise.resolve(false);

export const unstage = (changes: GitChange[]) =>
  changes.length ? run((root) => gitApi.gitUnstage(root, pathsOf(changes))) : Promise.resolve(false);

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
  const done = await run(
    (root) =>
      gitApi.gitDiscard(
        root,
        tracked.map((c) => c.path),
        untracked.map((c) => c.path),
      ),
    true,
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

export async function commit(amend = false) {
  if (!git.status || git.busy) return;
  const text = git.message.trim();
  if (!text && !amend) {
    toast("请输入提交信息");
    return;
  }
  if (!(await saveBeforeCommit())) return;
  const { merge, staged, changes } = groups.value;
  if (merge.length) {
    toast("请先解决合并冲突，并暂存解决后的文件");
    return;
  }
  let toStage: GitChange[] = [];
  if (!staged.length && !amend) {
    if (!changes.length) {
      toast("没有可提交的更改");
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
  const done = await run(async (root) => {
    if (toStage.length) await gitApi.gitStage(root, pathsOf(toStage));
    await gitApi.gitCommit(root, text, amend);
  });
  if (done) git.message = "";
}

export const remote = (op: RemoteOp) => run((root) => gitApi.gitRemote(root, op), op === "pull");

/** 同步：先拉取再推送；还没有上游分支时发布当前分支 */
export async function sync() {
  const status = git.status;
  if (!status?.branch) return;
  if (!status.upstream) {
    await remote("publish");
    return;
  }
  await run(async (root) => {
    await gitApi.gitRemote(root, "pull");
    await gitApi.gitRemote(root, "push");
  }, true);
}

export async function initRepo() {
  const dir = workspace.root;
  if (!dir) return;
  try {
    await gitApi.gitInit(dir);
  } catch (e) {
    toast(e);
  }
  await refreshGit();
}

// ---------------- 分支 ----------------

async function checkout(branch: string, create: boolean, start?: string) {
  await run((root) => gitApi.gitCheckout(root, branch, create, start), true);
}

/** 以某个提交为起点新建分支并切换过去 */
export async function createBranchAt(hash: string, short: string) {
  const name = (await promptInput(`新分支名称（基于 ${short}）`))?.trim();
  if (name) await checkout(name, true, hash);
}

export async function pickBranch() {
  const status = git.status;
  if (!status) return;
  let branches: string[];
  try {
    branches = await gitApi.gitBranches(status.root);
  } catch (e) {
    toast(e);
    return;
  }
  openPicker("选择要切换到的分支", [
    {
      label: "＋ 新建分支…",
      run: async () => {
        const name = (await promptInput("新分支名称（基于当前提交）"))?.trim();
        if (name) await checkout(name, true);
      },
    },
    ...branches.map((b) => ({
      label: b,
      detail: b === status.branch ? "当前分支" : undefined,
      run: () => {
        if (b !== git.status?.branch) checkout(b, false);
      },
    })),
  ]);
}

// ---------------- 对比 ----------------

// 差异视图只在第一次对比时加载
const loadMerge = () => import("@codemirror/merge");

/** revertable 为 false 时不显示“还原”按钮（只读的历史版本） */
async function mergeExtension(original: string, revertable = true) {
  const { unifiedMergeView } = await loadMerge();
  if (!revertable) return unifiedMergeView({ original, mergeControls: false });
  return unifiedMergeView({
    original,
    // 只保留“还原”按钮；“接受”只会改内存里的原始版本，对用户没有意义
    mergeControls: (type, action) => {
      const button = document.createElement("button");
      if (type === "accept") {
        button.style.display = "none";
        return button;
      }
      button.name = "reject";
      button.textContent = "还原";
      button.title = "把这处更改还原成对比版本的内容";
      button.onmousedown = action;
      return button;
    },
  });
}

async function applyOriginal(tab: Tab, original: string) {
  const { getOriginalDoc } = await loadMerge();
  original = original.replace(/\r\n?/g, "\n");
  const state = getState(tab.id);
  if (!state) return;
  try {
    // 内容没变就不重建，避免已展开的差异块和滚动位置被重置
    if (tab.diff && getOriginalDoc(state).toString() === original) return;
  } catch {
    // 还没有进入对比模式
  }
  const extension = await mergeExtension(original, !tab.readonly);
  // 标签页可能在加载期间被关闭
  if (findTab(tab.id)) updateTabState(tab.id, { effects: diffCompartment.reconfigure(extension) });
}

export function closeDiff(id: number) {
  const tab = findTab(id);
  if (!tab?.diff) return;
  tab.diff = null;
  updateTabState(id, { effects: diffCompartment.reconfigure([]) });
}

async function loadDiff(tab: Tab, rev: string, rel: string) {
  const root = git.status?.root;
  if (!root) return;
  let original: string | null;
  try {
    original = await gitApi.gitShow(root, rev, rel);
  } catch (e) {
    toast(e);
    return;
  }
  // 标签页可能在等待期间被关闭
  if (!findTab(tab.id)) return;
  if (original == null) {
    closeDiff(tab.id);
    return;
  }
  await applyOriginal(tab, original);
  tab.diff = { rev, rel, label: rev ? "HEAD" : "暂存区" };
}

/** 给标签页显示与指定内容的对比（历史提交里的文件与父提交对比时用） */
export async function applyDiff(tab: Tab, original: string, diff: NonNullable<Tab["diff"]>) {
  await applyOriginal(tab, original);
  tab.diff = diff;
}

/** Git 状态变化后（比如暂存了文件）更新对比的原始版本 */
function refreshDiffs() {
  for (const tab of workspace.tabs) {
    // 历史版本不会变，不用重新读取
    if (tab.diff && !tab.readonly) loadDiff(tab, tab.diff.rev, tab.diff.rel);
  }
}

/** 打开文件并显示更改：未暂存的更改与暂存区对比，已暂存的更改与 HEAD 对比 */
export async function openChange(c: GitChange, group: Group) {
  const path = absPath(c.path);
  const deleted = group === "staged" ? c.index === "D" : c.worktree === "D";
  if (deleted) {
    toast(`“${baseName(c.path)}”已被删除`);
    return;
  }
  await openFile(path);
  const tab = findTabByPath(path);
  if (!tab) return;
  // 冲突文件直接看冲突标记；新文件没有可以对比的版本
  if (group === "merge" || c.worktree === "?" || (group === "staged" && c.index === "A")) {
    closeDiff(tab.id);
    return;
  }
  // 已暂存的重命名要用原路径去 HEAD 里取旧版本
  const staged = group === "staged";
  await loadDiff(tab, staged ? "HEAD" : "", staged && c.origPath ? c.origPath : c.path);
}

export async function openChangeFile(c: GitChange) {
  const path = absPath(c.path);
  await openFile(path);
  const tab = findTabByPath(path);
  if (tab) closeDiff(tab.id);
}
