import { listen } from "@tauri-apps/api/event";
import { findTabByPath, openVirtualFile, updateTabState, getState, workspace } from "./workspace";

interface OutputEntry {
  /** 执行命令的目录 */
  cwd: string;
  /** Unix 毫秒 */
  time: number;
  command: string;
  durationMs: number;
  ok: boolean;
  output: string;
}

/** 输出标签页的虚拟路径 */
const OUTPUT_PATH = "git:output";
/** 最多保留这么多字符，超出后丢掉最早的记录 */
const MAX_LENGTH = 400_000;

let text = "";
/** 本窗口发起克隆时的目标父目录，克隆命令的日志也要收下 */
const extraDirs = new Set<string>();

export function watchOutputDir(dir: string) {
  extraDirs.add(dir.toLowerCase());
}

const pad = (n: number) => String(n).padStart(2, "0");

function format(e: OutputEntry) {
  const d = new Date(e.time);
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const seconds = (e.durationMs / 1000).toFixed(e.durationMs < 10_000 ? 2 : 0);
  const head = `[${time}] ${e.ok ? "✓" : "✗"} ${e.command}  (${seconds}s)`;
  const body = e.output ? e.output.replace(/^/gm, "    ") + "\n" : "";
  return `${head}\n${body}`;
}

/** 只记录和本窗口的仓库有关的命令（多个窗口共享同一个后端） */
function belongsHere(e: OutputEntry) {
  const cwd = e.cwd.toLowerCase();
  const root = workspace.root?.toLowerCase();
  if (root && (cwd.startsWith(root) || root.startsWith(cwd))) return true;
  return extraDirs.has(cwd);
}

function append(chunk: string) {
  text += chunk;
  const tab = findTabByPath(OUTPUT_PATH);
  if (text.length > MAX_LENGTH) {
    // 超长时丢掉前面的一半，并整体替换标签页内容
    const cut = text.indexOf("\n[", text.length - MAX_LENGTH / 2);
    text = text.slice(cut + 1);
    if (tab) {
      const len = getState(tab.id)?.doc.length ?? 0;
      updateTabState(tab.id, { changes: { from: 0, to: len, insert: text } });
    }
    return;
  }
  if (!tab) return;
  const state = getState(tab.id);
  if (!state) return;
  const end = state.doc.length;
  // 光标在末尾时跟着滚动，用户往上翻看时不打扰
  const follow = state.selection.main.head === end;
  updateTabState(tab.id, {
    changes: { from: end, insert: chunk },
    ...(follow ? { selection: { anchor: end + chunk.length }, scrollIntoView: true } : {}),
  });
}

listen<OutputEntry>("git-output", (e) => {
  if (belongsHere(e.payload)) append(format(e.payload));
});

/** 打开 Git 输出日志 */
export async function showOutput() {
  const tab = await openVirtualFile(OUTPUT_PATH, "Git 输出", "git-output.log", text || "（还没有执行过 git 命令）\n");
  const state = getState(tab.id);
  if (state) {
    updateTabState(tab.id, { selection: { anchor: state.doc.length }, scrollIntoView: true });
  }
}
