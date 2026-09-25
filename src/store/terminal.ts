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
});

// xterm 实例不放进响应式状态，只登记一个聚焦函数
const focusers = new Map<number, () => void>();
let seq = 0;

export function registerFocus(key: number, focus: (() => void) | null) {
  if (focus) focusers.set(key, focus);
  else focusers.delete(key);
}

export async function focusTerminal(key = terminal.active) {
  await nextTick();
  if (key != null) focusers.get(key)?.();
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
