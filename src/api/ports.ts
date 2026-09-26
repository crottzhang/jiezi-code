import { invoke } from "@tauri-apps/api/core";

export interface PortEntry {
  protocol: "TCP" | "UDP";
  address: string;
  port: number;
  pid: number;
  /** 进程名，取不到时为空 */
  name: string;
  /** 可执行文件完整路径，权限不足时为 null */
  path: string | null;
}

/** 所有 TCP 监听端口和 UDP 绑定端口，按端口排序 */
export const listPorts = () => invoke<PortEntry[]>("port_list");
/** 强制结束进程 */
export const killProcess = (pid: number) => invoke<void>("process_kill", { pid });
