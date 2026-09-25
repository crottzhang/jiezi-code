//! 在文件夹中搜索文本（Ctrl+Shift+F）以及批量替换。

use globset::{GlobBuilder, GlobSet, GlobSetBuilder};
use ignore::{WalkBuilder, WalkState};
use regex::{Captures, Regex, RegexBuilder};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::ops::Range;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{State, WebviewWindow};

/// 匹配总数超过这么多时停止搜索
const MAX_MATCHES: usize = 20_000;
/// 超过这个大小的文件不搜索
const MAX_FILE_SIZE: u64 = 10 * 1024 * 1024;
/// 预览里匹配前面最多保留的字符数
const PREVIEW_BEFORE: usize = 30;
/// 预览里匹配文本和后文各自最多保留的字符数
const PREVIEW_MAX: usize = 250;

/// 每个窗口正在进行的搜索，新搜索开始时取消旧的
#[derive(Default)]
pub struct Searches(Mutex<HashMap<String, Arc<AtomicBool>>>);

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SearchQuery {
    pattern: String,
    is_regex: bool,
    case_sensitive: bool,
    whole_word: bool,
}

impl SearchQuery {
    fn build(&self) -> Result<Regex, String> {
        let mut pattern = if self.is_regex {
            self.pattern.clone()
        } else {
            regex::escape(&self.pattern)
        };
        if self.whole_word {
            pattern = format!(r"\b(?:{pattern})\b");
        }
        RegexBuilder::new(&pattern)
            .case_insensitive(!self.case_sensitive)
            .multi_line(true)
            .crlf(true)
            .build()
            .map_err(|e| format!("正则表达式有误：{e}"))
    }
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Match {
    /// 从 1 开始的行号
    line: usize,
    /// 行内的 UTF-16 偏移（与 JS 字符串、CodeMirror 一致）
    col: usize,
    end_line: usize,
    end_col: usize,
    /// 预览：匹配前面的文本、匹配本身（只取第一行）、后面的文本
    before: String,
    text: String,
    after: String,
    /// 给出替换文本时，这处匹配替换后的结果
    replacement: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileResult {
    path: String,
    rel: String,
    matches: Vec<Match>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    files: Vec<FileResult>,
    /// 匹配太多，结果不完整
    limit_hit: bool,
    /// 被更新的搜索取消了
    cancelled: bool,
}

/// 一次替换：UTF-16 偏移
#[derive(Serialize, Debug, PartialEq)]
pub struct Change {
    from: usize,
    to: usize,
    insert: String,
}

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// 解析逗号分隔的通配符（类似 VS Code 的“包含/排除的文件”）。
/// 不带 `/` 的匹配任意层级（`*.ts`、`node_modules`），带 `/` 的相对于文件夹根目录（`src/**/*.vue`）；
/// 匹配到目录时目录下所有文件都算匹配。
fn build_globs(patterns: &str) -> Result<Option<GlobSet>, String> {
    let mut builder = GlobSetBuilder::new();
    let mut any = false;
    for raw in patterns.split(',') {
        let p = raw.trim().replace('\\', "/");
        let p = p.trim_start_matches("./").trim_matches('/');
        if p.is_empty() {
            continue;
        }
        let base = if p.contains('/') { p.to_string() } else { format!("**/{p}") };
        for glob in [base.clone(), format!("{base}/**")] {
            let glob = GlobBuilder::new(&glob)
                .literal_separator(true)
                .case_insensitive(cfg!(windows))
                .build()
                .map_err(|e| format!("无效的通配符“{p}”：{e}"))?;
            builder.add(glob);
        }
        any = true;
    }
    if !any {
        return Ok(None);
    }
    builder.build().map(Some).map_err(err)
}

fn slash_path(rel: &Path) -> String {
    rel.to_string_lossy().replace('\\', "/")
}

/// 读取文本文件：跳过过大、二进制和非 UTF-8 的文件，去掉 BOM
fn read_text(path: &Path) -> Option<(bool, String)> {
    if fs::metadata(path).ok()?.len() > MAX_FILE_SIZE {
        return None;
    }
    let bytes = fs::read(path).ok()?;
    if bytes[..bytes.len().min(8000)].contains(&0) {
        return None;
    }
    let (bom, body) = match bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]) {
        Some(rest) => (true, rest.to_vec()),
        None => (false, bytes),
    };
    String::from_utf8(body).ok().map(|s| (bom, s))
}

