use ssh2::{CheckResult, HashType, HostKeyType, KnownHostFileKind, Session};
use std::{
    fs::{self, OpenOptions},
    io::{self, Read, Seek, SeekFrom, Write},
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread,
    time::Duration,
};

pub struct SshTunnelHandle {
    pub local_port: u16,
    shutdown: Arc<AtomicBool>,
}

impl SshTunnelHandle {
    pub fn close(self) {
        self.shutdown.store(true, Ordering::SeqCst);
    }
}

/// Which credential the user picked in the connection dialog.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum SshAuth {
    Password,
    Key,
    /// No explicit choice — decide from whichever fields are filled in.
    Auto,
}

impl SshAuth {
    pub fn from_str_opt(s: Option<&str>) -> Self {
        match s {
            Some("password") => SshAuth::Password,
            Some("key") => SshAuth::Key,
            _ => SshAuth::Auto,
        }
    }
}

pub struct SshConfig {
    pub host: String,
    pub port: u16,
    pub user: String,
    /// SSH account password, or the passphrase of the private key when
    /// `auth` is [`SshAuth::Key`].
    pub secret: Option<String>,
    pub key_path: Option<String>,
    pub auth: SshAuth,
}

pub fn start_ssh_tunnel(
    ssh: SshConfig,
    pg_host: String,
    pg_port: u16,
) -> Result<SshTunnelHandle, String> {
    let tcp = TcpStream::connect(format!("{}:{}", ssh.host, ssh.port))
        .map_err(|e| format!("SSH: cannot reach {}:{} — {}", ssh.host, ssh.port, e))?;

    let mut sess = Session::new().map_err(|e| e.to_string())?;
    sess.set_tcp_stream(tcp);
    sess.handshake().map_err(|e| format!("SSH handshake failed: {}", e))?;

    // Verify the server before handing it any credentials.
    verify_host_key(&sess, &ssh.host, ssh.port)?;

    authenticate(&sess, &ssh)?;

    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("SSH tunnel local bind failed: {}", e))?;
    let local_port = listener.local_addr().map_err(|e| e.to_string())?.port();

    let shutdown = Arc::new(AtomicBool::new(false));
    let shutdown_c = Arc::clone(&shutdown);

    thread::spawn(move || run_tunnel(sess, listener, pg_host, pg_port, shutdown_c));

    Ok(SshTunnelHandle { local_port, shutdown })
}

// ── Host key verification ─────────────────────────────────────────────────────

/// Trust-on-first-use, the same policy as `ssh -o StrictHostKeyChecking=accept-new`:
/// an unknown host is recorded in `~/.ssh/known_hosts` and accepted, a host whose
/// key changed is refused.
fn verify_host_key(sess: &Session, host: &str, port: u16) -> Result<(), String> {
    let path = known_hosts_path()
        .ok_or_else(|| "SSH: cannot locate the home directory to read known_hosts".to_string())?;

    let mut known = sess
        .known_hosts()
        .map_err(|e| format!("SSH: cannot initialise host key checking — {}", e))?;

    // A missing known_hosts file just means every host is new.
    if path.exists() {
        known
            .read_file(&path, KnownHostFileKind::OpenSSH)
            .map_err(|e| format!("SSH: cannot read {} — {}", path.display(), e))?;
    }

    let (key, key_type) = sess
        .host_key()
        .ok_or_else(|| "SSH: server presented no host key".to_string())?;

    match known.check_port(host, port, key) {
        CheckResult::Match => Ok(()),
        CheckResult::NotFound => {
            let line = known_hosts_line(host, port, key, key_type).ok_or_else(|| {
                format!("SSH: server offered an unsupported host key type for {}", host)
            })?;
            append_known_host(&path, &line)?;
            Ok(())
        }
        CheckResult::Mismatch => Err(format!(
            "SSH: host key for {} does not match the one recorded in {}.\n\
             The server may have been rebuilt — or the connection is being intercepted.\n\
             Key offered now: {}\n\
             If you know the change is legitimate, remove the old entry with:\n\
             ssh-keygen -R '{}'",
            host,
            path.display(),
            fingerprint(sess).unwrap_or_else(|| "unavailable".to_string()),
            host_label(host, port),
        )),
        CheckResult::Failure => {
            Err(format!("SSH: host key check for {} failed unexpectedly", host))
        }
    }
}

