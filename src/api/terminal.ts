import { Channel, invoke } from "@tauri-apps/api/core";

export interface SpawnOptions {
  cwd?: string | null;
  cols: number;
  rows: number;
  onData: (data: Uint8Array) => void;
  onExit: (code: number) => void;
}

/** 启动 shell（Windows 下是 PowerShell），返回终端 id */
export function spawnTerminal({ cwd, cols, rows, onData, onExit }: SpawnOptions) {
  const dataChannel = new Channel<ArrayBuffer>();
  dataChannel.onmessage = (buf) => onData(new Uint8Array(buf));
  const exitChannel = new Channel<number>();
  exitChannel.onmessage = onExit;
  return invoke<number>("term_spawn", {
    cwd: cwd ?? null,
    cols,
    rows,
    onData: dataChannel,
    onExit: exitChannel,
  });
}

export const writeTerminal = (id: number, data: string) => invoke<void>("term_write", { id, data });
export const resizeTerminal = (id: number, cols: number, rows: number) =>
  invoke<void>("term_resize", { id, cols, rows });
export const killTerminalProcess = (id: number) => invoke<void>("term_kill", { id });
