use super::{blocking, git, log_command, native_path, run_text, spawn_error};
use crate::askpass;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::io::Read;
use std::path::Path;
use std::process::Command;
use std::sync::{LazyLock, Mutex};
use std::time::Instant;
use tauri::ipc::Channel;
use tauri::WebviewWindow;

#[derive(Clone, Serialize)]
pub struct Progress {
    /// 如 "Receiving objects"
    phase: String,
    percent: u32,
}

/// 正在执行的远程操作：操作编号 → 进程号，用于取消
static RUNNING: LazyLock<Mutex<HashMap<u32, u32>>> = LazyLock::new(Default::default);
static CANCELLED: LazyLock<Mutex<HashSet<u32>>> = LazyLock::new(Default::default);

/// 从 "Receiving objects:  45% (123/456), 1.2 MiB | 2 MiB/s" 这样的行里取出阶段和百分比
pub(super) fn parse_progress(line: &str) -> Option<(String, u32)> {
    let line = line.strip_prefix("remote: ").unwrap_or(line);
    let (phase, rest) = line.split_once(':')?;
    let digits: String = rest.trim_start().chars().take_while(char::is_ascii_digit).collect();
    let after = rest.trim_start().get(digits.len()..)?;
    if digits.is_empty() || !after.starts_with('%') {
        return None;
    }
    Some((phase.trim().to_string(), digits.parse().ok()?))
}

/// 执行会输出进度的 git 命令（进度写在 stderr，用 \r 刷新同一行）
pub(super) fn run_streaming(mut cmd: Command, id: u32, on_progress: &Channel<Progress>) -> Result<(), String> {
    let started = Instant::now();
    let mut child = cmd.spawn().map_err(spawn_error)?;
    RUNNING.lock().unwrap().insert(id, child.id());

    let mut stdout = child.stdout.take().unwrap();
    let stdout_thread = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = stdout.read_to_string(&mut s);
        s
    });

    let mut stderr = child.stderr.take().unwrap();
    let mut messages: Vec<String> = Vec::new();
    let mut last: Option<(String, u32)> = None;
    let mut pending: Vec<u8> = Vec::new();
    let mut buf = [0u8; 4096];
    let mut flush = |pending: &mut Vec<u8>, messages: &mut Vec<String>| {
        let text = String::from_utf8_lossy(pending).trim().to_string();
        pending.clear();
        if text.is_empty() {
            return;
        }
        match parse_progress(&text) {
            Some(p) => {
                if last.as_ref() != Some(&p) {
                    let _ = on_progress.send(Progress { phase: p.0.clone(), percent: p.1 });
                    last = Some(p);
                }
            }
            None => messages.push(text),
        }
    };
    loop {
        let n = match stderr.read(&mut buf) {
            Ok(0) | Err(_) => break,
            Ok(n) => n,
        };
        for &b in &buf[..n] {
            if b == b'\r' || b == b'\n' {
                flush(&mut pending, &mut messages);
            } else {
                pending.push(b);
            }
        }
    }
    flush(&mut pending, &mut messages);

    let status = child.wait().map_err(|e| e.to_string());
    RUNNING.lock().unwrap().remove(&id);
    let cancelled = CANCELLED.lock().unwrap().remove(&id);
    let stdout = stdout_thread.join().unwrap_or_default();
    let ok = status.as_ref().is_ok_and(|s| s.success());

    let mut output = messages.join("\n");
    if !stdout.trim().is_empty() {
        output = format!("{}\n{output}", stdout.trim());
    }
    log_command(&cmd, started, ok && !cancelled, &output);

    if cancelled {
        return Err("已取消".into());
    }
    status?;
    if ok {
        Ok(())
    } else if output.trim().is_empty() {
        Err("git 执行失败".into())
    } else {
        Err(output.trim().to_string())
    }
}

fn first_remote(root: &str) -> Result<String, String> {
    let mut cmd = git(root);
    cmd.arg("remote");
    run_text(cmd)?
        .lines()
        .next()
        .map(str::to_string)
        .ok_or_else(|| "仓库还没有配置远程".to_string())
}

/// 与远程同步：pull / push / fetch / push-tags；publish 表示把当前分支推送到第一个远程并设置上游。
/// `id` 由前端生成，用于取消
#[tauri::command]
pub async fn git_remote(
    window: WebviewWindow,
    root: String,
    op: String,
    id: u32,
    on_progress: Channel<Progress>,
) -> Result<(), String> {
    let label = window.label().to_string();
    blocking(move || {
        let mut cmd = git(&root);
        askpass::configure(&mut cmd, &label);
        match op.as_str() {
            "pull" => cmd.args(["pull", "--progress"]),
            "push" => cmd.args(["push", "--progress"]),
            "fetch" => cmd.args(["fetch", "--prune", "--progress"]),
            "push-tags" => cmd.args(["push", "--progress", &first_remote(&root)?, "--tags"]),
            "publish" => cmd.args(["push", "--progress", "-u", &first_remote(&root)?, "HEAD"]),
            _ => return Err(format!("未知操作：{op}")),
        };
        run_streaming(cmd, id, &on_progress)
    })
    .await
}

/// 从地址推出仓库文件夹名：https://github.com/a/b.git → b
pub(super) fn repo_name(url: &str) -> Option<String> {
    let trimmed = url.trim().trim_end_matches(['/', '\\']);
    let trimmed = trimmed.strip_suffix(".git").unwrap_or(trimmed);
    let name = trimmed.rsplit(['/', '\\', ':']).next()?.trim();
    (!name.is_empty()).then(|| name.to_string())
}

/// 把仓库克隆到 `parent` 下的同名文件夹，返回新文件夹的路径
#[tauri::command]
pub async fn git_clone(
    window: WebviewWindow,
    url: String,
    parent: String,
    id: u32,
    on_progress: Channel<Progress>,
) -> Result<String, String> {
    let label = window.label().to_string();
    blocking(move || {
        let name = repo_name(&url).ok_or("无法从地址中识别仓库名")?;
        let target = Path::new(&parent).join(&name);
        if target.exists() {
            return Err(format!("“{}”已存在", target.display()));
        }
        let target = native_path(&target.to_string_lossy());
        let mut cmd = git(&parent);
        askpass::configure(&mut cmd, &label);
        cmd.args(["clone", "--progress", "--", url.trim(), &target]);
        run_streaming(cmd, id, &on_progress)?;
        Ok(target)
    })
    .await
}

/// 取消正在执行的远程操作（连同 git 启动的 ssh / https 子进程一起结束）
#[tauri::command]
pub fn git_cancel(id: u32) {
    let Some(pid) = RUNNING.lock().unwrap().get(&id).copied() else { return };
    CANCELLED.lock().unwrap().insert(id);
    let mut kill = if cfg!(windows) {
        let mut c = Command::new("taskkill");
        c.args(["/PID", &pid.to_string(), "/T", "/F"]);
        c
    } else {
        let mut c = Command::new("kill");
        c.arg(pid.to_string());
        c
    };
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        kill.creation_flags(0x0800_0000);
    }
    let _ = kill.output();
}
