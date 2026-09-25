use super::{
    blocking, git, git_without_literal, native_path, run, run_codes, run_text, with_paths,
};
use serde::Serialize;
use std::path::Path;

/// 变更列表最多返回这么多条，避免没被忽略的大目录（比如 node_modules）把界面卡死
const MAX_CHANGES: usize = 5000;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitChange {
    /// 相对仓库根目录的路径，分隔符是 `/`
    pub(super) path: String,
    /// 重命名/复制前的路径
    pub(super) orig_path: Option<String>,
    /// 暂存区状态：M A D R C T，`.` 表示无变化
    pub(super) index: char,
    /// 工作区状态：M D T，`?` 表示未跟踪，`.` 表示无变化
    pub(super) worktree: char,
    /// 合并冲突
    pub(super) conflict: bool,
    /// 暂存区里这个文件的对象哈希，暂存内容变化时它也会变
    pub(super) index_hash: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    /// 仓库根目录（本机路径格式）
    pub(super) root: String,
    /// .git 目录（本机路径格式）
    pub(super) git_dir: String,
    /// 当前分支，游离 HEAD 时为 None
    pub(super) branch: Option<String>,
    /// 当前提交的短哈希，还没有提交时为 None
    pub(super) head: Option<String>,
    pub(super) upstream: Option<String>,
    pub(super) ahead: u32,
    pub(super) behind: u32,
    /// 进行中的操作：merge / rebase / cherry-pick / revert
    pub(super) operation: Option<&'static str>,
    pub(super) stash_count: usize,
    pub(super) changes: Vec<GitChange>,
    pub(super) truncated: bool,
}

fn status_char(s: &str, i: usize) -> char {
    s.chars().nth(i).unwrap_or('.')
}

/// 解析 `git status --porcelain=v2 --branch -z` 的输出
pub(super) fn parse_status(root: String, out: &[u8]) -> GitStatus {
    let text = String::from_utf8_lossy(out);
    let mut status = GitStatus {
        root,
        git_dir: String::new(),
        branch: None,
        head: None,
        upstream: None,
        ahead: 0,
        behind: 0,
        operation: None,
        stash_count: 0,
        changes: Vec::new(),
        truncated: false,
    };
    let mut tokens = text.split('\0').filter(|t| !t.is_empty());
    while let Some(line) = tokens.next() {
        if let Some(header) = line.strip_prefix("# ") {
            let (key, value) = header.split_once(' ').unwrap_or((header, ""));
            match key {
                "branch.oid" if value != "(initial)" => {
                    status.head = Some(value.chars().take(7).collect())
                }
                "branch.head" if value != "(detached)" => status.branch = Some(value.into()),
                "branch.upstream" => status.upstream = Some(value.into()),
                "branch.ab" => {
                    for part in value.split(' ') {
                        if let Some(n) = part.strip_prefix('+') {
                            status.ahead = n.parse().unwrap_or(0);
                        } else if let Some(n) = part.strip_prefix('-') {
                            status.behind = n.parse().unwrap_or(0);
                        }
                    }
                }
                _ => {}
            }
            continue;
        }

        let change = match line.as_bytes().first() {
            // 1 XY sub mH mI mW hH hI path
            Some(b'1') => {
                let f: Vec<&str> = line.splitn(9, ' ').collect();
                f.get(8).map(|path| GitChange {
                    path: path.to_string(),
                    orig_path: None,
                    index: status_char(f[1], 0),
                    worktree: status_char(f[1], 1),
                    conflict: false,
                    index_hash: Some(f[7].into()),
                })
            }
            // 2 XY sub mH mI mW hH hI Xscore path，后面紧跟一个 NUL 分隔的原路径
            Some(b'2') => {
                let f: Vec<&str> = line.splitn(10, ' ').collect();
                let orig = tokens.next().map(str::to_string);
                f.get(9).map(|path| GitChange {
                    path: path.to_string(),
                    orig_path: orig,
                    index: status_char(f[1], 0),
                    worktree: status_char(f[1], 1),
                    conflict: false,
                    index_hash: Some(f[7].into()),
                })
            }
            // u XY sub m1 m2 m3 mW h1 h2 h3 path
            Some(b'u') => line.splitn(11, ' ').nth(10).map(|path| GitChange {
                path: path.to_string(),
                orig_path: None,
                index: '.',
                worktree: '.',
                conflict: true,
                index_hash: None,
            }),
            Some(b'?') => Some(GitChange {
                path: line[2..].to_string(),
                orig_path: None,
                index: '.',
                worktree: '?',
                conflict: false,
                index_hash: None,
            }),
            _ => None,
        };
        if let Some(change) = change {
            if status.changes.len() >= MAX_CHANGES {
                status.truncated = true;
                break;
            }
            status.changes.push(change);
        }
    }
    status
}

