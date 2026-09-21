//! Canonical store selection shared with Node and Go conformance fixtures.
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
    let default_root = home.join(".config/moltnet");
    let root = explicit
        .or(environment)
        .map(Path::new)
        .unwrap_or(&default_root);
    let root = root
        .to_str()
        .ok_or("MoltNet store root must be valid UTF-8")?;
    if root.trim().is_empty() || root.contains('\0') {
        return Err("MoltNet store root must be a nonempty directory path".into());
    }
    let absolute = if Path::new(root).is_absolute() {
        PathBuf::from(root)
    } else {
        cwd.join(root)
    };
    let mut current = PathBuf::new();
    for component in absolute.components() {
        match component {
            Component::CurDir => continue,
            Component::ParentDir => {
                current.pop();
                continue;
            }
            value => current.push(value.as_os_str()),
        }
        match fs::symlink_metadata(&current) {
            Ok(_) => {
                current = fs::canonicalize(&current).map_err(|e| e.to_string())?;
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
        let cwd = fs::canonicalize(&temporary).unwrap();
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
                cwd.join("real/.config/moltnet")
            );
            fs::create_dir(cwd.join("CaseStore")).unwrap();
            if cwd.join("casestore").exists() {
                assert_eq!(
                    resolve_store_root(Some("casestore"), None, &cwd, &cwd).unwrap(),
                    cwd.join("CaseStore")
                );
            }
            std::os::unix::fs::symlink(cwd.join("missing"), cwd.join("broken")).unwrap();
            assert!(resolve_store_root(Some("broken/new"), None, &cwd, &cwd).is_err());
        }
        fs::remove_dir_all(temporary).unwrap();
    }
}
