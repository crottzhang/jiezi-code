import { nextTick, reactive } from "vue";

export interface TermInfo {
  key: number;
  title: string;
  exited: boolean;
}

export const terminal = reactive({
  visible: false,
  sessions: [] as TermInfo[],
  active: null as number | null,
  /** 临时图片管理界面是否打开 */
  imagesOpen: false,
  /** 每保存一张截图加一，管理界面据此刷新 */
  imagesVersion: 0,
});

export interface TermHandle {
  focus: () => void;
  /** 像用户粘贴一样写入文本（支持 bracketed paste） */
  paste: (text: string) => void;
}

// xterm 实例不放进响应式状态，只登记聚焦和粘贴函数
const handles = new Map<number, TermHandle>();
let seq = 0;

export function registerTerminal(key: number, handle: TermHandle | null) {
  if (handle) handles.set(key, handle);
  else handles.delete(key);
}

export async function focusTerminal(key = terminal.active) {
  await nextTick();
  if (key != null) handles.get(key)?.focus();
}

/** 路径含空格时加引号，保证 shell 当成一个参数 */
export function quotePath(path: string) {
  return /\s/.test(path) ? `"${path}"` : path;
}

/** 把文件路径粘贴到当前终端，没有终端时新建一个 */
export async function pastePathToTerminal(path: string) {
  showTerminal();
  await nextTick();
  const key = terminal.active;
  if (key == null) return;
  handles.get(key)?.paste(quotePath(path));
  focusTerminal(key);
}

function focusEditor() {
  document.querySelector<HTMLElement>(".cm-content")?.focus();
}

export function newTerminal() {
  const key = ++seq;
  terminal.sessions.push({ key, title: `PowerShell ${key}`, exited: false });
  terminal.active = key;
  terminal.visible = true;
}

export function markExited(key: number) {
  const info = terminal.sessions.find((s) => s.key === key);
  if (info) info.exited = true;
}

/** 关闭终端标签；对应的 TerminalView 卸载时会结束进程 */
export function closeTerminal(key: number) {
  const index = terminal.sessions.findIndex((s) => s.key === key);
  if (index < 0) return;
  terminal.sessions.splice(index, 1);
  if (terminal.active === key) {
    terminal.active = (terminal.sessions[index] ?? terminal.sessions[index - 1])?.key ?? null;
  }
  if (terminal.sessions.length === 0) hideTerminal();
  else focusTerminal();
}

export function showTerminal() {
  if (terminal.sessions.length === 0) newTerminal();
  terminal.visible = true;
  focusTerminal();
}

export function hideTerminal() {
  terminal.visible = false;
  focusEditor();
}

export function toggleTerminal() {
  if (terminal.visible) hideTerminal();
  else showTerminal();
}
