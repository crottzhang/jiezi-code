mod askpass;
mod clipboard;
mod fs;
mod git;
mod search;
mod terminal;
mod watch;
mod window;

use tauri::{Manager, WindowEvent};

/// git/ssh 把本程序当作 askpass 启动时，只回答问题然后退出，不打开窗口
pub fn askpass_client() -> Option<i32> {
    askpass::client_main()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(window::PendingFolders::from_args())
        .manage(terminal::Terminals::default())
        .manage(watch::Watchers::default())
        .manage(search::Searches::default())
        .setup(|app| {
            git::init(app.handle());
            askpass::start(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::Destroyed = event {
                terminal::kill_window_terminals(window.app_handle(), window.label());
                watch::unwatch_window(window.app_handle(), window.label());
            }
        })
        .invoke_handler(tauri::generate_handler![
            fs::read_dir,
            fs::read_file,
            fs::read_file_bytes,
            fs::open_external,
            fs::write_file,
            fs::create_entry,
            fs::rename_entry,
            fs::delete_entry,
            fs::list_files,
            watch::fs_watch,
            search::search_text,
            search::replace_in_files,
            search::replace_changes,
            git::status::git_status,
            git::status::git_init,
            git::status::git_stage,
            git::status::git_unstage,
            git::status::git_stage_content,
            git::status::git_discard,
            git::status::git_commit,
            git::status::git_last_message,
            git::status::git_undo_commit,
            git::status::git_show,
            git::status::git_ignore,
            git::status::git_check_ignore,
            git::history::git_log,
            git::history::git_commit_files,
            git::history::git_blame,
            git::history::git_revert,
            git::history::git_cherry_pick,
            git::history::git_tag,
            git::branch::git_branches,
            git::branch::git_checkout,
            git::branch::git_branch_delete,
            git::branch::git_branch_rename,
            git::branch::git_merge,
            git::branch::git_op_continue,
            git::branch::git_op_abort,
            git::stash::git_stash_list,
            git::stash::git_stash_push,
            git::stash::git_stash_apply,
            git::stash::git_stash_drop,
            git::remote::git_remote,
            git::remote::git_clone,
            git::remote::git_cancel,
            askpass::git_askpass_reply,
            window::new_window,
            window::take_initial_open,
            terminal::term_spawn,
            clipboard::save_clipboard_image,
            clipboard::list_clipboard_images,
            clipboard::read_clipboard_image,
            clipboard::delete_clipboard_images,
            clipboard::reveal_clipboard_image,
            terminal::term_write,
            terminal::term_resize,
            terminal::term_kill,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