/// 所有非空匹配及其替换结果。非正则模式下替换文本按字面插入，不展开 `$1`
fn find_all(
    re: &Regex,
    text: &str,
    replace: Option<&str>,
    literal: bool,
) -> Vec<(Range<usize>, Option<String>)> {
    re.captures_iter(text)
        .filter_map(|caps: Captures| {
            let m = caps.get(0)?;
            if m.is_empty() {
                return None;
            }
            let replacement = replace.map(|r| {
                if literal {
                    r.to_string()
                } else {
                    let mut dst = String::new();
                    caps.expand(r, &mut dst);
                    dst
                }
            });
            Some((m.range(), replacement))
        })
        .collect()
}

fn head(s: &str, n: usize) -> &str {
    match s.char_indices().nth(n) {
        Some((i, _)) => &s[..i],
        None => s,
    }
}

fn utf16_len(s: &str) -> usize {
    s.encode_utf16().count()
}

/// 把匹配的字节范围转成行号、列号和预览
fn to_matches(text: &str, found: Vec<(Range<usize>, Option<String>)>) -> Vec<Match> {
    let mut line = 1;
    let mut scanned = 0;
    let mut line_start = 0;
    found
        .into_iter()
        .map(|(range, replacement)| {
            // 逐段累计行号，整个文件只扫描一遍
            for (i, b) in text[scanned..range.start].bytes().enumerate() {
                if b == b'\n' {
                    line += 1;
                    line_start = scanned + i + 1;
                }
            }
            scanned = range.start;

            let matched = &text[range.clone()];
            let newlines = matched.bytes().filter(|&b| b == b'\n').count();
            let end_line_start = match matched.rfind('\n') {
                Some(i) => range.start + i + 1,
                None => line_start,
            };
            let line_end = text[range.start..]
                .find('\n')
                .map_or(text.len(), |i| range.start + i);
            // 预览不带行尾的 \r（匹配本身从 \r 开始时除外）
            let line_end = if line_end > range.start && text[..line_end].ends_with('\r') {
                line_end - 1
            } else {
                line_end
            };
            let match_end = range.end.min(line_end).max(range.start);

            let before = text[line_start..range.start].trim_start();
            let count = before.chars().count();
            let before = if count > PREVIEW_BEFORE {
                let skip = before.char_indices().nth(count - PREVIEW_BEFORE).unwrap().0;
                format!("…{}", &before[skip..])
            } else {
                before.to_string()
            };

            Match {
                line,
                col: utf16_len(&text[line_start..range.start]),
                end_line: line + newlines,
                end_col: utf16_len(&text[end_line_start..range.end]),
                before,
                text: head(&text[range.start..match_end], PREVIEW_MAX).to_string(),
                after: head(&text[match_end..line_end], PREVIEW_MAX).to_string(),
                replacement,
            }
        })
        .collect()
}

#[tauri::command]
pub async fn search_text(
    window: WebviewWindow,
    searches: State<'_, Searches>,
    root: String,
    query: SearchQuery,
    include: String,
    exclude: String,
    replace: Option<String>,
) -> Result<SearchResult, String> {
    let re = query.build()?;
    let include = build_globs(&include)?;
    let exclude = build_globs(&exclude)?.map(Arc::new);

    let cancel = Arc::new(AtomicBool::new(false));
    let label = window.label().to_string();
    if let Some(old) = searches.0.lock().unwrap().insert(label.clone(), cancel.clone()) {
        old.store(true, Ordering::Relaxed);
    }

    let flag = cancel.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        run_search(PathBuf::from(root), re, &query, include, exclude, replace, &flag)
    })
    .await
    .map_err(err);

    let mut map = searches.0.lock().unwrap();
    if map.get(&label).is_some_and(|c| Arc::ptr_eq(c, &cancel)) {
        map.remove(&label);
    }
    result
}

