use serde::Serialize;
use std::fs;
use std::io::Write;
use std::path::Path;

/// 超过这个大小的文件不在编辑器中打开，避免把整个大文件塞进 WebView 内存。
const MAX_FILE_SIZE: u64 = 20 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    name: String,
    path: String,
    is_dir: bool,
}

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// 只读取一层目录，文件树展开时再按需加载子目录。
#[tauri::command]
pub async fn read_dir(path: String) -> Result<Vec<DirEntry>, String> {
    let mut entries: Vec<DirEntry> = fs::read_dir(&path)
        .map_err(err)?
        .filter_map(|e| e.ok())
        .map(|e| {
            let path = e.path();
            let is_dir = match e.file_type() {
                Ok(t) if t.is_symlink() => path.is_dir(),
                Ok(t) => t.is_dir(),
                Err(_) => false,
            };
            DirEntry {
                name: e.file_name().to_string_lossy().into_owned(),
                path: path.to_string_lossy().into_owned(),
                is_dir,
            }
        })
        .collect();

    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(entries)
}

#[tauri::command]
pub async fn read_file(path: String) -> Result<String, String> {
    let size = fs::metadata(&path).map_err(err)?.len();
    if size > MAX_FILE_SIZE {
        return Err(format!(
            "文件过大（{:.1} MB），暂不支持打开",
            size as f64 / 1024.0 / 1024.0
        ));
    }

    let bytes = fs::read(&path).map_err(err)?;
    let head = &bytes[..bytes.len().min(8000)];
    if head.contains(&0) {
        return Err("二进制文件，无法以文本方式打开".into());
    }

    // 去掉 UTF-8 BOM，保存时统一写成无 BOM 的 UTF-8
    let bytes = bytes
        .strip_prefix(&[0xEF, 0xBB, 0xBF])
        .map(|b| b.to_vec())
        .unwrap_or(bytes);
    String::from_utf8(bytes).map_err(|_| "文件不是 UTF-8 编码，暂不支持打开".into())
}

#[tauri::command]
pub async fn write_file(path: String, content: String) -> Result<(), String> {
    // 先写临时文件再重命名，避免写到一半崩溃导致文件损坏
    let target = Path::new(&path);
    let tmp = target.with_extension(format!(
        "{}.jiezi-tmp",
        target.extension().and_then(|e| e.to_str()).unwrap_or("")
    ));
    {
        let mut f = fs::File::create(&tmp).map_err(err)?;
        f.write_all(content.as_bytes()).map_err(err)?;
        f.sync_all().map_err(err)?;
    }
    fs::rename(&tmp, target).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        err(e)
    })
}

/// 在 `dir` 下新建文件或文件夹，返回新路径。
#[tauri::command]
pub async fn create_entry(dir: String, name: String, is_dir: bool) -> Result<String, String> {
    let path = Path::new(&dir).join(&name);
    if path.exists() {
        return Err(format!("“{name}” 已存在"));
    }
    if is_dir {
        fs::create_dir_all(&path).map_err(err)?;
    } else {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(err)?;
        }
        fs::File::create_new(&path).map_err(err)?;
    }
    Ok(path.to_string_lossy().into_owned())
}

/// 同目录内重命名，返回新路径。
#[tauri::command]
pub async fn rename_entry(path: String, new_name: String) -> Result<String, String> {
    let old = Path::new(&path);
    let new = old
        .parent()
        .ok_or("无法重命名根目录")?
        .join(&new_name);
    if new.exists() {
        return Err(format!("“{new_name}” 已存在"));
    }
    fs::rename(old, &new).map_err(err)?;
    Ok(new.to_string_lossy().into_owned())
}

/// 快速打开最多列出这么多文件
const MAX_LIST_FILES: usize = 50_000;

/// 列出文件夹下所有文件的相对路径，供快速打开（Ctrl+P）使用。
/// 遵守 .gitignore，并跳过 .git 和 node_modules。
#[tauri::command]
pub async fn list_files(root: String) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let base = Path::new(&root);
        let mut files = Vec::new();
        let walker = ignore::WalkBuilder::new(base)
            .hidden(false)
            .filter_entry(|e| e.file_name() != ".git" && e.file_name() != "node_modules")
            .build();
        for entry in walker.flatten() {
            if !entry.file_type().is_some_and(|t| t.is_file()) {
                continue;
            }
            if let Ok(rel) = entry.path().strip_prefix(base) {
                files.push(rel.to_string_lossy().into_owned());
                if files.len() >= MAX_LIST_FILES {
                    break;
                }
            }
        }
        files
    })
    .await
    .map_err(err)
}

/// 删除到回收站，而不是永久删除。
#[tauri::command]
pub async fn delete_entry(path: String) -> Result<(), String> {
    trash::delete(&path).map_err(err)
}
