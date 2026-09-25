<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { EditorView } from "@codemirror/view";
import { showEditorMenu } from "../editor/contextMenu";
import { tabId } from "../editor/setup";
import { setEditorView } from "../editor/view";
import { activeTab, getState, scrollSnapshots, updateCursor, workspace } from "../store/workspace";

const host = ref<HTMLElement>();
let view: EditorView | null = null;

function show(id: number | null) {
  const state = id != null ? getState(id) : undefined;
  if (!view || !state || view.state === state) return;
  // 记住离开时的滚动位置
  scrollSnapshots.set(view.state.facet(tabId), view.scrollSnapshot());
  view.setState(state);
  const snapshot = scrollSnapshots.get(id!);
  if (snapshot) view.dispatch({ effects: snapshot });
  updateCursor(state);
  view.focus();
}

function onContextMenu(e: MouseEvent) {
  if (view) showEditorMenu(e, view, activeTab());
}

onMounted(() => {
  const state = getState(workspace.active!)!;
  view = new EditorView({ state, parent: host.value! });
  setEditorView(view);
  updateCursor(state);
  view.focus();
});

watch(() => workspace.active, show);

onBeforeUnmount(() => {
  setEditorView(null);
  view?.destroy();
  view = null;
});
</script>

<template>
  <div ref="host" class="editor-host" @contextmenu="onContextMenu"></div>
</template>

<style scoped>
.editor-host {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
</style>
