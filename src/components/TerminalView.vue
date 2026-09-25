<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import {
  killTerminalProcess,
  resizeTerminal,
  spawnTerminal,
  writeTerminal,
} from "../api/terminal";
import { closeTerminal, focusTerminal, markExited, registerFocus, type TermInfo } from "../store/terminal";
import { workspace } from "../store/workspace";
import { currentTheme, theme } from "../theme";

const props = defineProps<{ info: TermInfo; active: boolean }>();

const host = ref<HTMLElement>();
let term: Terminal;
let fit: FitAddon;
let resizeObserver: ResizeObserver;
let id: number | null = null;
let disposed = false;
// ConPTY 启动时会先发光标位置查询（ESC[6n）并等待回复，这可能早于 term_spawn 返回 id，
// 所以拿到 id 之前的输入先缓存，否则回复丢失会导致 PowerShell 一直卡住
let pending: string[] = [];

// xterm.js 不认 CSS 变量，主题切换时手动更新
watch(
  () => theme.id,
  () => {
    if (term) term.options.theme = currentTheme().terminal;
  },
);

/** 面板隐藏（display: none）时尺寸为 0，此时不能 fit */
function safeFit() {
  const el = host.value;
  if (el && el.clientWidth > 0 && el.clientHeight > 0) fit.fit();
}

function copySelection() {
  navigator.clipboard.writeText(term.getSelection());
  term.clearSelection();
}

async function paste() {
  try {
    term.paste(await navigator.clipboard.readText());
  } catch {
    // 剪贴板不可读时忽略
  }
}

/** 和 Windows Terminal / VS Code 一致：有选中内容时 Ctrl+C 复制，否则发送中断 */
function handleKey(e: KeyboardEvent) {
  if (e.type !== "keydown") return true;
  const ctrl = e.ctrlKey && !e.shiftKey && !e.altKey;
  if (ctrl && e.key === "c" && term.hasSelection()) {
    copySelection();
    return false;
  }
  // 交给浏览器触发 paste 事件，xterm 会把内容写入终端
  if (ctrl && e.key === "v") return false;
  return true;
}

/** 右键：有选中内容就复制，否则粘贴 */
function onContextMenu(e: MouseEvent) {
  e.preventDefault();
  if (term.hasSelection()) copySelection();
  else paste();
}

onMounted(async () => {
  term = new Terminal({
    fontFamily: "'Cascadia Mono', 'Cascadia Code', Consolas, monospace",
    fontSize: 13,
    lineHeight: 1.2,
    cursorBlink: true,
    scrollback: 5000,
    theme: currentTheme().terminal,
    windowsPty: navigator.userAgent.includes("Windows") ? { backend: "conpty" } : undefined,
  });
  fit = new FitAddon();
  term.loadAddon(fit);
  term.open(host.value!);
  safeFit();

  term.attachCustomKeyEventHandler(handleKey);
  term.onData((data) => {
    if (props.info.exited) closeTerminal(props.info.key);
    else if (id != null) writeTerminal(id, data).catch(() => {});
    else pending.push(data);
  });
  term.onResize(({ cols, rows }) => {
    if (id != null) resizeTerminal(id, cols, rows).catch(() => {});
  });

  resizeObserver = new ResizeObserver(() => safeFit());
  resizeObserver.observe(host.value!);
  registerFocus(props.info.key, () => term.focus());
  if (props.active) focusTerminal(props.info.key);

  try {
    const newId = await spawnTerminal({
      cwd: workspace.root,
      cols: term.cols,
      rows: term.rows,
      onData: (data) => term.write(data),
      onExit: (code) => {
        markExited(props.info.key);
        term.write(`\r\n\x1b[90m[进程已退出，代码 ${code}] 按任意键关闭终端\x1b[0m\r\n`);
      },
    });
    if (disposed) {
      killTerminalProcess(newId);
      return;
    }
    id = newId;
    if (pending.length) writeTerminal(id, pending.join("")).catch(() => {});
    pending = [];
    // 启动期间面板尺寸可能变过
    resizeTerminal(id, term.cols, term.rows).catch(() => {});
  } catch (e) {
    markExited(props.info.key);
    term.write(`\x1b[31m启动终端失败：${e}\x1b[0m\r\n`);
  }
});

watch(
  () => props.active,
  (active) => {
    if (active) focusTerminal(props.info.key);
  },
);

onBeforeUnmount(() => {
  disposed = true;
  registerFocus(props.info.key, null);
  resizeObserver?.disconnect();
  if (id != null) killTerminalProcess(id).catch(() => {});
  term?.dispose();
});
</script>

<template>
  <div ref="host" class="terminal-host" @contextmenu="onContextMenu"></div>
</template>

<style scoped>
.terminal-host {
  height: 100%;
  padding: 4px 0 0 10px;
  background: var(--bg-panel);
}
</style>
