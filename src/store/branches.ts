import { ask } from "@tauri-apps/plugin-dialog";
import * as gitApi from "../api/git";
import type { Branch } from "../api/git";
import { relativeTime } from "../utils/time";
import { git, runGit } from "./git";
import { openPicker, promptInput, toast } from "./ui";

async function loadBranches(): Promise<Branch[] | null> {
  const root = git.status?.root;
  if (!root) return null;
  try {
    return await gitApi.gitBranches(root);
  } catch (e) {
    toast(e);
    return null;
  }
}

const checkout = (branch: string, options: { create?: boolean; start?: string; track?: boolean } = {}) =>
  runGit((root) => gitApi.gitCheckout(root, branch, !!options.create, options.start, options.track), {
    changesFiles: true,
  });

function describe(b: Branch) {
  if (b.current) return "当前分支";
  const parts = [relativeTime(b.time)];
  if (b.remote) parts.unshift("远程分支");
  else if (b.upstream) parts.push(`跟踪 ${b.upstream}`);
  return parts.join(" · ");
}

/** 新建分支并切换过去；start 为空时基于当前提交 */
export async function createBranch(start?: string, startLabel?: string) {
  const name = (await promptInput(`新分支名称（基于 ${startLabel ?? "当前提交"}）`))?.trim();
  if (name) await checkout(name, { create: true, start });
}

export const createBranchAt = (hash: string, short: string) => createBranch(hash, short);

/** 切换分支：列出本地和远程分支，也可以新建 */
export async function pickBranch() {
  const list = await loadBranches();
  if (!list) return;
  const local = list.filter((b) => !b.remote);
  const localNames = new Set(local.map((b) => b.name));
  openPicker("选择要切换到的分支", [
    { label: "＋ 新建分支…", run: () => createBranch() },
    { label: "＋ 基于其他分支新建…", run: pickBaseForNewBranch },
    ...list.map((b) => ({
      label: b.name,
      detail: describe(b),
      run: () => {
        if (b.current) return;
        if (!b.remote) {
          checkout(b.name);
          return;
        }
        // 远程分支：本地已有同名分支就切换过去，否则新建一个跟踪它的本地分支
        const short = b.name.slice(b.name.indexOf("/") + 1);
        if (localNames.has(short)) checkout(short);
        else checkout(b.name, { track: true });
      },
    })),
  ]);
}

async function pickBaseForNewBranch() {
  const list = await loadBranches();
  if (!list) return;
  openPicker(
    "新分支基于哪个分支",
    list.map((b) => ({ label: b.name, detail: describe(b), run: () => createBranch(b.name, b.name) })),
  );
}

/** 删除本地分支（不能删除当前分支） */
export async function pickBranchToDelete() {
  const list = await loadBranches();
  if (!list) return;
  const candidates = list.filter((b) => !b.remote && !b.current);
  if (!candidates.length) {
    toast("除了当前分支，没有其他本地分支", { kind: "info" });
    return;
  }
  openPicker(
    "选择要删除的分支",
    candidates.map((b) => ({ label: b.name, detail: describe(b), run: () => deleteBranch(b.name) })),
  );
}

async function deleteBranch(name: string) {
  const ok = await ask(`确定要删除分支“${name}”吗？`, {
    title: "删除分支",
    kind: "warning",
    okLabel: "删除",
    cancelLabel: "取消",
  });
  if (!ok) return;
  await runGit(async (root) => {
    try {
      await gitApi.gitBranchDelete(root, name, false);
    } catch (e) {
      // 通常是分支还没有合并；把 git 的原话给用户看，再问是否强制删除
      const force = await ask(`${e}\n\n仍要强制删除分支“${name}”吗？其中没有合并的提交可能会丢失。`, {
        title: "删除分支",
        kind: "warning",
        okLabel: "强制删除",
        cancelLabel: "取消",
      });
      if (force) await gitApi.gitBranchDelete(root, name, true);
    }
  });
}

/** 重命名当前分支 */
export async function renameBranch() {
  const current = git.status?.branch;
  if (!current) {
    toast("当前不在任何分支上（游离 HEAD）", { kind: "info" });
    return;
  }
  const name = (await promptInput("重命名当前分支", current))?.trim();
  if (name && name !== current) await runGit((root) => gitApi.gitBranchRename(root, current, name));
}

/** 把选中的分支合并到当前分支 */
export async function pickBranchToMerge() {
  const list = await loadBranches();
  if (!list) return;
  const current = git.status?.branch ?? "当前提交";
  openPicker(
    `选择要合并到“${current}”的分支`,
    list.filter((b) => !b.current).map((b) => ({ label: b.name, detail: describe(b), run: () => mergeBranch(b.name) })),
  );
}

async function mergeBranch(name: string) {
  let conflict = false;
  const done = await runGit(
    async (root) => {
      conflict = await gitApi.gitMerge(root, name);
    },
    { changesFiles: true },
  );
  if (done && conflict) {
    toast("合并有冲突。在编辑器里解决冲突、暂存文件后，点源代码管理面板里的“继续合并”。", {
      kind: "info",
    });
  }
}