fn known_hosts_path() -> Option<PathBuf> {
    home_dir().map(|h| h.join(".ssh").join("known_hosts"))
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .filter(|p| !p.as_os_str().is_empty())
}

/// OpenSSH names a non-default port as `[host]:port`.
fn host_label(host: &str, port: u16) -> String {
    if port == 22 {
        host.to_string()
    } else {
        format!("[{}]:{}", host, port)
    }
}

fn key_type_name(key_type: HostKeyType) -> Option<&'static str> {
    match key_type {
        HostKeyType::Rsa => Some("ssh-rsa"),
        HostKeyType::Dss => Some("ssh-dss"),
        HostKeyType::Ecdsa256 => Some("ecdsa-sha2-nistp256"),
        HostKeyType::Ecdsa384 => Some("ecdsa-sha2-nistp384"),
        HostKeyType::Ecdsa521 => Some("ecdsa-sha2-nistp521"),
        HostKeyType::Ed25519 => Some("ssh-ed25519"),
        HostKeyType::Unknown => None,
    }
}

fn known_hosts_line(host: &str, port: u16, key: &[u8], key_type: HostKeyType) -> Option<String> {
    let name = key_type_name(key_type)?;
    Some(format!(
        "{} {} {}\n",
        host_label(host, port),
        name,
        base64_encode(key)
    ))
}

/// Append a single entry instead of rewriting the file, so comments and
/// entries LuneDB does not understand survive untouched.
fn append_known_host(path: &Path, line: &str) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)
            .map_err(|e| format!("SSH: cannot create {} — {}", dir.display(), e))?;
    }

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .read(true)
        .open(path)
        .map_err(|e| format!("SSH: cannot write {} — {}", path.display(), e))?;

    if needs_leading_newline(&mut file)
        .map_err(|e| format!("SSH: cannot read {} — {}", path.display(), e))?
    {
        file.write_all(b"\n")
            .map_err(|e| format!("SSH: cannot write {} — {}", path.display(), e))?;
    }

    file.write_all(line.as_bytes())
        .map_err(|e| format!("SSH: cannot write {} — {}", path.display(), e))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = file.set_permissions(fs::Permissions::from_mode(0o600));
    }

    Ok(())
}

/// True when the file is non-empty and its last byte is not a newline.
fn needs_leading_newline(file: &mut std::fs::File) -> io::Result<bool> {
    let len = file.seek(SeekFrom::End(0))?;
    if len == 0 {
        return Ok(false);
    }
    file.seek(SeekFrom::End(-1))?;
    let mut last = [0u8; 1];
    file.read_exact(&mut last)?;
    file.seek(SeekFrom::End(0))?;
    Ok(last[0] != b'\n')
}

fn fingerprint(sess: &Session) -> Option<String> {
    let hash = sess.host_key_hash(HashType::Sha256)?;
    Some(format!(
        "SHA256:{}",
        base64_encode(hash).trim_end_matches('=')
    ))
}

const B64_ALPHABET: &[u8; 64] =
    b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

fn base64_encode(data: &[u8]) -> String {
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(B64_ALPHABET[(n >> 18 & 63) as usize] as char);
        out.push(B64_ALPHABET[(n >> 12 & 63) as usize] as char);
        out.push(if chunk.len() > 1 {
            B64_ALPHABET[(n >> 6 & 63) as usize] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            B64_ALPHABET[(n & 63) as usize] as char
        } else {
            '='
        });
    }
    out
}

// ── Authentication ────────────────────────────────────────────────────────────

