<script setup lang="ts">
import { ref } from "vue";
import { baseName } from "../api/fs";
import { openFolder, openFolderInNewWindow, recentFolders, workspace } from "../store/workspace";

const recent = ref(recentFolders());

const shortcuts = [
  ["打开文件夹", "Ctrl + O"],
  ["转到文件", "Ctrl + P"],
  ["命令面板", "Ctrl + Shift + P"],
  ["转到行", "Ctrl + G"],
  ["新窗口", "Ctrl + Shift + N"],
  ["保存 / 全部保存", "Ctrl + S / Ctrl + Alt + S"],
  ["关闭标签页", "Ctrl + W"],
  ["切换标签页", "Ctrl + Tab"],
  ["查找 / 替换", "Ctrl + F"],
  ["显示/隐藏侧边栏", "Ctrl + B"],
  ["显示/隐藏终端", "Ctrl + `"],
];
</script>

<template>
  <div class="welcome">
    <div class="inner">
      <h1>Jiezi Code</h1>
      <p class="sub">轻量代码编辑器</p>

      <template v-if="!workspace.root">
        <div class="actions">
          <button class="primary" @click="openFolder()">打开文件夹</button>
          <button @click="openFolderInNewWindow()">在新窗口打开</button>
        </div>

        <section v-if="recent.length">
          <h2>最近打开</h2>
          <ul>
            <li v-for="path in recent" :key="path">
              <a @click="openFolder(path)">{{ baseName(path) }}</a>
              <span class="path">{{ path }}</span>
            </li>
          </ul>
        </section>
      </template>

      <section>
        <h2>快捷键</h2>
        <dl>
          <template v-for="[label, keys] in shortcuts" :key="label">
            <dt>{{ label }}</dt>
            <dd><kbd>{{ keys }}</kbd></dd>
          </template>
        </dl>
      </section>
    </div>
  </div>
</template>

<style scoped>
.welcome {
  flex: 1;
  display: flex;
  justify-content: center;
  overflow: auto;
  background: var(--bg-editor);
}
.inner {
  width: 480px;
  max-width: calc(100% - 32px);
  padding-top: 12vh;
}
h1 {
  margin: 0;
  font-size: 32px;
  font-weight: 300;
  color: var(--fg-strong);
}
.sub {
  margin: 4px 0 28px;
  color: var(--fg-muted);
}
.actions {
  display: flex;
  gap: 8px;
  margin-bottom: 32px;
}
.actions button {
  padding: 6px 14px;
  border-radius: 4px;
  background: var(--hover);
  color: var(--fg-strong);
}
.actions button.primary {
  background: var(--accent);
  color: var(--accent-fg);
}
.actions button:hover {
  filter: brightness(1.15);
}
h2 {
  margin: 0 0 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--fg-strong);
}
section {
  margin-bottom: 28px;
}
ul {
  list-style: none;
  margin: 0;
  padding: 0;
}
li {
  display: flex;
  gap: 10px;
  line-height: 24px;
  white-space: nowrap;
}
li a {
  color: var(--accent);
  cursor: pointer;
}
li a:hover {
  text-decoration: underline;
}
.path {
  color: var(--fg-muted);
  overflow: hidden;
  text-overflow: ellipsis;
}
dl {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 6px 16px;
  margin: 0;
}
dt {
  color: var(--fg-muted);
}
dd {
  margin: 0;
}
kbd {
  font-family: inherit;
  font-size: 12px;
  padding: 1px 6px;
  border-radius: 3px;
  background: var(--hover);
}
</style>
