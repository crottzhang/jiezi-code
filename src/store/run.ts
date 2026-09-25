import { reactive, watch } from "vue";
import { layout } from "./layout";
import { focusTerminal, nextTerminalKey, type TermInfo } from "./terminal";
import { promptInput } from "./ui";
import { workspace } from "./workspace";

const KEY = "jiezi.run";

export const run = reactive({
  /** 常用命令，按文件夹分别保存；没打开文件夹时用 "" */
  commands: [] as string[],
  /** 运行视图自己的终端，和右边的终端面板互不相干 */
  sessions: [] as TermInfo[],
  active: null as number | null,
});

const folderKey = () => workspace.root ?? "";

function readAll(): Record<string, string[]> {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return all && typeof all === "object" ? all : {};
  } catch {
    return {};
  }
}

function reload() {
  const list = readAll()[folderKey()];
  run.commands = Array.isArray(list) ? list.filter((c) => typeof c === "string") : [];
}

// 每次保存前重新读取，只改当前文件夹这一项：其他窗口可能刚保存过别的文件夹
function save() {
  const all = readAll();
  if (run.commands.length) all[folderKey()] = [...run.commands];
  else delete all[folderKey()];
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // 存储不可用时只在本次运行中有效
  }
}

watch(() => workspace.root, reload, { immediate: true });

// 其他窗口改了同一个文件夹的命令时同步过来
window.addEventListener("storage", (e) => {
  if (e.key === KEY) reload();
});

async function askCommand(title: string, value = "") {
  const command = await promptInput(title, value, {
    placeholder: "例如 npm run dev",
    selectAll: true,
  });
  return command?.trim() || null;
}

export async function addRunCommand() {
  const command = await askCommand("添加运行命令");
  if (!command) return;
  run.commands.push(command);
  save();
}

export async function editRunCommand(index: number) {
  const command = await askCommand("编辑运行命令", run.commands[index]);
  if (!command) return;
  run.commands[index] = command;
  save();
}

export function removeRunCommand(index: number) {
  run.commands.splice(index, 1);
  save();
}

let runSeq = 0;

/** 在运行视图里开一个新终端（Run N）；带命令时 shell 就绪后自动执行 */
export function newRunTerminal(command?: string) {
  const key = nextTerminalKey();
  run.sessions.push({ key, title: `Run ${++runSeq}`, exited: false, command });
  run.active = key;
  layout.sidebarView = "run";
  layout.sidebarVisible = true;
}

export function markRunExited(key: number) {
  const info = run.sessions.find((s) => s.key === key);
  if (info) info.exited = true;
}

/** 关闭终端标签；对应的 TerminalView 卸载时会结束进程 */
export function closeRunTerminal(key: number) {
  const index = run.sessions.findIndex((s) => s.key === key);
  if (index < 0) return;
  run.sessions.splice(index, 1);
  if (run.active === key) {
    run.active = (run.sessions[index] ?? run.sessions[index - 1])?.key ?? null;
  }
  focusTerminal(run.active);
}
