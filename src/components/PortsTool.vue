<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { ask } from "@tauri-apps/plugin-dialog";
import { revealPath } from "../api/fs";
import { killProcess, listPorts, type PortEntry } from "../api/ports";
import { tools } from "../store/tools";
import { toast } from "../store/ui";

const entries = ref<PortEntry[]>([]);
const loading = ref(false);
const filter = ref("");
const protocol = ref<"ALL" | "TCP" | "UDP">("TCP");
/** 正在结束的进程，防止重复点击 */
const killing = ref<number | null>(null);
const input = ref<HTMLInputElement>();

const protocols = [
  { id: "TCP", label: "TCP 监听" },
  { id: "UDP", label: "UDP" },
  { id: "ALL", label: "全部" },
] as const;

const shown = computed(() => {
  const q = filter.value.trim().toLowerCase();
  const list = entries.value.filter(
    (e) =>
      (protocol.value === "ALL" || e.protocol === protocol.value) &&
      (!q ||
        String(e.port).includes(q) ||
        String(e.pid) === q ||
        e.name.toLowerCase().includes(q) ||
        e.address.includes(q)),
  );
  // 输入纯数字时，端口号完全相同的排在最前面
  if (/^\d+$/.test(q)) {
    const port = Number(q);
    return [...list.filter((e) => e.port === port), ...list.filter((e) => e.port !== port)];
  }
  return list;
});

async function refresh() {
  loading.value = true;
  try {
    entries.value = await listPorts();
  } catch (e) {
    toast(`读取端口失败：${e}`);
  } finally {
    loading.value = false;
  }
}

function close() {
  tools.ports = false;
}

function displayName(e: PortEntry) {
  return e.name || "（未知进程）";
}

async function kill(e: PortEntry) {
  const ports = [...new Set(entries.value.filter((x) => x.pid === e.pid).map((x) => x.port))];
  const ok = await ask(
    `确定要结束进程 ${displayName(e)}（PID ${e.pid}）吗？\n\n` +
      `它占用的端口 ${ports.join("、")} 都会被释放，进程中未保存的数据会丢失。`,
    { title: "结束进程", kind: "warning", okLabel: "结束进程", cancelLabel: "取消" },
  );
  if (!ok) return;
  killing.value = e.pid;
  try {
    await killProcess(e.pid);
    toast(`已结束 ${displayName(e)}（PID ${e.pid}）`, { kind: "info" });
  } catch (err) {
    toast(err);
  } finally {
    killing.value = null;
  }
  await refresh();
}

function reveal(e: PortEntry) {
  if (e.path) revealPath(e.path).catch(toast);
}

async function copy(text: string) {
  await navigator.clipboard.writeText(text);
  toast(`已复制：${text}`, { kind: "info" });
}

function onKey(e: KeyboardEvent) {
  if (e.key !== "Escape") return;
  e.stopPropagation();
  if (filter.value) filter.value = "";
  else close();
}

onMounted(() => {
  refresh();
  input.value?.focus();
  window.addEventListener("keydown", onKey, true);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKey, true);
});
</script>

