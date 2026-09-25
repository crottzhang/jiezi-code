use super::{blocking, check_arg, git, run, run_text, status::operation};
use serde::Serialize;
use std::path::Path;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Branch {
    /// 本地分支是 `main`，远程分支是 `origin/main`
    pub(super) name: String,
    pub(super) remote: bool,
    pub(super) current: bool,
    pub(super) upstream: Option<String>,
    /// 最后一次提交的时间，Unix 秒
    pub(super) time: i64,
}

pub(super) fn parse_branches(out: &str) -> Vec<Branch> {
    out.lines()
        .filter_map(|line| {
            let f: Vec<&str> = line.split('\x1f').collect();
            if f.len() < 5 {
                return None;
            }
            let remote = f[0].starts_with("refs/remotes/");
            // origin/HEAD 只是指向默认分支的别名
            if remote && f[0].ends_with("/HEAD") {
                return None;
            }
            Some(Branch {
                name: f[1].into(),
                remote,
                current: f[2] == "*",
                upstream: Some(f[3]).filter(|u| !u.is_empty()).map(str::to_string),
                time: f[4].parse().unwrap_or(0),
            })
        })
        .collect()
}

/// 本地和远程分支，按最近提交时间排序
#[tauri::command]
pub async fn git_branches(root: String) -> Result<Vec<Branch>, String> {
    blocking(move || {
        let mut cmd = git(&root);
        cmd.args([
            "for-each-ref",
            "--sort=-committerdate",
            "--format=%(refname)%1f%(refname:short)%1f%(HEAD)%1f%(upstream:short)%1f%(committerdate:unix)",
            "refs/heads",
            "refs/remotes",
        ]);
        Ok(parse_branches(&run_text(cmd)?))
    })
    .await
}

/// 切换分支。create 时新建分支，start 是起点提交；track 时从远程分支新建同名的本地跟踪分支
#[tauri::command]
pub async fn git_checkout(
    root: String,
    branch: String,
    create: bool,
    start: Option<String>,
    track: Option<bool>,
) -> Result<(), String> {
    check_arg(&branch, "分支名")?;
    if let Some(start) = &start {
        check_arg(start, "提交")?;
    }
    blocking(move || {
        let mut cmd = git(&root);
        cmd.args(["switch", "-q"]);
        if track.unwrap_or(false) {
            cmd.args(["--track", &branch]);
        } else {
            if create {
                cmd.arg("-c");
            }
            cmd.arg(&branch);
            // 新建分支时的起点提交
            if let Some(start) = start.filter(|_| create) {
                cmd.arg(start);
            }
        }
        run(cmd, None).map(drop)
    })
    .await
}

/// 删除本地分支；force 时即使没有合并也删除
#[tauri::command]
pub async fn git_branch_delete(root: String, name: String, force: bool) -> Result<(), String> {
    check_arg(&name, "分支名")?;
    blocking(move || {
        let mut cmd = git(&root);
        cmd.args(["branch", if force { "-D" } else { "-d" }, &name]);
        run(cmd, None).map(drop)
    })
    .await
}

#[tauri::command]
pub async fn git_branch_rename(root: String, old: String, new: String) -> Result<(), String> {
    check_arg(&old, "分支名")?;
    check_arg(&new, "分支名")?;
    blocking(move || {
        let mut cmd = git(&root);
        cmd.args(["branch", "-m", &old, &new]);
        run(cmd, None).map(drop)
    })
    .await
}

fn has_operation(root: &str) -> Result<bool, String> {
    let mut cmd = git(root);
    cmd.args(["rev-parse", "--absolute-git-dir"]);
    Ok(operation(Path::new(&run_text(cmd)?)).is_some())
}

/// 暂存区里是否有未解决的冲突文件
fn has_conflicts(root: &str) -> Result<bool, String> {
    let mut cmd = git(root);
    cmd.args(["ls-files", "-u"]);
    Ok(!run_text(cmd)?.trim().is_empty())
}

/// 把分支合并到当前分支；有冲突时返回 Ok(true)
#[tauri::command]
pub async fn git_merge(root: String, branch: String) -> Result<bool, String> {
    check_arg(&branch, "分支名")?;
    blocking(move || {
        let mut cmd = git(&root);
        cmd.args(["merge", "--no-edit", &branch]);
        match run(cmd, None) {
            Ok(_) => Ok(false),
            Err(e) => {
                if has_operation(&root)? {
                    Ok(true)
                } else {
                    Err(e)
                }
            }
        }
    })
    .await
}

fn check_op(op: &str) -> Result<(), String> {
    match op {
        "merge" | "rebase" | "cherry-pick" | "revert" => Ok(()),
        _ => Err(format!("未知操作：{op}")),
    }
}

/// 解决冲突后继续进行中的操作。合并时 message 为空就用 git 生成的合并信息。
/// 继续后又遇到冲突（比如变基的下一个提交）时返回 Ok(true)
#[tauri::command]
pub async fn git_op_continue(root: String, op: String, message: String) -> Result<bool, String> {
    check_op(&op)?;
    blocking(move || {
        let mut cmd = git(&root);
        let mut input = None;
        if op == "merge" {
            cmd.args(["commit", "-q"]);
            if message.trim().is_empty() {
                cmd.arg("--no-edit");
            } else {
                cmd.args(["-F", "-"]);
                input = Some(message.as_bytes());
            }
        } else {
            cmd.args([op.as_str(), "--continue"]);
        }
        match run(cmd, input) {
            Ok(_) => has_operation(&root),
            Err(e) => {
                // 变基继续时下一个提交又冲突了，这不算失败（不看错误文字，git 可能是中文界面）
                if op == "rebase" && has_operation(&root)? && has_conflicts(&root)? {
                    Ok(true)
                } else {
                    Err(e)
                }
            }
        }
    })
    .await
}

#[tauri::command]
pub async fn git_op_abort(root: String, op: String) -> Result<(), String> {
    check_op(&op)?;
    blocking(move || {
        let mut cmd = git(&root);
        cmd.args([op.as_str(), "--abort"]);
        run(cmd, None).map(drop)
    })
    .await
}
