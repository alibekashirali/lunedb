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
fn map_read(result: Result<String, KeyringError>) -> Result<String, String> {
    match result {
        Ok(password) => Ok(password),
        Err(KeyringError::NoEntry) => Ok(String::new()),
        Err(e) => Err(describe(e)),
    }
}

/// Deleting something that is already gone is not a failure.
fn map_delete(result: Result<(), KeyringError>) -> Result<(), String> {
    match result {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(e) => Err(describe(e)),
    }
}

fn read(entry: Entry) -> Result<String, String> {
    map_read(entry.get_password())
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
    map_delete(entry(conn_id)?.delete_credential())
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
    map_delete(entry_ssh(conn_id)?.delete_credential())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn platform_failure() -> KeyringError {
        KeyringError::PlatformFailure("secret service is not running".into())
    }

    #[test]
    fn a_missing_entry_reads_as_an_empty_string() {
        assert_eq!(map_read(Err(KeyringError::NoEntry)).unwrap(), "");
    }

    #[test]
    fn a_stored_password_is_returned_unchanged() {
        assert_eq!(map_read(Ok("hunter2".into())).unwrap(), "hunter2");
    }

    /// The point of the whole mapping: an unreachable keychain must not be
    /// mistaken for "this connection has no password", which is what produced
    /// a bogus "password authentication failed" from PostgreSQL.
    #[test]
    fn an_unreachable_keychain_is_an_error_not_an_empty_password() {
        let err = map_read(Err(platform_failure())).unwrap_err();
        assert!(err.starts_with("Keychain error:"), "{err}");
        assert!(err.contains("secret service is not running"), "{err}");
    }

    #[test]
    fn deleting_a_missing_entry_succeeds() {
        assert!(map_delete(Err(KeyringError::NoEntry)).is_ok());
        assert!(map_delete(Ok(())).is_ok());
        assert!(map_delete(Err(platform_failure())).is_err());
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