fn run_search(
    base: PathBuf,
    re: Regex,
    query: &SearchQuery,
    include: Option<GlobSet>,
    exclude: Option<Arc<GlobSet>>,
    replace: Option<String>,
    cancel: &AtomicBool,
) -> SearchResult {
    let filter_base = base.clone();
    let walker = WalkBuilder::new(&base)
        .hidden(false)
        .filter_entry(move |e| {
            if e.file_name() == ".git" || e.file_name() == "node_modules" {
                return false;
            }
            match (&exclude, e.path().strip_prefix(&filter_base)) {
                (Some(ex), Ok(rel)) if !rel.as_os_str().is_empty() => !ex.is_match(slash_path(rel)),
                _ => true,
            }
        })
        .build_parallel();

    let files = Mutex::new(Vec::new());
    let total = AtomicUsize::new(0);
    let limit_hit = AtomicBool::new(false);
    let literal = !query.is_regex;

    walker.run(|| {
        Box::new(|entry| {
            if cancel.load(Ordering::Relaxed) || limit_hit.load(Ordering::Relaxed) {
                return WalkState::Quit;
            }
            let Ok(entry) = entry else { return WalkState::Continue };
            if !entry.file_type().is_some_and(|t| t.is_file()) {
                return WalkState::Continue;
            }
            let path = entry.path();
            let Ok(rel) = path.strip_prefix(&base) else { return WalkState::Continue };
            if include.as_ref().is_some_and(|inc| !inc.is_match(slash_path(rel))) {
                return WalkState::Continue;
            }
            let Some((_, text)) = read_text(path) else { return WalkState::Continue };
            let found = find_all(&re, &text, replace.as_deref(), literal);
            if found.is_empty() {
                return WalkState::Continue;
            }
            if total.fetch_add(found.len(), Ordering::Relaxed) + found.len() >= MAX_MATCHES {
                limit_hit.store(true, Ordering::Relaxed);
            }
            files.lock().unwrap().push(FileResult {
                path: path.to_string_lossy().into_owned(),
                rel: rel.to_string_lossy().into_owned(),
                matches: to_matches(&text, found),
            });
            WalkState::Continue
        })
    });

    let mut files = files.into_inner().unwrap();
    files.sort_by_cached_key(|f| f.rel.to_lowercase());
    SearchResult {
        files,
        limit_hit: limit_hit.into_inner(),
        cancelled: cancel.load(Ordering::Relaxed),
    }
}

/// 在磁盘上的文件里替换所有匹配，返回替换的数量。
/// 保留文件原有的 BOM 和换行符
#[tauri::command]
pub async fn replace_in_files(
    paths: Vec<String>,
    query: SearchQuery,
    replace: String,
) -> Result<usize, String> {
    let re = query.build()?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut count = 0;
        let mut failed = Vec::new();
        for path in paths {
            let path = Path::new(&path);
            let Some((bom, text)) = read_text(path) else { continue };
            let found = find_all(&re, &text, Some(&replace), !query.is_regex);
            if found.is_empty() {
                continue;
            }
            let mut out = String::with_capacity(text.len());
            if bom {
                out.push('\u{FEFF}');
            }
            let mut last = 0;
            for (range, replacement) in &found {
                out.push_str(&text[last..range.start]);
                out.push_str(replacement.as_deref().unwrap_or_default());
                last = range.end;
            }
            out.push_str(&text[last..]);
            match crate::fs::write_atomic(path, out.as_bytes()) {
                Ok(()) => count += found.len(),
                Err(e) => failed.push(format!("{}：{e}", path.display())),
            }
        }
        if failed.is_empty() {
            Ok(count)
        } else {
            Err(format!("有 {} 个文件替换失败\n{}", failed.len(), failed.join("\n")))
        }
    })
    .await
    .map_err(err)?
}

