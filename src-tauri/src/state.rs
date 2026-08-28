use crate::ssh_tunnel::SshTunnelHandle;
use sqlx::PgPool;
use std::sync::Mutex;

pub struct AppState {
    pub pg_pool: Mutex<Option<PgPool>>,
    pub ssh_tunnel: Mutex<Option<SshTunnelHandle>>,
}

impl AppState {
    pub fn new() -> Self {
        AppState {
            pg_pool: Mutex::new(None),
            ssh_tunnel: Mutex::new(None),
        }
    }
}
