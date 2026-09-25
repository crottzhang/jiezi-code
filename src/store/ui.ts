import { reactive } from "vue";

export type MenuItem =
  | {
      label: string;
      action: () => void;
      danger?: boolean;
      /** 仅用于显示的快捷键 */
      keys?: string;
      /** 灰显，点击无效 */
      disabled?: boolean;
    }
  /** 分隔线 */
  | { separator: true };

export const SEPARATOR: MenuItem = { separator: true };

export interface ToastAction {
  label: string;
  run: () => void;
}

/** 快速选择列表里的一项 */
export interface PickItem {
  label: string;
  detail?: string;
  run: () => void;
}

export const ui = reactive({
  prompt: null as null | {
    title: string;
    value: string;
    /** 密码类输入，隐藏内容 */
    secret: boolean;
    placeholder: string;
    /** 全选初始内容；否则像重命名文件一样只选中扩展名之前的部分 */
    selectAll: boolean;
    resolve: (value: string | null) => void;
  },
  menu: null as null | { x: number; y: number; items: MenuItem[] },
  toast: null as null | {
    text: string;
    id: number;
    kind: "error" | "info";
    action?: ToastAction;
  },
  /** 快速打开面板：text 以 ">" 开头是命令，":" 开头是跳转行，否则搜索文件 */
  palette: null as null | {
    text: string;
    id: number;
    /** 有值时面板变成通用的选择列表，按 label 过滤 */
    pick?: { placeholder: string; items: PickItem[] };
  },
});

let paletteId = 0;
export function openPalette(text = "") {
  ui.palette = { text, id: ++paletteId };
}

/** 用快速打开面板让用户从列表中选一项 */
export function openPicker(placeholder: string, items: PickItem[]) {
  ui.palette = { text: "", id: ++paletteId, pick: { placeholder, items } };
}

export function closePalette() {
  ui.palette = null;
}

/** 顶部输入框，类似 VS Code 的 Quick Input */
export function promptInput(
  title: string,
  value = "",
  options: { secret?: boolean; placeholder?: string; selectAll?: boolean } = {},
): Promise<string | null> {
  ui.prompt?.resolve(null);
  return new Promise((resolve) => {
    ui.prompt = {
      title,
      value,
      secret: options.secret ?? false,
      placeholder: options.placeholder ?? "",
      selectAll: options.selectAll ?? false,
      resolve: (v) => {
        ui.prompt = null;
        resolve(v);
      },
    };
  });
}

export function showMenu(e: MouseEvent, items: MenuItem[]) {
  e.preventDefault();
  e.stopPropagation();
  ui.menu = { x: e.clientX, y: e.clientY, items };
}

let toastId = 0;

/** 右下角的提示。默认是错误样式；带操作按钮的提示停留得久一些 */
export function toast(
  text: unknown,
  options: { kind?: "error" | "info"; action?: ToastAction } = {},
) {
  const id = ++toastId;
  ui.toast = { text: String(text), id, kind: options.kind ?? "error", action: options.action };
  setTimeout(
    () => {
      if (ui.toast?.id === id) ui.toast = null;
    },
    options.action ? 8000 : 4000,
  );
}
