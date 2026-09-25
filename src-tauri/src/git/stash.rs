use super::{blocking, git_without_literal as git, run, run_text};
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stash {
    /// stash@{index}
    pub(super) index: u32,
    pub(super) hash: String,
    /// 如 "WIP on main: 1a2b3c 提交说明" 或 "On main: 自己写的说明"
    pub(super) message: String,
    pub(super) time: i64,
}

pub(super) fn parse_stashes(out: &str) -> Vec<Stash> {
    out.lines()
        .filter_map(|line| {
            let f: Vec<&str> = line.splitn(4, '\x1f').collect();
            if f.len() < 4 {
                return None;
            }
            let index = f[0].strip_prefix("stash@{")?.strip_suffix('}')?.parse().ok()?;
            Some(Stash {
                index,
                hash: f[1].into(),
                message: f[3].into(),
                time: f[2].parse().unwrap_or(0),
            })
        })
        .collect()
}

#[tauri::command]
pub async fn git_stash_list(root: String) -> Result<Vec<Stash>, String> {
    blocking(move || {
        let mut cmd = git(&root);
        cmd.args(["stash", "list", "--format=%gd%x1f%H%x1f%ct%x1f%gs"]);
        Ok(parse_stashes(&run_text(cmd)?))
    })
    .await
}

/// 储藏当前的改动；untracked 时连未跟踪的文件一起储藏
#[tauri::command]
pub async fn git_stash_push(root: String, message: String, untracked: bool) -> Result<(), String> {
    blocking(move || {
        let mut cmd = git(&root);
        cmd.args(["stash", "push", "-q"]);
        if untracked {
            cmd.arg("--include-untracked");
        }
        if !message.trim().is_empty() {
            cmd.args(["-m", message.trim()]);
        }
        run(cmd, None).map(drop)
    })
    .await
}

/// 应用储藏；pop 时应用成功后删除这条储藏（有冲突时 git 会保留它）
#[tauri::command]
pub async fn git_stash_apply(root: String, index: u32, pop: bool) -> Result<(), String> {
    blocking(move || {
        let mut cmd = git(&root);
        cmd.args([
            "stash",
            if pop { "pop" } else { "apply" },
            "-q",
            &format!("stash@{{{index}}}"),
        ]);
        run(cmd, None).map(drop)
    })
    .await
}

#[tauri::command]
pub async fn git_stash_drop(root: String, index: u32) -> Result<(), String> {
    blocking(move || {
        let mut cmd = git(&root);
        cmd.args(["stash", "drop", "-q", &format!("stash@{{{index}}}")]);
        run(cmd, None).map(drop)
    })
    .await
}
