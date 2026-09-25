//! Git 集成：调用系统的 git 命令行，沿用用户自己的配置、钩子和凭据。

pub mod branch;
pub mod history;
pub mod remote;
pub mod stash;
pub mod status;
#[cfg(test)]
mod tests;

use serde::Serialize;
use std::io::Write;
use std::process::{Command, Stdio};
use std::sync::OnceLock;
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

static APP: OnceLock<AppHandle> = OnceLock::new();

/// 启动时调用，之后每条 git 命令都会通过 `git-output` 事件发给前端的输出日志
pub fn init(app: &AppHandle) {
    let _ = APP.set(app.clone());
}

/// 这些只读命令频繁执行（轮询状态、对比、行作者信息），只在出错时记录
const QUIET: &[&str] = &[
    "status",
    "rev-parse",
    "show",
    "cat-file",
    "blame",
    "log",
    "for-each-ref",
    "diff-tree",
    "ls-files",
    "hash-object",
    "remote",
];

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputEntry {
    /// 执行命令的目录，前端据此只显示自己仓库的日志
    cwd: String,
    /// 开始时间，Unix 毫秒
    time: u64,
    command: String,
    duration_ms: u64,
    ok: bool,
    output: String,
}

/// 日志里每条命令最多保留这么多字符的输出
const MAX_LOG_OUTPUT: usize = 8000;

pub(crate) fn log_command(cmd: &Command, started: Instant, ok: bool, output: &str) {
    let Some(app) = APP.get() else { return };
    let args: Vec<String> = cmd
        .get_args()
        .map(|a| a.to_string_lossy().into_owned())
        .collect();
    let args = user_args(&args);
    if ok && args.first().is_some_and(|a| QUIET.contains(&a.as_str())) {
        return;
    }
    let mut output = output.trim().to_string();
    if output.len() > MAX_LOG_OUTPUT {
        let mut cut = MAX_LOG_OUTPUT;
        while !output.is_char_boundary(cut) {
            cut -= 1;
        }
        output.truncate(cut);
        output.push_str("\n…（输出过长，已截断）");
    }
    let elapsed = started.elapsed();
    let time = SystemTime::now()
        .checked_sub(elapsed)
        .unwrap_or(UNIX_EPOCH)
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let entry = OutputEntry {
        cwd: cmd
            .get_current_dir()
            .map(|d| d.to_string_lossy().into_owned())
            .unwrap_or_default(),
        time,
        command: format!("git {}", args.join(" ")),
        duration_ms: elapsed.as_millis() as u64,
        ok,
        output,
    };
    let _ = app.emit("git-output", entry);
}

/// 去掉 `git()` 统一加上的全局参数，只留用户关心的部分
fn user_args(args: &[String]) -> &[String] {
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "-c" => i += 2,
            a if a.starts_with('-') => i += 1,
            _ => break,
        }
    }
    &args[i.min(args.len())..]
}

pub(crate) fn git(cwd: &str) -> Command {
    let mut cmd = git_without_literal(cwd);
    // 路径按字面匹配，否则 `[id].vue` 这类文件名会被当成通配符
    cmd.arg("--literal-pathspecs");
    cmd
}

/// 不带 --literal-pathspecs 的 git。git stash 内部依赖通配路径，
/// 加上这个参数后 `stash push --include-untracked` 会悄悄漏掉未跟踪的文件
pub(crate) fn git_without_literal(cwd: &str) -> Command {
    let mut cmd = Command::new("git");
    cmd.current_dir(cwd)
        .args(["-c", "core.quotepath=false"])
        // 需要输入账号密码时直接失败，而不是卡在看不见的终端提示上（远程操作另外配置了 askpass）
        .env("GIT_TERMINAL_PROMPT", "0")
        // 永远不要打开编辑器：":" 是 git 认可的“什么都不做”的编辑器
        .env("GIT_EDITOR", ":")
        .env("GIT_SEQUENCE_EDITOR", ":")
        .env("GIT_MERGE_AUTOEDIT", "no")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

pub(crate) fn spawn_error(e: std::io::Error) -> String {
    if e.kind() == std::io::ErrorKind::NotFound {
        "未找到 git，请先安装 Git 并把它加入 PATH".to_string()
    } else {
        e.to_string()
    }
}

/// 执行 git，成功返回 stdout；失败返回 git 的错误输出
pub(crate) fn run(mut cmd: Command, input: Option<&[u8]>) -> Result<Vec<u8>, String> {
    let started = Instant::now();
    if input.is_some() {
        cmd.stdin(Stdio::piped());
    }
    let mut child = cmd.spawn().map_err(spawn_error)?;
    if let Some(input) = input {
        // 写完就关闭 stdin，git 才知道输入结束了
        let mut stdin = child.stdin.take().unwrap();
        stdin.write_all(input).map_err(|e| e.to_string())?;
    }
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    let stderr = String::from_utf8_lossy(&out.stderr);
    if out.status.success() {
        // 成功时 stdout 可能是文件内容等大块数据，日志里只记 stderr 里的提示
        log_command(&cmd, started, true, &stderr);
        return Ok(out.stdout);
    }
    let stdout = String::from_utf8_lossy(&out.stdout);
    let msg = [stdout.trim(), stderr.trim()]
        .into_iter()
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    log_command(&cmd, started, false, &msg);
    // 错误提示优先用 stderr；只有 stdout 时（比如合并冲突的提示）用 stdout
    Err(if stderr.trim().is_empty() { msg } else { stderr.trim().to_string() })
}

pub(crate) fn run_text(cmd: Command) -> Result<String, String> {
    run(cmd, None).map(|b| String::from_utf8_lossy(&b).trim_end().to_string())
}

/// 在后台线程执行，避免阻塞异步运行时
pub(crate) async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())?
}

/// 把路径列表以 NUL 分隔通过 stdin 传给 git，不受命令行长度限制
pub(crate) fn with_paths(mut cmd: Command, paths: &[String]) -> Result<Vec<u8>, String> {
    cmd.args(["--pathspec-from-file=-", "--pathspec-file-nul"]);
    run(cmd, Some(paths.join("\0").as_bytes()))
}

pub(crate) fn native_path(p: &str) -> String {
    if cfg!(windows) {
        p.replace('/', "\\")
    } else {
        p.to_string()
    }
}

/// 分支名、提交号等作为位置参数传给 git 时，不允许以 - 开头，免得被当成选项
pub(crate) fn check_arg(value: &str, what: &str) -> Result<(), String> {
    if value.is_empty() || value.starts_with('-') {
        Err(format!("无效的{what}：{value}"))
    } else {
        Ok(())
    }
}
