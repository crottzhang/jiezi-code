import { watch } from "vue";
import { Text, type EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { baseName } from "../api/fs";
import * as gitApi from "../api/git";
import type { GitChange } from "../api/git";
import { diffCompartment, tabId } from "../editor/setup";
import { loadQuickDiff, setQuickDiffClickHandler, setQuickDiffOriginal } from "../editor/quickDiff";
import { absPath, git, relPath, runGit, type Group } from "./git";
import { toast } from "./ui";
import {
  findTab,
  findTabByPath,
  getState,
  openFile,
  updateTabState,
  workspace,
  type Tab,
} from "./workspace";

// 差异视图只在第一次对比时加载
const loadMerge = () => import("@codemirror/merge");

/** 对比的原始版本里用的换行符，只暂存一处改动时按它写回暂存区 */
const originalEol = new Map<number, string>();

const normalize = (text: string) => text.replace(/\r\n?/g, "\n");

// ---------------- 行内对比 ----------------

function controlButton(name: string, label: string, title: string, onMouseDown: (e: MouseEvent) => void) {
  const button = document.createElement("button");
  button.name = name;
  button.textContent = label;
  button.title = title;
  button.onmousedown = onMouseDown;
  return button;
}

async function mergeExtension(tab: Tab, original: string, rev: string) {
  const { unifiedMergeView } = await loadMerge();
  // 历史版本只读，不能还原或暂存
  if (tab.readonly) return unifiedMergeView({ original, mergeControls: false });
  // 只有与暂存区对比时，“暂存这一处”才有意义
  const stageable = rev === "";
  return unifiedMergeView({
    original,
    mergeControls: (type, action) => {
      if (type === "reject") return controlButton("reject", "还原", "把这处更改还原成对比版本的内容", action);
      if (!stageable) {
        const hidden = document.createElement("span");
        hidden.style.display = "none";
        return hidden;
      }
      const button = controlButton("accept", "暂存", "只暂存这一处更改", (e) => {
        e.preventDefault();
        const view = EditorView.findFromDOM(button);
        if (view) stageChunk(view, view.posAtDOM(button));
      });
      return button;
    },
  });
}

async function applyOriginal(tab: Tab, raw: string, rev: string) {
  const { getOriginalDoc } = await loadMerge();
  const original = normalize(raw);
  originalEol.set(tab.id, raw.includes("\r\n") ? "\r\n" : "\n");
  const state = getState(tab.id);
  if (!state) return;
  try {
    // 内容没变就不重建，避免已展开的差异块和滚动位置被重置
    if (tab.diff?.rev === rev && getOriginalDoc(state).toString() === original) return;
  } catch {
    // 还没有进入对比模式
  }
  const extension = await mergeExtension(tab, original, rev);
  // 标签页可能在加载期间被关闭
  if (!findTab(tab.id)) return;
  // 对比模式自带改动标记，行号旁的改动标记先隐藏
  updateTabState(tab.id, {
    effects: [diffCompartment.reconfigure(extension), setQuickDiffOriginal.of(null)],
  });
}

export function closeDiff(id: number) {
  const tab = findTab(id);
  if (!tab?.diff) return;
  tab.diff = null;
  originalEol.delete(id);
  updateTabState(id, { effects: diffCompartment.reconfigure([]) });
  // 重新显示行号旁的改动标记
  quickDiffKeys.delete(id);
  syncQuickDiff();
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
  await applyOriginal(tab, original, rev);
  tab.diff = { rev, rel, label: rev ? "HEAD" : "暂存区" };
}

/** 给标签页显示与指定内容的对比（历史提交里的文件与父提交对比时用） */
export async function applyDiff(tab: Tab, original: string, diff: NonNullable<Tab["diff"]>) {
  await applyOriginal(tab, original, diff.rev);
  tab.diff = diff;
}

// Git 状态变化后（比如暂存了文件、切换了分支）更新对比的原始版本；历史版本不会变
watch(
  () => git.status,
  () => {
    for (const tab of workspace.tabs) {
      if (tab.diff && !tab.readonly) loadDiff(tab, tab.diff.rev, tab.diff.rel);
    }
  },
);

/** 打开文件并显示更改：未暂存的更改与暂存区对比，已暂存的更改与 HEAD 对比 */
export async function openChange(c: GitChange, group: Group) {
  const path = absPath(c.path);
  const deleted = group === "staged" ? c.index === "D" : c.worktree === "D";
  if (deleted) {
    toast(`“${baseName(c.path)}”已被删除`, { kind: "info" });
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

/** 在对比视图里跳到上一处/下一处更改 */
export async function goToChunk(direction: 1 | -1, view: EditorView | null) {
  if (!view) return;
  const { goToNextChunk, goToPreviousChunk } = await loadMerge();
  (direction > 0 ? goToNextChunk : goToPreviousChunk)(view);
  view.focus();
}

// ---------------- 只暂存一处改动 ----------------

/**
 * 只暂存 pos 所在的那一处改动后，暂存区里文件的新内容 = 原始版本应用上这一处改动。
 * 算法和 @codemirror/merge 的 acceptChunk 一致。pos 不在任何改动上时返回 null
 */
export async function contentWithChunk(state: EditorState, pos: number, eol: string) {
  const { getChunks, getOriginalDoc } = await loadMerge();
  const chunk = getChunks(state)?.chunks.find((ch) => ch.fromB <= pos && ch.endB >= pos);
  if (!chunk) return null;
  const orig = getOriginalDoc(state);
  let insert = state.sliceDoc(chunk.fromB, Math.max(chunk.fromB, chunk.toB - 1));
  if (chunk.fromB !== chunk.toB && chunk.toA <= orig.length) insert += "\n";
  const next = orig.replace(chunk.fromA, Math.min(orig.length, chunk.toA), Text.of(insert.split("\n")));
  return next.sliceString(0, next.length, eol);
}

async function stageChunk(view: EditorView, pos: number) {
  const tab = findTab(view.state.facet(tabId));
  const diff = tab?.diff;
  if (!tab || !diff || diff.rev !== "") return;
  const content = await contentWithChunk(view.state, pos, originalEol.get(tab.id) ?? "\n");
  if (content == null) return;
  // 暂存区变化后状态刷新，对比的原始版本会自动更新，这一处就从差异里消失了
  await runGit((root) => gitApi.gitStageContent(root, diff.rel, content));
}

// ---------------- 行号旁的改动标记 ----------------

/** 标签页 → 上次读取暂存区版本时的依据；依据没变就不用重新读取 */
const quickDiffKeys = new Map<number, string>();

async function setQuickDiff(tab: Tab, original: string | null) {
  if (original != null) await loadQuickDiff();
  if (!findTab(tab.id)) return;
  const text = original == null ? null : Text.of(normalize(original).split("\n"));
  updateTabState(tab.id, { effects: setQuickDiffOriginal.of(text) });
}

function syncQuickDiff() {
  const status = git.status;
  const byPath = new Map(status?.changes.map((c) => [c.path, c]) ?? []);
  for (const tab of workspace.tabs) {
    if (tab.readonly) continue;
    const rel = status ? relPath(tab.path) : null;
    const change = rel ? byPath.get(rel) : undefined;
    // 不在仓库里、未跟踪、正在对比的文件不显示
    if (!status || !rel || tab.diff || change?.worktree === "?") {
      if (quickDiffKeys.get(tab.id) !== "none") {
        quickDiffKeys.set(tab.id, "none");
        setQuickDiff(tab, null);
      }
      continue;
    }
    // 暂存区里这个文件的内容只会随状态字母、暂存区哈希、HEAD 变化
    const key = `${rel}|${change ? change.index + change.worktree + change.indexHash : "clean"}|${status.head}`;
    if (quickDiffKeys.get(tab.id) === key) continue;
    quickDiffKeys.set(tab.id, key);
    gitApi
      .gitShow(status.root, "", rel)
      .then((original) => {
        if (quickDiffKeys.get(tab.id) === key) setQuickDiff(tab, original);
      })
      .catch(() => {
        // 二进制文件等，不显示标记
      });
  }
  for (const id of quickDiffKeys.keys()) if (!findTab(id)) quickDiffKeys.delete(id);
}

watch(() => git.status, syncQuickDiff);
watch(() => workspace.tabs.map((t) => t.id).join(), syncQuickDiff);

// 点击改动标记：进入与暂存区的对比，并定位到这一处
setQuickDiffClickHandler((view, pos) => {
  const tab = findTab(view.state.facet(tabId));
  const rel = tab && relPath(tab.path);
  if (!tab || !rel) return;
  loadDiff(tab, "", rel).then(() => {
    view.dispatch({ selection: { anchor: Math.min(pos, view.state.doc.length) }, scrollIntoView: true });
    view.focus();
  });
});
