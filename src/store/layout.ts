import { reactive, watch } from "vue";

const KEY = "jiezi.layout";

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
}

const saved = load();

export type SidebarView = "explorer" | "search" | "scm" | "run";
const VIEWS: SidebarView[] = ["explorer", "search", "scm", "run"];

export const layout = reactive({
  sidebarVisible: (saved.sidebarVisible as boolean) ?? true,
  sidebarView: (VIEWS.includes(saved.sidebarView) ? saved.sidebarView : "explorer") as SidebarView,
  sidebarWidth: (saved.sidebarWidth as number) || 260,
  panelWidth: (saved.panelWidth as number) || 480,
  /** 光标所在行末尾显示 Git 作者信息 */
  blame: (saved.blame as boolean) ?? true,
  /** 对比时左右并排显示，否则在一个编辑器里行内显示 */
  diffSplit: (saved.diffSplit as boolean) ?? false,
});

watch(layout, () => {
  try {
    localStorage.setItem(KEY, JSON.stringify(layout));
  } catch {
    // 存储不可用时不影响使用
  }
});

/** 切换侧边栏视图；已经显示着这个视图时收起侧边栏 */
export function toggleView(view: SidebarView) {
  if (layout.sidebarVisible && layout.sidebarView === view) {
    layout.sidebarVisible = false;
  } else {
    layout.sidebarView = view;
    layout.sidebarVisible = true;
  }
}

/** 拖动分隔条：onMove 收到相对按下位置的水平位移 */
export function startDrag(e: MouseEvent, onMove: (dx: number) => void) {
  e.preventDefault();
  const startX = e.clientX;
  const move = (ev: MouseEvent) => onMove(ev.clientX - startX);
  const up = () => {
    window.removeEventListener("mousemove", move);
    window.removeEventListener("mouseup", up);
    document.body.classList.remove("resizing");
  };
  window.addEventListener("mousemove", move);
  window.addEventListener("mouseup", up);
  document.body.classList.add("resizing");
}

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
