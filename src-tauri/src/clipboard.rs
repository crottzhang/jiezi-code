//! 粘贴到终端的临时截图：保存、列出、读取、删除

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::{Duration, UNIX_EPOCH};
use tauri::ipc::{InvokeBody, Request, Response};

/// 截图保留时长，超过的在下次粘贴截图时删除
const IMAGE_MAX_AGE: Duration = Duration::from_secs(7 * 24 * 60 * 60);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageEntry {
    name: String,
    path: String,
    size: u64,
    /// 修改时间，毫秒时间戳
    modified: u64,
}

#[derive(Serialize)]
pub struct ImageList {
    dir: String,
    images: Vec<ImageEntry>,
}

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// 截图保存目录：exe 所在目录下的 `.temp/clipboard`，不可写时退回系统临时目录
fn clipboard_dir() -> Result<PathBuf, String> {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()));
    let candidates = exe_dir
        .into_iter()
        .chain(std::iter::once(std::env::temp_dir().join("jiezi-code")))
        .map(|d| d.join(".temp").join("clipboard"));
    let mut last_err = String::new();
    for dir in candidates {
        match std::fs::create_dir_all(&dir) {
            Ok(()) => return Ok(dir),
            Err(e) => last_err = e.to_string(),
        }
    }
    Err(last_err)
}

/// 只接受目录里的纯文件名，防止通过 `..` 或路径分隔符访问目录外的文件
fn image_path(name: &str) -> Result<PathBuf, String> {
    if name.is_empty() || name.contains(['/', '\\']) || name.contains("..") {
        return Err("文件名无效".into());
    }
    Ok(clipboard_dir()?.join(name))
}

/// 只处理自己生成的截图，目录里的其他文件不动
fn is_image(entry: &std::fs::DirEntry) -> bool {
    entry.file_name().to_string_lossy().starts_with("image-")
        && entry.file_type().is_ok_and(|t| t.is_file())
}

/// 删除目录里过期的截图，出错直接忽略
fn remove_old_images(dir: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten().filter(is_image) {
        let expired = entry
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.elapsed().ok())
            .is_some_and(|age| age > IMAGE_MAX_AGE);
        if expired {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

/// 保存粘贴到终端的截图，返回文件的绝对路径。
/// 图片字节作为原始请求体传入，文件名放在 `x-file-name` 头里。
#[tauri::command]
pub async fn save_clipboard_image(request: Request<'_>) -> Result<String, String> {
    let InvokeBody::Raw(data) = request.body() else {
        return Err("缺少图片数据".into());
    };
    let name = request
        .headers()
        .get("x-file-name")
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default();
    let path = image_path(name)?;
    std::fs::write(&path, data).map_err(err)?;
    if let Some(dir) = path.parent() {
        remove_old_images(dir);
    }
    Ok(path.to_string_lossy().into_owned())
}

/// 列出所有截图，新的在前
#[tauri::command]
pub async fn list_clipboard_images() -> Result<ImageList, String> {
    let dir = clipboard_dir()?;
    let mut images: Vec<ImageEntry> = std::fs::read_dir(&dir)
        .map_err(err)?
        .flatten()
        .filter(is_image)
        .filter_map(|entry| {
            let meta = entry.metadata().ok()?;
            let modified = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map_or(0, |d| d.as_millis() as u64);
            Some(ImageEntry {
                name: entry.file_name().to_string_lossy().into_owned(),
                path: entry.path().to_string_lossy().into_owned(),
                size: meta.len(),
                modified,
            })
        })
        .collect();
    images.sort_by(|a, b| b.modified.cmp(&a.modified).then_with(|| b.name.cmp(&a.name)));
    Ok(ImageList {
        dir: dir.to_string_lossy().into_owned(),
        images,
    })
}

/// 读取截图的原始字节，前端用来显示缩略图
#[tauri::command]
pub async fn read_clipboard_image(name: String) -> Result<Response, String> {
    let data = std::fs::read(image_path(&name)?).map_err(err)?;
    Ok(Response::new(data))
}

#[tauri::command]
pub async fn delete_clipboard_images(names: Vec<String>) -> Result<(), String> {
    for name in names {
        let path = image_path(&name)?;
        if let Err(e) = std::fs::remove_file(&path) {
            if e.kind() != std::io::ErrorKind::NotFound {
                return Err(format!("删除 {name} 失败：{e}"));
            }
        }
    }
    Ok(())
}

/// 在系统文件管理器中显示截图；不传文件名时打开截图目录
#[tauri::command]
pub async fn reveal_clipboard_image(name: Option<String>) -> Result<(), String> {
    let target = match name {
        Some(name) => image_path(&name)?,
        None => clipboard_dir()?,
    };
    crate::fs::reveal(&target).spawn().map_err(err)?;
    Ok(())
}