/// 根据 .git 目录里的标记文件判断正在进行的操作
pub(super) fn operation(git_dir: &Path) -> Option<&'static str> {
    if git_dir.join("rebase-merge").exists() || git_dir.join("rebase-apply").exists() {
        Some("rebase")
    } else if git_dir.join("MERGE_HEAD").exists() {
        Some("merge")
    } else if git_dir.join("CHERRY_PICK_HEAD").exists() {
        Some("cherry-pick")
    } else if git_dir.join("REVERT_HEAD").exists() {
        Some("revert")
    } else {
        None
    }
}

/// 储藏的数量等于 refs/stash 的引用日志行数，直接读文件，不用再启动一次 git
fn stash_count(common_dir: &Path) -> usize {
    std::fs::read_to_string(common_dir.join("logs").join("refs").join("stash"))
        .map(|s| s.lines().filter(|l| !l.trim().is_empty()).count())
        .unwrap_or(0)
}

/// 查询 `dir` 所在仓库的状态；不在仓库里时返回 None
#[tauri::command]
pub async fn git_status(dir: String) -> Result<Option<GitStatus>, String> {
    blocking(move || {
        let mut cmd = git(&dir);
        // 需要根据错误信息判断，固定用英文输出
        cmd.env("LC_ALL", "C").args([
            "rev-parse",
            "--show-toplevel",
            "--absolute-git-dir",
            "--git-common-dir",
        ]);
        let out = match run_text(cmd) {
            Ok(out) => out,
            Err(e) if e.contains("not a git repository") => return Ok(None),
            Err(e) => return Err(e),
        };
        let mut lines = out.lines();
        let root = native_path(lines.next().unwrap_or_default());
        let git_dir = native_path(lines.next().unwrap_or_default());
        // --git-common-dir 可能是相对于当前目录的路径
        let common_dir = Path::new(&dir).join(native_path(lines.next().unwrap_or(".git")));

        let mut cmd = git(&root);
        // 查询状态时不去刷新索引文件，避免和用户在终端里执行的 git 命令抢锁
        cmd.env("GIT_OPTIONAL_LOCKS", "0").args([
            "status",
            "--porcelain=v2",
            "--branch",
            "-z",
            "--untracked-files=all",
        ]);
        let out = run(cmd, None)?;
        let mut status = parse_status(root, &out);
        status.operation = operation(Path::new(&git_dir));
        status.stash_count = stash_count(&common_dir);
        status.git_dir = git_dir;
        Ok(Some(status))
    })
    .await
}

#[tauri::command]
pub async fn git_init(dir: String) -> Result<(), String> {
    blocking(move || {
        let mut cmd = git(&dir);
        cmd.args(["init", "-q"]);
        run(cmd, None).map(drop)
    })
    .await
}

#[tauri::command]
pub async fn git_stage(root: String, paths: Vec<String>) -> Result<(), String> {
    blocking(move || {
        let mut cmd = git(&root);
        cmd.args(["add", "-A"]);
        with_paths(cmd, &paths).map(drop)
    })
    .await
}

#[tauri::command]
pub async fn git_unstage(root: String, paths: Vec<String>) -> Result<(), String> {
    blocking(move || {
        // reset 在还没有任何提交的仓库里也能用，restore --staged 不行
        let mut cmd = git(&root);
        cmd.args(["reset", "-q"]);
        with_paths(cmd, &paths).map(drop)
    })
    .await
}

/// 把暂存区里某个文件的内容直接替换成 `content`（用于只暂存一处改动）
#[tauri::command]
pub async fn git_stage_content(root: String, path: String, content: String) -> Result<(), String> {
    blocking(move || {
        // --path 让 git 按这个文件的规则做换行符等转换
        let mut cmd = git(&root);
        cmd.args(["hash-object", "-w", "--stdin", &format!("--path={path}")]);
        let blob = String::from_utf8_lossy(&run(cmd, Some(content.as_bytes()))?)
            .trim()
            .to_string();

        // 沿用暂存区里原来的文件模式（比如可执行位），新文件用 100644
        let mut cmd = git(&root);
        cmd.args(["ls-files", "-s", "--", &path]);
        let listed = run_text(cmd)?;
        let mode = listed.split_whitespace().next().unwrap_or("100644").to_string();

        let mut cmd = git(&root);
        cmd.args([
            "update-index",
            "--add",
            "--cacheinfo",
            &format!("{mode},{blob},{path}"),
        ]);
        run(cmd, None).map(drop)
    })
    .await
}

