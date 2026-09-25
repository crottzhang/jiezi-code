<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { ui } from "../store/ui";

const input = ref<HTMLInputElement>();

watch(
  () => ui.prompt,
  async (prompt) => {
    if (!prompt) return;
    await nextTick();
    const el = input.value!;
    el.focus();
    // 重命名时只选中文件名，不选扩展名
    const dot = prompt.value.lastIndexOf(".");
    el.setSelectionRange(0, dot > 0 ? dot : prompt.value.length);
  },
);

function submit() {
  ui.prompt?.resolve(ui.prompt.value);
}

function cancel() {
  ui.prompt?.resolve(null);
}

function runMenuItem(action: () => void) {
  ui.menu = null;
  action();
}
</script>

<template>
  <div v-if="ui.prompt" class="prompt-mask" @mousedown.self="cancel">
    <div class="prompt">
      <div class="prompt-title">{{ ui.prompt.title }}</div>
      <input
        ref="input"
        v-model="ui.prompt.value"
        spellcheck="false"
        @keydown.enter="submit"
        @keydown.esc="cancel"
      />
    </div>
  </div>

  <div
    v-if="ui.menu"
    class="menu-mask"
    @mousedown="ui.menu = null"
    @contextmenu.prevent="ui.menu = null"
  >
    <ul class="menu" :style="{ left: `${ui.menu.x}px`, top: `${ui.menu.y}px` }" @mousedown.stop>
      <li
        v-for="item in ui.menu.items"
        :key="item.label"
        :class="{ danger: item.danger }"
        @click="runMenuItem(item.action)"
      >
        {{ item.label }}
      </li>
    </ul>
  </div>

  <div v-if="ui.toast" :key="ui.toast.id" class="toast" @click="ui.toast = null">
    {{ ui.toast.text }}
  </div>
</template>

<style scoped>
.prompt-mask,
.menu-mask {
  position: fixed;
  inset: 0;
  z-index: 100;
}
.prompt {
  position: absolute;
  top: 8px;
  left: 50%;
  transform: translateX(-50%);
  width: 500px;
  max-width: calc(100% - 32px);
  padding: 8px;
  border-radius: 6px;
  background: var(--bg-widget);
  box-shadow: var(--shadow);
  border: 1px solid var(--widget-border);
}
.prompt-title {
  margin-bottom: 6px;
  font-size: 12px;
  color: var(--fg-muted);
}
.prompt input {
  width: 100%;
  padding: 4px 6px;
  border: 1px solid var(--accent);
  border-radius: 3px;
  outline: none;
  background: var(--bg-input);
  color: var(--fg-strong);
  font: inherit;
}
.menu {
  position: absolute;
  min-width: 160px;
  margin: 0;
  padding: 4px 0;
  list-style: none;
  border-radius: 6px;
  background: var(--bg-widget);
  box-shadow: var(--shadow);
  border: 1px solid var(--widget-border);
}
.menu li {
  padding: 4px 16px;
  cursor: pointer;
}
.menu li:hover {
  background: var(--menu-hover-bg);
  color: var(--menu-hover-fg);
}
.menu li.danger:hover {
  background: var(--danger);
  color: #fff;
}
.toast {
  position: fixed;
  right: 16px;
  bottom: 36px;
  z-index: 101;
  max-width: 420px;
  padding: 10px 14px;
  border: 1px solid var(--widget-border);
  border-left: 3px solid var(--danger);
  border-radius: var(--radius);
  background: var(--bg-widget);
  box-shadow: var(--shadow);
  color: var(--fg-strong);
  cursor: pointer;
}
</style>
