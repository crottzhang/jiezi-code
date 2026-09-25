import { reactive } from "vue";
import { themes, type ThemeDef } from "./themes";

const KEY = "jiezi.theme";

function readSaved() {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function findTheme(id: string | null) {
  return themes.find((t) => t.id === id) ?? themes[0];
}

export const theme = reactive({ id: findTheme(readSaved()).id });

export const currentTheme = (): ThemeDef => findTheme(theme.id);

/** 把主题写成 :root 上的 CSS 变量，界面和编辑器都读这些变量，切换时不用重建任何东西 */
function apply(def: ThemeDef) {
  const root = document.documentElement;
  for (const [name, value] of Object.entries(def.vars)) root.style.setProperty(`--${name}`, value);
  root.dataset.theme = def.id;
  theme.id = def.id;
}

export function setTheme(id: string) {
  apply(findTheme(id));
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // 存储不可用时只影响本窗口
  }
}

/** 挂载 Vue 之前调用，避免首屏闪一下默认颜色 */
export function initTheme() {
  apply(currentTheme());
  // 其他窗口切换主题时同步（同一个应用的窗口共享 localStorage）
  window.addEventListener("storage", (e) => {
    if (e.key === KEY) apply(findTheme(e.newValue));
  });
}
