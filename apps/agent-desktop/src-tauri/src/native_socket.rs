//! HTTP over a private Unix socket. Authenticate the kernel peer before sending
//! any HTTP bytes, including the process grant. No TCP/proxy/TLS fallback.
use std::fs;
use std::io::{self, Read, Write};
use std::os::fd::{AsRawFd, FromRawFd};
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::{FileTypeExt, MetadataExt};
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::{Duration, Instant};
use ureq::unversioned::transport::{
    Buffers, ConnectionDetails, Connector, LazyBuffers, NextTimeout, Transport,
};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(1);
const DIRECTORY_PREFIX: &str = "moltnet-agent-";
pub const SOCKET_NAME: &str = "control.sock";

#[derive(Clone, Debug)]
pub struct SocketConnector {
    pub directory: Arc<tempfile::TempDir>,
    pub pid: u32,
    pub alive: Arc<AtomicBool>,
}

impl SocketConnector {
    pub fn path(&self) -> PathBuf {
        self.directory.path().join(SOCKET_NAME)
    }

    fn open(&self) -> io::Result<UnixStream> {
        if !self.alive.load(Ordering::Acquire) {
            return Err(io::Error::new(
                io::ErrorKind::NotConnected,
                "Managed Agent Server is no longer running",
            ));
        }
        let directory = fs::symlink_metadata(self.directory.path())?;
        let socket = fs::symlink_metadata(self.path())?;
        // SAFETY: geteuid takes no arguments and returns the current identity.
        let uid = unsafe { libc::geteuid() };
        if !directory.is_dir()
            || directory.uid() != uid
            || directory.mode() & 0o777 != 0o700
            || !socket.file_type().is_socket()
            || socket.uid() != uid
        {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "Invalid native socket ownership or permissions",
            ));
        }
        let stream = connect_bounded(&self.path())?;
        let (peer_uid, peer_pid) = peer_identity(&stream)?;
        if peer_uid != uid || peer_pid != self.pid {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                format!(
                    "Native socket peer uid/pid {peer_uid}/{peer_pid} did not match expected {uid}/{}",
                    self.pid
                ),
            ));
        }
        if !self.alive.load(Ordering::Acquire) {
            return Err(io::Error::new(
                io::ErrorKind::NotConnected,
                "Managed Agent Server stopped during connection",
            ));
        }
        Ok(stream)
    }
}

/// Create a short private endpoint and remove endpoints left by dead Desktop
/// processes. A live PID, a symlink, another owner or broader permissions is
/// always left untouched.
pub fn private_directory() -> Result<tempfile::TempDir, String> {
    let root = fs::canonicalize("/tmp").map_err(|error| error.to_string())?;
    sweep_stale_directories(&root);
    let directory = tempfile::Builder::new()
        .prefix(&format!("{DIRECTORY_PREFIX}{}-", std::process::id()))
        .tempdir_in(root)
        .map_err(|error| error.to_string())?;
    fs::set_permissions(
        directory.path(),
        <fs::Permissions as std::os::unix::fs::PermissionsExt>::from_mode(0o700),
    )
    .map_err(|error| error.to_string())?;
    Ok(directory)
}

fn sweep_stale_directories(root: &std::path::Path) {
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    // SAFETY: geteuid takes no arguments and returns the current identity.
    let uid = unsafe { libc::geteuid() };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(pid) = name
            .to_str()
            .and_then(|value| value.strip_prefix(DIRECTORY_PREFIX))
            .and_then(|value| value.split_once('-'))
            .and_then(|(pid, _)| pid.parse::<u32>().ok())
            .filter(|pid| *pid > 0 && *pid <= libc::pid_t::MAX as u32)
        else {
            continue;
        };
        if pid == std::process::id() || process_is_alive(pid) {
            continue;
        }
        let path = entry.path();
        let Ok(metadata) = fs::symlink_metadata(&path) else {
            continue;
        };
        if metadata.is_dir()
            && !metadata.file_type().is_symlink()
            && metadata.uid() == uid
            && metadata.mode() & 0o777 == 0o700
        {
            let _ = fs::remove_dir_all(path);
        }
    }
}

fn process_is_alive(pid: u32) -> bool {
    // SAFETY: signal 0 performs an existence/permission check only.
    let result = unsafe { libc::kill(pid as libc::pid_t, 0) };
    result == 0 || io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}

