use crate::ssh_tunnel::{start_ssh_tunnel, SshAuth, SshConfig};
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use sqlx::postgres::{PgConnectOptions, PgPoolOptions, PgSslMode};
use tauri::State;

#[derive(Deserialize)]
pub struct ConnectionConfig {
    pub host: String,
    pub port: u16,
    pub user: String,
    pub password: String,
    pub database: String,
    pub ssl_mode: Option<String>,
    pub ssl_ca_cert: Option<String>,
    // SSH tunnel
    pub ssh_enabled: Option<bool>,
    pub ssh_host: Option<String>,
    pub ssh_port: Option<u16>,
    pub ssh_user: Option<String>,
    /// SSH password, or the private key passphrase when `ssh_auth` is "key".
    pub ssh_password: Option<String>,
    pub ssh_key_path: Option<String>,
    /// "password" | "key"; absent means "use whatever is filled in".
    pub ssh_auth: Option<String>,
}

#[derive(Serialize)]
pub struct ConnectionResult {
    pub success: bool,
    pub message: String,
}

#[tauri::command]
pub async fn connect_postgres(
    config: ConnectionConfig,
    state: State<'_, AppState>,
) -> Result<ConnectionResult, String> {
    // Close any existing SSH tunnel before opening a new one
    {
        let mut guard = state.ssh_tunnel.lock().map_err(|e| e.to_string())?;
        if let Some(old) = guard.take() {
            old.close();
        }
    }

    let (connect_host, connect_port) = if config.ssh_enabled.unwrap_or(false) {
        let ssh_cfg = SshConfig {
            host: config.ssh_host.clone().unwrap_or_default(),
            port: config.ssh_port.unwrap_or(22),
            user: config.ssh_user.clone().unwrap_or_default(),
            secret: config.ssh_password.clone().filter(|p| !p.is_empty()),
            key_path: config.ssh_key_path.clone().filter(|k| !k.is_empty()),
            auth: SshAuth::from_str_opt(config.ssh_auth.as_deref()),
        };

        if ssh_cfg.host.is_empty() || ssh_cfg.user.is_empty() {
            return Ok(ConnectionResult {
                success: false,
                message: "SSH tunnel: host and user are required".to_string(),
            });
        }

        let pg_host = config.host.clone();
        let pg_port = config.port;

        // start_ssh_tunnel is blocking — run it off the async executor
        match tokio::task::spawn_blocking(move || start_ssh_tunnel(ssh_cfg, pg_host, pg_port))
            .await
        {
            Ok(Ok(handle)) => {
                let port = handle.local_port;
                let mut guard = state.ssh_tunnel.lock().map_err(|e| e.to_string())?;
                *guard = Some(handle);
                ("127.0.0.1".to_string(), port)
            }
            Ok(Err(e)) => return Ok(ConnectionResult { success: false, message: e }),
            Err(e) => {
                return Ok(ConnectionResult {
                    success: false,
                    message: format!("SSH task error: {}", e),
                })
            }
        }
    } else {
        (config.host.clone(), config.port)
    };

    let ssl_mode = match config.ssl_mode.as_deref().unwrap_or("prefer") {
        "disable"     => PgSslMode::Disable,
        "require"     => PgSslMode::Require,
        "verify-ca"   => PgSslMode::VerifyCa,
        "verify-full" => PgSslMode::VerifyFull,
        _             => PgSslMode::Prefer,
    };

    let mut opts = PgConnectOptions::new()
        .host(&connect_host)
        .port(connect_port)
        .username(&config.user)
        .password(&config.password)
        .database(&config.database)
        .ssl_mode(ssl_mode);

    if let Some(cert) = &config.ssl_ca_cert {
        if !cert.is_empty() {
            opts = opts.ssl_root_cert(cert.as_str());
        }
    }

    match PgPoolOptions::new()
        .max_connections(5)
        .connect_with(opts)
        .await
    {
        Ok(pool) => {
            let mut guard = state.pg_pool.lock().map_err(|e| e.to_string())?;
            *guard = Some(pool);
            Ok(ConnectionResult {
                success: true,
                message: format!("Connected to {}", config.database),
            })
        }
        Err(e) => Ok(ConnectionResult {
            success: false,
            message: format!("Connection failed: {}", e),
        }),
    }
}

#[tauri::command]
pub async fn disconnect_postgres(state: State<'_, AppState>) -> Result<(), String> {
    let pool = {
        let mut guard = state.pg_pool.lock().map_err(|e| e.to_string())?;
        guard.take()
    };
    if let Some(pool) = pool {
        pool.close().await;
    }

    let tunnel = {
        let mut guard = state.ssh_tunnel.lock().map_err(|e| e.to_string())?;
        guard.take()
    };
    if let Some(tunnel) = tunnel {
        tunnel.close();
    }

    Ok(())
}
