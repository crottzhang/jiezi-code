import { reactive, watch } from "vue";
import { ask } from "@tauri-apps/plugin-dialog";
import * as gitApi from "../api/git";
import type { CommitFile, Stash } from "../api/git";
import { git, groups, runGit } from "./git";
import { openCommitFile } from "./history";
import { promptInput, toast } from "./ui";

export const stash = reactive({
  list: [] as Stash[],
  /** 储藏分组是否展开 */
  open: true,
  expanded: {} as Record<string, boolean>,
  /** 储藏 → 改动的文件，读取中为 null */
  files: {} as Record<string, CommitFile[] | null>,
});

async function load() {
  const root = git.status?.root;
  if (!root || !git.status?.stashCount) {
    stash.list = [];
    return;
  }
  try {
    stash.list = await gitApi.gitStashList(root);
  } catch (e) {
    toast(e);
  }
}

// 储藏数量来自状态（直接读引用日志），变化时才重新读取列表
watch(() => [git.status?.root, git.status?.stashCount], load, { immediate: true });

/** 储藏当前的改动；untracked 时连未跟踪的文件一起 */
export async function stashChanges(untracked = false) {
  if (!git.status) return;
  if (!groups.value.staged.length && !groups.value.changes.length) {
    toast("没有可以储藏的改动", { kind: "info" });
    return;
  }
  const message = await promptInput(
    untracked ? "储藏说明（包含未跟踪的文件，可以不填）" : "储藏说明（可以不填）",
  );
  if (message == null) return;
  await runGit((root) => gitApi.gitStashPush(root, message, untracked), { changesFiles: true });
}

/** 应用储藏；pop 时应用后删除这条储藏 */
export const applyStash = (s: Stash, pop: boolean) =>
  runGit((root) => gitApi.gitStashApply(root, s.index, pop), { changesFiles: true });

/** 弹出最新的储藏 */
export function popLatestStash() {
  const latest = stash.list[0];
  if (latest) applyStash(latest, true);
  else toast("没有储藏", { kind: "info" });
}

export async function dropStash(s: Stash) {
  const ok = await ask(`确定要删除储藏“${s.message}”吗？\n删除后无法恢复。`, {
    title: "删除储藏",
    kind: "warning",
    okLabel: "删除",
    cancelLabel: "取消",
  });
  if (ok) await runGit((root) => gitApi.gitStashDrop(root, s.index));
}

export async function toggleStash(s: Stash) {
  stash.expanded[s.hash] = !stash.expanded[s.hash];
  if (!stash.expanded[s.hash] || stash.files[s.hash] !== undefined) return;
  const root = git.status?.root;
  if (!root) return;
  stash.files[s.hash] = null;
  try {
    stash.files[s.hash] = await gitApi.gitCommitFiles(root, s.hash);
  } catch (e) {
    delete stash.files[s.hash];
    stash.expanded[s.hash] = false;
    toast(e);
  }
}

/** 查看储藏里的文件：与储藏时所在的提交对比 */
export function openStashFile(s: Stash, file: CommitFile) {
  const label = `stash@{${s.index}}`;
  openCommitFile(
    {
      hash: s.hash,
      short: label,
      parents: [`${s.hash}^1`],
      author: "",
      email: "",
      time: s.time,
      refs: [],
      subject: s.message,
      body: "",
    },
    file,
    "储藏前",
  );
}