/// 放弃工作区的修改：已跟踪的文件恢复成暂存区的版本，未跟踪的文件移到回收站
#[tauri::command]
pub async fn git_discard(
    root: String,
    paths: Vec<String>,
    untracked: Vec<String>,
) -> Result<(), String> {
    blocking(move || {
        if !paths.is_empty() {
            let mut cmd = git(&root);
            cmd.args(["checkout", "-q"]);
            with_paths(cmd, &paths)?;
        }
        if !untracked.is_empty() {
            let base = Path::new(&root);
            trash::delete_all(untracked.iter().map(|p| base.join(native_path(p))))
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn git_commit(root: String, message: String, amend: bool) -> Result<(), String> {
    blocking(move || {
        let mut cmd = git(&root);
        cmd.args(["commit", "-q"]);
        if amend {
            cmd.arg("--amend");
        }
        if message.is_empty() {
            // 修改上次提交但不改提交信息；合并时沿用 git 生成的合并信息
            cmd.arg("--no-edit");
            return run(cmd, None).map(drop);
        }
        cmd.args(["-F", "-"]);
        run(cmd, Some(message.as_bytes())).map(drop)
    })
    .await
}

/// 上一次提交的完整提交信息
#[tauri::command]
pub async fn git_last_message(root: String) -> Result<String, String> {
    blocking(move || {
        let mut cmd = git(&root);
        cmd.args(["log", "-1", "--format=%B"]);
        run_text(cmd).map(|s| s.trim().to_string())
    })
    .await
}

/// 撤销上一次提交：改动回到暂存区，返回被撤销的提交信息
#[tauri::command]
pub async fn git_undo_commit(root: String) -> Result<String, String> {
    blocking(move || {
        let mut cmd = git(&root);
        cmd.args(["log", "-1", "--format=%P%x1f%B"]);
        let out = run_text(cmd)?;
        let (parents, message) = out.split_once('\x1f').unwrap_or(("", &out));
        let mut cmd = git(&root);
        if parents.trim().is_empty() {
            // 第一个提交没有父提交，删掉分支引用，暂存区保持不变
            cmd.args(["update-ref", "-d", "HEAD"]);
        } else {
            cmd.args(["reset", "-q", "--soft", "HEAD~1"]);
        }
        run(cmd, None)?;
        Ok(message.trim().to_string())
    })
    .await
}

/// 读取某个版本的文件内容，`rev` 为空字符串表示暂存区。文件在该版本中不存在时返回 None
#[tauri::command]
pub async fn git_show(root: String, rev: String, path: String) -> Result<Option<String>, String> {
    blocking(move || {
        let mut cmd = git(&root);
        cmd.env("LC_ALL", "C").args(["show", &format!("{rev}:{path}")]);
        let bytes = match run(cmd, None) {
            Ok(b) => b,
            Err(e) if e.contains("does not exist") || e.contains("exists on disk, but not in") => {
                return Ok(None)
            }
            Err(e) if e.contains("invalid object name") || e.contains("bad revision") => {
                return Ok(None)
            }
            Err(e) => return Err(e),
        };
        if bytes[..bytes.len().min(8000)].contains(&0) {
            return Err("二进制文件，无法比较".into());
        }
        let bytes = bytes
            .strip_prefix(&[0xEF, 0xBB, 0xBF])
            .map(|b| b.to_vec())
            .unwrap_or(bytes);
        Ok(Some(String::from_utf8_lossy(&bytes).into_owned()))
    })
    .await
}

/// 文件夹 `dir` 下的这些名字里，哪些被 .gitignore 忽略（资源管理器里显示成灰色）
#[tauri::command]
pub async fn git_check_ignore(dir: String, names: Vec<String>) -> Result<Vec<String>, String> {
    if names.is_empty() {
        return Ok(Vec::new());
    }
    blocking(move || {
        // check-ignore 不支持 --literal-pathspecs；这里传的都是单纯的文件名，不受通配影响
        let mut cmd = git_without_literal(&dir);
        cmd.args(["check-ignore", "--stdin", "-z"]);
        // 退出码 1 表示一个都没被忽略
        let out = run_codes(cmd, Some(names.join("\0").as_bytes()), &[0, 1])?;
        Ok(String::from_utf8_lossy(&out)
            .split('\0')
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .collect())
    })
    .await
}

/// 把规则追加到仓库根目录的 .gitignore，已有的规则不重复添加
#[tauri::command]
pub async fn git_ignore(root: String, patterns: Vec<String>) -> Result<(), String> {
    blocking(move || {
        let file = Path::new(&root).join(".gitignore");
        let mut text = std::fs::read_to_string(&file).unwrap_or_default();
        let existing: Vec<String> = text.lines().map(|l| l.trim().to_string()).collect();
        let added: Vec<&String> = patterns
            .iter()
            .filter(|p| !existing.iter().any(|e| e == p.trim()))
            .collect();
        if added.is_empty() {
            return Ok(());
        }
        // 沿用文件原来的换行符
        let eol = if text.contains("\r\n") { "\r\n" } else { "\n" };
        if !text.is_empty() && !text.ends_with('\n') {
            text.push_str(eol);
        }
        for p in added {
            text.push_str(p.trim());
            text.push_str(eol);
        }
        std::fs::write(&file, text).map_err(|e| e.to_string())
    })
    .await
}
