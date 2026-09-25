// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // 被 git 当作 askpass 程序启动时只回答问题，不启动编辑器
    if let Some(code) = jiezi_code_lib::askpass_client() {
        std::process::exit(code);
    }
    jiezi_code_lib::run()
}