/// 计算一段文本（已打开的文件的编辑器内容）里的所有替换，偏移为 UTF-16
#[tauri::command]
pub fn replace_changes(text: String, query: SearchQuery, replace: String) -> Result<Vec<Change>, String> {
    let re = query.build()?;
    let mut changes = Vec::new();
    let mut last = 0;
    let mut offset = 0;
    for (range, replacement) in find_all(&re, &text, Some(&replace), !query.is_regex) {
        offset += utf16_len(&text[last..range.start]);
        let from = offset;
        offset += utf16_len(&text[range.clone()]);
        last = range.end;
        changes.push(Change { from, to: offset, insert: replacement.unwrap_or_default() });
    }
    Ok(changes)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn query(pattern: &str, is_regex: bool) -> SearchQuery {
        SearchQuery { pattern: pattern.into(), is_regex, case_sensitive: false, whole_word: false }
    }

    fn search(q: &SearchQuery, text: &str) -> Vec<Match> {
        to_matches(text, find_all(&q.build().unwrap(), text, None, !q.is_regex))
    }

    #[test]
    fn positions_are_utf16_and_one_based() {
        let m = search(&query("foo", false), "a\r\n  中😀 foo bar\nfoo");
        assert_eq!(m.len(), 2);
        assert_eq!((m[0].line, m[0].col, m[0].end_line, m[0].end_col), (2, 6, 2, 9));
        assert_eq!((m[0].before.as_str(), m[0].text.as_str(), m[0].after.as_str()), ("中😀 ", "foo", " bar"));
        assert_eq!((m[1].line, m[1].col), (3, 0));
    }

    #[test]
    fn literal_mode_escapes_and_whole_word() {
        assert_eq!(search(&query("a.b", false), "axb a.b").len(), 1);
        let mut q = query("cat", false);
        q.whole_word = true;
        assert_eq!(search(&q, "cat concat cat_ cat.").len(), 2);
    }

    #[test]
    fn multiline_regex_and_crlf_dollar() {
        let m = search(&query(r"b\r?\nc", true), "ab\r\ncd");
        assert_eq!((m[0].line, m[0].col, m[0].end_line, m[0].end_col), (1, 1, 2, 1));
        assert_eq!(m[0].text, "b");
        // CRLF 文件里 $ 也能在行尾匹配
        assert_eq!(search(&query(r"x$", true), "x\r\nx").len(), 2);
    }

    #[test]
    fn empty_matches_are_skipped() {
        assert_eq!(search(&query("a*", true), "bab").len(), 1);
    }

    #[test]
    fn long_lines_are_trimmed_in_preview() {
        let line = format!("{}needle{}", "x".repeat(100), "y".repeat(400));
        let m = search(&query("needle", false), &line);
        assert!(m[0].before.starts_with('…'));
        assert_eq!(m[0].before.chars().count(), PREVIEW_BEFORE + 1);
        assert_eq!(m[0].after.chars().count(), PREVIEW_MAX);
    }

    #[test]
    fn replace_expands_groups_only_in_regex_mode() {
        let re = query(r"(\w+)@", true).build().unwrap();
        let found = find_all(&re, "ab@ cd@", Some("[$1]"), false);
        assert_eq!(found[1].1.as_deref(), Some("[cd]"));
        let re = query("ab", false).build().unwrap();
        assert_eq!(find_all(&re, "ab", Some("$1"), true)[0].1.as_deref(), Some("$1"));
    }

    #[test]
    fn replace_changes_use_utf16_offsets() {
        let changes = replace_changes("😀a😀a".into(), query("a", false), "bb".into()).unwrap();
        assert_eq!(
            changes,
            vec![
                Change { from: 2, to: 3, insert: "bb".into() },
                Change { from: 5, to: 6, insert: "bb".into() },
            ]
        );
    }

    #[test]
    fn walks_folder_with_gitignore_and_globs() {
        let dir = std::env::temp_dir().join(format!("jiezi-search-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        for (rel, content) in [
            (".gitignore", "ignored/\n"),
            ("src/a.ts", "needle\nneedle"),
            ("src/b.rs", "needle"),
            ("dist/c.ts", "needle"),
            ("ignored/d.ts", "needle"),
            ("bin.dat", "needle\0"),
        ] {
            let path = dir.join(rel);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, content).unwrap();
        }
        // walker 只在 git 仓库里读取 .gitignore
        fs::create_dir_all(dir.join(".git")).unwrap();

        let q = query("NEEDLE", false);
        let run = |include: &str, exclude: &str| {
            let r = run_search(
                dir.clone(),
                q.build().unwrap(),
                &q,
                build_globs(include).unwrap(),
                build_globs(exclude).unwrap().map(Arc::new),
                None,
                &AtomicBool::new(false),
            );
            r.files.iter().map(|f| (slash_path(Path::new(&f.rel)), f.matches.len())).collect::<Vec<_>>()
        };
        assert_eq!(
            run("", ""),
            vec![("dist/c.ts".into(), 1), ("src/a.ts".into(), 2), ("src/b.rs".into(), 1)]
        );
        assert_eq!(run("*.ts", "dist"), vec![("src/a.ts".into(), 2)]);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn globs_match_like_vscode() {
        let set = build_globs(" *.ts , src/lib ,, docs/ ").unwrap().unwrap();
        assert!(set.is_match("a/b/c.ts"));
        assert!(set.is_match("src/lib/x.rs"));
        assert!(!set.is_match("other/src/lib/x.rs"));
        assert!(set.is_match("docs/readme.md"));
        assert!(!set.is_match("a/b.tsx"));
        assert!(build_globs(" , ").unwrap().is_none());
    }
}
