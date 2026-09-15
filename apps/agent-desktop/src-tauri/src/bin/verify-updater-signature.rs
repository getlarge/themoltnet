use base64::{engine::general_purpose::STANDARD, Engine as _};
use minisign_verify::{PublicKey, Signature};
use std::{env, ffi::OsString, fs, process::ExitCode};

fn verify(mut args: impl Iterator<Item = OsString>) -> Result<(), String> {
    let encoded_public_key = args
        .next()
        .ok_or_else(|| "missing updater public key".to_string())?;
    let signature_path = args
        .next()
        .ok_or_else(|| "missing updater signature path".to_string())?;
    let artifact_path = args
        .next()
        .ok_or_else(|| "missing updater artifact path".to_string())?;
    if args.next().is_some() {
        return Err("unexpected updater verification argument".into());
    }

    let public_key_text = STANDARD
        .decode(encoded_public_key.to_string_lossy().trim())
        .map_err(|error| format!("invalid updater public-key encoding: {error}"))?;
    let public_key_text = std::str::from_utf8(&public_key_text)
        .map_err(|error| format!("updater public key is not UTF-8: {error}"))?;
    let public_key = PublicKey::decode(public_key_text)
        .map_err(|error| format!("invalid updater public key: {error}"))?;

    let encoded_signature = fs::read_to_string(signature_path)
        .map_err(|error| format!("could not read updater signature: {error}"))?;
    let signature_text = STANDARD
        .decode(encoded_signature.trim())
        .map_err(|error| format!("invalid updater signature encoding: {error}"))?;
    let signature_text = std::str::from_utf8(&signature_text)
        .map_err(|error| format!("updater signature is not UTF-8: {error}"))?;
    let signature = Signature::decode(signature_text)
        .map_err(|error| format!("invalid updater signature: {error}"))?;

    let artifact = fs::read(artifact_path)
        .map_err(|error| format!("could not read updater artifact: {error}"))?;
    public_key
        .verify(&artifact, &signature, true)
        .map_err(|error| format!("updater signature verification failed: {error}"))
}

fn main() -> ExitCode {
    match verify(env::args_os().skip(1)) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("{error}");
            ExitCode::FAILURE
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PUBLIC_KEY: &str = "untrusted comment: minisign public key E7620F1842B4E81F\nRWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3";
    const SIGNATURE: &str = "untrusted comment: signature from minisign secret key\nRWQf6LRCGA9i59SLOFxz6NxvASXDJeRtuZykwQepbDEGt87ig1BNpWaVWuNrm73YiIiJbq71Wi+dP9eKL8OC351vwIasSSbXxwA=\ntrusted comment: timestamp:1555779966\tfile:test\nQtKMXWyYcwdpZAlPF7tE2ENJkRd1ujvKjlj1m9RtHTBnZPa5WKU5uWRs5GoP5M/VqE81QFuMKI5k/SfNQUaOAA==";

    fn fixture(artifact: &[u8]) -> (tempfile::TempDir, Vec<OsString>) {
        let directory = tempfile::tempdir().unwrap();
        let signature_path = directory.path().join("artifact.sig");
        let artifact_path = directory.path().join("artifact.tar.gz");
        fs::write(&signature_path, STANDARD.encode(SIGNATURE)).unwrap();
        fs::write(&artifact_path, artifact).unwrap();
        let args = vec![
            STANDARD.encode(PUBLIC_KEY).into(),
            signature_path.into_os_string(),
            artifact_path.into_os_string(),
        ];
        (directory, args)
    }

    #[test]
    fn accepts_a_known_good_signature() {
        let (_directory, args) = fixture(b"test");

        assert_eq!(verify(args.into_iter()), Ok(()));
    }

    #[test]
    fn rejects_a_tampered_artifact() {
        let (_directory, args) = fixture(b"Test");

        assert!(verify(args.into_iter())
            .unwrap_err()
            .contains("signature verification failed"));
    }

    #[test]
    fn rejects_missing_extra_and_malformed_arguments() {
        assert_eq!(
            verify(Vec::<OsString>::new().into_iter()),
            Err("missing updater public key".into())
        );
        let (_directory, mut args) = fixture(b"test");
        args.push("extra".into());
        assert_eq!(
            verify(args.into_iter()),
            Err("unexpected updater verification argument".into())
        );
        let (_directory, mut args) = fixture(b"test");
        args[0] = "not-base64".into();
        assert!(verify(args.into_iter())
            .unwrap_err()
            .contains("invalid updater public-key encoding"));
    }
}
