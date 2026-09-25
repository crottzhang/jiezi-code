<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import {
  killTerminalProcess,
  resizeTerminal,
  spawnTerminal,
  writeTerminal,
} from "../api/terminal";
import { saveClipboardImage } from "../api/clipboard";
import {
  focusTerminal,
  quotePath,
  registerTerminal,
  terminal,
  type TermInfo,
} from "../store/terminal";
import { workspace } from "../store/workspace";
import { currentTheme, theme } from "../theme";
import type { MenuNode } from "../menu";
import MenuList from "./MenuList.vue";

const props = defineProps<{ info: TermInfo; active: boolean }>();
// 退出、关闭由父组件处理：终端面板和运行视图各自管理自己的终端列表
const emit = defineEmits<{ exited: []; close: [] }>();

const host = ref<HTMLElement>();
let term: Terminal;
let fit: FitAddon;
let resizeObserver: ResizeObserver;
let id: number | null = null;
let disposed = false;
// ConPTY 启动时会先发光标位置查询（ESC[6n）并等待回复，这可能早于 term_spawn 返回 id，
// 所以拿到 id 之前的输入先缓存，否则回复丢失会导致 PowerShell 一直卡住
let pending: string[] = [];

// 运行面板开的终端：等 shell 启动时的输出停下来再输入命令，
// 以免命令混在 ConPTY 启动握手（光标位置查询的回复）之前
let startCommand = props.info.command ?? null;
let startTimer: number | undefined;

function onShellOutput() {
  if (startCommand == null) return;
  clearTimeout(startTimer);
  startTimer = window.setTimeout(() => {
    if (startCommand != null && !props.info.exited) runCommand(startCommand);
    startCommand = null;
  }, 200);
}

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

/** 截图先存成文件，再把路径粘贴进终端 */
async function pasteImage(image: Blob) {
  try {
    const path = await saveClipboardImage(image);
    term.paste(quotePath(path));
    terminal.imagesVersion++;
  } catch (e) {
    term.write(`\r\n\x1b[31m保存截图失败：${e}\x1b[0m\r\n`);
  }
}

/** 剪贴板里只有图片（没有文本）时返回图片 */
async function readClipboardImage() {
  for (const item of await navigator.clipboard.read()) {
    if (item.types.includes("text/plain")) return null;
    const type = item.types.find((t) => t.startsWith("image/"));
    if (type) return item.getType(type);
  }
  return null;
}

async function paste() {
  const image = await readClipboardImage().catch(() => null);
  if (image) return pasteImage(image);
  try {
    term.paste(await navigator.clipboard.readText());
  } catch {
    // 剪贴板不可读时忽略
  }
}

/** Ctrl+V 触发的 paste 事件：有图片时抢在 xterm 之前处理，纯文本仍交给 xterm */
function onPaste(e: ClipboardEvent) {
  const data = e.clipboardData;
  if (!data || data.getData("text/plain")) return;
  const image = [...data.items]
    .find((i) => i.kind === "file" && i.type.startsWith("image/"))
    ?.getAsFile();
  if (!image) return;
  e.preventDefault();
  e.stopPropagation();
  pasteImage(image);
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

/** 右键菜单里一键启动的 AI 命令行，均跳过权限确认 */
const AGENT_COMMANDS = [
  { label: "Claude 绕过权限", command: "claude --dangerously-skip-permissions" },
  { label: "Codex 绕过权限", command: "codex --dangerously-bypass-approvals-and-sandbox" },
  { label: "Agy 绕过权限", command: "agy --dangerously-skip-permissions" },
];

const menu = shallowRef<{ x: number; y: number; items: MenuNode[] } | null>(null);
const menuBox = ref<HTMLElement>();

/** 像用户输入一样发送，走 onData 同一条路径 */
function runCommand(command: string) {
  term.input(`${command}\r`);
}

function buildMenu(): MenuNode[] {
  const exited = props.info.exited;
  return [
    ...AGENT_COMMANDS.map(({ label, command }) => ({
      label,
      disabled: exited,
      run: () => runCommand(command),
    })),
    { separator: true },
    { label: "全选", run: () => term.selectAll() },
    { label: "复制", keys: "Ctrl+C", disabled: !term.hasSelection(), run: copySelection },
    { label: "粘贴", keys: "Ctrl+V", disabled: exited, run: paste },
  ];
}

async function onContextMenu(e: MouseEvent) {
  e.preventDefault();
  menu.value = { x: e.clientX, y: e.clientY, items: buildMenu() };
  // 终端在窗口底部，放不下时向上/向左翻转
  await nextTick();
  const box = menuBox.value;
  if (!box || !menu.value) return;
  const { width, height } = box.getBoundingClientRect();
  let { x, y } = menu.value;
  if (x + width > innerWidth) x = Math.max(0, x - width);
  if (y + height > innerHeight) y = Math.max(0, y - height);
  menu.value = { ...menu.value, x, y };
}

function closeMenu() {
  menu.value = null;
  term.focus();
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
    if (props.info.exited) emit("close");
    else if (id != null) writeTerminal(id, data).catch(() => {});
    else pending.push(data);
  });
  term.onResize(({ cols, rows }) => {
    if (id != null) resizeTerminal(id, cols, rows).catch(() => {});
  });

  resizeObserver = new ResizeObserver(() => safeFit());
  resizeObserver.observe(host.value!);
  registerTerminal(props.info.key, { focus: () => term.focus(), paste: (text) => term.paste(text) });
  if (props.active) focusTerminal(props.info.key);

  try {
    const newId = await spawnTerminal({
      cwd: props.info.cwd ?? workspace.root,
      cols: term.cols,
      rows: term.rows,
      onData: (data) => {
        term.write(data);
        onShellOutput();
      },
      onExit: (code) => {
        emit("exited");
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
    emit("exited");
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
  clearTimeout(startTimer);
  registerTerminal(props.info.key, null);
  resizeObserver?.disconnect();
  if (id != null) killTerminalProcess(id).catch(() => {});
  term?.dispose();
});
</script>

<template>
  <!-- 单根节点：父组件用 v-show 切换终端，菜单放在内部再传送到 body -->
  <div ref="host" class="terminal-host" @contextmenu="onContextMenu" @paste.capture="onPaste">
    <Teleport to="body">
      <div v-if="menu" class="menu-mask" @mousedown="closeMenu" @contextmenu.prevent="closeMenu">
        <div
          ref="menuBox"
          class="term-menu"
          :style="{ left: `${menu.x}px`, top: `${menu.y}px` }"
          @mousedown.stop
        >
          <MenuList :items="menu.items" @close="closeMenu" />
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.terminal-host {
  height: 100%;
  padding: 4px 0 0 10px;
  background: var(--bg-panel);
}
.menu-mask {
  position: fixed;
  inset: 0;
  z-index: 100;
}
.term-menu {
  position: absolute;
}
</style>
