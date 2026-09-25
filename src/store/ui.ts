import { reactive } from "vue";

export interface MenuItem {
  label: string;
  action: () => void;
  danger?: boolean;
}

export const ui = reactive({
  prompt: null as null | {
    title: string;
    value: string;
    resolve: (value: string | null) => void;
  },
  menu: null as null | { x: number; y: number; items: MenuItem[] },
  toast: null as null | { text: string; id: number },
  /** 快速打开面板：text 以 ">" 开头是命令，":" 开头是跳转行，否则搜索文件 */
  palette: null as null | { text: string; id: number },
});

let paletteId = 0;
export function openPalette(text = "") {
  ui.palette = { text, id: ++paletteId };
}

export function closePalette() {
  ui.palette = null;
}

/** 顶部输入框，类似 VS Code 的 Quick Input */
export function promptInput(title: string, value = ""): Promise<string | null> {
  ui.prompt?.resolve(null);
  return new Promise((resolve) => {
    ui.prompt = {
      title,
      value,
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
export function toast(text: unknown) {
  const id = ++toastId;
  ui.toast = { text: String(text), id };
  setTimeout(() => {
    if (ui.toast?.id === id) ui.toast = null;
  }, 4000);
}
