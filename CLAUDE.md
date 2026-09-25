# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Jiezi Code is a lightweight code editor built with Tauri 2 (Rust backend) + Vue 3 + CodeMirror 6, primarily targeting Windows (WebView2, ConPTY/PowerShell terminal). README.md (in Chinese) documents features and the file-by-file layout.

## Commands

```bash
npm install
npm run tauri dev       # run the app (starts Vite on fixed port 1420, then the Rust app)
npm run tauri build     # release bundle
npm run build           # frontend only: vue-tsc --noEmit type check + vite build
npx vue-tsc --noEmit    # type check only (there is no ESLint/Prettier setup)

# Rust (run inside src-tauri/)
cargo test                                  # all tests
cargo test parses_porcelain_v2              # single test by name
cargo test git::tests::stash_round_trip     # single test by path
cargo clippy
```

There are no frontend tests. Rust tests live in `src-tauri/src/git/tests.rs` plus `#[cfg(test)]` modules in `search.rs`, `watch.rs`, and `askpass.rs`. The git tests create real temporary repos (`TempRepo` in `tests.rs`) and shell out to the system `git`, so git must be on PATH.

## Architecture

### Frontend ↔ backend boundary
- Every Rust command is registered in the `generate_handler!` list in `src-tauri/src/lib.rs`. Adding a command means: write the `#[tauri::command]` fn, register it there, and add a typed wrapper in `src/api/*.ts` (camelCase args are converted to snake_case by Tauri). Components and stores call `src/api/*`, never `invoke` directly.
- Streaming data uses `tauri::ipc::Channel` passed as a command argument (terminal output as raw bytes, git remote/clone progress). Broadcast notifications use events: `fs-changed` (watcher → `store/git.ts`, `store/search.ts`), `git-output` (every git command → `store/output.ts`), `git-askpass` (credential prompt → `store/git.ts`).
- Multi-window: all windows run in one process. Per-window resources (terminals, file watchers) are keyed by window label and cleaned up in `on_window_event(Destroyed)`; events targeting one window use `emit_to(label, …)`. New windows are labelled `win-*` and must match `capabilities/default.json`.

### Git integration (`src-tauri/src/git/`)
- Everything shells out to the system `git` CLI (so user config, hooks, and credentials apply) — no libgit2. Always build commands via `git::git(cwd)`, which adds `--literal-pathspecs`, `core.quotepath=false`, disables terminal prompts/editors, and hides the console window on Windows. Use `git_without_literal` only for `stash` (literal pathspecs break `stash push --include-untracked`).
- Run through `git::run` / `run_text` (logs to the "Git 输出" panel; read-only commands in `QUIET` are only logged on failure), wrap blocking work in `git::blocking`, pass path lists with `with_paths` (NUL-separated via stdin), and validate branch/rev positional args with `check_arg`.
- Credential prompts: `askpass.rs` makes the editor's own executable act as `GIT_ASKPASS`/`SSH_ASKPASS`. `main.rs` checks for this mode before starting the GUI; the child process relays the prompt over a local TCP connection to the running editor, which shows an input dialog.

### Frontend state (`src/store/`)
- State is plain module-level `reactive()` objects plus exported functions — no Pinia/Vuex. Stores import each other directly.
- Memory-saving design that must be preserved: there is exactly **one** `EditorView` per window (`src/editor/view.ts`). Each tab keeps an immutable `EditorState` (including undo history) in a non-reactive `Map` in `store/workspace.ts`; switching tabs swaps the state. Don't put `EditorState` into reactive objects.
- Heavy things load lazily: language packs via `@codemirror/language-data`, the terminal panel/xterm.js as an async component, `@codemirror/merge` on first diff. The file tree reads one directory level at a time on expand.
- Refresh signalling uses version counters on `workspace` (`dirVersions`, `fsVersion`, `treeVersion`) that views watch.
- Read-only "virtual" tabs (historical file versions, Git output log) have `readonly: true` and a non-disk `path`.
- Persisted UI prefs use `localStorage` under `jiezi.*` keys with try/catch (`store/layout.ts`, `theme/index.ts`).

### Commands, menus, keybindings
- `src/commands.ts` is the single command table shared by the hamburger menu (`src/menu.ts`) and the command palette (`QuickOpen.vue`). The `keys` field is display-only; actual key handling is in `App.vue` (`onKeyDown`, capture phase) and CodeMirror keymaps.

### Theming
- `src/theme/themes.ts` defines each theme as a set of CSS variables plus a terminal palette. UI and CodeMirror highlighting (`src/editor/theme.ts`) reference only CSS variables; switching themes just rewrites variables on `:root` without rebuilding editor state. Add a theme by appending to the `themes` array.

## Conventions
- Code comments, doc comments, user-facing strings, error messages, and commit messages are in Chinese; match that.
- The window is frameless (`decorations: false`); the title bar/window controls are in `TitleBar.vue`, and any new window API used must be allowed in `capabilities/default.json`.
