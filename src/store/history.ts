import { reactive, watch } from "vue";
import { baseName } from "../api/fs";
import * as gitApi from "../api/git";
import type { CommitFile, GitCommit } from "../api/git";
import { applyDiff, git, relPath } from "./git";
import { layout } from "./layout";
import { toast } from "./ui";
import { openVirtualFile, workspace } from "./workspace";

/** 每次读取的提交数 */
const PAGE = 50;

/** 历史版本标签页的虚拟路径前缀：git:<短哈希>:<相对路径> */
const VIRTUAL_PREFIX = "git:";

export const history = reactive({
  /** 历史记录分组是否展开；收起时不读取 */
  open: true,
  commits: [] as GitCommit[],
  loading: false,
  /** 已经读到最早的提交 */
  done: false,
  /** 只看改动过这个文件的提交（仓库内相对路径） */
  filter: null as string | null,
  /** 展开查看改动文件的提交 */
  expanded: {} as Record<string, boolean>,
  /** 提交 → 改动的文件，读取中为 null */
  files: {} as Record<string, CommitFile[] | null>,
});

let seq = 0;

/** reset 为 true 时从头读取，否则接着读下一页 */
export async function loadHistory(reset = true) {
  const root = git.status?.root;
  if (!root) {
    seq++;
    history.commits = [];
    history.done = true;
    history.loading = false;
    return;
  }
  if (!reset && (history.loading || history.done)) return;
  const id = ++seq;
  history.loading = true;
  try {
    const page = await gitApi.gitLog(root, reset ? 0 : history.commits.length, PAGE, history.filter);
    if (id !== seq) return;
    history.commits = reset ? page : [...history.commits, ...page];
    history.done = page.length < PAGE;
  } catch (e) {
    if (id === seq) toast(e);
  } finally {
    if (id === seq) history.loading = false;
  }
}

// 提交、切换分支、拉取、推送之后 HEAD 或领先/落后数会变，这时重新读取；收起时不读
watch(
  () => [
    history.open,
    history.filter,
    git.status?.root,
    git.status?.head,
    git.status?.branch,
    git.status?.ahead,
    git.status?.behind,
  ],
  () => {
    if (history.open) loadHistory();
  },
  { immediate: true },
);

watch(
  () => workspace.root,
  () => {
    history.filter = null;
    history.expanded = {};
    history.files = {};
  },
);

export async function toggleCommit(commit: GitCommit) {
  const hash = commit.hash;
  history.expanded[hash] = !history.expanded[hash];
  if (!history.expanded[hash] || history.files[hash] !== undefined) return;
  const root = git.status?.root;
  if (!root) return;
  history.files[hash] = null;
  try {
    history.files[hash] = await gitApi.gitCommitFiles(root, hash);
  } catch (e) {
    delete history.files[hash];
    history.expanded[hash] = false;
    toast(e);
  }
}

/** 以只读标签页打开文件在这个提交里的版本，并与父提交中的版本对比 */
export async function openCommitFile(commit: GitCommit, file: CommitFile) {
  const root = git.status?.root;
  if (!root) return;
  const parent = commit.parents[0];
  try {
    const [content, original] = await Promise.all([
      file.status === "D" ? "" : gitApi.gitShow(root, commit.hash, file.path),
      parent && file.status !== "A"
        ? gitApi.gitShow(root, parent, file.origPath ?? file.path)
        : null,
    ]);
    const tab = await openVirtualFile(
      `${VIRTUAL_PREFIX}${commit.short}:${file.path}`,
      `${baseName(file.path)} (${commit.short})`,
      baseName(file.path),
      content ?? "",
    );
    if (original != null) {
      await applyDiff(tab, original, { rev: parent, rel: file.origPath ?? file.path, label: parent.slice(0, 7) });
    }
  } catch (e) {
    toast(e);
  }
}

/** 在源代码管理面板里只显示改动过这个文件的提交 */
export function showFileHistory(path: string) {
  const rel = path.startsWith(VIRTUAL_PREFIX) ? path.split(":").slice(2).join(":") : relPath(path);
  if (!rel) {
    toast("这个文件不在 Git 仓库中");
    return;
  }
  history.filter = rel;
  history.open = true;
  layout.sidebarView = "scm";
  layout.sidebarVisible = true;
}

export function clearFileHistory() {
  history.filter = null;
}

/** 提交时间显示成“3 分钟前”这类相对时间，超过一个月显示日期 */
export function relativeTime(seconds: number) {
  const diff = Date.now() / 1000 - seconds;
  if (diff < 60) return "刚刚";
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)} 天前`;
  return formatTime(seconds, false);
}

export function formatTime(seconds: number, withTime = true) {
  const d = new Date(seconds * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return withTime ? `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}` : date;
}
