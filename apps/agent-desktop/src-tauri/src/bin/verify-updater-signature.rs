use base64::{engine::general_purpose::STANDARD, Engine as _};
use minisign_verify::{PublicKey, Signature};
use std::{env, fs, process::ExitCode};

fn verify() -> Result<(), String> {
    let mut args = env::args_os().skip(1);
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
    match verify() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("{error}");
            ExitCode::FAILURE
        }
    }
}
