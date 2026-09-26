import { reactive } from "vue";

/** 工具菜单里各个小工具对话框的开关 */
export const tools = reactive({
  ports: false,
});

export function openPortsTool() {
  tools.ports = true;
}
