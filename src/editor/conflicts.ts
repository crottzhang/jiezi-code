import { EditorState, RangeSetBuilder, StateField, type Text } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";

/**
 * 合并冲突：识别 <<<<<<< / ||||||| / ======= / >>>>>>> 标记，
 * 在冲突块上方显示“采用当前更改 / 采用传入更改 / 保留双方”按钮，并给两边的内容上色。
 */

export interface Conflict {
  /** 各标记行的行号（从 1 开始）；base 只在 diff3 风格的冲突里有 */
  start: number;
  base: number | null;
  mid: number;
  end: number;
}

export function findConflicts(doc: Text): Conflict[] {
  const result: Conflict[] = [];
  let open: Partial<Conflict> | null = null;
  for (let n = 1; n <= doc.lines; n++) {
    const text = doc.line(n).text;
    if (text.startsWith("<<<<<<<")) {
      open = { start: n, base: null };
    } else if (!open) {
      continue;
    } else if (text.startsWith("|||||||") && open.mid == null) {
      open.base = n;
    } else if (text.startsWith("=======") && open.mid == null) {
      open.mid = n;
    } else if (text.startsWith(">>>>>>>") && open.mid != null) {
      result.push({ start: open.start!, base: open.base ?? null, mid: open.mid, end: n });
      open = null;
    }
  }
  return result;
}

type Resolution = "current" | "incoming" | "both";

/** 取第 from 到 to 行（含）的文本；from > to 时为空 */
function lines(doc: Text, from: number, to: number) {
  if (from > to) return "";
  return doc.sliceString(doc.line(from).from, doc.line(to).to) + "\n";
}

/** 解决一个冲突块要做的替换：整个冲突块（含标记行）换成选中的内容 */
export function resolution(doc: Text, conflict: Conflict, how: Resolution) {
  const current = lines(doc, conflict.start + 1, (conflict.base ?? conflict.mid) - 1);
  const incoming = lines(doc, conflict.mid + 1, conflict.end - 1);
  const insert = how === "current" ? current : how === "incoming" ? incoming : current + incoming;
  const from = doc.line(conflict.start).from;
  const endLine = doc.line(conflict.end);
  // 连同结束标记行的换行符一起替换；文件末尾的冲突块没有换行符，替换内容也去掉最后的换行
  if (endLine.to < doc.length) return { from, to: endLine.to + 1, insert };
  return { from, to: endLine.to, insert: insert.replace(/\n$/, "") };
}

function resolve(view: EditorView, conflict: Conflict, how: Resolution) {
  const change = resolution(view.state.doc, conflict, how);
  view.dispatch({
    changes: change,
    selection: { anchor: change.from },
    userEvent: "input.resolve",
  });
  view.focus();
}

class ActionsWidget extends WidgetType {
  constructor(readonly startLine: number) {
    super();
  }
  eq(other: ActionsWidget) {
    return other.startLine === this.startLine;
  }
  toDOM(view: EditorView) {
    const bar = document.createElement("div");
    bar.className = "cm-conflictActions";
    const add = (label: string, how: Resolution) => {
      const button = document.createElement("button");
      button.textContent = label;
      button.onmousedown = (e) => {
        e.preventDefault();
        // 按钮所在位置之后第一个冲突块就是它对应的块
        const line = view.state.doc.lineAt(view.posAtDOM(bar)).number;
        const conflict = findConflicts(view.state.doc).find((c) => c.start >= line);
        if (conflict) resolve(view, conflict, how);
      };
      bar.append(button);
    };
    add("采用当前更改", "current");
    add("采用传入更改", "incoming");
    add("保留双方", "both");
    return bar;
  }
  ignoreEvent() {
    return false;
  }
}

const markerLine = Decoration.line({ class: "cm-conflict-marker" });
const currentLine = Decoration.line({ class: "cm-conflict-current" });
const baseLine = Decoration.line({ class: "cm-conflict-base" });
const incomingLine = Decoration.line({ class: "cm-conflict-incoming" });

function build(state: EditorState): DecorationSet {
  const conflicts = findConflicts(state.doc);
  if (!conflicts.length) return Decoration.none;
  const editable = !state.readOnly;
  const builder = new RangeSetBuilder<Decoration>();
  const doc = state.doc;
  for (const c of conflicts) {
    const from = doc.line(c.start).from;
    if (editable) {
      builder.add(from, from, Decoration.widget({ widget: new ActionsWidget(c.start), block: true, side: -1 }));
    }
    for (let n = c.start; n <= c.end; n++) {
      const deco =
        n === c.start || n === c.mid || n === c.end || n === c.base
          ? markerLine
          : n < (c.base ?? c.mid)
            ? currentLine
            : n < c.mid
              ? baseLine
              : incomingLine;
      const pos = doc.line(n).from;
      builder.add(pos, pos, deco);
    }
  }
  return builder.finish();
}

/** 只在文档里可能有冲突标记时才逐行扫描，平时编辑不做多余的工作 */
const MARKER = /^(<{7}|={7}|>{7}|\|{7})/m;

export const conflicts = StateField.define<DecorationSet>({
  create: (state) => (MARKER.test(state.doc.toString()) ? build(state) : Decoration.none),
  update(value, tr) {
    if (!tr.docChanged) return value;
    let touched = value.size > 0;
    if (!touched) {
      tr.changes.iterChanges((_fa, _ta, _fb, _tb, inserted) => {
        if (!touched && MARKER.test(inserted.toString())) touched = true;
      });
    }
    return touched ? build(tr.state) : value.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});
