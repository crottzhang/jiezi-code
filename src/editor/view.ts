import type { EditorView } from "@codemirror/view";

// 当前窗口唯一的 EditorView，菜单和命令面板里的编辑命令通过它执行
let current: EditorView | null = null;

export function setEditorView(view: EditorView | null) {
  current = view;
}

export function getEditorView() {
  return current;
}

export function goToLine(line: number) {
  const view = current;
  if (!view) return;
  const target = view.state.doc.line(Math.min(Math.max(1, line), view.state.doc.lines));
  view.dispatch({ selection: { anchor: target.from }, scrollIntoView: true });
  view.focus();
}
