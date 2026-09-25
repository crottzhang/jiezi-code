use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{mpsc, Mutex};
use std::time::Duration;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Manager, State, WebviewWindow};

struct Session {
    // master 被 drop 时伪终端关闭，读线程随之收到 EOF
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
    window: String,
}

#[derive(Default)]
pub struct Terminals {
    sessions: Mutex<HashMap<u32, Session>>,
    counter: AtomicU32,
}

fn default_shell() -> CommandBuilder {
    if cfg!(windows) {
        let mut cmd = CommandBuilder::new("powershell.exe");
        cmd.arg("-NoLogo");
        cmd
    } else {
        CommandBuilder::new(std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into()))
    }
}

fn home_dir() -> Option<String> {
    std::env::var(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).ok()
}

fn pty_size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        rows: rows.max(1),
        cols: cols.max(1),
        pixel_width: 0,
        pixel_height: 0,
    }
}

/// 启动一个 shell。输出以原始字节通过 `on_data` 推给前端（xterm.js 自己做 UTF-8 解码），
/// 进程退出后通过 `on_exit` 发送退出码。
#[tauri::command]
pub async fn term_spawn(
    app: AppHandle,
    window: WebviewWindow,
    terminals: State<'_, Terminals>,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
    on_data: Channel,
    on_exit: Channel<i32>,
) -> Result<u32, String> {
    let pair = native_pty_system()
        .openpty(pty_size(cols, rows))
        .map_err(|e| e.to_string())?;

    let mut cmd = default_shell();
    if let Some(dir) = cwd.or_else(home_dir) {
        cmd.cwd(dir);
    }
    let mut child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let id = terminals.counter.fetch_add(1, Ordering::Relaxed) + 1;

    terminals.sessions.lock().unwrap().insert(
        id,
        Session {
            master: pair.master,
            writer,
            killer: child.clone_killer(),
            window: window.label().to_string(),
        },
    );

    let (exit_tx, exit_rx) = mpsc::channel::<i32>();

    // 等待进程退出，然后关闭伪终端。
    // Windows 的 ConPTY 在伪终端关闭前不会给读端 EOF，所以要由这里主动移除会话。
    std::thread::spawn(move || {
        let code = child.wait().map(|s| s.exit_code() as i32).unwrap_or(-1);
        let _ = exit_tx.send(code);
        // 先从表里取出再 drop：关闭伪终端可能短暂阻塞，不要持锁进行
        let session = app.state::<Terminals>().sessions.lock().unwrap().remove(&id);
        drop(session);
    });

    // 读输出直到 EOF，确保所有输出都发完之后才通知退出
    std::thread::spawn(move || {
        let mut buf = [0u8; 16 * 1024];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if on_data.send(InvokeResponseBody::Raw(buf[..n].to_vec())).is_err() {
                        break;
                    }
                }
            }
        }
        let code = exit_rx.recv_timeout(Duration::from_secs(3)).unwrap_or(-1);
        let _ = on_exit.send(code);
    });

    Ok(id)
}

#[tauri::command]
pub async fn term_write(terminals: State<'_, Terminals>, id: u32, data: String) -> Result<(), String> {
    let mut sessions = terminals.sessions.lock().unwrap();
    let session = sessions.get_mut(&id).ok_or("终端已关闭")?;
    session.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
    session.writer.flush().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn term_resize(
    terminals: State<'_, Terminals>,
    id: u32,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let sessions = terminals.sessions.lock().unwrap();
    let session = sessions.get(&id).ok_or("终端已关闭")?;
    session.master.resize(pty_size(cols, rows)).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn term_kill(terminals: State<'_, Terminals>, id: u32) -> Result<(), String> {
    let session = terminals.sessions.lock().unwrap().remove(&id);
    if let Some(mut session) = session {
        let _ = session.killer.kill();
    }
    Ok(())
}

/// 窗口关闭时结束它打开的所有终端
pub fn kill_window_terminals(app: &AppHandle, label: &str) {
    let removed: Vec<Session> = {
        let terminals = app.state::<Terminals>();
        let mut sessions = terminals.sessions.lock().unwrap();
        let ids: Vec<u32> = sessions
            .iter()
            .filter(|(_, s)| s.window == label)
            .map(|(id, _)| *id)
            .collect();
        ids.iter().filter_map(|id| sessions.remove(id)).collect()
    };
    for mut session in removed {
        let _ = session.killer.kill();
    }
}
