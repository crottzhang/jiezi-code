mod fs;
mod terminal;
mod window;

use tauri::{Manager, WindowEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(window::PendingFolders::from_args())
        .manage(terminal::Terminals::default())
        .on_window_event(|window, event| {
            if let WindowEvent::Destroyed = event {
                terminal::kill_window_terminals(window.app_handle(), window.label());
            }
        })
        .invoke_handler(tauri::generate_handler![
            fs::read_dir,
            fs::read_file,
            fs::write_file,
            fs::create_entry,
            fs::rename_entry,
            fs::delete_entry,
            fs::list_files,
            window::new_window,
            window::take_initial_open,
            terminal::term_spawn,
            terminal::term_write,
            terminal::term_resize,
            terminal::term_kill,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
