use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

/// 窗口启动时要打开的内容
#[derive(Clone, Serialize)]
pub struct InitialOpen {
    folder: String,
    file: Option<String>,
}

/// 记录每个新窗口启动时要打开的文件夹。
/// 多个窗口共享同一个进程和同一个 WebView2 浏览器进程，比开多个应用实例省内存。
#[derive(Default)]
pub struct PendingFolders {
    map: Mutex<HashMap<String, InitialOpen>>,
    counter: AtomicU32,
}

impl PendingFolders {
    /// 处理命令行参数：`jiezi-code <文件夹>` 打开文件夹，`jiezi-code <文件>` 打开所在文件夹和该文件
    pub fn from_args() -> Self {
        let pending = Self::default();
        if let Some(open) = std::env::args().nth(1).and_then(|arg| resolve_arg(&arg)) {
            pending.map.lock().unwrap().insert("main".into(), open);
        }
        pending
    }
}

fn resolve_arg(arg: &str) -> Option<InitialOpen> {
    let path = std::fs::canonicalize(arg).ok()?;
    // canonicalize 在 Windows 上会返回 \\?\C:\... 形式，去掉前缀
    let text = path.to_string_lossy();
    let clean = text.strip_prefix(r"\\?\").unwrap_or(&text).to_string();
    let path = Path::new(&clean);
    if path.is_dir() {
        Some(InitialOpen { folder: clean.clone(), file: None })
    } else {
        Some(InitialOpen {
            folder: path.parent()?.to_string_lossy().into_owned(),
            file: Some(clean.clone()),
        })
    }
}

/// 必须是 async：在 Windows 上同步命令里创建窗口会死锁。
#[tauri::command]
pub async fn new_window(
    app: AppHandle,
    pending: State<'_, PendingFolders>,
    folder: Option<String>,
) -> Result<(), String> {
    let label = format!("win-{}", pending.counter.fetch_add(1, Ordering::Relaxed) + 1);
    if let Some(folder) = folder {
        pending
            .map
            .lock()
            .unwrap()
            .insert(label.clone(), InitialOpen { folder, file: None });
    }
    WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("index.html".into()))
        .title("Jiezi Code")
        .inner_size(1200.0, 800.0)
        .min_inner_size(600.0, 400.0)
        .decorations(false)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// 前端启动时调用，取走本窗口要打开的内容（只取一次）。
#[tauri::command]
pub fn take_initial_open(
    window: WebviewWindow,
    pending: State<'_, PendingFolders>,
) -> Option<InitialOpen> {
    pending.map.lock().unwrap().remove(window.label())
}
