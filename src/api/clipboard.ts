import { invoke } from "@tauri-apps/api/core";

export interface ClipboardImage {
  name: string;
  path: string;
  size: number;
  /** 修改时间，毫秒时间戳 */
  modified: number;
}

const pad = (n: number, len = 2) => String(n).padStart(len, "0");
const IMAGE_EXT: Record<string, string> = { "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };

/** 把截图保存到 exe 目录下的 .temp/clipboard，返回文件绝对路径 */
export async function saveClipboardImage(image: Blob) {
  const d = new Date();
  const stamp =
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${pad(d.getMilliseconds(), 3)}`;
  const ext = IMAGE_EXT[image.type] ?? "png";
  return invoke<string>("save_clipboard_image", new Uint8Array(await image.arrayBuffer()), {
    headers: { "x-file-name": `image-${stamp}.${ext}` },
  });
}

/** 所有截图，新的在前 */
export const listClipboardImages = () =>
  invoke<{ dir: string; images: ClipboardImage[] }>("list_clipboard_images");
export const readClipboardImage = (name: string) =>
  invoke<ArrayBuffer>("read_clipboard_image", { name });
export const deleteClipboardImages = (names: string[]) =>
  invoke<void>("delete_clipboard_images", { names });
/** 在文件管理器中显示截图，不传文件名时打开截图目录 */
export const revealClipboardImage = (name?: string) =>
  invoke<void>("reveal_clipboard_image", { name: name ?? null });
