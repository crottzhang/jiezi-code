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
        cmd("view.scm"),
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
        cmd("git.amend"),
        SEP,
        cmd("git.pull"),
        cmd("git.push"),
        cmd("git.sync"),
        cmd("git.fetch"),
        SEP,
        cmd("git.checkout"),
        cmd("git.fileHistory"),
        cmd("git.refresh"),
      ],
    },
    { label: "帮助", children: [cmd("help.about")] },
  ];
}
