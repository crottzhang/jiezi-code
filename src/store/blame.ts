import { watch } from "vue";
import * as gitApi from "../api/git";
import type { BlameCommit } from "../api/git";
import { requestBlame, setBlame, setBlameRequester, type LineBlame } from "../editor/blame";
import { tabId } from "../editor/setup";
import { getEditorView } from "../editor/view";
import { formatTime, relativeTime } from "../utils/time";
import { git, relPath } from "./git";
import { layout } from "./layout";
import { findTab, updateTabState, workspace } from "./workspace";

const UNCOMMITTED: LineBlame = { text: "你 · 尚未提交", title: "这一行的改动还没有提交" };

function describe(c: BlameCommit): LineBlame {
  if (c.uncommitted) return UNCOMMITTED;
  return {
    text: `${c.author}，${relativeTime(c.time)} · ${c.summary}`,
    title: `${c.hash.slice(0, 7)} · ${c.author} · ${formatTime(c.time)}\n${c.summary}`,
  };
}

setBlameRequester(async (view) => {
  const state = view.state;
  const tab = findTab(state.facet(tabId));
  const status = git.status;
  if (!layout.blame || !tab || tab.readonly || !status) return;
  const rel = relPath(tab.path);
  // 未跟踪的文件没有历史
  if (!rel || status.changes.some((c) => c.path === rel && c.worktree === "?")) return;
  const doc = state.doc;
  // 按文件保存时的换行符传给 git，否则仓库里存的是 CRLF 时每一行都会被当成改动
  const content = doc.sliceString(0, doc.length, tab.eol === "CRLF" ? "\r\n" : "\n");
  let result;
  try {
    result = await gitApi.gitBlame(status.root, rel, content);
  } catch {
    return; // 二进制文件等，不显示
  }
  if (!result || !findTab(tab.id)) return;
  const described = result.commits.map(describe);
  const lines = Array.from({ length: doc.lines }, (_, i) => {
    const index = result.lines[i];
    return index == null ? null : described[index];
  });
  // 读取期间又编辑了的话，setBlame 会因为文档对不上而被忽略，编辑停顿后会重新读取
  updateTabState(tab.id, { effects: setBlame.of({ doc, lines }) });
});

// 提交、切换分支后作者信息会变
watch(
  () => git.status?.head,
  () => {
    const view = getEditorView();
    if (view && layout.blame) requestBlame(view);
  },
);

// 关闭时清掉所有标签页里的作者信息，打开时读取当前文件
watch(
  () => layout.blame,
  (on) => {
    if (on) {
      const view = getEditorView();
      if (view) requestBlame(view);
      return;
    }
    for (const tab of workspace.tabs) updateTabState(tab.id, { effects: setBlame.of(null) });
  },
);
