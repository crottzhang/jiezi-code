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

export const layout = reactive({
  sidebarVisible: (saved.sidebarVisible as boolean) ?? true,
  sidebarWidth: (saved.sidebarWidth as number) || 260,
  panelWidth: (saved.panelWidth as number) || 480,
});

watch(layout, () => {
  try {
    localStorage.setItem(KEY, JSON.stringify(layout));
  } catch {
    // 存储不可用时不影响使用
  }
});

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
