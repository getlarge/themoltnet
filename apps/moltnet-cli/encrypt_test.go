package main

import (
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"golang.org/x/crypto/curve25519"
)

type x25519DerivationVector struct {
	Comment                string `json:"comment"`
	Ed25519SeedBase64      string `json:"ed25519_seed_base64"`
	Ed25519PublicKey       string `json:"ed25519_public_key"`
	X25519PrivateKeyBase64 string `json:"x25519_private_key_base64"`
	X25519PublicKeyBase64  string `json:"x25519_public_key_base64"`
}

type encryptionVector struct {
	Comment                      string         `json:"comment"`
	Plaintext                    string         `json:"plaintext"`
	RecipientEd25519PublicKey    string         `json:"recipient_ed25519_public_key"`
	RecipientX25519PubKeyBase64  string         `json:"recipient_x25519_public_key_base64"`
	EphemeralSeedHex             string         `json:"ephemeral_seed_hex"`
	EphemeralPublicKeyBase64     string         `json:"ephemeral_public_key_base64"`
	NonceBase64                  string         `json:"nonce_base64"`
	SharedSecretHex              string         `json:"shared_secret_hex"`
	DerivedKeyHex                string         `json:"derived_key_hex"`
	CiphertextBase64             string         `json:"ciphertext_base64"`
	SealedEnvelope               SealedEnvelope `json:"sealed_envelope"`
	DecryptorEd25519SeedBase64   string         `json:"decryptor_ed25519_seed_base64"`
	DecryptorX25519PrivKeyBase64 string         `json:"decryptor_x25519_private_key_base64"`
}

type x25519VectorsFile struct {
	Description      string `json:"description"`
	X25519Derivation struct {
		Description string                   `json:"description"`
		Vectors     []x25519DerivationVector `json:"vectors"`
	} `json:"x25519_derivation"`
	Encryption struct {
		Description string             `json:"description"`
		HKDFInfo    string             `json:"hkdf_info"`
		Vectors     []encryptionVector `json:"vectors"`
	} `json:"encryption"`
}

func loadX25519Vectors(t *testing.T) x25519VectorsFile {
	t.Helper()
	_, filename, _, _ := runtime.Caller(0)
	dir := filepath.Dir(filename)
	path := filepath.Join(dir, "..", "..", "test-fixtures", "x25519-vectors.json")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("load x25519 vectors: %v", err)
	}
	var f x25519VectorsFile
	if err := json.Unmarshal(data, &f); err != nil {
		t.Fatalf("parse x25519 vectors: %v", err)
	}
	return f
}

func TestCrossLanguageX25519Derivation(t *testing.T) {
	f := loadX25519Vectors(t)
	for i, v := range f.X25519Derivation.Vectors {
		t.Run(v.Comment, func(t *testing.T) {
			// Derive X25519 private key
			gotPriv, err := DeriveX25519PrivateKey(v.Ed25519SeedBase64)
			if err != nil {
				t.Fatalf("vector %d: DeriveX25519PrivateKey: %v", i, err)
			}
			if gotPriv != v.X25519PrivateKeyBase64 {
				t.Errorf("vector %d: X25519 private key mismatch\n  got:  %s\n  want: %s", i, gotPriv, v.X25519PrivateKeyBase64)
			}

			// Derive X25519 public key
			gotPub, err := DeriveX25519PublicKey(v.Ed25519PublicKey)
			if err != nil {
				t.Fatalf("vector %d: DeriveX25519PublicKey: %v", i, err)
			}
			if gotPub != v.X25519PublicKeyBase64 {
				t.Errorf("vector %d: X25519 public key mismatch\n  got:  %s\n  want: %s", i, gotPub, v.X25519PublicKeyBase64)
			}

			// Verify private/public consistency: X25519 base point multiplication
			privBytes, _ := base64.StdEncoding.DecodeString(gotPriv)
			computedPub, err := curve25519.X25519(privBytes, curve25519.Basepoint)
			if err != nil {
				t.Fatalf("vector %d: curve25519.X25519: %v", i, err)
			}
			computedPubB64 := base64.StdEncoding.EncodeToString(computedPub)
			if computedPubB64 != v.X25519PublicKeyBase64 {
				t.Errorf("vector %d: X25519 pub from priv mismatch\n  got:  %s\n  want: %s", i, computedPubB64, v.X25519PublicKeyBase64)
			}
		})
	}
}

func TestCrossLanguageEncryption(t *testing.T) {
	f := loadX25519Vectors(t)
	for i, v := range f.Encryption.Vectors {
		t.Run(v.Comment, func(t *testing.T) {
			// Test decryption of the known ciphertext
			envelopeJSON, err := json.Marshal(v.SealedEnvelope)
			if err != nil {
				t.Fatalf("vector %d: marshal envelope: %v", i, err)
			}

			plaintext, err := DecryptFromAgent(string(envelopeJSON), v.DecryptorEd25519SeedBase64)
			if err != nil {
				t.Fatalf("vector %d: DecryptFromAgent: %v", i, err)
			}
			if plaintext != v.Plaintext {
				t.Errorf("vector %d: plaintext mismatch\n  got:  %q\n  want: %q", i, plaintext, v.Plaintext)
			}

			// Verify intermediate values
			// 1. X25519 key derivation
			gotPriv, err := DeriveX25519PrivateKey(v.DecryptorEd25519SeedBase64)
			if err != nil {
				t.Fatalf("vector %d: derive X25519 priv: %v", i, err)
			}
			if gotPriv != v.DecryptorX25519PrivKeyBase64 {
				t.Errorf("vector %d: X25519 priv mismatch\n  got:  %s\n  want: %s", i, gotPriv, v.DecryptorX25519PrivKeyBase64)
			}

			// 2. ECDH shared secret
			x25519Priv, _ := base64.StdEncoding.DecodeString(gotPriv)
			ephPub, _ := base64.StdEncoding.DecodeString(v.EphemeralPublicKeyBase64)
			shared, err := curve25519.X25519(x25519Priv, ephPub)
			if err != nil {
				t.Fatalf("vector %d: ECDH: %v", i, err)
			}
			gotSharedHex := hex.EncodeToString(shared)
			if gotSharedHex != v.SharedSecretHex {
				t.Errorf("vector %d: shared secret mismatch\n  got:  %s\n  want: %s", i, gotSharedHex, v.SharedSecretHex)
			}

			// 3. HKDF derived key
			key, err := deriveKey(shared)
			if err != nil {
				t.Fatalf("vector %d: HKDF: %v", i, err)
			}
			gotKeyHex := hex.EncodeToString(key)
			if gotKeyHex != v.DerivedKeyHex {
				t.Errorf("vector %d: derived key mismatch\n  got:  %s\n  want: %s", i, gotKeyHex, v.DerivedKeyHex)
			}
		})
	}
}

