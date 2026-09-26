import { getCommand, isEnabled } from "./commands";
import { baseName } from "./api/fs";
import { openFolder, recentFolders } from "./store/workspace";
import { themes } from "./theme/themes";

export type MenuNode =
  | { separator: true }
  | {
      label: string;
      keys?: string;
      checked?: boolean;
      disabled?: boolean;
      run?: () => void;
      children?: MenuNode[];
    };

const SEP: MenuNode = { separator: true };

function cmd(id: string): MenuNode {
  const c = getCommand(id);
  return {
    label: c.label,
    keys: c.keys,
    checked: c.checked?.(),
    disabled: !isEnabled(c),
    run: () => c.run(),
  };
}

/** 汉堡菜单内容，每次打开时重新生成，保证勾选/禁用状态是最新的 */
export function buildAppMenu(): MenuNode[] {
  const recent = recentFolders();
  return [
    {
      label: "文件",
      children: [
        cmd("file.newFile"),
        cmd("file.newFolder"),
        cmd("notes.new"),
        SEP,
        cmd("file.openFolder"),
        {
          label: "最近打开",
          disabled: recent.length === 0,
          children: recent.map((path) => ({
            label: `${baseName(path)}  —  ${path}`,
            run: () => openFolder(path),
          })),
        },
        cmd("file.newWindow"),
        SEP,
        cmd("file.save"),
        cmd("file.saveAll"),
        SEP,
        cmd("file.reveal"),
        SEP,
        cmd("file.closeEditor"),
        cmd("file.closeFolder"),
        cmd("file.closeWindow"),
      ],
    },
    {
      label: "编辑",
      children: [
        cmd("edit.undo"),
        cmd("edit.redo"),
        SEP,
        cmd("edit.find"),
        cmd("edit.findInFiles"),
        cmd("edit.replaceInFiles"),
        SEP,
        cmd("edit.selectAll"),
        cmd("edit.toggleComment"),
      ],
    },
    {
      label: "视图",
      children: [
        cmd("go.commandPalette"),
        cmd("go.quickOpen"),
        cmd("go.line"),
        SEP,
        cmd("view.sidebar"),
        cmd("view.explorer"),
        cmd("view.search"),
        cmd("view.scm"),
        cmd("view.run"),
        cmd("view.notes"),
        cmd("view.terminal"),
        cmd("terminal.new"),
        SEP,
        {
          label: "主题",
          children: themes.map((t) => ({ ...cmd(`theme.${t.id}`), label: t.name })),
        },
      ],
    },
    {
      label: "Git",
      children: [
        cmd("git.commit"),
        cmd("git.commitPush"),
        cmd("git.amend"),
        cmd("git.undoCommit"),
        SEP,
        cmd("git.pull"),
        cmd("git.push"),
        cmd("git.sync"),
        cmd("git.fetch"),
        cmd("git.clone"),
        SEP,
        {
          label: "分支",
          children: [
            cmd("git.checkout"),
            cmd("git.branch"),
            cmd("git.merge"),
            cmd("git.renameBranch"),
            cmd("git.deleteBranch"),
          ],
        },
        {
          label: "储藏",
          children: [cmd("git.stash"), cmd("git.stashUntracked"), cmd("git.stashPop")],
        },
        SEP,
        cmd("git.fileHistory"),
        cmd("git.blame"),
        cmd("git.diffSplit"),
        cmd("git.output"),
        cmd("git.refresh"),
      ],
    },
    { label: "帮助", children: [cmd("help.about")] },
  ];
}