<template>
  <div class="mask" @mousedown.self="close">
    <div class="dialog" role="dialog" aria-label="端口占用">
      <header>
        <span class="title">端口占用</span>
        <span class="meta">{{ shown.length }} 项</span>
        <span class="spacer"></span>
        <button class="icon-btn" title="关闭 (Esc)" @click="close">
          <svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8" /></svg>
        </button>
      </header>

      <div class="toolbar">
        <input
          ref="input"
          v-model="filter"
          class="filter"
          placeholder="按端口、进程名或 PID 过滤"
          spellcheck="false"
          autocomplete="off"
        />
        <div class="seg">
          <button
            v-for="p in protocols"
            :key="p.id"
            :class="{ active: protocol === p.id }"
            @click="protocol = p.id"
          >
            {{ p.label }}
          </button>
        </div>
        <button class="text-btn" :disabled="loading" @click="refresh">
          {{ loading ? "刷新中…" : "刷新" }}
        </button>
      </div>

      <div class="table-wrap">
        <table v-if="shown.length">
          <thead>
            <tr>
              <th class="num">端口</th>
              <th>协议</th>
              <th>本地地址</th>
              <th class="num">PID</th>
              <th>进程</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="e in shown" :key="`${e.protocol}-${e.address}-${e.port}-${e.pid}`">
              <td class="num port" title="复制端口号" @dblclick="copy(String(e.port))">{{ e.port }}</td>
              <td class="muted">{{ e.protocol }}</td>
              <td class="muted" :title="e.address">{{ e.address }}</td>
              <td class="num" title="复制 PID" @dblclick="copy(String(e.pid))">{{ e.pid }}</td>
              <td class="name" :title="e.path ?? e.name">
                <span :class="{ muted: !e.name }">{{ displayName(e) }}</span>
                <span v-if="e.path" class="path">{{ e.path }}</span>
              </td>
              <td>
                <div class="actions">
                  <button
                    class="icon-btn"
                    title="在文件管理器中显示"
                    :disabled="!e.path"
                    @click="reveal(e)"
                  >
                    <svg viewBox="0 0 16 16"><path d="M2 4.5v8h12v-7H7.5L6 4H2.5z" /></svg>
                  </button>
                  <button
                    class="text-btn danger"
                    :disabled="e.pid <= 4 || killing === e.pid"
                    @click="kill(e)"
                  >
                    {{ killing === e.pid ? "结束中…" : "结束进程" }}
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-else-if="!loading" class="empty">
          {{ filter ? "没有匹配的端口" : "没有占用中的端口" }}
        </div>
      </div>

      <footer>
        <span>双击端口号或 PID 复制 · 结束系统或其他用户的进程需要以管理员身份运行</span>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  z-index: 90;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px 16px;
  background: rgba(0, 0, 0, 0.4);
}
.dialog {
  display: flex;
  flex-direction: column;
  width: 880px;
  max-width: 100%;
  height: 600px;
  max-height: 100%;
  border: 1px solid var(--widget-border);
  border-radius: 6px;
  background: var(--bg-widget);
  box-shadow: var(--shadow);
  overflow: hidden;
}
header,
.toolbar,
footer {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: none;
}
header {
  height: 40px;
  padding: 0 8px 0 14px;
  border-bottom: 1px solid var(--border);
}
.title {
  color: var(--fg-strong);
  font-weight: 600;
}
.meta {
  margin-left: 4px;
  color: var(--fg-muted);
  font-size: 12px;
}
.spacer {
  flex: 1;
}
.toolbar {
  gap: 8px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--border);
}
.filter {
  flex: 1;
  min-width: 0;
  height: 26px;
  padding: 0 8px;
  border: 1px solid var(--border-input);
  border-radius: var(--radius);
  outline: none;
  background: var(--bg-input);
  color: var(--fg-strong);
  font: inherit;
}
.filter:focus {
  border-color: var(--accent);
}
.seg {
  display: flex;
  flex: none;
  border: 1px solid var(--border-input);
  border-radius: var(--radius);
  overflow: hidden;
}
.seg button {
  height: 24px;
  padding: 0 10px;
  color: var(--fg-muted);
  font-size: 12px;
}
.seg button + button {
  border-left: 1px solid var(--border-input);
}
.seg button:hover {
  background: var(--hover);
  color: var(--fg-strong);
}
.seg button.active {
  background: var(--accent);
  color: var(--accent-fg);
}
.text-btn {
  flex: none;
  height: 24px;
  padding: 0 8px;
  border-radius: 4px;
  color: var(--fg);
  font-size: 12px;
  white-space: nowrap;
}
.text-btn:hover:not(:disabled),
.icon-btn:hover:not(:disabled) {
  background: var(--hover);
  color: var(--fg-strong);
}
.text-btn.danger:hover:not(:disabled) {
  color: var(--danger);
}
.text-btn:disabled,
.icon-btn:disabled {
  opacity: 0.35;
  cursor: default;
}
.icon-btn {
  width: 24px;
  height: 24px;
  border-radius: 4px;
  color: var(--fg-muted);
}
.icon-btn svg {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.table-wrap {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  font-size: 12px;
}
th {
  position: sticky;
  top: 0;
  z-index: 1;
  height: 28px;
  padding: 0 8px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-widget);
  color: var(--fg-muted);
  font-weight: normal;
  text-align: left;
}
th:nth-child(1) {
  width: 72px;
}
th:nth-child(2) {
  width: 52px;
}
th:nth-child(3) {
  width: 150px;
}
th:nth-child(4) {
  width: 72px;
}
th:nth-child(6) {
  width: 116px;
}
td {
  height: 30px;
  padding: 0 8px;
  border-bottom: 1px solid var(--border);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
tr:hover td {
  background: var(--hover);
}
th.num,
td.num {
  padding-right: 16px;
  font-variant-numeric: tabular-nums;
  text-align: right;
}
td.port {
  color: var(--fg-strong);
  font-weight: 600;
}
.muted {
  color: var(--fg-muted);
}
.name .path {
  margin-left: 8px;
  color: var(--fg-muted);
}
.actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 2px;
}
.empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--fg-muted);
}

footer {
  height: 28px;
  padding: 0 14px;
  border-top: 1px solid var(--border);
  color: var(--fg-muted);
  font-size: 12px;
}
</style>
