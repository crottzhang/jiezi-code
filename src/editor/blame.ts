import { StateEffect, StateField, type EditorState, type Text } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";

/**
 * 光标所在行末尾淡淡显示“谁、什么时候、哪个提交”改了这一行。
 * 数据由 store/blame.ts 按需读取（git blame），编辑后先隐藏，停顿一会儿再重新读取。
 */

export interface LineBlame {
  /** 行末显示的文字 */
  text: string;
  /** 鼠标悬停时的完整信息 */
  title: string;
}

export interface BlameData {
  /** 读取时的文档；和当前文档不是同一个时说明已经编辑过，数据作废 */
  doc: Text;
  /** 每行一项（从 0 开始） */
  lines: (LineBlame | null)[];
}

export const setBlame = StateEffect.define<BlameData | null>();

const blameData = StateField.define<BlameData | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setBlame)) return e.value && e.value.doc === tr.state.doc ? e.value : null;
    }
    return tr.docChanged ? null : value;
  },
});

class BlameWidget extends WidgetType {
  constructor(readonly info: LineBlame) {
    super();
  }
  eq(other: BlameWidget) {
    return other.info.text === this.info.text;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-blame";
    span.textContent = this.info.text;
    span.title = this.info.title;
    return span;
  }
}

function annotation(state: EditorState): DecorationSet {
  const data = state.field(blameData);
  const sel = state.selection.main;
  if (!data) return Decoration.none;
  const line = state.doc.lineAt(sel.head);
  // 选中了多行时不显示
  if (!sel.empty && state.doc.lineAt(sel.anchor).number !== line.number) return Decoration.none;
  const info = data.lines[line.number - 1];
  if (!info) return Decoration.none;
  return Decoration.set([Decoration.widget({ widget: new BlameWidget(info), side: 1 }).range(line.to)]);
}

const blameDecorations = StateField.define<DecorationSet>({
  create: annotation,
  update(value, tr) {
    const changed = tr.docChanged || tr.selection || tr.effects.some((e) => e.is(setBlame));
    return changed ? annotation(tr.state) : value;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** 编辑停顿多久后重新读取 */
const DELAY = 700;

let requester: ((view: EditorView) => void) | null = null;

/** 由 store 注册：需要（重新）读取当前文档的行作者信息时调用 */
export function setBlameRequester(fn: ((view: EditorView) => void) | null) {
  requester = fn;
}

const blameLoader = ViewPlugin.fromClass(
  class {
    timer: ReturnType<typeof setTimeout> | undefined;
    constructor(readonly view: EditorView) {
      // 切换标签页时 EditorView 换了状态，插件会重新创建
      if (!view.state.field(blameData)) this.schedule(0);
    }
    update(u: { docChanged: boolean }) {
      if (u.docChanged) this.schedule(DELAY);
    }
    schedule(delay: number) {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => requester?.(this.view), delay);
    }
    destroy() {
      clearTimeout(this.timer);
    }
  },
);

/** 重新读取当前显示的文档（比如提交之后） */
export function requestBlame(view: EditorView) {
  requester?.(view);
}

export const blame = [blameData, blameDecorations, blameLoader];
