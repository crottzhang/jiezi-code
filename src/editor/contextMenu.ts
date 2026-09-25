import { selectAll, toggleComment } from "@codemirror/commands";
import { openSearchPanel } from "@codemirror/search";
import type { EditorView } from "@codemirror/view";
import { closeDiff, goToChunk } from "../store/diff";
import { git, relPath } from "../store/git";
import { showFileHistory } from "../store/history";
import { openPalette, SEPARATOR, showMenu, toast, type MenuItem } from "../store/ui";
import { isMarkdownFile, isSvgFile, previewImage, previewMarkdown, type Tab } from "../store/workspace";

/** 选中的文本，多处选区按换行拼接（和 CodeMirror 自己复制时一致） */
function selectedText(view: EditorView) {
  const { state } = view;
  return state.selection.ranges
    .filter((r) => !r.empty)
    .map((r) => state.sliceDoc(r.from, r.to))
    .join(state.lineBreak);
}

async function copy(view: EditorView) {
  await navigator.clipboard.writeText(selectedText(view)).catch(toast);
}

async function cut(view: EditorView) {
  try {
    await navigator.clipboard.writeText(selectedText(view));
  } catch (e) {
    toast(e);
    return;
  }
  view.dispatch(view.state.replaceSelection(""), { userEvent: "delete.cut", scrollIntoView: true });
}

async function paste(view: EditorView) {
  let text: string;
  try {
    text = await navigator.clipboard.readText();
  } catch {
    return; // 剪贴板不可读时忽略
  }
  if (!text || view.state.readOnly) return;
  view.dispatch(view.state.replaceSelection(text), { userEvent: "input.paste", scrollIntoView: true });
}

/** 右键点在选区之外时，先把光标移到点击处（和 VS Code 一致），菜单里的命令才作用于这里 */
function moveCursorTo(view: EditorView, e: MouseEvent) {
  if (!(e.target as Element).closest(".cm-content")) return;
  const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
  if (pos == null) return;
  if (view.state.selection.ranges.some((r) => r.from <= pos && pos <= r.to && !r.empty)) return;
  view.dispatch({ selection: { anchor: pos } });
}

/**
 * 编辑器的右键菜单，替代 WebView 自带的菜单。
 * tab 是这个编辑器对应的标签页；左右对比时左边的原始版本不对应标签页，传 undefined
 */
export function showEditorMenu(e: MouseEvent, view: EditorView, tab?: Tab) {
  moveCursorTo(view, e);
  const readOnly = view.state.readOnly;
  const empty = view.state.selection.ranges.every((r) => r.empty);
  // 执行前把焦点还给编辑器：点菜单时焦点已经离开了
  const run = (fn: (view: EditorView) => unknown) => () => {
    view.focus();
    fn(view);
  };

  const items: MenuItem[] = [
    { label: "剪切", keys: "Ctrl+X", disabled: readOnly || empty, action: run(cut) },
    { label: "复制", keys: "Ctrl+C", disabled: empty, action: run(copy) },
    { label: "粘贴", keys: "Ctrl+V", disabled: readOnly, action: run(paste) },
    SEPARATOR,
    { label: "全选", keys: "Ctrl+A", action: run(selectAll) },
    { label: "查找/替换", keys: "Ctrl+F", action: run(openSearchPanel) },
  ];
  if (tab) {
    items.push(
      { label: "转到行…", keys: "Ctrl+G", action: () => openPalette(":") },
      { label: "切换行注释", keys: "Ctrl+/", disabled: readOnly, action: run(toggleComment) },
    );
  }

  if (tab?.diff) {
    items.push(
      SEPARATOR,
      { label: "上一处更改", action: () => goToChunk(-1, view) },
      { label: "下一处更改", action: () => goToChunk(1, view) },
      { label: "关闭对比", action: () => closeDiff(tab.id) },
    );
  }

  // 只读的虚拟标签页（历史版本、Git 输出）不对应磁盘文件，不提供文件相关的操作
  if (tab && !tab.readonly) {
    const rel = git.status ? relPath(tab.path) : null;
    items.push(SEPARATOR);
    if (isMarkdownFile(tab.path)) items.push({ label: "打开预览", action: () => previewMarkdown(tab.path) });
    if (isSvgFile(tab.path)) items.push({ label: "预览图片", action: () => previewImage(tab.path) });
    if (rel) items.push({ label: "查看文件历史", action: () => showFileHistory(tab.path) });
    items.push({ label: "复制路径", action: () => navigator.clipboard.writeText(tab.path).catch(toast) });
    if (rel) items.push({ label: "复制相对路径", action: () => navigator.clipboard.writeText(rel).catch(toast) });
  }

  showMenu(e, items);
}