fn authenticate(sess: &Session, ssh: &SshConfig) -> Result<(), String> {
    let secret = ssh.secret.as_deref().filter(|s| !s.is_empty());
    let key_path = ssh.key_path.as_deref().filter(|k| !k.is_empty());
    let mut attempts: Vec<String> = Vec::new();

    let try_key = |attempts: &mut Vec<String>| {
        if let Some(key) = key_path {
            let expanded = expand_tilde(key);
            if !expanded.exists() {
                attempts.push(format!("key file {} does not exist", expanded.display()));
                return;
            }
            if let Err(e) = sess.userauth_pubkey_file(&ssh.user, None, &expanded, secret) {
                attempts.push(format!("key auth: {}", e));
            }
        }
    };

    let try_password = |attempts: &mut Vec<String>| {
        if let Some(pass) = secret {
            if let Err(e) = sess.userauth_password(&ssh.user, pass) {
                attempts.push(format!("password auth: {}", e));
            }
        }
    };

    match ssh.auth {
        SshAuth::Key => try_key(&mut attempts),
        SshAuth::Password => try_password(&mut attempts),
        SshAuth::Auto => {
            if key_path.is_some() {
                try_key(&mut attempts);
            }
            if !sess.authenticated() {
                try_password(&mut attempts);
            }
        }
    }

    // Last resort: whatever the running ssh-agent holds.
    if !sess.authenticated() {
        if let Err(e) = sess.userauth_agent(&ssh.user) {
            attempts.push(format!("ssh-agent: {}", e));
        }
    }

    if sess.authenticated() {
        Ok(())
    } else if attempts.is_empty() {
        Err("SSH authentication failed — no password, key file or ssh-agent identity was available"
            .to_string())
    } else {
        Err(format!("SSH authentication failed — {}", attempts.join("; ")))
    }
}

/// `~/.ssh/id_ed25519` is what users type; libssh2 needs a real path.
fn expand_tilde(path: &str) -> PathBuf {
    let rest = if path == "~" {
        Some("")
    } else if let Some(r) = path.strip_prefix("~/") {
        Some(r)
    } else {
        path.strip_prefix("~\\")
    };

    match (rest, home_dir()) {
        (Some(""), Some(home)) => home,
        (Some(rest), Some(home)) => home.join(rest),
        _ => PathBuf::from(path),
    }
}

// ── Port forwarding ───────────────────────────────────────────────────────────

