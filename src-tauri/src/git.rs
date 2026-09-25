use serde::Serialize;
use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

/// 变更列表最多返回这么多条，避免没被忽略的大目录（比如 node_modules）把界面卡死
const MAX_CHANGES: usize = 5000;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitChange {
    /// 相对仓库根目录的路径，分隔符是 `/`
    path: String,
    /// 重命名/复制前的路径
    orig_path: Option<String>,
    /// 暂存区状态：M A D R C T，`.` 表示无变化
    index: char,
    /// 工作区状态：M D T，`?` 表示未跟踪，`.` 表示无变化
    worktree: char,
    /// 合并冲突
    conflict: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    /// 仓库根目录（本机路径格式）
    root: String,
    /// 当前分支，游离 HEAD 时为 None
    branch: Option<String>,
    /// 当前提交的短哈希，还没有提交时为 None
    head: Option<String>,
    upstream: Option<String>,
    ahead: u32,
    behind: u32,
    changes: Vec<GitChange>,
    truncated: bool,
}

fn git(cwd: &str) -> Command {
    let mut cmd = Command::new("git");
    cmd.current_dir(cwd)
        // 路径按字面匹配，否则 `[id].vue` 这类文件名会被当成通配符
        .args(["--literal-pathspecs", "-c", "core.quotepath=false"])
        // 需要输入账号密码时直接失败，而不是卡在看不见的终端提示上
        .env("GIT_TERMINAL_PROMPT", "0")
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

/// 执行 git，成功返回 stdout；失败返回 git 的错误输出
fn run(mut cmd: Command, input: Option<&[u8]>) -> Result<Vec<u8>, String> {
    if input.is_some() {
        cmd.stdin(Stdio::piped());
    }
    let mut child = cmd.spawn().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            "未找到 git，请先安装 Git 并把它加入 PATH".to_string()
        } else {
            e.to_string()
        }
    })?;
    if let Some(input) = input {
        // 写完就关闭 stdin，git 才知道输入结束了
        let mut stdin = child.stdin.take().unwrap();
        stdin.write_all(input).map_err(|e| e.to_string())?;
    }
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    if out.status.success() {
        return Ok(out.stdout);
    }
    let msg = String::from_utf8_lossy(&out.stderr).trim().to_string();
    Err(if msg.is_empty() {
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    } else {
        msg
    })
}

fn run_text(cmd: Command) -> Result<String, String> {
    run(cmd, None).map(|b| String::from_utf8_lossy(&b).trim_end().to_string())
}

/// 在后台线程执行，避免阻塞异步运行时
async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())?
}

/// 把路径列表以 NUL 分隔通过 stdin 传给 git，不受命令行长度限制
fn with_paths(mut cmd: Command, paths: &[String]) -> Result<Vec<u8>, String> {
    cmd.args(["--pathspec-from-file=-", "--pathspec-file-nul"]);
    run(cmd, Some(paths.join("\0").as_bytes()))
}

fn native_path(p: &str) -> String {
    if cfg!(windows) {
        p.replace('/', "\\")
    } else {
        p.to_string()
    }
}

fn status_char(s: &str, i: usize) -> char {
    s.chars().nth(i).unwrap_or('.')
}

