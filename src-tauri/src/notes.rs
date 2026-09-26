//! 笔记：保存在应用数据目录下的 notes.db（SQLite），所有窗口共用

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

/// 数据库连接，第一次用到笔记时才打开
#[derive(Default)]
pub struct Notes(Mutex<Option<Connection>>);

/// 列表里显示的笔记信息，不含正文
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NoteMeta {
    id: i64,
    title: String,
    /// 标题之后第一行非空文字，列表里作为摘要
    summary: String,
    pinned: bool,
    /// Unix 秒
    updated_at: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    #[serde(flatten)]
    meta: NoteMeta,
    content: String,
}

/// 广播给所有窗口：某条笔记被新建、保存、置顶或删除
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct NotesChanged {
    id: i64,
    deleted: bool,
}

const UNTITLED: &str = "无标题笔记";
const TITLE_MAX: usize = 100;
const SUMMARY_MAX: usize = 120;

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs() as i64)
}

/// 去掉 Markdown 标题、引用、列表的前缀
fn strip_marks(line: &str) -> &str {
    line.trim()
        .trim_start_matches(['#', '>', '-', '*', '+'])
        .trim_start()
}

fn truncate(s: &str, max: usize) -> String {
    match s.char_indices().nth(max) {
        Some((i, _)) => format!("{}…", &s[..i]),
        None => s.to_string(),
    }
}

/// 第一行非空文字作为标题，下一行非空文字作为摘要
fn title_and_summary(content: &str) -> (String, String) {
    let mut lines = content.lines().map(strip_marks).filter(|l| !l.is_empty());
    let title = lines.next().map_or_else(|| UNTITLED.to_string(), |l| truncate(l, TITLE_MAX));
    let summary = lines.next().map_or_else(String::new, |l| truncate(l, SUMMARY_MAX));
    (title, summary)
}

fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if version < 1 {
        conn.execute_batch(
            "BEGIN;
             CREATE TABLE notes (
                 id         INTEGER PRIMARY KEY AUTOINCREMENT,
                 title      TEXT    NOT NULL,
                 summary    TEXT    NOT NULL DEFAULT '',
                 content    TEXT    NOT NULL,
                 pinned     INTEGER NOT NULL DEFAULT 0,
                 created_at INTEGER NOT NULL,
                 updated_at INTEGER NOT NULL
             );
             CREATE INDEX notes_order ON notes (pinned DESC, updated_at DESC);
             PRAGMA user_version = 1;
             COMMIT;",
        )?;
    }
    Ok(())
}

fn open(app: &AppHandle) -> Result<Connection, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("无法创建数据目录：{e}"))?;
    let conn = Connection::open(dir.join("notes.db")).map_err(|e| format!("无法打开笔记数据库：{e}"))?;
    conn.pragma_update(None, "journal_mode", "WAL").map_err(|e| e.to_string())?;
    migrate(&conn).map_err(|e| format!("笔记数据库升级失败：{e}"))?;
    Ok(conn)
}

/// 在后台线程里使用数据库连接，避免阻塞异步运行时
async fn with_db<T: Send + 'static>(
    app: AppHandle,
    f: impl FnOnce(&Connection) -> rusqlite::Result<T> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let notes = app.state::<Notes>();
        let mut guard = notes.0.lock().unwrap_or_else(|e| e.into_inner());
        if guard.is_none() {
            *guard = Some(open(&app)?);
        }
        f(guard.as_ref().unwrap()).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

fn notify(app: &AppHandle, id: i64, deleted: bool) {
    let _ = app.emit("notes-changed", NotesChanged { id, deleted });
}

fn not_found() -> rusqlite::Error {
    rusqlite::Error::QueryReturnedNoRows
}

const META_COLUMNS: &str = "id, title, summary, pinned, updated_at";

fn row_meta(row: &rusqlite::Row) -> rusqlite::Result<NoteMeta> {
    Ok(NoteMeta {
        id: row.get(0)?,
        title: row.get(1)?,
        summary: row.get(2)?,
        pinned: row.get(3)?,
        updated_at: row.get(4)?,
    })
}

fn get_meta(conn: &Connection, id: i64) -> rusqlite::Result<NoteMeta> {
    conn.query_row(
        &format!("SELECT {META_COLUMNS} FROM notes WHERE id = ?1"),
        [id],
        row_meta,
    )
}

/// 置顶的在前，其余按修改时间从新到旧。query 非空时只返回标题或正文包含它的笔记（不区分大小写）
fn list(conn: &Connection, query: &str) -> rusqlite::Result<Vec<NoteMeta>> {
    let pattern = format!(
        "%{}%",
        query.trim().replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_")
    );
    let mut stmt = conn.prepare(&format!(
        "SELECT {META_COLUMNS} FROM notes
         WHERE ?1 = '%%' OR title LIKE ?1 ESCAPE '\\' OR content LIKE ?1 ESCAPE '\\'
         ORDER BY pinned DESC, updated_at DESC, id DESC"
    ))?;
    let rows = stmt.query_map([pattern], row_meta)?;
    rows.collect()
}

