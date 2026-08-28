mod db;
mod keychain;
mod ollama;
mod ssh_tunnel;
mod state;

use db::{connection::*, query::*, schema::*};
use keychain::*;
use ollama::*;
use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            connect_postgres,
            disconnect_postgres,
            get_schema,
            get_views,
            get_functions,
            get_materialized_views,
            get_sequences,
            get_object_definition,
            get_table_ddl,
            execute_query,
            stream_docs,
            keychain_set,
            keychain_get,
            keychain_delete,
            keychain_set_ssh,
            keychain_get_ssh,
            keychain_delete_ssh,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
