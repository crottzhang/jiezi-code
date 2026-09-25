<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { ui } from "../store/ui";

const input = ref<HTMLInputElement>();
const menuEl = ref<HTMLElement>();
/** 菜单实际尺寸，打开后测量，用来避免超出窗口 */
const menuSize = ref({ width: 0, height: 0 });

watch(
  () => ui.menu,
  async (menu) => {
    menuSize.value = { width: 0, height: 0 };
    if (!menu) return;
    await nextTick();
    const rect = menuEl.value?.getBoundingClientRect();
    if (rect) menuSize.value = { width: rect.width, height: rect.height };
  },
);

const menuStyle = computed(() => {
  const menu = ui.menu!;
  const { width, height } = menuSize.value;
  // 靠近右边或底部时往左、往上展开
  const x = menu.x + width > window.innerWidth - 4 ? Math.max(4, menu.x - width) : menu.x;
  const y = menu.y + height > window.innerHeight - 4 ? Math.max(4, menu.y - height) : menu.y;
  return { left: `${x}px`, top: `${y}px` };
});

watch(
  () => ui.prompt,
  async (prompt) => {
    if (!prompt) return;
    await nextTick();
    const el = input.value!;
    el.focus();
    // 重命名时只选中文件名，不选扩展名
    const dot = prompt.secret || prompt.selectAll ? -1 : prompt.value.lastIndexOf(".");
    el.setSelectionRange(0, dot > 0 ? dot : prompt.value.length);
  },
);

function submit() {
  ui.prompt?.resolve(ui.prompt.value);
}

function cancel() {
  ui.prompt?.resolve(null);
}

function runToastAction() {
  const action = ui.toast?.action;
  ui.toast = null;
  action?.run();
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
        :type="ui.prompt.secret ? 'password' : 'text'"
        :placeholder="ui.prompt.placeholder"
        spellcheck="false"
        autocomplete="off"
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
    <ul ref="menuEl" class="menu" :style="menuStyle" @mousedown.stop>
      <template v-for="(item, i) in ui.menu.items" :key="i">
        <li v-if="'separator' in item" class="sep"></li>
        <li
          v-else
          :class="{ danger: item.danger, disabled: item.disabled }"
          @click="item.disabled || runMenuItem(item.action)"
        >
          <span class="label">{{ item.label }}</span>
          <span v-if="item.keys" class="keys">{{ item.keys }}</span>
        </li>
      </template>
    </ul>
  </div>

  <div
    v-if="ui.toast"
    :key="ui.toast.id"
    class="toast"
    :class="ui.toast.kind"
    @click="ui.toast = null"
  >
    <span class="toast-text">{{ ui.toast.text }}</span>
    <button v-if="ui.toast.action" class="toast-action" @click.stop="runToastAction">
      {{ ui.toast.action.label }}
    </button>
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
  display: flex;
  gap: 24px;
  padding: 4px 16px;
  cursor: pointer;
  white-space: nowrap;
}
.menu .label {
  flex: 1;
}
.menu .keys {
  color: var(--fg-muted);
}
.menu li.disabled {
  opacity: 0.45;
  cursor: default;
}
.menu li.sep {
  height: 1px;
  margin: 4px 0;
  padding: 0;
  background: var(--widget-border);
  cursor: default;
}
.menu li:not(.sep, .disabled):hover {
  background: var(--menu-hover-bg);
  color: var(--menu-hover-fg);
}
.menu li:not(.sep, .disabled):hover .keys {
  color: inherit;
}
.menu li.danger:not(.disabled):hover {
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
  display: flex;
  align-items: flex-start;
  gap: 12px;
}
.toast.info {
  border-left-color: var(--accent);
}
.toast-text {
  flex: 1;
  min-width: 0;
  max-height: 40vh;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
}
.toast-action {
  flex: none;
  padding: 2px 10px;
  border: 1px solid var(--border-input);
  border-radius: var(--radius);
  background: var(--bg-input);
  color: var(--fg);
  font-size: 12px;
}
.toast-action:hover {
  background: var(--hover);
  color: var(--fg-strong);
}
</style>
