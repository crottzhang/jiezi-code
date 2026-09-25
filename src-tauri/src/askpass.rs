//! 远程操作需要账号、密码或 SSH 口令时，由编辑器弹窗询问。
//!
//! git/ssh 通过 GIT_ASKPASS / SSH_ASKPASS 启动一个程序来询问，把它的输出当作回答。
//! 这里让编辑器自己的可执行文件充当这个程序：带着特定环境变量启动时不打开窗口，
//! 而是通过本机 TCP 连接把问题交给正在运行的编辑器，编辑器弹出输入框，再把回答传回来。

use serde::{Deserialize, Serialize};
use std::collections::hash_map::RandomState;
use std::collections::HashMap;
use std::hash::{BuildHasher, Hasher};
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::process::Command;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{mpsc, Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

const ENV_PORT: &str = "JIEZI_ASKPASS_PORT";
const ENV_TOKEN: &str = "JIEZI_ASKPASS_TOKEN";
const ENV_WINDOW: &str = "JIEZI_ASKPASS_WINDOW";

/// 用户迟迟不回答时放弃，让 git 以认证失败结束
const ANSWER_TIMEOUT: Duration = Duration::from_secs(600);

struct Server {
    port: u16,
    token: String,
    pending: Mutex<HashMap<u32, mpsc::Sender<Option<String>>>>,
    counter: AtomicU32,
}

static SERVER: OnceLock<Server> = OnceLock::new();

#[derive(Serialize, Deserialize)]
struct Request {
    token: String,
    window: String,
    prompt: String,
}

#[derive(Serialize, Deserialize)]
struct Response {
    value: Option<String>,
}

#[derive(Clone, Serialize)]
struct AskEvent {
    id: u32,
    prompt: String,
    /// 密码、口令类的问题，输入框要隐藏内容
    secret: bool,
}

fn random_token() -> String {
    // RandomState 每次都用系统随机数做种子，足够生成一个本机用的一次性口令
    let a = RandomState::new().build_hasher().finish();
    let mut h = RandomState::new().build_hasher();
    h.write_u32(std::process::id());
    format!("{a:016x}{:016x}", h.finish())
}

/// 启动本机监听，失败时远程操作只是无法弹窗询问，不影响其它功能
pub fn start(app: AppHandle) {
    let Ok(listener) = TcpListener::bind("127.0.0.1:0") else { return };
    let Ok(addr) = listener.local_addr() else { return };
    let server = Server {
        port: addr.port(),
        token: random_token(),
        pending: Mutex::new(HashMap::new()),
        counter: AtomicU32::new(0),
    };
    if SERVER.set(server).is_err() {
        return;
    }
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let app = app.clone();
            std::thread::spawn(move || {
                let _ = handle(stream, &app);
            });
        }
    });
}

fn handle(stream: TcpStream, app: &AppHandle) -> std::io::Result<()> {
    let server = SERVER.get().unwrap();
    let mut reader = BufReader::new(stream.try_clone()?);
    let mut line = String::new();
    reader.read_line(&mut line)?;
    let Ok(req) = serde_json::from_str::<Request>(&line) else { return Ok(()) };
    if req.token != server.token {
        return Ok(());
    }
    let id = server.counter.fetch_add(1, Ordering::Relaxed) + 1;
    let (tx, rx) = mpsc::channel();
    server.pending.lock().unwrap().insert(id, tx);
    let lower = req.prompt.to_lowercase();
    let event = AskEvent {
        id,
        secret: ["password", "passphrase", "token", "密码", "口令"]
            .iter()
            .any(|k| lower.contains(k)),
        prompt: req.prompt,
    };
    let value = if app.emit_to(req.window.as_str(), "git-askpass", event).is_ok() {
        rx.recv_timeout(ANSWER_TIMEOUT).ok().flatten()
    } else {
        None
    };
    server.pending.lock().unwrap().remove(&id);
    let mut stream = stream;
    writeln!(stream, "{}", serde_json::to_string(&Response { value })?)?;
    Ok(())
}

/// 给远程操作的 git 命令配置 askpass，问题会弹到 `window` 这个窗口
pub fn configure(cmd: &mut Command, window: &str) {
    let (Some(server), Ok(exe)) = (SERVER.get(), std::env::current_exe()) else { return };
    cmd.env("GIT_ASKPASS", &exe)
        .env("SSH_ASKPASS", &exe)
        // 即使有终端也用 askpass（OpenSSH 8.4+）
        .env("SSH_ASKPASS_REQUIRE", "force")
        .env(ENV_PORT, server.port.to_string())
        .env(ENV_TOKEN, &server.token)
        .env(ENV_WINDOW, window);
}

/// 前端回答了问题；value 为 None 表示用户取消
#[tauri::command]
pub fn git_askpass_reply(id: u32, value: Option<String>) {
    if let Some(server) = SERVER.get() {
        if let Some(tx) = server.pending.lock().unwrap().remove(&id) {
            let _ = tx.send(value);
        }
    }
}

/// 作为 askpass 程序被 git/ssh 启动时执行：返回进程退出码；普通启动时返回 None
pub fn client_main() -> Option<i32> {
    let port = std::env::var(ENV_PORT).ok()?;
    let token = std::env::var(ENV_TOKEN).unwrap_or_default();
    let window = std::env::var(ENV_WINDOW).unwrap_or_default();
    let prompt = std::env::args().nth(1).unwrap_or_default();
    Some(match ask(&port, token, window, prompt) {
        Some(answer) => {
            println!("{answer}");
            0
        }
        None => 1,
    })
}

fn ask(port: &str, token: String, window: String, prompt: String) -> Option<String> {
    let mut stream = TcpStream::connect(("127.0.0.1", port.parse::<u16>().ok()?)).ok()?;
    let req = serde_json::to_string(&Request { token, window, prompt }).ok()?;
    writeln!(stream, "{req}").ok()?;
    let mut line = String::new();
    BufReader::new(stream).read_line(&mut line).ok()?;
    serde_json::from_str::<Response>(&line).ok()?.value
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_round_trip_through_json() {
        let req = Request {
            token: "t".into(),
            window: "main".into(),
            prompt: "Password for 'https://u@example.com': ".into(),
        };
        let back: Request = serde_json::from_str(&serde_json::to_string(&req).unwrap()).unwrap();
        assert_eq!(back.prompt, req.prompt);
        let res: Response = serde_json::from_str(r#"{"value":null}"#).unwrap();
        assert!(res.value.is_none());
    }

    #[test]
    fn tokens_differ() {
        assert_ne!(random_token(), random_token());
        assert_eq!(random_token().len(), 32);
    }
}
