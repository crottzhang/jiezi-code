import { RangeSet, RangeSetBuilder, StateEffect, StateField, type Text } from "@codemirror/state";
import { EditorView, gutter, GutterMarker } from "@codemirror/view";
import type { Chunk } from "@codemirror/merge";

/**
 * 行号旁的 Git 改动标记：与暂存区里的版本比较，新增的行绿色、修改的行蓝色、删除的位置红色三角。
 * 原始版本由 store/diff.ts 通过 setQuickDiffOriginal 设置；为 null 时不显示。
 */

type MergeModule = typeof import("@codemirror/merge");

// @codemirror/merge 按需加载，加载完之前不会设置原始版本，所以这里用到时一定已经有了
let merge: MergeModule | null = null;
export async function loadQuickDiff() {
  merge ??= await import("@codemirror/merge");
}

/** 大文件的差异计算设个上限，避免输入时卡顿 */
const DIFF_CONFIG = { scanLimit: 2000, timeout: 50 };

export const setQuickDiffOriginal = StateEffect.define<Text | null>();

class ChangeMarker extends GutterMarker {
  readonly elementClass: string;
  constructor(readonly kind: "added" | "modified" | "deleted") {
    super();
    // 不能写成字段初始化：那样会在 kind 赋值之前执行
    this.elementClass = `cm-qd-${kind}`;
  }
  eq(other: ChangeMarker) {
    return other.kind === this.kind;
  }
}

const MARKERS = {
  added: new ChangeMarker("added"),
  modified: new ChangeMarker("modified"),
  deleted: new ChangeMarker("deleted"),
};

interface QuickDiff {
  original: Text | null;
  chunks: readonly Chunk[];
  markers: RangeSet<GutterMarker>;
}

function buildMarkers(chunks: readonly Chunk[], doc: Text) {
  const builder = new RangeSetBuilder<GutterMarker>();
  for (const c of chunks) {
    if (c.fromB === c.toB) {
      // 只删除了行：在删除位置所在的行上标一个三角
      const line = doc.lineAt(Math.min(c.fromB, doc.length));
      builder.add(line.from, line.from, MARKERS.deleted);
      continue;
    }
    const marker = c.fromA === c.toA ? MARKERS.added : MARKERS.modified;
    const first = doc.lineAt(c.fromB).number;
    const last = doc.lineAt(Math.max(c.fromB, Math.min(c.endB, doc.length))).number;
    for (let n = first; n <= last; n++) {
      const line = doc.line(n);
      builder.add(line.from, line.from, marker);
    }
  }
  return builder.finish();
}

const EMPTY: QuickDiff = { original: null, chunks: [], markers: RangeSet.empty };

const quickDiffField = StateField.define<QuickDiff>({
  create: () => EMPTY,
  update(value, tr) {
    for (const e of tr.effects) {
      if (!e.is(setQuickDiffOriginal)) continue;
      const original = e.value;
      if (!original || !merge) return EMPTY;
      const chunks = merge.Chunk.build(original, tr.state.doc, DIFF_CONFIG);
      return { original, chunks, markers: buildMarkers(chunks, tr.state.doc) };
    }
    if (!tr.docChanged || !value.original || !merge) return value;
    const chunks = merge.Chunk.updateB(value.chunks, value.original, tr.state.doc, tr.changes, DIFF_CONFIG);
    return { original: value.original, chunks, markers: buildMarkers(chunks, tr.state.doc) };
  },
});

/** 当前的改动标记：[行号, 类型]，调试和测试用 */
export function quickDiffMarkers(state: EditorView["state"]) {
  const result: [number, string][] = [];
  state.field(quickDiffField).markers.between(0, state.doc.length, (from, _to, marker) => {
    result.push([state.doc.lineAt(from).number, (marker as ChangeMarker).kind]);
  });
  return result;
}

/** 当前是否有原始版本（没有被 Git 跟踪的文件为 false） */
export const hasQuickDiff = (state: EditorView["state"]) => state.field(quickDiffField, false)?.original != null;

let onMarkerClick: ((view: EditorView, pos: number) => void) | null = null;

/** 点击改动标记时调用（显示这一处的差异） */
export function setQuickDiffClickHandler(handler: (view: EditorView, pos: number) => void) {
  onMarkerClick = handler;
}

export const quickDiff = [
  quickDiffField,
  gutter({
    class: "cm-quickDiffGutter",
    markers: (view) => view.state.field(quickDiffField).markers,
    domEventHandlers: {
      mousedown(view, line) {
        let hit = false;
        view.state.field(quickDiffField).markers.between(line.from, line.from, () => {
          hit = true;
        });
        if (!hit || !onMarkerClick) return false;
        onMarkerClick(view, line.from);
        return true;
      },
    },
  }),
];
