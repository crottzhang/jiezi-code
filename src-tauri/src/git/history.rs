use super::{blocking, check_arg, git, run, status::operation};
use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommit {
    pub(super) hash: String,
    pub(super) short: String,
    pub(super) parents: Vec<String>,
    pub(super) author: String,
    pub(super) email: String,
    /// 作者时间，Unix 秒
    pub(super) time: i64,
    /// 指向这个提交的引用，如 `HEAD -> master`、`origin/master`、`tag: v1.0`
    pub(super) refs: Vec<String>,
    pub(super) subject: String,
    pub(super) body: String,
}

/// 字段之间用 0x1f 分隔，提交之间由 -z 用 NUL 分隔
const LOG_FORMAT: &str = "--format=%H%x1f%h%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%D%x1f%s%x1f%b";

pub(super) fn parse_log(out: &[u8]) -> Vec<GitCommit> {
    String::from_utf8_lossy(out)
        .split('\0')
        .filter_map(|record| {
            let f: Vec<&str> = record.trim_start_matches('\n').splitn(9, '\x1f').collect();
            if f.len() < 9 {
                return None;
            }
            Some(GitCommit {
                hash: f[0].into(),
                short: f[1].into(),
                parents: f[2].split_whitespace().map(str::to_string).collect(),
                author: f[3].into(),
                email: f[4].into(),
                time: f[5].parse().unwrap_or(0),
                refs: f[6]
                    .split(", ")
                    .filter(|r| !r.is_empty())
                    .map(str::to_string)
                    .collect(),
                subject: f[7].into(),
                body: f[8].trim().into(),
            })
        })
        .collect()
}

