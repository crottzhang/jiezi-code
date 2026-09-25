import { reactive, watch } from "vue";
import { ask } from "@tauri-apps/plugin-dialog";
import { baseName } from "../api/fs";
import * as gitApi from "../api/git";
import type { CommitFile, GitCommit } from "../api/git";
import { applyDiff } from "./diff";
import { git, relPath, runGit } from "./git";
import { layout } from "./layout";
import { openPicker, promptInput, toast } from "./ui";
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
  /** 查看哪个分支的历史，null 为当前分支 */
  rev: null as string | null,
  /** 搜索框里的内容：按提交信息、作者、哈希过滤 */
  query: "",
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
    const skip = reset ? 0 : history.commits.length;
    const page = await gitApi.gitLog(root, skip, PAGE, history.filter, history.rev, history.query.trim());
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
    history.rev,
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

// 搜索框输入时稍等一下再读，免得每敲一个字都跑一次 git log
let queryTimer: ReturnType<typeof setTimeout> | undefined;
watch(
  () => history.query.trim(),
  () => {
    clearTimeout(queryTimer);
    queryTimer = setTimeout(() => {
      if (history.open) loadHistory();
    }, 250);
  },
);

watch(
  () => workspace.root,
  () => {
    history.filter = null;
    history.rev = null;
    history.query = "";
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

/**
 * 以只读标签页打开文件在这个提交里的版本，并与父提交中的版本对比。
 * parentLabel 是对比栏里父版本的名字，默认用父提交的短哈希
 */
export async function openCommitFile(commit: GitCommit, file: CommitFile, parentLabel?: string) {
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
      await applyDiff(tab, original, {
        rev: parent,
        rel: file.origPath ?? file.path,
        label: parentLabel ?? parent.slice(0, 7),
      });
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

export function showCurrentBranchHistory() {
  history.rev = null;
}

export function clearFileHistory() {
  history.filter = null;
}

/** 选择查看哪个分支的历史 */
export async function pickHistoryBranch() {
  const root = git.status?.root;
  if (!root) return;
  let branches;
  try {
    branches = await gitApi.gitBranches(root);
  } catch (e) {
    toast(e);
    return;
  }
  openPicker("查看哪个分支的历史", [
    { label: "当前分支", detail: git.status?.branch ?? "HEAD", run: () => (history.rev = null) },
    ...branches
      .filter((b) => !b.current)
      .map((b) => ({ label: b.name, detail: b.remote ? "远程分支" : "本地分支", run: () => (history.rev = b.name) })),
  ]);
}

// ---------------- 对提交的操作 ----------------

const isMerge = (c: GitCommit) => c.parents.length > 1;

/** 生成一个撤销该提交改动的新提交 */
export async function revertCommit(c: GitCommit) {
  const ok = await ask(`生成一个新提交，撤销“${c.subject}”(${c.short}) 的改动？`, {
    title: "还原提交",
    kind: "info",
    okLabel: "还原",
    cancelLabel: "取消",
  });
  if (!ok) return;
  let conflict = false;
  const done = await runGit(
    async (root) => {
      conflict = await gitApi.gitRevert(root, c.hash, isMerge(c));
    },
    { changesFiles: true },
  );
  if (done && conflict) toast("还原时有冲突。解决冲突并暂存后，点源代码管理面板里的“继续”。", { kind: "info" });
}

/** 把其他分支上的提交应用到当前分支 */
export async function cherryPickCommit(c: GitCommit) {
  let conflict = false;
  const done = await runGit(
    async (root) => {
      conflict = await gitApi.gitCherryPick(root, c.hash, isMerge(c));
    },
    { changesFiles: true },
  );
  if (done && conflict) toast("拣选时有冲突。解决冲突并暂存后，点源代码管理面板里的“继续”。", { kind: "info" });
}

/** 在提交上打标签；填了说明就是附注标签 */
export async function tagCommit(c: GitCommit) {
  const name = (await promptInput(`给 ${c.short} 打标签：标签名`, "", { placeholder: "例如 v1.0.0" }))?.trim();
  if (!name) return;
  const message = await promptInput(`标签 ${name} 的说明（可以不填）`);
  if (message == null) return;
  await runGit((root) => gitApi.gitTag(root, name, c.hash, message.trim() || null));
}

export { formatTime, shortTime } from "../utils/time";
