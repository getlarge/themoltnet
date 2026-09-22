use std::path::Path;

pub fn validate_fixture(
    fixture: &Path,
    temporary: &Path,
    environment: impl Fn(&str) -> Option<std::ffi::OsString>,
) -> Result<(), String> {
    let fixture = fixture.canonicalize().map_err(|e| e.to_string())?;
    let temporary = temporary.canonicalize().map_err(|e| e.to_string())?;
    if fixture.parent() != Some(temporary.as_path())
        || !fixture
            .file_name()
            .is_some_and(|name| name.to_string_lossy().starts_with("moltnet-desktop-e2e-"))
    {
        return Err("Desktop automation requires a runner-owned system temporary directory".into());
    }
    for (name, child) in [
        ("HOME", "home"),
        ("USERPROFILE", "home"),
        ("MOLTNET_HOME", "store"),
        ("MOLTNET_AGENT_HOME", "agent"),
        ("XDG_CONFIG_HOME", "home/.config"),
        ("XDG_CACHE_HOME", "home/.cache"),
        ("XDG_DATA_HOME", "home/.local/share"),
        ("XDG_RUNTIME_DIR", "home/.runtime"),
    ] {
        let actual = environment(name).and_then(|path| std::fs::canonicalize(path).ok());
        if actual.as_deref() != Some(fixture.join(child).as_path()) {
            return Err(format!("Desktop automation requires isolated {name}"));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{collections::HashMap, ffi::OsString, fs};

    fn fixture(root: &Path) -> HashMap<&'static str, OsString> {
        [
            ("HOME", "home"),
            ("USERPROFILE", "home"),
            ("MOLTNET_HOME", "store"),
            ("MOLTNET_AGENT_HOME", "agent"),
            ("XDG_CONFIG_HOME", "home/.config"),
            ("XDG_CACHE_HOME", "home/.cache"),
            ("XDG_DATA_HOME", "home/.local/share"),
            ("XDG_RUNTIME_DIR", "home/.runtime"),
        ]
        .into_iter()
        .map(|(name, child)| {
            let path = root.join(child);
            fs::create_dir_all(&path).unwrap();
            (name, path.into_os_string())
        })
        .collect()
    }

    #[test]
    fn accepts_only_temporary_roots_and_private_platform_directories() {
        let temporary = tempfile::tempdir().unwrap();
        let root = temporary.path().join("moltnet-desktop-e2e-fixture");
        let mut env = fixture(&root);
        assert!(validate_fixture(&root, temporary.path(), |name| env.get(name).cloned()).is_ok());
        for name in [
            "HOME",
            "USERPROFILE",
            "MOLTNET_HOME",
            "MOLTNET_AGENT_HOME",
            "XDG_CONFIG_HOME",
            "XDG_CACHE_HOME",
            "XDG_DATA_HOME",
            "XDG_RUNTIME_DIR",
        ] {
            let original = env
                .insert(name, temporary.path().as_os_str().into())
                .unwrap();
            assert!(
                validate_fixture(&root, temporary.path(), |key| env.get(key).cloned()).is_err(),
                "{name}"
            );
            env.insert(name, original);
        }
        let other = tempfile::tempdir().unwrap();
        assert!(validate_fixture(&root, other.path(), |name| env.get(name).cloned()).is_err());
    }
}
