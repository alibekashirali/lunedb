use keyring::{Entry, Error as KeyringError};

fn entry(conn_id: i64) -> Result<Entry, String> {
    Entry::new("lunedb", &format!("conn-{}", conn_id)).map_err(describe)
}

fn entry_ssh(conn_id: i64) -> Result<Entry, String> {
    Entry::new("lunedb", &format!("ssh-{}", conn_id)).map_err(describe)
}

fn describe(e: KeyringError) -> String {
    format!("Keychain error: {}", e)
}

/// A missing entry is a normal state — that connection simply has no stored
/// secret yet. Every other failure is reported, so a keychain the app cannot
/// reach never looks like an empty password.
fn read(entry: Entry) -> Result<String, String> {
    match entry.get_password() {
        Ok(password) => Ok(password),
        Err(KeyringError::NoEntry) => Ok(String::new()),
        Err(e) => Err(describe(e)),
    }
}

#[tauri::command]
pub fn keychain_set(conn_id: i64, password: String) -> Result<(), String> {
    entry(conn_id)?.set_password(&password).map_err(describe)
}

#[tauri::command]
pub fn keychain_get(conn_id: i64) -> Result<String, String> {
    read(entry(conn_id)?)
}

#[tauri::command]
pub fn keychain_delete(conn_id: i64) -> Result<(), String> {
    match entry(conn_id)?.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(e) => Err(describe(e)),
    }
}

#[tauri::command]
pub fn keychain_set_ssh(conn_id: i64, password: String) -> Result<(), String> {
    entry_ssh(conn_id)?.set_password(&password).map_err(describe)
}

#[tauri::command]
pub fn keychain_get_ssh(conn_id: i64) -> Result<String, String> {
    read(entry_ssh(conn_id)?)
}

#[tauri::command]
pub fn keychain_delete_ssh(conn_id: i64) -> Result<(), String> {
    match entry_ssh(conn_id)?.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(e) => Err(describe(e)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reading_a_connection_without_a_stored_password_yields_an_empty_string() {
        // id far outside anything the app would create
        assert_eq!(keychain_get(-987_654_321).unwrap(), "");
    }

    /// Proves the build talks to the real OS keychain rather than keyring's
    /// in-memory mock: the value has to survive into a *different* process.
    ///
    /// Ignored by default because it writes to the developer's own keychain.
    /// Run the two halves in separate processes:
    ///   cargo test --lib keychain_persist_write -- --ignored
    ///   cargo test --lib keychain_persist_read  -- --ignored
    #[test]
    #[ignore]
    fn keychain_persist_write() {
        keychain_set(-424_242, "persisted-secret".into()).unwrap();
    }

    #[test]
    #[ignore]
    fn keychain_persist_read() {
        assert_eq!(keychain_get(-424_242).unwrap(), "persisted-secret");
        keychain_delete(-424_242).unwrap();
        assert_eq!(keychain_get(-424_242).unwrap(), "");
    }
}