fn get(conn: &Connection, id: i64) -> rusqlite::Result<Note> {
    let content = conn
        .query_row("SELECT content FROM notes WHERE id = ?1", [id], |r| r.get(0))
        .optional()?
        .ok_or_else(not_found)?;
    Ok(Note { meta: get_meta(conn, id)?, content })
}

fn create(conn: &Connection, content: &str) -> rusqlite::Result<NoteMeta> {
    let (title, summary) = title_and_summary(content);
    let t = now();
    conn.execute(
        "INSERT INTO notes (title, summary, content, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)",
        params![title, summary, content, t],
    )?;
    get_meta(conn, conn.last_insert_rowid())
}

fn save(conn: &Connection, id: i64, content: &str) -> rusqlite::Result<NoteMeta> {
    let (title, summary) = title_and_summary(content);
    let changed = conn.execute(
        "UPDATE notes SET title = ?2, summary = ?3, content = ?4, updated_at = ?5 WHERE id = ?1",
        params![id, title, summary, content, now()],
    )?;
    if changed == 0 {
        return Err(not_found());
    }
    get_meta(conn, id)
}

fn set_pinned(conn: &Connection, id: i64, pinned: bool) -> rusqlite::Result<()> {
    conn.execute("UPDATE notes SET pinned = ?2 WHERE id = ?1", params![id, pinned])?;
    Ok(())
}

fn delete(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM notes WHERE id = ?1", [id])?;
    Ok(())
}

/// 笔记不存在时给出好懂的错误信息
fn describe(e: String) -> String {
    if e == not_found().to_string() {
        "笔记不存在，可能已被删除".into()
    } else {
        e
    }
}

#[tauri::command]
pub async fn note_list(app: AppHandle, query: String) -> Result<Vec<NoteMeta>, String> {
    with_db(app, move |conn| list(conn, &query)).await
}

#[tauri::command]
pub async fn note_get(app: AppHandle, id: i64) -> Result<Note, String> {
    with_db(app, move |conn| get(conn, id)).await.map_err(describe)
}

#[tauri::command]
pub async fn note_create(app: AppHandle, content: String) -> Result<NoteMeta, String> {
    let meta = with_db(app.clone(), move |conn| create(conn, &content)).await?;
    notify(&app, meta.id, false);
    Ok(meta)
}

#[tauri::command]
pub async fn note_save(app: AppHandle, id: i64, content: String) -> Result<NoteMeta, String> {
    let meta = with_db(app.clone(), move |conn| save(conn, id, &content))
        .await
        .map_err(describe)?;
    notify(&app, id, false);
    Ok(meta)
}

#[tauri::command]
pub async fn note_pin(app: AppHandle, id: i64, pinned: bool) -> Result<(), String> {
    with_db(app.clone(), move |conn| set_pinned(conn, id, pinned)).await?;
    notify(&app, id, false);
    Ok(())
}

#[tauri::command]
pub async fn note_delete(app: AppHandle, id: i64) -> Result<(), String> {
    with_db(app.clone(), move |conn| delete(conn, id)).await?;
    notify(&app, id, true);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        conn
    }

    #[test]
    fn title_from_first_line() {
        assert_eq!(
            title_and_summary("\n\n# 标题  \n\n- 第一条\n正文"),
            ("标题".to_string(), "第一条".to_string())
        );
        assert_eq!(title_and_summary("  \n"), (UNTITLED.to_string(), String::new()));
        let long = "字".repeat(TITLE_MAX + 5);
        assert_eq!(title_and_summary(&long).0.chars().count(), TITLE_MAX + 1);
    }

    #[test]
    fn create_save_delete() {
        let conn = db();
        let a = create(&conn, "# 甲\n内容").unwrap();
        assert_eq!((a.title.as_str(), a.summary.as_str()), ("甲", "内容"));

        let saved = save(&conn, a.id, "乙\n新内容").unwrap();
        assert_eq!(saved.title, "乙");
        assert_eq!(get(&conn, a.id).unwrap().content, "乙\n新内容");

        delete(&conn, a.id).unwrap();
        assert!(get(&conn, a.id).is_err());
        assert!(save(&conn, a.id, "x").is_err());
    }

    #[test]
    fn list_order_and_search() {
        let conn = db();
        let a = create(&conn, "Alpha\n100% done").unwrap();
        let b = create(&conn, "beta_note").unwrap();
        let c = create(&conn, "gamma").unwrap();
        set_pinned(&conn, a.id, true).unwrap();

        let ids = |q: &str| list(&conn, q).unwrap().iter().map(|n| n.id).collect::<Vec<_>>();
        assert_eq!(ids(""), vec![a.id, c.id, b.id]);
        assert_eq!(ids("ALPHA"), vec![a.id]);
        // % 和 _ 按字面匹配
        assert_eq!(ids("0%"), vec![a.id]);
        assert_eq!(ids("a_n"), vec![b.id]);
        assert!(ids("a%n").is_empty());
    }
}
