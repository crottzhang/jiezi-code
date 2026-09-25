//! 监听打开的文件夹：文件在外部被改动（终端、其它程序、git 命令）时通知前端刷新文件树、
//! 已打开的文件和 Git 状态。

use notify_debouncer_mini::notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_mini::{new_debouncer, DebounceEventResult, Debouncer};
use serde::Serialize;
use std::collections::{BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

/// 一批改动超过这么多个目录时不再逐个列出，前端整体刷新
const MAX_DIRS: usize = 300;

/// 每个窗口一个监听器
#[derive(Default)]
pub struct Watchers(Mutex<HashMap<String, Debouncer<RecommendedWatcher>>>);

#[derive(Clone, Serialize, Default, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FsChange {
    /// 内容有变化的目录（新建、删除、重命名了其中的条目）
    dirs: Vec<String>,
    /// 有变化的文件
    files: Vec<String>,
    /// .git 里有变化（提交、切换分支、暂存等），需要刷新 Git 状态
    git: bool,
    /// 改动太多，前端应整体刷新
    all: bool,
}

/// 把一批变化的路径归类
pub(crate) fn classify(paths: &[PathBuf], git_dirs: &[PathBuf]) -> FsChange {
    let mut dirs = BTreeSet::new();
    let mut files = BTreeSet::new();
    let mut git = false;
    for path in paths {
        if let Some(rel) = git_dirs.iter().find_map(|g| path.strip_prefix(g).ok()) {
            // 对象库、引用日志、锁文件的变化不影响状态显示；储藏的引用日志除外
            let rel_str = rel.to_string_lossy().replace('\\', "/");
            let noise = rel_str.starts_with("objects")
                || (rel_str.starts_with("logs") && !rel_str.starts_with("logs/refs/stash"))
                || rel_str.ends_with(".lock");
            if !noise {
                git = true;
            }
            continue;
        }
        files.insert(path.to_string_lossy().into_owned());
        if let Some(parent) = path.parent() {
            dirs.insert(parent.to_string_lossy().into_owned());
        }
    }
    if dirs.len() > MAX_DIRS {
        return FsChange { git: true, all: true, ..Default::default() };
    }
    FsChange {
        // 工作区文件变化也可能改变 Git 状态
        git: git || !files.is_empty(),
        dirs: dirs.into_iter().collect(),
        files: files.into_iter().collect(),
        all: false,
    }
}

/// 开始监听 `root`（替换本窗口之前的监听）。`git_dir` 在文件夹之外时（打开的是仓库的子目录）也一并监听。
/// root 为 None 时停止监听
#[tauri::command]
pub fn fs_watch(
    app: AppHandle,
    window: WebviewWindow,
    watchers: State<'_, Watchers>,
    root: Option<String>,
    git_dir: Option<String>,
) -> Result<(), String> {
    let label = window.label().to_string();
    let mut map = watchers.0.lock().unwrap();
    map.remove(&label);
    let Some(root) = root else { return Ok(()) };

    let root_path = PathBuf::from(&root);
    let mut git_dirs = vec![root_path.join(".git")];
    let outside = git_dir
        .map(PathBuf::from)
        .filter(|g| !g.starts_with(&root_path));
    if let Some(g) = &outside {
        git_dirs.push(g.clone());
    }

    let target = label.clone();
    let mut debouncer = new_debouncer(Duration::from_millis(250), move |res: DebounceEventResult| {
        let Ok(events) = res else { return };
        let paths: Vec<PathBuf> = events.into_iter().map(|e| e.path).collect();
        let change = classify(&paths, &git_dirs);
        if change != FsChange::default() {
            let _ = app.emit_to(target.as_str(), "fs-changed", change);
        }
    })
    .map_err(|e| e.to_string())?;
    debouncer
        .watcher()
        .watch(Path::new(&root), RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;
    if let Some(g) = outside {
        let _ = debouncer.watcher().watch(&g, RecursiveMode::Recursive);
    }
    map.insert(label, debouncer);
    Ok(())
}

/// 窗口关闭时停止它的监听
pub fn unwatch_window(app: &AppHandle, label: &str) {
    app.state::<Watchers>().0.lock().unwrap().remove(label);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_changes() {
        let root = PathBuf::from("repo");
        let git = root.join(".git");
        let paths = [
            root.join("src").join("a.ts"),
            root.join("src").join("b.ts"),
            git.join("objects").join("ab").join("cdef"),
            git.join("index.lock"),
        ];
        let change = classify(&paths, std::slice::from_ref(&git));
        assert_eq!(change.files.len(), 2);
        assert_eq!(change.dirs, [root.join("src").to_string_lossy().into_owned()]);
        // 只有工作区文件变化时也要刷新 Git 状态
        assert!(change.git);

        // 只有对象库和锁文件变化：什么都不用做
        let change = classify(&paths[2..], std::slice::from_ref(&git));
        assert_eq!(change, FsChange::default());

        // 暂存区、储藏变化
        let change = classify(&[git.join("index"), git.join("logs").join("refs").join("stash")], &[git]);
        assert!(change.git && change.files.is_empty());
    }
}
