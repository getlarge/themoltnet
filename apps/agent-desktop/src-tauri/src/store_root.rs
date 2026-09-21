//! Store paths and canonical identity shared with Node and Go conformance fixtures.
use std::{
    fs,
    io::ErrorKind,
    path::{Component, Path, PathBuf},
};

pub fn resolve_store_root(
    explicit: Option<&str>,
    environment: Option<&str>,
    home: &Path,
    cwd: &Path,
) -> Result<PathBuf, String> {
    resolve_store_path(
        explicit.map(Path::new),
        environment.map(Path::new),
        home,
        cwd,
    )
}

/// Native path variant preserves non-UTF-8 filesystem names.
pub fn resolve_store_path(
    explicit: Option<&Path>,
    environment: Option<&Path>,
    home: &Path,
    cwd: &Path,
) -> Result<PathBuf, String> {
    let Some(root) = explicit.or(environment) else {
        return Ok(home.join(".config/moltnet"));
    };
    if root.as_os_str().to_string_lossy().trim().is_empty()
        || root.as_os_str().as_encoded_bytes().contains(&0)
    {
        return Err("MoltNet store root must be a nonempty directory path".into());
    }
    let absolute = if root.is_absolute() {
        PathBuf::from(root)
    } else {
        cwd.join(root)
    };
    let mut current = PathBuf::new();
    for component in absolute.components() {
        match component {
            Component::Prefix(prefix) => {
                current.push(prefix.as_os_str());
                continue;
            }
            Component::CurDir => continue,
            Component::ParentDir => {
                current.pop();
                continue;
            }
            value => current.push(value.as_os_str()),
        }
        match fs::symlink_metadata(&current) {
            Ok(_) => {
                current =
                    normalize_windows_path(fs::canonicalize(&current).map_err(|e| e.to_string())?);
                if !current.is_dir() {
                    return Err("MoltNet store root must be a directory".into());
                }
            }
            Err(error) if error.kind() == ErrorKind::NotFound => {}
            Err(error) => return Err(error.to_string()),
        }
    }
    Ok(current)
}

#[cfg(not(windows))]
fn normalize_windows_path(path: PathBuf) -> PathBuf {
    path
}