func TestEncryptDecryptRoundTrip(t *testing.T) {
	// Generate a keypair for bob
	bob, err := GenerateKeyPair()
	if err != nil {
		t.Fatalf("generate keypair: %v", err)
	}

	messages := []string{
		"hello bob",
		"",
		"こんにちは 🔑",
		"line1\nline2\x00line3",
	}

	for _, msg := range messages {
		sealed, err := EncryptForAgent(msg, bob.PublicKey)
		if err != nil {
			t.Fatalf("EncryptForAgent(%q): %v", msg, err)
		}

		plaintext, err := DecryptFromAgent(sealed, bob.PrivateKey)
		if err != nil {
			t.Fatalf("DecryptFromAgent(%q): %v", msg, err)
		}

		if plaintext != msg {
			t.Errorf("round-trip mismatch\n  got:  %q\n  want: %q", plaintext, msg)
		}
	}
}

func TestDecryptRejectsWrongKey(t *testing.T) {
	bob, _ := GenerateKeyPair()
	alice, _ := GenerateKeyPair()

	sealed, err := EncryptForAgent("for bob only", bob.PublicKey)
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}

	_, err = DecryptFromAgent(sealed, alice.PrivateKey)
	if err == nil {
		t.Error("expected error when decrypting with wrong key")
	}
}

func TestDecryptRejectsTamperedCiphertext(t *testing.T) {
	bob, _ := GenerateKeyPair()

	sealed, err := EncryptForAgent("secret", bob.PublicKey)
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}

	var envelope SealedEnvelope
	json.Unmarshal([]byte(sealed), &envelope)

	ct, _ := base64.StdEncoding.DecodeString(envelope.Ciphertext)
	ct[0] ^= 0xff
	envelope.Ciphertext = base64.StdEncoding.EncodeToString(ct)

	tampered, _ := json.Marshal(envelope)
	_, err = DecryptFromAgent(string(tampered), bob.PrivateKey)
	if err == nil {
		t.Error("expected error when decrypting tampered ciphertext")
	}
}

func TestDecryptRejectsUnsupportedVersion(t *testing.T) {
	bob, _ := GenerateKeyPair()

	sealed, err := EncryptForAgent("test", bob.PublicKey)
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}

	var envelope SealedEnvelope
	json.Unmarshal([]byte(sealed), &envelope)
	envelope.V = 99

	modified, _ := json.Marshal(envelope)
	_, err = DecryptFromAgent(string(modified), bob.PrivateKey)
	if err == nil {
		t.Error("expected error for unsupported version")
	}
}

func TestDecryptRejectsUnsupportedAlgorithm(t *testing.T) {
	bob, _ := GenerateKeyPair()

	sealed, err := EncryptForAgent("test", bob.PublicKey)
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}

	var envelope SealedEnvelope
	json.Unmarshal([]byte(sealed), &envelope)
	envelope.Algorithm = "aes-256-gcm"

	modified, _ := json.Marshal(envelope)
	_, err = DecryptFromAgent(string(modified), bob.PrivateKey)
	if err == nil {
		t.Error("expected error for unsupported algorithm")
	}
}

func TestDeterministicEncryption(t *testing.T) {
	// Use first encryption vector's deterministic values
	f := loadX25519Vectors(t)
	v := f.Encryption.Vectors[0]

	ephPriv, _ := hex.DecodeString(v.EphemeralSeedHex)
	nonce, _ := base64.StdEncoding.DecodeString(v.NonceBase64)
	recipientPub, _ := base64.StdEncoding.DecodeString(v.RecipientX25519PubKeyBase64)

	sealed, err := encryptWithEphemeral(v.Plaintext, recipientPub, ephPriv, nonce)
	if err != nil {
		t.Fatalf("encryptWithEphemeral: %v", err)
	}

	var gotEnvelope SealedEnvelope
	json.Unmarshal([]byte(sealed), &gotEnvelope)

	if gotEnvelope.EphemeralPublicKey != v.SealedEnvelope.EphemeralPublicKey {
		t.Errorf("ephemeral pub mismatch\n  got:  %s\n  want: %s", gotEnvelope.EphemeralPublicKey, v.SealedEnvelope.EphemeralPublicKey)
	}
	if gotEnvelope.Ciphertext != v.SealedEnvelope.Ciphertext {
		t.Errorf("ciphertext mismatch\n  got:  %s\n  want: %s", gotEnvelope.Ciphertext, v.SealedEnvelope.Ciphertext)
	}
}
