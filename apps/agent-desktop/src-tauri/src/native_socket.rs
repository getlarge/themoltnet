//! HTTP over a private Unix socket. Authenticate the kernel peer before sending
//! any HTTP bytes, including the process grant. No TCP/proxy/TLS fallback.
use std::fs;
use std::io::{self, Read, Write};
use std::os::fd::{AsRawFd, FromRawFd};
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::{FileTypeExt, MetadataExt};
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::sync::Arc;
use ureq::unversioned::transport::{
    Buffers, ConnectionDetails, Connector, LazyBuffers, NextTimeout, Transport,
};

#[derive(Clone, Debug)]
pub struct SocketConnector {
    pub directory: Arc<tempfile::TempDir>,
    pub pid: u32,
}

impl SocketConnector {
    pub fn path(&self) -> PathBuf {
        self.directory.path().join("control.sock")
    }

    fn open(&self) -> io::Result<UnixStream> {
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
                "Native socket peer is not the managed Agent Server",
            ));
        }
        Ok(stream)
    }
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
        let fd = libc::socket(libc::AF_UNIX, libc::SOCK_STREAM, 0);
        if fd < 0 {
            return Err(io::Error::last_os_error());
        }
        let stream = UnixStream::from_raw_fd(fd);
        if libc::fcntl(fd, libc::F_SETFD, libc::FD_CLOEXEC) < 0 {
            return Err(io::Error::last_os_error());
        }
        stream.set_nonblocking(true)?;
        if libc::connect(fd, &address as *const _ as *const libc::sockaddr, length) != 0 {
            let error = io::Error::last_os_error();
            if error.raw_os_error() != Some(libc::EINPROGRESS) {
                return Err(error);
            }
            let mut event = libc::pollfd {
                fd,
                events: libc::POLLOUT,
                revents: 0,
            };
            match libc::poll(&mut event, 1, 1000) {
                0 => {
                    return Err(io::Error::new(
                        io::ErrorKind::TimedOut,
                        "Native socket connect timed out",
                    ))
                }
                -1 => return Err(io::Error::last_os_error()),
                _ => {}
            }
            if let Some(error) = stream.take_error()? {
                return Err(error);
            }
        }
        stream.set_nonblocking(false)?;
        Ok(stream)
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
        if details.uri.scheme_str() != Some("http") || details.uri.host() != Some("127.0.0.1") {
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
        let directory = Arc::new(
            tempfile::Builder::new()
                .prefix("mn-")
                .tempdir_in(fs::canonicalize("/tmp").unwrap())
                .unwrap(),
        );
        fs::set_permissions(directory.path(), fs::Permissions::from_mode(0o700)).unwrap();
        let connector = SocketConnector {
            directory,
            pid: std::process::id(),
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
    fn rejects_unexpected_process_before_sending_any_bytes() {
        let (mut connector, listener) = endpoint();
        connector.pid += 1;
        assert!(connector.open().is_err());
        let (mut peer, _) = listener.accept().unwrap();
        let mut bytes = [0; 1];
        assert_eq!(peer.read(&mut bytes).unwrap(), 0);
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
