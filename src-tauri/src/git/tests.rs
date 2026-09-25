use super::branch::*;
use super::history::*;
use super::remote::{parse_progress, repo_name, run_streaming};
use super::stash::*;
use super::status::*;
use super::{git, run};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use tauri::async_runtime::block_on;
use tauri::ipc::Channel;

// ---------------- 解析 ----------------

#[test]
fn parses_porcelain_v2() {
    let out = [
        "# branch.oid 2f6410fab5c95b9e15f484f4e4afa64abdba37d6",
        "# branch.head master",
        "# branch.upstream origin/master",
        "# branch.ab +2 -1",
        "1 MM N... 100644 100644 100644 789819 9ad2eb a.txt",
        "1 .D N... 100644 100644 000000 617807 617807 b c.txt",
        "2 R. N... 100644 100644 100644 587be6 587be6 R100 新 [id].txt",
        "old.txt",
        "u UU N... 100644 100644 100644 100644 aaaaaa bbbbbb cccccc conflict.txt",
        "? untracked.txt",
        "",
    ]
    .join("\0");
    let s = parse_status("repo".into(), out.as_bytes());
    assert_eq!(s.branch.as_deref(), Some("master"));
    assert_eq!(s.head.as_deref(), Some("2f6410f"));
    assert_eq!(s.upstream.as_deref(), Some("origin/master"));
    assert_eq!((s.ahead, s.behind), (2, 1));
    let summary: Vec<_> = s
        .changes
        .iter()
        .map(|c| (c.path.as_str(), c.orig_path.as_deref(), c.index, c.worktree, c.conflict))
        .collect();
    assert_eq!(
        summary,
        [
            ("a.txt", None, 'M', 'M', false),
            ("b c.txt", None, '.', 'D', false),
            ("新 [id].txt", Some("old.txt"), 'R', '.', false),
            ("conflict.txt", None, '.', '.', true),
            ("untracked.txt", None, '.', '?', false),
        ]
    );
    assert_eq!(s.changes[0].index_hash.as_deref(), Some("9ad2eb"));
    assert_eq!(s.changes[4].index_hash, None);
}

#[test]
fn parses_unborn_and_detached() {
    let s = parse_status("repo".into(), b"# branch.oid (initial)\0# branch.head (detached)\0");
    assert_eq!((s.head, s.branch), (None, None));
}

#[test]
fn parses_progress_lines() {
    assert_eq!(
        parse_progress("Receiving objects:  45% (123/456), 1.2 MiB | 2 MiB/s"),
        Some(("Receiving objects".into(), 45))
    );
    assert_eq!(
        parse_progress("remote: Counting objects: 100% (5/5), done."),
        Some(("Counting objects".into(), 100))
    );
    assert_eq!(parse_progress("To github.com:a/b.git"), None);
    assert_eq!(parse_progress("error: failed to push some refs"), None);
}

#[test]
fn derives_repo_names() {
    assert_eq!(repo_name("https://github.com/a/b.git").as_deref(), Some("b"));
    assert_eq!(repo_name("git@github.com:a/my-repo.git").as_deref(), Some("my-repo"));
    assert_eq!(repo_name("https://example.com/a/b/").as_deref(), Some("b"));
    assert_eq!(repo_name("git@host:repo").as_deref(), Some("repo"));
    assert_eq!(repo_name("  ").as_deref(), None);
}

// ---------------- 临时仓库 ----------------

struct TempRepo {
    dir: PathBuf,
    root: String,
}

static SEQ: AtomicU32 = AtomicU32::new(0);

