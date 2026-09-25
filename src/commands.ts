import { getVersion } from "@tauri-apps/api/app";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { message } from "@tauri-apps/plugin-dialog";
import { redo, selectAll, toggleComment, undo } from "@codemirror/commands";
import { openSearchPanel } from "@codemirror/search";
import type { EditorView } from "@codemirror/view";
import { newWindow } from "./api/fs";
import { getEditorView } from "./editor/view";
import { layout } from "./store/layout";
import { newTerminal, terminal, toggleTerminal } from "./store/terminal";
import { openPalette, toast } from "./store/ui";
import { setTheme, theme } from "./theme";
import { themes } from "./theme/themes";
import {
  closeFolder,
  closeTab,
  newEntry,
  openFolder,
  saveAll,
  saveFile,
  workspace,
} from "./store/workspace";

/** 菜单和命令面板共用的命令表 */
export interface Command {
  id: string;
  label: string;
  /** 仅用于显示，实际按键处理在 App.vue 和 CodeMirror 的 keymap 里 */
  keys?: string;
  run: () => unknown;
  enabled?: () => boolean;
  checked?: () => boolean;
}

function editorCommand(fn: (view: EditorView) => boolean) {
  return () => {
    const view = getEditorView();
    if (!view) return;
    view.focus();
    fn(view);
  };
}

const hasFolder = () => workspace.root != null;
const hasEditor = () => workspace.active != null;

async function showAbout() {
  const version = await getVersion();
  await message(`Jiezi Code ${version}\n基于 Tauri 2 + Vue 3 + CodeMirror 6 的轻量代码编辑器`, {
    title: "关于",
    kind: "info",
  });
}

export const commands: Command[] = [
  { id: "file.newFile", label: "新建文件…", run: () => newEntry(workspace.root!, false), enabled: hasFolder },
  { id: "file.newFolder", label: "新建文件夹…", run: () => newEntry(workspace.root!, true), enabled: hasFolder },
  { id: "file.openFolder", label: "打开文件夹…", keys: "Ctrl+O", run: () => openFolder() },
  { id: "file.newWindow", label: "新建窗口", keys: "Ctrl+Shift+N", run: () => newWindow().catch(toast) },
  { id: "file.save", label: "保存", keys: "Ctrl+S", run: () => saveFile(), enabled: hasEditor },
  {
    id: "file.saveAll",
    label: "全部保存",
    keys: "Ctrl+Alt+S",
    run: saveAll,
    enabled: () => workspace.tabs.some((t) => t.dirty),
  },
  { id: "file.closeEditor", label: "关闭编辑器", keys: "Ctrl+W", run: () => closeTab(), enabled: hasEditor },
  { id: "file.closeFolder", label: "关闭文件夹", run: closeFolder, enabled: hasFolder },
  { id: "file.closeWindow", label: "关闭窗口", keys: "Alt+F4", run: () => getCurrentWindow().close() },

  { id: "edit.undo", label: "撤销", keys: "Ctrl+Z", run: editorCommand(undo), enabled: hasEditor },
  { id: "edit.redo", label: "重做", keys: "Ctrl+Y", run: editorCommand(redo), enabled: hasEditor },
  { id: "edit.find", label: "查找/替换", keys: "Ctrl+F", run: editorCommand(openSearchPanel), enabled: hasEditor },
  { id: "edit.selectAll", label: "全选", keys: "Ctrl+A", run: editorCommand(selectAll), enabled: hasEditor },
  {
    id: "edit.toggleComment",
    label: "切换行注释",
    keys: "Ctrl+/",
    run: editorCommand(toggleComment),
    enabled: hasEditor,
  },

  { id: "go.quickOpen", label: "转到文件…", keys: "Ctrl+P", run: () => openPalette("") },
  { id: "go.commandPalette", label: "命令面板…", keys: "Ctrl+Shift+P", run: () => openPalette(">") },
  { id: "go.line", label: "转到行…", keys: "Ctrl+G", run: () => openPalette(":"), enabled: hasEditor },

  {
    id: "view.sidebar",
    label: "侧边栏",
    keys: "Ctrl+B",
    run: () => (layout.sidebarVisible = !layout.sidebarVisible),
    checked: () => layout.sidebarVisible,
  },
  { id: "view.terminal", label: "终端", keys: "Ctrl+`", run: toggleTerminal, checked: () => terminal.visible },
  { id: "terminal.new", label: "新建终端", run: newTerminal },

  ...themes.map((t) => ({
    id: `theme.${t.id}`,
    label: `主题：${t.name}`,
    run: () => setTheme(t.id),
    checked: () => theme.id === t.id,
  })),

  { id: "help.about", label: "关于 Jiezi Code", run: showAbout },
];

const byId = new Map(commands.map((c) => [c.id, c]));

export function getCommand(id: string) {
  const cmd = byId.get(id);
  if (!cmd) throw new Error(`未知命令：${id}`);
  return cmd;
}

export const isEnabled = (cmd: Command) => cmd.enabled?.() ?? true;

export function runCommand(cmd: Command) {
  if (isEnabled(cmd)) cmd.run();
}
