/** 时间显示成“3 分钟前”这类相对时间，超过一个月显示日期。seconds 是 Unix 秒 */
export function relativeTime(seconds: number) {
  const diff = Date.now() / 1000 - seconds;
  if (diff < 60) return "刚刚";
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)} 天前`;
  return formatTime(seconds, false);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** 简短的时间：今天显示时分秒，今年显示月日，更早显示年月 */
export function shortTime(seconds: number) {
  const d = new Date(seconds * 1000);
  const now = new Date();
  if (d.getFullYear() !== now.getFullYear()) return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  if (d.getMonth() !== now.getMonth() || d.getDate() !== now.getDate()) {
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function formatTime(seconds: number, withTime = true) {
  const d = new Date(seconds * 1000);
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return withTime ? `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` : date;
}