impl TempRepo {
    fn new() -> Self {
        let dir = std::env::temp_dir().join(format!(
            "jiezi-git-test-{}-{}",
            std::process::id(),
            SEQ.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let repo = TempRepo { root: dir.to_string_lossy().into_owned(), dir };
        block_on(git_init(repo.root.clone())).unwrap();
        repo.sh(&["config", "user.email", "t@t"]);
        repo.sh(&["config", "user.name", "t"]);
        repo.sh(&["config", "core.autocrlf", "false"]);
        // 统一用 main 作为初始分支，不受本机 init.defaultBranch 配置影响
        repo.sh(&["symbolic-ref", "HEAD", "refs/heads/main"]);
        repo
    }

    fn sh(&self, args: &[&str]) -> String {
        let mut cmd = git(&self.root);
        cmd.args(args);
        String::from_utf8_lossy(&run(cmd, None).unwrap()).trim().to_string()
    }

    fn write(&self, name: &str, text: &str) {
        std::fs::write(self.dir.join(name), text).unwrap();
    }

    fn read(&self, name: &str) -> String {
        std::fs::read_to_string(self.dir.join(name)).unwrap()
    }

    fn commit_all(&self, message: &str) {
        self.sh(&["add", "-A"]);
        block_on(git_commit(self.root.clone(), message.into(), false)).unwrap();
    }

    fn status(&self) -> GitStatus {
        block_on(git_status(self.root.clone())).unwrap().unwrap()
    }
}

impl Drop for TempRepo {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

fn root_of(r: &TempRepo) -> String {
    r.root.clone()
}

/// 暂存、取消暂存、读取版本、放弃更改、提交、历史、切换分支
#[test]
fn basic_round_trip() {
    let dir = std::env::temp_dir().join(format!("jiezi-git-empty-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    assert!(block_on(git_status(dir.to_string_lossy().into_owned())).unwrap().is_none());
    let _ = std::fs::remove_dir_all(&dir);

    let r = TempRepo::new();
    let root = root_of(&r);
    // 文件名带通配符和中文，确认按字面匹配
    let name = "页面 [id].txt";
    r.write(name, "one\n");
    let s = r.status();
    assert_eq!((s.changes[0].path.as_str(), s.changes[0].worktree), (name, '?'));
    assert!(s.git_dir.ends_with(".git"));

    // 还没有提交时也能暂存和取消暂存
    block_on(git_stage(root.clone(), vec![name.into()])).unwrap();
    assert_eq!(r.status().changes[0].index, 'A');
    block_on(git_unstage(root.clone(), vec![name.into()])).unwrap();
    assert_eq!(r.status().changes[0].worktree, '?');

    block_on(git_stage(root.clone(), vec![name.into()])).unwrap();
    block_on(git_commit(root.clone(), "第一次提交\n\n正文".into(), false)).unwrap();
    let s = r.status();
    assert!(s.changes.is_empty() && s.head.is_some());

    r.write(name, "two\n");
    assert_eq!(
        block_on(git_show(root.clone(), "HEAD".into(), name.into())).unwrap().as_deref(),
        Some("one\n")
    );
    assert_eq!(block_on(git_show(root.clone(), "HEAD".into(), "nope.txt".into())).unwrap(), None);
    block_on(git_discard(root.clone(), vec![name.into()], vec![])).unwrap();
    assert_eq!(r.read(name), "one\n");

    let log = block_on(git_log(root.clone(), 0, 50, None, None)).unwrap();
    assert_eq!((log[0].subject.as_str(), log[0].body.as_str()), ("第一次提交", "正文"));
    assert!(log[0].refs.iter().any(|x| x.starts_with("HEAD -> ")));
    let files = block_on(git_commit_files(root.clone(), log[0].hash.clone())).unwrap();
    assert_eq!((files[0].path.as_str(), files[0].status), (name, 'A'));

    // 重命名 + 新增
    r.sh(&["mv", name, "renamed.txt"]);
    r.write("other.txt", "x\n");
    r.commit_all("second");
    let log = block_on(git_log(root.clone(), 0, 50, None, None)).unwrap();
    assert_eq!(log[0].parents, [log[1].hash.clone()]);
    let mut files = block_on(git_commit_files(root.clone(), log[0].hash.clone())).unwrap();
    files.sort_by(|a, b| a.path.cmp(&b.path));
    let summary: Vec<_> = files
        .iter()
        .map(|f| (f.path.as_str(), f.orig_path.as_deref(), f.status))
        .collect();
    assert_eq!(summary, [("other.txt", None, 'A'), ("renamed.txt", Some(name), 'R')]);
    let followed = block_on(git_log(root.clone(), 0, 50, Some("renamed.txt".into()), None)).unwrap();
    assert_eq!(followed.len(), 2);
    let paged = block_on(git_log(root.clone(), 1, 50, None, None)).unwrap();
    assert_eq!(paged[0].hash, log[1].hash);

    // 从旧提交新建分支，再看另一个分支的历史
    block_on(git_checkout(root.clone(), "from-old".into(), true, Some(log[1].short.clone()), None))
        .unwrap();
    assert!(!r.dir.join("other.txt").exists());
    let main_log = block_on(git_log(root.clone(), 0, 50, None, Some("main".into()))).unwrap();
    assert_eq!(main_log.len(), 2);
    assert!(block_on(git_log(root.clone(), 0, 50, None, Some("--all".into()))).is_err());

    block_on(git_commit(root.clone(), String::new(), true)).unwrap();
}

#[test]
fn branches_delete_rename_and_merge_conflict() {
    let r = TempRepo::new();
    let root = root_of(&r);
    r.write("a.txt", "base\n");
    r.commit_all("base");
    block_on(git_checkout(root.clone(), "feature".into(), true, None, None)).unwrap();
    r.write("a.txt", "feature\n");
    r.commit_all("feature change");
    block_on(git_checkout(root.clone(), "main".into(), false, None, None)).unwrap();
    r.write("a.txt", "main\n");
    r.commit_all("main change");

    let branches = block_on(git_branches(root.clone())).unwrap();
    let names: Vec<_> = branches.iter().map(|b| b.name.as_str()).collect();
    assert!(names.contains(&"main") && names.contains(&"feature"));

    // 合并冲突 → 中止
    assert!(block_on(git_merge(root.clone(), "feature".into())).unwrap());
    let s = r.status();
    assert_eq!(s.operation, Some("merge"));
    assert!(s.changes.iter().any(|c| c.conflict));
    block_on(git_op_abort(root.clone(), "merge".into())).unwrap();
    assert_eq!(r.status().operation, None);
    assert_eq!(r.read("a.txt"), "main\n");

    // 再合并 → 解决冲突 → 继续
    assert!(block_on(git_merge(root.clone(), "feature".into())).unwrap());
    r.write("a.txt", "resolved\n");
    block_on(git_stage(root.clone(), vec!["a.txt".into()])).unwrap();
    assert!(!block_on(git_op_continue(root.clone(), "merge".into(), String::new())).unwrap());
    let s = r.status();
    assert_eq!(s.operation, None);
    let log = block_on(git_log(root.clone(), 0, 1, None, None)).unwrap();
    assert_eq!(log[0].parents.len(), 2);

    // 已合并的分支可以普通删除；重命名
    block_on(git_branch_rename(root.clone(), "feature".into(), "feature-2".into())).unwrap();
    block_on(git_branch_delete(root.clone(), "feature-2".into(), false)).unwrap();
    assert_eq!(block_on(git_branches(root.clone())).unwrap().len(), 1);
    assert!(block_on(git_op_abort(root.clone(), "reset --hard".into())).is_err());
}

#[test]
fn stash_round_trip() {
    let r = TempRepo::new();
    let root = root_of(&r);
    r.write("a.txt", "one\n");
    r.commit_all("base");
    r.write("a.txt", "two\n");
    r.write("new.txt", "untracked\n");

    block_on(git_stash_push(root.clone(), "我的储藏".into(), true)).unwrap();
    let s = r.status();
    assert!(s.changes.is_empty());
    assert_eq!(s.stash_count, 1);
    let list = block_on(git_stash_list(root.clone())).unwrap();
    assert_eq!(list.len(), 1);
    assert!(list[0].message.contains("我的储藏"));
    let files = block_on(git_commit_files(root.clone(), list[0].hash.clone())).unwrap();
    assert_eq!(files[0].path, "a.txt");

    block_on(git_stash_apply(root.clone(), 0, false)).unwrap();
    assert_eq!(r.read("a.txt"), "two\n");
    assert_eq!(r.status().stash_count, 1);
    block_on(git_stash_drop(root.clone(), 0)).unwrap();
    assert_eq!(r.status().stash_count, 0);
}

#[test]
fn stage_content_ignore_undo_blame_revert_tag() {
    let r = TempRepo::new();
    let root = root_of(&r);
    r.write("a.txt", "1\n2\n3\n4\n5\n");
    r.commit_all("base");

    // 只暂存第一处改动
    r.write("a.txt", "1 changed\n2\n3\n4\n5 changed\n");
    block_on(git_stage_content(root.clone(), "a.txt".into(), "1 changed\n2\n3\n4\n5\n".into())).unwrap();
    assert_eq!(
        block_on(git_show(root.clone(), String::new(), "a.txt".into())).unwrap().as_deref(),
        Some("1 changed\n2\n3\n4\n5\n")
    );
    let c = &r.status().changes[0];
    assert_eq!((c.index, c.worktree), ('M', 'M'));

    // .gitignore：追加且不重复
    block_on(git_ignore(root.clone(), vec!["/dist/".into(), "*.log".into()])).unwrap();
    block_on(git_ignore(root.clone(), vec!["*.log".into()])).unwrap();
    assert_eq!(r.read(".gitignore"), "/dist/\n*.log\n");

    // 逐行作者信息：未保存的内容里新加的行算“未提交”
    let blame = block_on(git_blame(root.clone(), "a.txt".into(), Some("1\n2\nnew\n3\n4\n5\n".into())))
        .unwrap()
        .unwrap();
    assert_eq!(blame.lines.len(), 6);
    let at = |line: usize| &blame.commits[blame.lines[line] as usize];
    assert!(!at(0).uncommitted && at(0).summary == "base");
    assert!(at(2).uncommitted);
    assert!(block_on(git_blame(root.clone(), "nope.txt".into(), None)).unwrap().is_none());

    // 提交、撤销提交（改动回到暂存区）
    block_on(git_commit(root.clone(), "partial".into(), false)).unwrap();
    assert_eq!(block_on(git_last_message(root.clone())).unwrap(), "partial");
    let message = block_on(git_undo_commit(root.clone())).unwrap();
    assert_eq!(message, "partial");
    assert_eq!(r.status().changes.iter().find(|c| c.path == "a.txt").unwrap().index, 'M');
    block_on(git_commit(root.clone(), "partial".into(), false)).unwrap();

    // 还原提交、打标签
    r.sh(&["checkout", "--", "a.txt"]);
    let head = block_on(git_log(root.clone(), 0, 1, None, None)).unwrap().remove(0);
    assert!(!block_on(git_revert(root.clone(), head.hash.clone(), false)).unwrap());
    assert_eq!(r.read("a.txt"), "1\n2\n3\n4\n5\n");
    block_on(git_tag(root.clone(), "v1".into(), head.hash.clone(), Some("第一版".into()))).unwrap();
    assert_eq!(r.sh(&["tag", "-l", "-n1"]).split_whitespace().collect::<Vec<_>>(), ["v1", "第一版"]);
    assert!(block_on(git_tag(root.clone(), "-d".into(), head.hash, None)).is_err());

    // 撤销第一个提交：分支引用被删除，文件仍在暂存区
    let r2 = TempRepo::new();
    r2.write("x.txt", "x\n");
    r2.commit_all("only");
    assert_eq!(block_on(git_undo_commit(root_of(&r2))).unwrap(), "only");
    let s = r2.status();
    assert!(s.head.is_none());
    assert_eq!(s.changes[0].index, 'A');
}

#[test]
fn cherry_pick_conflict_and_continue() {
    let r = TempRepo::new();
    let root = root_of(&r);
    r.write("a.txt", "base\n");
    r.commit_all("base");
    block_on(git_checkout(root.clone(), "other".into(), true, None, None)).unwrap();
    r.write("a.txt", "other\n");
    r.commit_all("other change");
    let pick = block_on(git_log(root.clone(), 0, 1, None, None)).unwrap().remove(0);
    block_on(git_checkout(root.clone(), "main".into(), false, None, None)).unwrap();
    r.write("a.txt", "main\n");
    r.commit_all("main change");

    assert!(block_on(git_cherry_pick(root.clone(), pick.hash, false)).unwrap());
    assert_eq!(r.status().operation, Some("cherry-pick"));
    r.write("a.txt", "both\n");
    block_on(git_stage(root.clone(), vec!["a.txt".into()])).unwrap();
    assert!(!block_on(git_op_continue(root.clone(), "cherry-pick".into(), String::new())).unwrap());
    assert_eq!(r.status().operation, None);
    let log = block_on(git_log(root.clone(), 0, 1, None, None)).unwrap();
    assert_eq!(log[0].subject, "other change");
}

/// 推送到本机的裸仓库，再从另一个克隆拉取
#[test]
fn push_and_pull_with_progress() {
    let remote = TempRepo::new();
    std::fs::remove_dir_all(&remote.dir).unwrap();
    std::fs::create_dir_all(&remote.dir).unwrap();
    let mut init = git(&remote.root);
    init.args(["init", "-q", "--bare", "-b", "main"]);
    run(init, None).unwrap();

    let a = TempRepo::new();
    a.write("a.txt", "one\n");
    a.commit_all("first");
    a.sh(&["remote", "add", "origin", &remote.root]);
    let progress = Channel::new(|_| Ok(()));
    let mut push = git(&a.root);
    push.args(["push", "--progress", "-u", "origin", "HEAD"]);
    run_streaming(push, 1, &progress).unwrap();
    assert_eq!(a.status().upstream.as_deref(), Some("origin/main"));

    let parent = std::env::temp_dir().join(format!("jiezi-git-clone-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&parent);
    std::fs::create_dir_all(&parent).unwrap();
    let target = parent.join("b");
    let mut clone = git(&parent.to_string_lossy());
    clone.args(["clone", "--progress", "--", &remote.root, &target.to_string_lossy()]);
    run_streaming(clone, 2, &progress).unwrap();
    // 克隆出来的仓库沿用本机的 core.autocrlf，换行符可能是 CRLF
    let read = || std::fs::read_to_string(target.join("a.txt")).unwrap().replace("\r\n", "\n");
    assert_eq!(read(), "one\n");

    a.write("a.txt", "two\n");
    a.commit_all("second");
    let mut push = git(&a.root);
    push.args(["push", "--progress"]);
    run_streaming(push, 3, &progress).unwrap();
    let mut pull = git(&target.to_string_lossy());
    pull.args(["pull", "--progress"]);
    run_streaming(pull, 4, &progress).unwrap();
    assert_eq!(read(), "two\n");

    // 失败时返回 git 的错误信息
    let mut bad = git(&a.root);
    bad.args(["push", "--progress", "no-such-remote"]);
    assert!(run_streaming(bad, 5, &progress).unwrap_err().contains("no-such-remote"));
    let _ = std::fs::remove_dir_all(&parent);
}
