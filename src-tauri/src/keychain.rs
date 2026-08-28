use keyring::Entry;

fn entry(conn_id: i64) -> Result<Entry, String> {
    Entry::new("lunedb", &format!("conn-{}", conn_id)).map_err(|e| e.to_string())
}

fn entry_ssh(conn_id: i64) -> Result<Entry, String> {
    Entry::new("lunedb", &format!("ssh-{}", conn_id)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn keychain_set(conn_id: i64, password: String) -> Result<(), String> {
    entry(conn_id)?.set_password(&password).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn keychain_get(conn_id: i64) -> Result<String, String> {
    Ok(entry(conn_id)
        .ok()
        .and_then(|e| e.get_password().ok())
        .unwrap_or_default())
}

#[tauri::command]
pub fn keychain_delete(conn_id: i64) -> Result<(), String> {
    if let Ok(e) = entry(conn_id) {
        let _ = e.delete_credential();
    }
    Ok(())
}

#[tauri::command]
pub fn keychain_set_ssh(conn_id: i64, password: String) -> Result<(), String> {
    entry_ssh(conn_id)?.set_password(&password).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn keychain_get_ssh(conn_id: i64) -> Result<String, String> {
    Ok(entry_ssh(conn_id)
        .ok()
        .and_then(|e| e.get_password().ok())
        .unwrap_or_default())
}

#[tauri::command]
pub fn keychain_delete_ssh(conn_id: i64) -> Result<(), String> {
    if let Ok(e) = entry_ssh(conn_id) {
        let _ = e.delete_credential();
    }
    Ok(())
}