// Nonblocking connect bounds startup even if another listener fills its backlog.
fn connect_bounded(path: &std::path::Path) -> io::Result<UnixStream> {
    // SAFETY: sockaddr_un is zero initialized and filled within sun_path bounds.
    // UnixStream takes ownership immediately, closing the fd on every error.
    unsafe {
        let mut address: libc::sockaddr_un = std::mem::zeroed();
        let bytes = path.as_os_str().as_bytes();
        if bytes.len() >= address.sun_path.len() || bytes.contains(&0) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Invalid native socket path",
            ));
        }
        address.sun_family = libc::AF_UNIX as libc::sa_family_t;
        for (target, source) in address.sun_path.iter_mut().zip(bytes) {
            *target = *source as libc::c_char;
        }
        let length = std::mem::size_of_val(&address) as libc::socklen_t;
        #[cfg(target_os = "macos")]
        {
            address.sun_len = length as u8;
        }
        #[cfg(target_os = "linux")]
        let socket_type = libc::SOCK_STREAM | libc::SOCK_CLOEXEC;
        #[cfg(not(target_os = "linux"))]
        let socket_type = libc::SOCK_STREAM;
        let fd = libc::socket(libc::AF_UNIX, socket_type, 0);
        if fd < 0 {
            return Err(io::Error::last_os_error());
        }
        let stream = UnixStream::from_raw_fd(fd);
        #[cfg(not(target_os = "linux"))]
        {
            if libc::fcntl(fd, libc::F_SETFD, libc::FD_CLOEXEC) < 0 {
                return Err(io::Error::last_os_error());
            }
        }
        stream.set_nonblocking(true)?;
        if libc::connect(fd, &address as *const _ as *const libc::sockaddr, length) != 0 {
            let error = io::Error::last_os_error();
            if error.raw_os_error() == Some(libc::EAGAIN) {
                return Err(io::Error::from(io::ErrorKind::WouldBlock));
            }
            if error.raw_os_error() != Some(libc::EINPROGRESS) {
                return Err(error);
            }
            let mut event = libc::pollfd {
                fd,
                events: libc::POLLOUT,
                revents: 0,
            };
            wait_for_connect(CONNECT_TIMEOUT, |remaining_ms| {
                let result = libc::poll(&mut event, 1, remaining_ms);
                if result < 0 {
                    Err(io::Error::last_os_error())
                } else {
                    Ok(result)
                }
            })?;
            if let Some(error) = stream.take_error()? {
                return Err(error);
            }
        }
        stream.set_nonblocking(false)?;
        Ok(stream)
    }
}

fn wait_for_connect(
    timeout: Duration,
    mut poll: impl FnMut(libc::c_int) -> io::Result<libc::c_int>,
) -> io::Result<()> {
    let deadline = Instant::now() + timeout;
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "Native socket connect timed out",
            ));
        }
        let remaining_ms = remaining.as_millis().clamp(1, libc::c_int::MAX as u128) as libc::c_int;
        match poll(remaining_ms) {
            Ok(0) => {
                return Err(io::Error::new(
                    io::ErrorKind::TimedOut,
                    "Native socket connect timed out",
                ))
            }
            Ok(_) => return Ok(()),
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            Err(error) => return Err(error),
        }
    }
}

#[cfg(target_os = "linux")]
fn peer_identity(stream: &UnixStream) -> io::Result<(u32, u32)> {
    // SAFETY: the kernel fills a correctly sized ucred on a live socket fd.
    unsafe {
        let mut credentials: libc::ucred = std::mem::zeroed();
        let mut length = std::mem::size_of_val(&credentials) as libc::socklen_t;
        if libc::getsockopt(
            stream.as_raw_fd(),
            libc::SOL_SOCKET,
            libc::SO_PEERCRED,
            &mut credentials as *mut _ as *mut libc::c_void,
            &mut length,
        ) != 0
        {
            return Err(io::Error::last_os_error());
        }
        Ok((credentials.uid, credentials.pid as u32))
    }
}

#[cfg(target_os = "macos")]
fn peer_identity(stream: &UnixStream) -> io::Result<(u32, u32)> {
    // SAFETY: both calls write into correctly sized values on a live socket fd.
    unsafe {
        let mut uid = 0;
        let mut gid = 0;
        if libc::getpeereid(stream.as_raw_fd(), &mut uid, &mut gid) != 0 {
            return Err(io::Error::last_os_error());
        }
        let mut pid: libc::pid_t = 0;
        let mut length = std::mem::size_of_val(&pid) as libc::socklen_t;
        if libc::getsockopt(
            stream.as_raw_fd(),
            0,
            libc::LOCAL_PEERPID,
            &mut pid as *mut _ as *mut libc::c_void,
            &mut length,
        ) != 0
        {
            return Err(io::Error::last_os_error());
        }
        Ok((uid, pid as u32))
    }
}

impl Connector for SocketConnector {
    type Out = SocketTransport;
    fn connect(
        &self,
        details: &ConnectionDetails,
        _: Option<()>,
    ) -> Result<Option<Self::Out>, ureq::Error> {
        if !allowed_authority(details.uri.scheme_str(), details.uri.host()) {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "Unexpected native request authority",
            )
            .into());
        }
        Ok(Some(SocketTransport {
            stream: self.open()?,
            buffers: LazyBuffers::new(
                details.config.input_buffer_size(),
                details.config.output_buffer_size(),
            ),
        }))
    }
}

fn allowed_authority(scheme: Option<&str>, host: Option<&str>) -> bool {
    scheme == Some("http") && host == Some("127.0.0.1")
}

