<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { baseName } from "../api/fs";
import { buildAppMenu, type MenuNode } from "../menu";
import { terminal, toggleTerminal } from "../store/terminal";
import { openPalette } from "../store/ui";
import { workspace } from "../store/workspace";
import MenuList from "./MenuList.vue";

const win = getCurrentWindow();
const maximized = ref(false);
const menu = shallowRef<MenuNode[] | null>(null);

function toggleMenu() {
  menu.value = menu.value ? null : buildAppMenu();
}

let unlistenResize: (() => void) | undefined;

onMounted(async () => {
  maximized.value = await win.isMaximized();
  unlistenResize = await win.onResized(async () => {
    maximized.value = await win.isMaximized();
  });
});

onBeforeUnmount(() => unlistenResize?.());
</script>

<template>
  <!-- deep：整条标题栏都能拖动窗口、双击最大化；按钮本身不受影响 -->
  <header class="titlebar" data-tauri-drag-region="deep">
    <div class="left">
      <button class="icon" :class="{ active: menu }" title="应用菜单" @click="toggleMenu">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round">
          <path d="M2.5 4h11M2.5 8h11M2.5 12h11" />
        </svg>
      </button>
    </div>

    <div class="center">
      <button class="search" title="搜索文件 (Ctrl+P)、命令 (Ctrl+Shift+P)" @click="openPalette('')">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round">
          <circle cx="7" cy="7" r="4.5" />
          <path d="m10.5 10.5 3 3" />
        </svg>
        <span>{{ workspace.root ? baseName(workspace.root) : "Jiezi Code" }}</span>
      </button>
    </div>

    <div class="right">
      <button
        class="icon"
        :class="{ active: terminal.visible }"
        title="切换终端 (Ctrl+`)"
        @click="toggleTerminal()"
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="1.5" y="2.5" width="13" height="11" rx="1" />
          <path d="m4.5 6 2 2-2 2M8.5 10h3" />
        </svg>
      </button>

      <div class="controls">
        <button title="最小化" @click="win.minimize()">
          <svg viewBox="0 0 10 10" stroke="currentColor"><path d="M0 5.5h10" /></svg>
        </button>
        <button :title="maximized ? '还原' : '最大化'" @click="win.toggleMaximize()">
          <svg v-if="maximized" viewBox="0 0 10 10" fill="none" stroke="currentColor">
            <path d="M2.5 2.5V.5h7v7h-2" />
            <rect x=".5" y="2.5" width="7" height="7" />
          </svg>
          <svg v-else viewBox="0 0 10 10" fill="none" stroke="currentColor">
            <rect x=".5" y=".5" width="9" height="9" />
          </svg>
        </button>
        <button class="close" title="关闭" @click="win.close()">
          <svg viewBox="0 0 10 10" stroke="currentColor"><path d="m0 0 10 10M10 0 0 10" /></svg>
        </button>
      </div>
    </div>
  </header>

  <!-- 菜单放到 body 下，避免落在拖动区域里 -->
  <Teleport to="body">
    <div v-if="menu" class="menu-mask" @mousedown="menu = null" @contextmenu.prevent="menu = null">
      <MenuList class="app-menu" :items="menu" @mousedown.stop @close="menu = null" />
    </div>
  </Teleport>
</template>

<style scoped>
.titlebar {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  height: 35px;
  flex: none;
  background: var(--bg-app);
  border-bottom: 1px solid var(--border-side);
  user-select: none;
}
.left {
  display: flex;
  padding-left: 6px;
}
.right {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  height: 100%;
}
.icon {
  width: 30px;
  height: 26px;
  border-radius: 4px;
  color: var(--fg-muted);
}
.icon svg {
  width: 16px;
  height: 16px;
}
.icon:hover,
.icon.active {
  background: var(--hover);
  color: var(--fg-strong);
}
.right > .icon {
  margin-right: 6px;
}
.search {
  gap: 8px;
  width: clamp(200px, 38vw, 600px);
  height: 24px;
  border: 1px solid var(--border-input);
  border-radius: var(--radius);
  background: var(--bg-input);
  color: var(--fg-muted);
  font-size: 12px;
}
.search svg {
  width: 14px;
  height: 14px;
  flex: none;
}
.search span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.search:hover {
  border-color: var(--fg-muted);
  color: var(--fg-strong);
}
.controls {
  display: flex;
  height: 100%;
}
.controls button {
  width: 46px;
  height: 100%;
  color: var(--fg);
}
.controls svg {
  width: 10px;
  height: 10px;
  shape-rendering: crispEdges;
}
.controls button:hover {
  background: var(--hover);
  color: var(--fg-strong);
}
.controls .close:hover {
  background: #e81123;
  color: #fff;
}
.menu-mask {
  position: fixed;
  inset: 0;
  z-index: 100;
}
.app-menu {
  position: absolute;
  top: 33px;
  left: 6px;
}
</style>
