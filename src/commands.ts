import { getVersion } from "@tauri-apps/api/app";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { message } from "@tauri-apps/plugin-dialog";
import { redo, selectAll, toggleComment, undo } from "@codemirror/commands";
import { openSearchPanel } from "@codemirror/search";
import type { EditorView } from "@codemirror/view";
import { newWindow } from "./api/fs";
import { getEditorView } from "./editor/view";
import {
  createBranch,
  pickBranch,
  pickBranchToDelete,
  pickBranchToMerge,
  renameBranch,
} from "./store/branches";
import {
  abortOperation,
  cloneRepo,
  commit,
  continueOperation,
  git,
  refreshGit,
  remote,
  startAmend,
  sync,
  undoLastCommit,
} from "./store/git";
import { showOutput } from "./store/output";
import { popLatestStash, stashChanges } from "./store/stash";
import { showFileHistory } from "./store/history";
import { layout, toggleView } from "./store/layout";
import { openSearch } from "./store/search";
import { newTerminal, terminal, toggleTerminal } from "./store/terminal";
import { openPalette, toast } from "./store/ui";
import { setTheme, theme } from "./theme";
import { themes } from "./theme/themes";
import {
  activeTab,
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
const hasRepo = () => git.status != null;
const inOperation = () => !!git.status?.operation;

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
  { id: "edit.findInFiles", label: "在文件中查找", keys: "Ctrl+Shift+F", run: () => openSearch() },
  { id: "edit.replaceInFiles", label: "在文件中替换", keys: "Ctrl+Shift+H", run: () => openSearch(true) },
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
  {
    id: "view.explorer",
    label: "资源管理器",
    keys: "Ctrl+Shift+E",
    run: () => toggleView("explorer"),
    checked: () => layout.sidebarVisible && layout.sidebarView === "explorer",
  },
  {
    id: "view.search",
    label: "搜索",
    keys: "Ctrl+Shift+F",
    run: () => toggleView("search"),
    checked: () => layout.sidebarVisible && layout.sidebarView === "search",
  },
  {
    id: "view.scm",
    label: "源代码管理",
    keys: "Ctrl+Shift+G",
    run: () => toggleView("scm"),
    checked: () => layout.sidebarVisible && layout.sidebarView === "scm",
  },
  {
    id: "view.run",
    label: "运行",
    keys: "Ctrl+Shift+D",
    run: () => toggleView("run"),
    checked: () => layout.sidebarVisible && layout.sidebarView === "run",
  },
  { id: "view.terminal", label: "终端", keys: "Ctrl+`", run: toggleTerminal, checked: () => terminal.visible },
  { id: "terminal.new", label: "新建终端", run: newTerminal },

  { id: "git.commit", label: "Git：提交", run: () => commit(), enabled: hasRepo },
  { id: "git.commitPush", label: "Git：提交并推送", run: () => commit("push"), enabled: hasRepo },
  { id: "git.commitSync", label: "Git：提交并同步", run: () => commit("sync"), enabled: hasRepo },
  { id: "git.amend", label: "Git：修改上次提交…", run: startAmend, enabled: hasRepo },
  { id: "git.undoCommit", label: "Git：撤销上次提交", run: undoLastCommit, enabled: hasRepo },
  { id: "git.continue", label: "Git：继续合并/变基", run: continueOperation, enabled: inOperation },
  { id: "git.abort", label: "Git：中止合并/变基", run: abortOperation, enabled: inOperation },

  { id: "git.pull", label: "Git：拉取", run: () => remote("pull"), enabled: hasRepo },
  {
    id: "git.push",
    label: "Git：推送",
    run: () => remote(git.status?.upstream ? "push" : "publish"),
    enabled: hasRepo,
  },
  { id: "git.sync", label: "Git：同步（拉取并推送）", run: sync, enabled: hasRepo },
  { id: "git.fetch", label: "Git：抓取", run: () => remote("fetch"), enabled: hasRepo },
  { id: "git.pushTags", label: "Git：推送所有标签", run: () => remote("push-tags"), enabled: hasRepo },
  { id: "git.clone", label: "Git：克隆仓库…", run: cloneRepo },

  { id: "git.checkout", label: "Git：切换分支…", run: pickBranch, enabled: hasRepo },
  { id: "git.branch", label: "Git：新建分支…", run: () => createBranch(), enabled: hasRepo },
  { id: "git.merge", label: "Git：合并分支到当前分支…", run: pickBranchToMerge, enabled: hasRepo },
  { id: "git.renameBranch", label: "Git：重命名当前分支…", run: renameBranch, enabled: hasRepo },
  { id: "git.deleteBranch", label: "Git：删除分支…", run: pickBranchToDelete, enabled: hasRepo },

  { id: "git.stash", label: "Git：储藏改动…", run: () => stashChanges(false), enabled: hasRepo },
  {
    id: "git.stashUntracked",
    label: "Git：储藏改动（包含未跟踪的文件）…",
    run: () => stashChanges(true),
    enabled: hasRepo,
  },
  { id: "git.stashPop", label: "Git：弹出最新的储藏", run: popLatestStash, enabled: () => !!git.status?.stashCount },

  {
    id: "git.fileHistory",
    label: "Git：查看当前文件的历史",
    run: () => showFileHistory(activeTab()!.path),
    enabled: () => hasRepo() && hasEditor(),
  },
  {
    id: "git.blame",
    label: "Git：在行末显示作者信息",
    run: () => (layout.blame = !layout.blame),
    checked: () => layout.blame,
  },
  {
    id: "git.diffSplit",
    label: "Git：对比时左右并排显示",
    run: () => (layout.diffSplit = !layout.diffSplit),
    checked: () => layout.diffSplit,
  },
  { id: "git.output", label: "Git：显示输出", run: showOutput },
  { id: "git.refresh", label: "Git：刷新", run: refreshGit, enabled: hasRepo },

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