#[cfg(windows)]
fn normalize_windows_path(path: PathBuf) -> PathBuf {
    use std::path::Prefix;
    let mut components = path.components();
    let Some(Component::Prefix(prefix)) = components.next() else {
        return path;
    };
    let mut normalized = match prefix.kind() {
        Prefix::VerbatimDisk(drive) => {
            PathBuf::from(format!("{}:", char::from(drive).to_ascii_uppercase()))
        }
        Prefix::VerbatimUNC(server, share) => {
            let mut root = PathBuf::from(r"\\");
            root.push(server);
            root.push(share);
            root
        }
        _ => return path,
    };
    normalized.extend(components);
    normalized
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn shared_conformance() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let temporary = std::env::temp_dir().join(format!("moltnet-store-{unique}"));
        fs::create_dir(&temporary).unwrap();
        let cwd = normalize_windows_path(fs::canonicalize(&temporary).unwrap());
        for row in include_str!("../../../../test-fixtures/store-root-conformance.tsv").lines() {
            if row.starts_with('#') || row.is_empty() {
                continue;
            }
            let (root, expected) = row.split_once('\t').unwrap();
            let result = resolve_store_root(Some(root), Some("ignored"), &cwd, &cwd);
            if expected == "ERROR" {
                assert!(result.is_err(), "accepted {root:?}");
            } else {
                assert_eq!(result.unwrap(), cwd.join(expected));
            }
        }
        assert_eq!(
            resolve_store_root(None, None, &cwd, &cwd).unwrap(),
            cwd.join(".config/moltnet")
        );
        assert_eq!(
            resolve_store_root(None, Some("from-env"), &cwd, &cwd).unwrap(),
            cwd.join("from-env")
        );
        assert!(resolve_store_root(Some("bad\0root"), None, &cwd, &cwd).is_err());
        fs::write(cwd.join("file"), "fixture").unwrap();
        assert!(resolve_store_root(Some("file"), None, &cwd, &cwd).is_err());
        assert!(resolve_store_root(Some("file/child"), None, &cwd, &cwd).is_err());
        #[cfg(unix)]
        {
            fs::create_dir(cwd.join("real")).unwrap();
            std::os::unix::fs::symlink(cwd.join("real"), cwd.join("alias")).unwrap();
            assert_eq!(
                resolve_store_root(Some("alias/new"), None, &cwd, &cwd).unwrap(),
                cwd.join("real/new")
            );
            fs::create_dir(cwd.join("real/nested")).unwrap();
            std::os::unix::fs::symlink(cwd.join("real/nested"), cwd.join("nested-link")).unwrap();
            assert_eq!(
                resolve_store_root(Some("nested-link/../new"), None, &cwd, &cwd).unwrap(),
                cwd.join("real/new")
            );
            assert_eq!(
                resolve_store_root(None, None, &cwd.join("alias"), &cwd).unwrap(),
                cwd.join("alias/.config/moltnet")
            );
            std::os::unix::fs::symlink(cwd.join("missing"), cwd.join("broken")).unwrap();
            assert!(resolve_store_root(Some("broken/new"), None, &cwd, &cwd).is_err());
        }
        fs::remove_dir_all(temporary).unwrap();
    }
    #[test]
    fn case_insensitive_volume() {
        let temporary = std::env::temp_dir().join(format!("moltnet-case-{}", std::process::id()));
        fs::create_dir_all(temporary.join("CaseStore")).unwrap();
        let cwd = normalize_windows_path(fs::canonicalize(&temporary).unwrap());
        if !cwd.join("casestore").exists() {
            fs::remove_dir_all(temporary).unwrap();
            eprintln!("SKIP case_insensitive_volume: requires a case-insensitive filesystem");
            return;
        }
        assert_eq!(
            resolve_store_root(Some("casestore"), None, &cwd, &cwd).unwrap(),
            cwd.join("CaseStore")
        );
        fs::remove_dir_all(temporary).unwrap();
    }

    #[test]
    #[cfg(unix)]
    fn traverse_only_directory() {
        use std::os::unix::fs::PermissionsExt;
        let temporary =
            std::env::temp_dir().join(format!("moltnet-traverse-{}", std::process::id()));
        fs::create_dir_all(temporary.join("CaseStore")).unwrap();
        let cwd = normalize_windows_path(fs::canonicalize(&temporary).unwrap());
        let actual = cwd.join("CaseStore");
        let alias = if cwd.join("casestore").exists() {
            cwd.join("casestore")
        } else {
            actual.clone()
        };
        fs::set_permissions(&actual, fs::Permissions::from_mode(0o111)).unwrap();
        let readable = fs::read_dir(&actual);
        let result = resolve_store_path(Some(&alias.join("new")), None, &cwd, &cwd);
        fs::set_permissions(&actual, fs::Permissions::from_mode(0o700)).unwrap();
        fs::remove_dir_all(temporary).unwrap();
        match readable {
            Ok(_) => {
                eprintln!("SKIP traverse_only_directory: filesystem or user bypasses directory read permissions");
                return;
            }
            Err(error) => assert_eq!(error.kind(), ErrorKind::PermissionDenied),
        }
        assert_eq!(result.unwrap(), actual.join("new"));
    }

    #[test]
    #[cfg(unix)]
    fn native_path_bytes() {
        use std::os::unix::ffi::OsStrExt;
        let home = Path::new(std::ffi::OsStr::from_bytes(b"/non-utf8-\xff"));
        assert_eq!(
            resolve_store_root(None, None, home, Path::new("/")).unwrap(),
            home.join(".config/moltnet")
        );
        assert_eq!(
            resolve_store_path(Some(home), None, Path::new("/unused"), Path::new("/")).unwrap(),
            home
        );
    }

    #[test]
    #[cfg(windows)]
    fn windows_paths_do_not_keep_verbatim_prefixes() {
        let cwd = std::env::current_dir().unwrap();
        let canonical = fs::canonicalize(&cwd).unwrap();
        let resolved = resolve_store_path(Some(&canonical), None, &cwd, &cwd).unwrap();
        assert!(!resolved.as_os_str().to_string_lossy().starts_with(r"\\?\"));
        assert_eq!(
            normalize_windows_path(PathBuf::from(r"\\?\UNC\host\share\folder")),
            PathBuf::from(r"\\host\share\folder")
        );
    }
}
