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
    let Some(root) = explicit.or(environment) else {
        return Ok(home.join(".config/moltnet"));
    };
    if root.trim().is_empty() || root.contains('\0') {
        return Err("MoltNet store root must be a nonempty directory path".into());
    }
    let absolute = if Path::new(root).is_absolute() {
        PathBuf::from(root)
    } else {
        cwd.join(root)
    };
    let mut ancestor = PathBuf::new();
    for component in absolute.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                ancestor.pop();
            }
            value => ancestor.push(value.as_os_str()),
        }
    }
    let mut missing = Vec::new();
    loop {
        match fs::symlink_metadata(&ancestor) {
            Ok(_) => {
                let mut canonical = fs::canonicalize(&ancestor).map_err(|e| e.to_string())?;
                if !canonical.is_dir() {
                    return Err("MoltNet store root must be a directory".into());
                }
                for segment in missing.iter().rev() {
                    canonical.push(segment);
                }
                return Ok(canonical);
            }
            Err(error) if error.kind() == ErrorKind::NotFound => {
                let name = ancestor
                    .file_name()
                    .ok_or_else(|| error.to_string())?
                    .to_os_string();
                missing.push(name);
                if !ancestor.pop() {
                    return Err(error.to_string());
                }
            }
            Err(error) => return Err(error.to_string()),
        }
    }
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
            std::os::unix::fs::symlink(cwd.join("missing"), cwd.join("broken")).unwrap();
            assert!(resolve_store_root(Some("broken/new"), None, &cwd, &cwd).is_err());
        }
        fs::remove_dir_all(temporary).unwrap();
    }
}