#[derive(Debug)]
pub struct SocketTransport {
    stream: UnixStream,
    buffers: LazyBuffers,
}

fn io_error(error: io::Error, timeout: NextTimeout) -> ureq::Error {
    if matches!(
        error.kind(),
        io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut
    ) {
        ureq::Error::Timeout(timeout.reason)
    } else {
        error.into()
    }
}

impl Transport for SocketTransport {
    fn buffers(&mut self) -> &mut dyn Buffers {
        &mut self.buffers
    }
    fn transmit_output(&mut self, amount: usize, timeout: NextTimeout) -> Result<(), ureq::Error> {
        self.stream
            .set_write_timeout(timeout.not_zero().map(|value| *value))?;
        self.stream
            .write_all(&self.buffers.output()[..amount])
            .map_err(|error| io_error(error, timeout))
    }
    fn await_input(&mut self, timeout: NextTimeout) -> Result<bool, ureq::Error> {
        self.stream
            .set_read_timeout(timeout.not_zero().map(|value| *value))?;
        let amount = self
            .stream
            .read(self.buffers.input_append_buf())
            .map_err(|error| io_error(error, timeout))?;
        self.buffers.input_appended(amount);
        Ok(amount > 0)
    }
    // Reconnect and check peer credentials for every request.
    fn is_open(&mut self) -> bool {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    use std::os::unix::net::UnixListener;

    fn endpoint() -> (SocketConnector, UnixListener) {
        let directory = Arc::new(private_directory().unwrap());
        let connector = SocketConnector {
            directory,
            pid: std::process::id(),
            alive: Arc::new(AtomicBool::new(true)),
        };
        let listener = UnixListener::bind(connector.path()).unwrap();
        (connector, listener)
    }

    #[test]
    fn accepts_owned_socket_from_expected_process() {
        let (connector, _listener) = endpoint();
        connector.open().unwrap();
    }

    #[test]
    fn accepts_only_the_fixed_http_authority() {
        assert!(allowed_authority(Some("http"), Some("127.0.0.1")));
        assert!(!allowed_authority(Some("https"), Some("127.0.0.1")));
        assert!(!allowed_authority(Some("http"), Some("localhost")));
        assert!(!allowed_authority(None, Some("127.0.0.1")));
    }

    #[test]
    fn connect_wait_is_bounded_and_retries_interrupts() {
        let timeout = wait_for_connect(Duration::from_millis(1), |_| Ok(0)).unwrap_err();
        assert_eq!(timeout.kind(), io::ErrorKind::TimedOut);

        let mut attempts = 0;
        wait_for_connect(Duration::from_secs(1), |_| {
            attempts += 1;
            if attempts == 1 {
                Err(io::Error::from(io::ErrorKind::Interrupted))
            } else {
                Ok(1)
            }
        })
        .unwrap();
        assert_eq!(attempts, 2);
    }

    #[test]
    fn rejects_unexpected_process_before_sending_any_bytes() {
        let (mut connector, listener) = endpoint();
        connector.pid += 1;
        assert!(connector.open().is_err());
        let (mut peer, _) = listener.accept().unwrap();
        let mut bytes = [0; 1];
        assert_eq!(peer.read(&mut bytes).unwrap(), 0);
    }

    #[test]
    fn refuses_connections_after_the_managed_process_is_reaped() {
        let (connector, _listener) = endpoint();
        connector.alive.store(false, Ordering::Release);
        let error = connector.open().unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::NotConnected);
    }

    #[test]
    fn rejects_directory_permissions_and_symlink_socket() {
        let (connector, _listener) = endpoint();
        fs::set_permissions(
            connector.directory.path(),
            fs::Permissions::from_mode(0o755),
        )
        .unwrap();
        assert!(connector.open().is_err());
        fs::set_permissions(
            connector.directory.path(),
            fs::Permissions::from_mode(0o700),
        )
        .unwrap();
        let real = connector.directory.path().join("real.sock");
        fs::rename(connector.path(), &real).unwrap();
        std::os::unix::fs::symlink(real, connector.path()).unwrap();
        assert!(connector.open().is_err());
    }

    #[test]
    fn health_uses_authenticated_socket_transport() {
        let (connector, listener) = endpoint();
        let token = crate::control::NativeToken::generate().unwrap();
        let expected = token.expose().to_string();
        let connection =
            crate::control::NativeConnection::new(token, connector.directory, connector.pid);
        let responder = std::thread::spawn(move || {
            let (mut peer, _) = listener.accept().unwrap();
            peer.set_read_timeout(Some(std::time::Duration::from_secs(3)))
                .unwrap();
            let mut request = Vec::new();
            while !request.ends_with(b"\r\n\r\n") {
                let mut byte = [0];
                peer.read_exact(&mut byte).unwrap();
                request.push(byte[0]);
            }
            let request = String::from_utf8(request).unwrap();
            assert!(request.contains(&expected));
            assert!(request.contains("GET /health "));
            peer.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}")
                .unwrap();
        });
        connection.health().unwrap();
        responder.join().unwrap();
    }
}