fn run_tunnel(
    sess: Session,
    listener: TcpListener,
    pg_host: String,
    pg_port: u16,
    shutdown: Arc<AtomicBool>,
) {
    struct Bridge {
        stream: TcpStream,
        channel: ssh2::Channel,
    }

    listener.set_nonblocking(true).ok();
    let mut bridges: Vec<Bridge> = Vec::new();
    let mut buf = [0u8; 8192];

    loop {
        if shutdown.load(Ordering::SeqCst) {
            break;
        }

        // Accept new local connections → open a new SSH channel per connection
        match listener.accept() {
            Ok((stream, _)) => {
                stream.set_nonblocking(true).ok();
                sess.set_blocking(true);
                let ch = sess.channel_direct_tcpip(&pg_host, pg_port, None);
                sess.set_blocking(false);
                match ch {
                    Ok(channel) => bridges.push(Bridge { stream, channel }),
                    Err(e) => eprintln!("[lunedb ssh] channel error: {e}"),
                }
            }
            Err(ref e) if e.kind() == io::ErrorKind::WouldBlock => {}
            Err(_) => break,
        }

        // Pump all active bridges (non-blocking bidirectional copy)
        bridges.retain_mut(|b| {
            // SSH channel → local TCP
            match b.channel.read(&mut buf) {
                Ok(0) => return false,
                Ok(n) => { b.stream.write_all(&buf[..n]).ok(); }
                Err(ref e) if e.kind() == io::ErrorKind::WouldBlock => {}
                Err(_) => return false,
            }
            // local TCP → SSH channel
            match b.stream.read(&mut buf) {
                Ok(0) => return false,
                Ok(n) => { b.channel.write_all(&buf[..n]).ok(); }
                Err(ref e) if e.kind() == io::ErrorKind::WouldBlock => {}
                Err(_) => return false,
            }
            !b.channel.eof()
        });

        thread::sleep(Duration::from_millis(if bridges.is_empty() { 10 } else { 1 }));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn host_label_omits_the_default_port() {
        assert_eq!(host_label("db.example.com", 22), "db.example.com");
        assert_eq!(host_label("db.example.com", 2222), "[db.example.com]:2222");
    }

    #[test]
    fn known_hosts_line_matches_openssh_format() {
        let line = known_hosts_line("example.com", 22, b"key-bytes", HostKeyType::Ed25519).unwrap();
        assert_eq!(line, "example.com ssh-ed25519 a2V5LWJ5dGVz\n");

        let line = known_hosts_line("example.com", 2222, b"key-bytes", HostKeyType::Rsa).unwrap();
        assert_eq!(line, "[example.com]:2222 ssh-rsa a2V5LWJ5dGVz\n");
    }

    #[test]
    fn known_hosts_line_rejects_unknown_key_types() {
        assert!(known_hosts_line("example.com", 22, b"k", HostKeyType::Unknown).is_none());
    }

    #[test]
    fn base64_encode_handles_every_padding_case() {
        // RFC 4648 test vectors.
        assert_eq!(base64_encode(b""), "");
        assert_eq!(base64_encode(b"f"), "Zg==");
        assert_eq!(base64_encode(b"fo"), "Zm8=");
        assert_eq!(base64_encode(b"foo"), "Zm9v");
        assert_eq!(base64_encode(b"foob"), "Zm9vYg==");
        assert_eq!(base64_encode(b"fooba"), "Zm9vYmE=");
        assert_eq!(base64_encode(b"foobar"), "Zm9vYmFy");
    }

    #[test]
    fn base64_encode_covers_the_full_alphabet() {
        let all: Vec<u8> = (0u8..=255).collect();
        let encoded = base64_encode(&all);
        assert_eq!(encoded.len(), 344);
        assert!(encoded.ends_with("=="));
        assert!(encoded.starts_with("AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8"));
    }

    #[test]
    fn expand_tilde_resolves_against_home() {
        let home = home_dir().expect("test environment provides a home directory");
        assert_eq!(expand_tilde("~/.ssh/id_ed25519"), home.join(".ssh/id_ed25519"));
        assert_eq!(expand_tilde("~"), home);
        assert_eq!(expand_tilde("/absolute/key"), PathBuf::from("/absolute/key"));
        // A tilde inside the path is not a home reference.
        assert_eq!(expand_tilde("keys/~/id"), PathBuf::from("keys/~/id"));
    }

    #[test]
    fn ssh_auth_parses_the_dialog_values() {
        assert_eq!(SshAuth::from_str_opt(Some("password")), SshAuth::Password);
        assert_eq!(SshAuth::from_str_opt(Some("key")), SshAuth::Key);
        assert_eq!(SshAuth::from_str_opt(Some("nonsense")), SshAuth::Auto);
        assert_eq!(SshAuth::from_str_opt(None), SshAuth::Auto);
    }

    #[test]
    fn appending_a_host_key_keeps_existing_entries() {
        let dir = std::env::temp_dir().join(format!("lunedb-kh-{}", std::process::id()));
        let path = dir.join("known_hosts");
        let _ = fs::remove_dir_all(&dir);

        // Existing file without a trailing newline must not swallow our entry.
        fs::create_dir_all(&dir).unwrap();
        fs::write(&path, "old.example.com ssh-rsa AAAA").unwrap();

        append_known_host(&path, "new.example.com ssh-ed25519 BBBB\n").unwrap();

        let contents = fs::read_to_string(&path).unwrap();
        assert_eq!(
            contents,
            "old.example.com ssh-rsa AAAA\nnew.example.com ssh-ed25519 BBBB\n"
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn appending_creates_a_missing_known_hosts_file() {
        let dir = std::env::temp_dir().join(format!("lunedb-kh-new-{}", std::process::id()));
        let path = dir.join(".ssh").join("known_hosts");
        let _ = fs::remove_dir_all(&dir);

        append_known_host(&path, "fresh.example.com ssh-ed25519 CCCC\n").unwrap();

        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            "fresh.example.com ssh-ed25519 CCCC\n"
        );

        let _ = fs::remove_dir_all(&dir);
    }
}