/// 提交历史，分页读取。`rev` 为 None 时是当前分支；给了 `path` 时只列出改动过这个文件的提交（跟随重命名）
#[tauri::command]
pub async fn git_log(
    root: String,
    skip: u32,
    limit: u32,
    path: Option<String>,
    rev: Option<String>,
) -> Result<Vec<GitCommit>, String> {
    if let Some(rev) = &rev {
        check_arg(rev, "分支")?;
    }
    blocking(move || {
        let mut cmd = git(&root);
        cmd.env("LC_ALL", "C").args([
            "log",
            "-z",
            LOG_FORMAT,
            &format!("--skip={skip}"),
            &format!("--max-count={limit}"),
        ]);
        if let Some(rev) = &rev {
            cmd.arg(rev);
        }
        if let Some(path) = &path {
            cmd.args(["--follow", "--", path]);
        }
        match run(cmd, None) {
            Ok(out) => Ok(parse_log(&out)),
            // 还没有任何提交
            Err(e) if e.contains("does not have any commits") => Ok(Vec::new()),
            Err(e) => Err(e),
        }
    })
    .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitFile {
    pub(super) path: String,
    pub(super) orig_path: Option<String>,
    /// A M D R C T
    pub(super) status: char,
}

/// 解析 `--name-status -z` 的输出：状态\0路径\0，重命名/复制是 状态\0原路径\0新路径\0
pub(super) fn parse_name_status(out: &[u8]) -> Vec<CommitFile> {
    let text = String::from_utf8_lossy(out);
    let mut tokens = text.split('\0').filter(|t| !t.is_empty());
    let mut files = Vec::new();
    while let Some(status) = tokens.next() {
        let code = status.chars().next().unwrap_or('M');
        let Some(first) = tokens.next() else { break };
        if code == 'R' || code == 'C' {
            let Some(second) = tokens.next() else { break };
            files.push(CommitFile {
                path: second.into(),
                orig_path: Some(first.into()),
                status: code,
            });
        } else {
            files.push(CommitFile {
                path: first.into(),
                orig_path: None,
                status: code,
            });
        }
    }
    files
}

fn diff_tree(root: &str, revs: &[&str]) -> Result<Vec<u8>, String> {
    let mut cmd = git(root);
    cmd.args([
        "diff-tree",
        "-r",
        "-z",
        "-M",
        "--no-commit-id",
        "--name-status",
        "--root",
    ]);
    cmd.args(revs);
    run(cmd, None)
}

/// 某个提交改动的文件（与第一个父提交比较；根提交与空树比较）
#[tauri::command]
pub async fn git_commit_files(root: String, hash: String) -> Result<Vec<CommitFile>, String> {
    check_arg(&hash, "提交")?;
    blocking(move || {
        // 合并提交只和第一个父提交比较，和在分支上看到的改动一致
        let out = match diff_tree(&root, &[&format!("{hash}^1"), &hash]) {
            Ok(out) => out,
            // 根提交没有父提交，单独和空树比较
            Err(_) => diff_tree(&root, &[&hash])?,
        };
        Ok(parse_name_status(&out))
    })
    .await
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BlameCommit {
    pub(super) hash: String,
    pub(super) author: String,
    pub(super) time: i64,
    pub(super) summary: String,
    /// 还没有提交的行
    pub(super) uncommitted: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Blame {
    pub(super) commits: Vec<BlameCommit>,
    /// 每一行（从 0 开始）对应 commits 里的下标
    pub(super) lines: Vec<u32>,
}

/// 解析 `git blame --incremental` 的输出
pub(super) fn parse_blame(out: &[u8]) -> Blame {
    let text = String::from_utf8_lossy(out);
    let mut commits: Vec<BlameCommit> = Vec::new();
    let mut index: HashMap<String, usize> = HashMap::new();
    let mut lines: Vec<u32> = Vec::new();
    let mut current: Option<(usize, usize, usize)> = None; // (提交下标, 起始行, 行数)
    for line in text.lines() {
        if let Some((idx, start, count)) = current {
            let commit = &mut commits[idx];
            if let Some(v) = line.strip_prefix("author ") {
                commit.author = v.into();
            } else if let Some(v) = line.strip_prefix("author-time ") {
                commit.time = v.parse().unwrap_or(0);
            } else if let Some(v) = line.strip_prefix("summary ") {
                commit.summary = v.into();
            } else if line.starts_with("filename ") {
                // 每一段以 filename 结束
                if lines.len() < start + count {
                    lines.resize(start + count, 0);
                }
                for l in &mut lines[start..start + count] {
                    *l = idx as u32;
                }
                current = None;
            }
            continue;
        }
        // 段首：<哈希> <原行号> <现行号> <行数>
        let f: Vec<&str> = line.split(' ').collect();
        if f.len() == 4 && f[0].len() >= 40 {
            let hash = f[0].to_string();
            let idx = *index.entry(hash.clone()).or_insert_with(|| {
                commits.push(BlameCommit {
                    uncommitted: hash.bytes().all(|b| b == b'0'),
                    hash: hash.clone(),
                    author: String::new(),
                    time: 0,
                    summary: String::new(),
                });
                commits.len() - 1
            });
            let start = f[2].parse::<usize>().unwrap_or(1).saturating_sub(1);
            let count = f[3].parse::<usize>().unwrap_or(0);
            current = Some((idx, start, count));
        }
    }
    Blame { commits, lines }
}

/// 逐行作者信息。`content` 是编辑器里的当前内容（可能还没保存），文件没被跟踪时返回 None
#[tauri::command]
pub async fn git_blame(
    root: String,
    path: String,
    content: Option<String>,
) -> Result<Option<Blame>, String> {
    blocking(move || {
        let mut cmd = git(&root);
        cmd.env("LC_ALL", "C").args(["blame", "--incremental"]);
        if content.is_some() {
            cmd.args(["--contents", "-"]);
        }
        cmd.args(["--", &path]);
        match run(cmd, content.as_deref().map(str::as_bytes)) {
            Ok(out) => Ok(Some(parse_blame(&out))),
            Err(e) if e.contains("no such path") || e.contains("does not have any commits") => {
                Ok(None)
            }
            Err(e) => Err(e),
        }
    })
    .await
}

/// revert / cherry-pick 出现冲突时返回 Ok(true)，由用户在面板里解决后继续
fn apply_commit(root: &str, op: &str, hash: &str, is_merge: bool) -> Result<bool, String> {
    check_arg(hash, "提交")?;
    let mut cmd = git(root);
    cmd.arg(op);
    if op == "revert" {
        cmd.arg("--no-edit");
    }
    if is_merge {
        // 合并提交以第一个父提交为主线
        cmd.args(["-m", "1"]);
    }
    cmd.arg(hash);
    match run(cmd, None) {
        Ok(_) => Ok(false),
        Err(e) => {
            let mut dir = git(root);
            dir.args(["rev-parse", "--absolute-git-dir"]);
            let git_dir = super::run_text(dir)?;
            if operation(Path::new(&git_dir)).is_some() {
                Ok(true)
            } else {
                Err(e)
            }
        }
    }
}

/// 生成一个撤销该提交改动的新提交
#[tauri::command]
pub async fn git_revert(root: String, hash: String, is_merge: bool) -> Result<bool, String> {
    blocking(move || apply_commit(&root, "revert", &hash, is_merge)).await
}

/// 把该提交的改动应用到当前分支
#[tauri::command]
pub async fn git_cherry_pick(root: String, hash: String, is_merge: bool) -> Result<bool, String> {
    blocking(move || apply_commit(&root, "cherry-pick", &hash, is_merge)).await
}

/// 在提交上打标签；有说明时是附注标签
#[tauri::command]
pub async fn git_tag(
    root: String,
    name: String,
    hash: String,
    message: Option<String>,
) -> Result<(), String> {
    check_arg(&name, "标签名")?;
    check_arg(&hash, "提交")?;
    blocking(move || {
        let mut cmd = git(&root);
        cmd.arg("tag");
        let message = message.filter(|m| !m.trim().is_empty());
        if message.is_some() {
            cmd.args(["-a", "-F", "-"]);
        }
        cmd.args([&name, &hash]);
        run(cmd, message.as_deref().map(str::as_bytes)).map(drop)
    })
    .await
}
