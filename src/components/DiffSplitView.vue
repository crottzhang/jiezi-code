<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { basicSetup } from "codemirror";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap, type ViewUpdate } from "@codemirror/view";
import { indentWithTab } from "@codemirror/commands";
import type { MergeView } from "@codemirror/merge";
import { baseName } from "../api/fs";
import { showEditorMenu } from "../editor/contextMenu";
import { loadLanguage } from "../editor/setup";
import { themeExtension } from "../editor/theme";
import { setEditorView } from "../editor/view";
import { activeTab, getState, updateCursor, updateTabState, workspace } from "../store/workspace";

/**
 * 左右并排对比：左边是对比版本（只读），右边是标签页的内容。
 * 右边的编辑同步回标签页的 EditorState，保存、未保存标记都照常工作。
 */

const host = ref<HTMLElement>();
let view: MergeView | null = null;
let generation = 0;

function destroy() {
  if (!view) return;
  view.destroy();
  view = null;
  setEditorView(null);
}

/** 右边的改动同步到标签页 */
function sync(id: number, u: ViewUpdate) {
  const current = getState(id);
  if (!current) return;
  if (current.doc.eq(u.startState.doc)) {
    updateTabState(id, { changes: u.changes });
  } else {
    // 标签页的内容在别处变了（比如文件被外部修改后重新读取），以右边看到的为准
    updateTabState(id, { changes: { from: 0, to: current.doc.length, insert: u.state.doc } });
  }
}

async function build() {
  const gen = ++generation;
  destroy();
  const tab = activeTab();
  const state = tab && getState(tab.id);
  if (!tab?.diff || !state) return;
  const merge = await import("@codemirror/merge");
  let original;
  try {
    original = merge.getOriginalDoc(state);
  } catch {
    return; // 行内对比还没建立好
  }
  const lang = await loadLanguage(baseName(tab.diff.rel));
  if (gen !== generation || !host.value) return;

  const common: Extension[] = [basicSetup, themeExtension, lang.support ?? []];
  const id = tab.id;
  view = new merge.MergeView({
    parent: host.value,
    a: { doc: original, extensions: [...common, EditorState.readOnly.of(true)] },
    b: {
      doc: state.doc,
      extensions: [
        ...common,
        keymap.of([indentWithTab]),
        EditorState.readOnly.of(!!tab.readonly),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) sync(id, u);
          if (u.docChanged || u.selectionSet) updateCursor(u.state);
        }),
      ],
    },
    // 左边的箭头把那一处还原成对比版本的内容
    revertControls: tab.readonly ? undefined : "a-to-b",
    collapseUnchanged: { margin: 3, minSize: 6 },
    gutter: true,
  });
  // 菜单和命令面板里的编辑命令作用于右边
  setEditorView(view.b);
  updateCursor(view.b.state);
  view.b.focus();
}

/** 右边对应标签页；左边是对比版本，只有复制、查找这类菜单项 */
function onContextMenu(e: MouseEvent) {
  const target = e.target as Node;
  if (view?.b.dom.contains(target)) showEditorMenu(e, view.b, activeTab());
  else if (view?.a.dom.contains(target)) showEditorMenu(e, view.a);
}

onMounted(() => {
  build();
  watch(() => [workspace.active, activeTab()?.diff?.rev, activeTab()?.diff?.rel], build);
});

onBeforeUnmount(() => {
  generation++;
  destroy();
});
</script>

<template>
  <div ref="host" class="split-host" @contextmenu="onContextMenu"></div>
</template>

<style scoped>
.split-host {
  flex: 1;
  min-height: 0;
  overflow: auto;
  background: var(--bg-editor);
}
.split-host :deep(.cm-mergeView) {
  min-height: 100%;
}
.split-host :deep(.cm-mergeViewEditor + .cm-mergeViewEditor),
.split-host :deep(.cm-merge-revert) {
  border-left: 1px solid var(--border);
}
.split-host :deep(.cm-merge-revert) {
  background: var(--bg-editor);
}
.split-host :deep(.cm-merge-revert button) {
  color: var(--fg-muted);
}
.split-host :deep(.cm-merge-revert button:hover) {
  color: var(--fg-strong);
}
</style>