/// 解析 `git status --porcelain=v2 --branch -z` 的输出
fn parse_status(root: String, out: &[u8]) -> GitStatus {
    let text = String::from_utf8_lossy(out);
    let mut status = GitStatus {
        root,
        branch: None,
        head: None,
        upstream: None,
        ahead: 0,
        behind: 0,
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
            Some(b'1') => line.splitn(9, ' ').collect::<Vec<_>>().get(8).map(|path| {
                let xy = &line[2..4];
                GitChange {
                    path: path.to_string(),
                    orig_path: None,
                    index: status_char(xy, 0),
                    worktree: status_char(xy, 1),
                    conflict: false,
                }
            }),
            // 2 XY sub mH mI mW hH hI Xscore path，后面紧跟一个 NUL 分隔的原路径
            Some(b'2') => {
                let path = line.splitn(10, ' ').nth(9).map(str::to_string);
                let orig = tokens.next().map(str::to_string);
                path.map(|path| {
                    let xy = &line[2..4];
                    GitChange {
                        path,
                        orig_path: orig,
                        index: status_char(xy, 0),
                        worktree: status_char(xy, 1),
                        conflict: false,
                    }
                })
            }
            // u XY sub m1 m2 m3 mW h1 h2 h3 path
            Some(b'u') => line.splitn(11, ' ').nth(10).map(|path| GitChange {
                path: path.to_string(),
                orig_path: None,
                index: '.',
                worktree: '.',
                conflict: true,
            }),
            Some(b'?') => Some(GitChange {
                path: line[2..].to_string(),
                orig_path: None,
                index: '.',
                worktree: '?',
                conflict: false,
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

/// 查询 `dir` 所在仓库的状态；不在仓库里时返回 None
#[tauri::command]
pub async fn git_status(dir: String) -> Result<Option<GitStatus>, String> {
    blocking(move || {
        let mut cmd = git(&dir);
        // 需要根据错误信息判断，固定用英文输出
        cmd.env("LC_ALL", "C").args(["rev-parse", "--show-toplevel"]);
        let root = match run_text(cmd) {
            Ok(root) => native_path(&root),
            Err(e) if e.contains("not a git repository") => return Ok(None),
            Err(e) => return Err(e),
        };
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
        Ok(Some(parse_status(root, &out)))
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
        if amend && message.is_empty() {
            // 修改上次提交但不改提交信息
            cmd.arg("--no-edit");
            return run(cmd, None).map(drop);
        }
        cmd.args(["-F", "-"]);
        run(cmd, Some(message.as_bytes())).map(drop)
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
            Err(e) if e.contains("invalid object name") => return Ok(None),
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

#[tauri::command]
pub async fn git_branches(root: String) -> Result<Vec<String>, String> {
    blocking(move || {
        let mut cmd = git(&root);
        cmd.args([
            "for-each-ref",
            "--sort=-committerdate",
            "--format=%(refname:short)",
            "refs/heads",
        ]);
        Ok(run_text(cmd)?.lines().map(str::to_string).collect())
    })
    .await
}

#[tauri::command]
pub async fn git_checkout(
    root: String,
    branch: String,
    create: bool,
    start: Option<String>,
) -> Result<(), String> {
    // 分支名和提交号都不允许以 - 开头，这里先拦下，免得被当成命令行选项
    if branch.starts_with('-') || start.as_deref().is_some_and(|s| s.starts_with('-')) {
        return Err(format!("无效的分支名：{branch}"));
    }
    blocking(move || {
        let mut cmd = git(&root);
        cmd.args(["switch", "-q"]);
        if create {
            cmd.arg("-c");
        }
        cmd.arg(&branch);
        // 新建分支时的起点提交
        if let Some(start) = start.filter(|_| create) {
            cmd.arg(start);
        }
        run(cmd, None).map(drop)
    })
    .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommit {
    hash: String,
    short: String,
    parents: Vec<String>,
    author: String,
    email: String,
    /// 作者时间，Unix 秒
    time: i64,
    /// 指向这个提交的引用，如 `HEAD -> master`、`origin/master`、`tag: v1.0`
    refs: Vec<String>,
    subject: String,
    body: String,
}

/// 字段之间用 0x1f 分隔，提交之间由 -z 用 NUL 分隔
const LOG_FORMAT: &str = "--format=%H%x1f%h%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%D%x1f%s%x1f%b";

fn parse_log(out: &[u8]) -> Vec<GitCommit> {
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

/// 当前分支的提交历史，分页读取。给了 `path` 时只列出改动过这个文件的提交（跟随重命名）
#[tauri::command]
pub async fn git_log(
    root: String,
    skip: u32,
    limit: u32,
    path: Option<String>,
) -> Result<Vec<GitCommit>, String> {
    blocking(move || {
        let mut cmd = git(&root);
        cmd.env("LC_ALL", "C").args([
            "log",
            "-z",
            LOG_FORMAT,
            &format!("--skip={skip}"),
            &format!("--max-count={limit}"),
        ]);
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
    path: String,
    orig_path: Option<String>,
    /// A M D R C T
    status: char,
}

/// 解析 `--name-status -z` 的输出：状态\0路径\0，重命名/复制是 状态\0原路径\0新路径\0
fn parse_name_status(out: &[u8]) -> Vec<CommitFile> {
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

/// 某个提交改动的文件（与第一个父提交比较；根提交与空树比较）
#[tauri::command]
pub async fn git_commit_files(root: String, hash: String) -> Result<Vec<CommitFile>, String> {
    if hash.starts_with('-') {
        return Err(format!("无效的提交：{hash}"));
    }
    blocking(move || {
        let mut cmd = git(&root);
        cmd.args([
            "diff-tree",
            "-r",
            "-z",
            "-M",
            "--no-commit-id",
            "--name-status",
            "--root",
        ]);
        // 合并提交只和第一个父提交比较，和在分支上看到的改动一致
        cmd.arg(format!("{hash}^1"));
        cmd.arg(&hash);
        let out = match run(cmd, None) {
            Ok(out) => out,
            // 根提交没有父提交，单独和空树比较
            Err(_) => {
                let mut cmd = git(&root);
                cmd.args([
                    "diff-tree",
                    "-r",
                    "-z",
                    "-M",
                    "--no-commit-id",
                    "--name-status",
                    "--root",
                    &hash,
                ]);
                run(cmd, None)?
            }
        };
        Ok(parse_name_status(&out))
    })
    .await
}

/// 与远程同步：pull / push / fetch；publish 表示把当前分支推送到第一个远程并设置上游
#[tauri::command]
pub async fn git_remote(root: String, op: String) -> Result<(), String> {
    blocking(move || {
        let mut cmd = git(&root);
        match op.as_str() {
            "pull" => {
                cmd.arg("pull");
            }
            "push" => {
                cmd.arg("push");
            }
            "fetch" => {
                cmd.args(["fetch", "--prune"]);
            }
            "publish" => {
                let mut list = git(&root);
                list.arg("remote");
                let remotes = run_text(list)?;
                let remote = remotes.lines().next().ok_or("仓库还没有配置远程，无法发布分支")?;
                cmd.args(["push", "-u", remote, "HEAD"]);
            }
            _ => return Err(format!("未知操作：{op}")),
        }
        run(cmd, None).map(drop)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

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
    }

    #[test]
    fn parses_unborn_and_detached() {
        let s = parse_status("repo".into(), b"# branch.oid (initial)\0# branch.head (detached)\0");
        assert_eq!((s.head, s.branch), (None, None));
    }
}

#[cfg(test)]
mod command_tests {
    use super::*;
    use tauri::async_runtime::block_on;

    fn sh(dir: &str, args: &[&str]) {
        let mut cmd = git(dir);
        cmd.args(args);
        run(cmd, None).unwrap();
    }

    /// 在临时仓库里走一遍暂存、取消暂存、读取版本、放弃更改、提交、切换分支
    #[test]
    fn round_trip_in_temp_repo() {
        let dir = std::env::temp_dir().join(format!("jiezi-git-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let root = dir.to_string_lossy().into_owned();

        assert!(block_on(git_status(root.clone())).unwrap().is_none());
        block_on(git_init(root.clone())).unwrap();
        sh(&root, &["config", "user.email", "t@t"]);
        sh(&root, &["config", "user.name", "t"]);
        sh(&root, &["config", "core.autocrlf", "false"]);

        // 文件名带通配符和中文，确认按字面匹配
        let name = "页面 [id].txt";
        std::fs::write(dir.join(name), "one\n").unwrap();
        let s = block_on(git_status(root.clone())).unwrap().unwrap();
        assert_eq!((s.changes[0].path.as_str(), s.changes[0].worktree), (name, '?'));

        // 还没有提交时也能暂存和取消暂存
        block_on(git_stage(root.clone(), vec![name.into()])).unwrap();
        let s = block_on(git_status(root.clone())).unwrap().unwrap();
        assert_eq!(s.changes[0].index, 'A');
        block_on(git_unstage(root.clone(), vec![name.into()])).unwrap();
        let s = block_on(git_status(root.clone())).unwrap().unwrap();
        assert_eq!(s.changes[0].worktree, '?');

        block_on(git_stage(root.clone(), vec![name.into()])).unwrap();
        block_on(git_commit(root.clone(), "第一次提交\n\n正文".into(), false)).unwrap();
        let s = block_on(git_status(root.clone())).unwrap().unwrap();
        assert!(s.changes.is_empty() && s.head.is_some());

        std::fs::write(dir.join(name), "two\n").unwrap();
        assert_eq!(
            block_on(git_show(root.clone(), "HEAD".into(), name.into())).unwrap().as_deref(),
            Some("one\n")
        );
        assert_eq!(block_on(git_show(root.clone(), "HEAD".into(), "nope.txt".into())).unwrap(), None);
        block_on(git_discard(root.clone(), vec![name.into()], vec![])).unwrap();
        assert_eq!(std::fs::read_to_string(dir.join(name)).unwrap(), "one\n");

        // 历史：根提交的文件列表
        let log = block_on(git_log(root.clone(), 0, 50, None)).unwrap();
        assert_eq!(log.len(), 1);
        assert_eq!((log[0].subject.as_str(), log[0].body.as_str()), ("第一次提交", "正文"));
        assert!(log[0].refs.iter().any(|r| r.starts_with("HEAD -> ")));
        let files = block_on(git_commit_files(root.clone(), log[0].hash.clone())).unwrap();
        assert_eq!((files[0].path.as_str(), files[0].status), (name, 'A'));

        // 重命名 + 新增，再看第二个提交的文件列表和按文件过滤的历史
        sh(&root, &["mv", name, "renamed.txt"]);
        std::fs::write(dir.join("other.txt"), "x\n").unwrap();
        block_on(git_stage(root.clone(), vec!["other.txt".into()])).unwrap();
        block_on(git_commit(root.clone(), "second".into(), false)).unwrap();
        let log = block_on(git_log(root.clone(), 0, 50, None)).unwrap();
        assert_eq!(log.len(), 2);
        assert_eq!(log[0].parents, [log[1].hash.clone()]);
        let mut files = block_on(git_commit_files(root.clone(), log[0].hash.clone())).unwrap();
        files.sort_by(|a, b| a.path.cmp(&b.path));
        let summary: Vec<_> = files
            .iter()
            .map(|f| (f.path.as_str(), f.orig_path.as_deref(), f.status))
            .collect();
        assert_eq!(summary, [("other.txt", None, 'A'), ("renamed.txt", Some(name), 'R')]);
        let followed = block_on(git_log(root.clone(), 0, 50, Some("renamed.txt".into()))).unwrap();
        assert_eq!(followed.len(), 2);
        let paged = block_on(git_log(root.clone(), 1, 50, None)).unwrap();
        assert_eq!(paged[0].hash, log[1].hash);

        // 从旧提交新建分支
        block_on(git_checkout(root.clone(), "from-old".into(), true, Some(log[1].short.clone()))).unwrap();
        assert!(!dir.join("other.txt").exists());

        block_on(git_checkout(root.clone(), "feature/x".into(), true, None)).unwrap();
        let s = block_on(git_status(root.clone())).unwrap().unwrap();
        assert_eq!(s.branch.as_deref(), Some("feature/x"));
        let branches = block_on(git_branches(root.clone())).unwrap();
        assert_eq!(branches.len(), 3);

        block_on(git_commit(root.clone(), String::new(), true)).unwrap();
        assert!(block_on(git_remote(root.clone(), "publish".into())).is_err());

        let _ = std::fs::remove_dir_all(&dir);
    }
}
