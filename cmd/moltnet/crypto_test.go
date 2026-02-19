package main

import (
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

type testVector struct {
	Comment          string `json:"comment"`
	PrivateKeyBase64 string `json:"private_key_base64"`
	PublicKey        string `json:"public_key"`
	Fingerprint      string `json:"fingerprint"`
	SignInput        string `json:"sign_input"`
	SignatureBase64  string `json:"signature_base64"`
}

type signingVector struct {
	Comment         string `json:"comment"`
	Message         string `json:"message"`
	Nonce           string `json:"nonce"`
	SigningBytesHex string `json:"signing_bytes_hex"`
	SignatureBase64 string `json:"signature_base64"`
}

type signingVectorsSection struct {
	Description      string          `json:"description"`
	PrivateKeyBase64 string          `json:"private_key_base64"`
	PublicKey        string          `json:"public_key"`
	Vectors          []signingVector `json:"vectors"`
}

type testVectorsFile struct {
	Description    string                `json:"description"`
	Vectors        []testVector          `json:"vectors"`
	SigningVectors signingVectorsSection `json:"signing_vectors"`
}

func loadVectors(t *testing.T) []testVector {
	t.Helper()
	f := loadVectorsFile(t)
	return f.Vectors
}

func loadVectorsFile(t *testing.T) testVectorsFile {
	t.Helper()
	_, filename, _, _ := runtime.Caller(0)
	dir := filepath.Dir(filename)
	path := filepath.Join(dir, "..", "..", "test-fixtures", "crypto-vectors.json")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("load vectors: %v", err)
	}
	var f testVectorsFile
	if err := json.Unmarshal(data, &f); err != nil {
		t.Fatalf("parse vectors: %v", err)
	}
	return f
}

func TestCrossLanguageVectors(t *testing.T) {
	vectors := loadVectors(t)
	for i, v := range vectors {
		t.Run(v.Comment, func(t *testing.T) {
			// Decode seed
			seed, err := base64.StdEncoding.DecodeString(v.PrivateKeyBase64)
			if err != nil {
				t.Fatalf("vector %d: decode seed: %v", i, err)
			}

			// Derive keypair from seed
			kp, err := KeyPairFromSeed(seed)
			if err != nil {
				t.Fatalf("vector %d: keypair from seed: %v", i, err)
			}

			// Check public key
			if kp.PublicKey != v.PublicKey {
				t.Errorf("vector %d: public key mismatch\n  got:  %s\n  want: %s", i, kp.PublicKey, v.PublicKey)
			}

			// Check fingerprint
			if kp.Fingerprint != v.Fingerprint {
				t.Errorf("vector %d: fingerprint mismatch\n  got:  %s\n  want: %s", i, kp.Fingerprint, v.Fingerprint)
			}

			// Check signature
			sig, err := Sign(v.SignInput, v.PrivateKeyBase64)
			if err != nil {
				t.Fatalf("vector %d: sign: %v", i, err)
			}
			if sig != v.SignatureBase64 {
				t.Errorf("vector %d: signature mismatch\n  got:  %s\n  want: %s", i, sig, v.SignatureBase64)
			}

			// Verify signature
			valid, err := Verify(v.SignInput, v.SignatureBase64, v.PublicKey)
			if err != nil {
				t.Fatalf("vector %d: verify: %v", i, err)
			}
			if !valid {
				t.Errorf("vector %d: signature verification failed", i)
			}
		})
	}
}

func TestGenerateKeyPair(t *testing.T) {
	kp, err := GenerateKeyPair()
	if err != nil {
		t.Fatalf("generate: %v", err)
	}

	// Public key format
	if len(kp.PublicKey) < 10 || kp.PublicKey[:8] != "ed25519:" {
		t.Errorf("public key format: got %q", kp.PublicKey)
	}

	// Private key is 32 bytes base64
	seed, err := base64.StdEncoding.DecodeString(kp.PrivateKey)
	if err != nil {
		t.Fatalf("decode private key: %v", err)
	}
	if len(seed) != 32 {
		t.Errorf("private key size: got %d, want 32", len(seed))
	}

	// Fingerprint format
	if len(kp.Fingerprint) != 19 { // XXXX-XXXX-XXXX-XXXX
		t.Errorf("fingerprint format: got %q (len %d)", kp.Fingerprint, len(kp.Fingerprint))
	}
}

func TestSignVerifyRoundTrip(t *testing.T) {
	kp, err := GenerateKeyPair()
	if err != nil {
		t.Fatalf("generate: %v", err)
	}

	message := "moltnet:test:round-trip"
	sig, err := Sign(message, kp.PrivateKey)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}

	valid, err := Verify(message, sig, kp.PublicKey)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if !valid {
		t.Error("round-trip verification failed")
	}
}

func TestVerifyRejectsTamperedSignature(t *testing.T) {
	kp, err := GenerateKeyPair()
	if err != nil {
		t.Fatalf("generate: %v", err)
	}

	message := "moltnet:test:tamper"
	sig, err := Sign(message, kp.PrivateKey)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}

	// Flip a bit in the signature
	sigBytes, _ := base64.StdEncoding.DecodeString(sig)
	sigBytes[0] ^= 0x01
	tampered := base64.StdEncoding.EncodeToString(sigBytes)

	valid, err := Verify(message, tampered, kp.PublicKey)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if valid {
		t.Error("tampered signature should not verify")
	}
}

func TestBuildSigningBytes(t *testing.T) {
	// Verify domain prefix
	sb := BuildSigningBytes("hello", "nonce123")
	prefix := string(sb[:10])
	if prefix != "moltnet:v1" {
		t.Errorf("domain prefix: got %q, want %q", prefix, "moltnet:v1")
	}

	// Verify determinism
	sb2 := BuildSigningBytes("hello", "nonce123")
	if hex.EncodeToString(sb) != hex.EncodeToString(sb2) {
		t.Error("BuildSigningBytes is not deterministic")
	}

	// Different messages produce different bytes
	sb3 := BuildSigningBytes("world", "nonce123")
	if hex.EncodeToString(sb) == hex.EncodeToString(sb3) {
		t.Error("different messages should produce different signing bytes")
	}
}

func TestCrossLanguageSigningVectors(t *testing.T) {
	f := loadVectorsFile(t)
	sv := f.SigningVectors

	for i, v := range sv.Vectors {
		t.Run(v.Comment, func(t *testing.T) {
			// Check signing bytes match
			sb := BuildSigningBytes(v.Message, v.Nonce)
			gotHex := hex.EncodeToString(sb)
			if gotHex != v.SigningBytesHex {
				t.Errorf("vector %d: signing bytes mismatch\n  got:  %s\n  want: %s", i, gotHex, v.SigningBytesHex)
			}

			// Check signature via SignForRequest
			sig, err := SignForRequest(v.Message, v.Nonce, sv.PrivateKeyBase64)
			if err != nil {
				t.Fatalf("vector %d: SignForRequest: %v", i, err)
			}
			if sig != v.SignatureBase64 {
				t.Errorf("vector %d: signature mismatch\n  got:  %s\n  want: %s", i, sig, v.SignatureBase64)
			}

			// Verify via VerifyForRequest
			valid, err := VerifyForRequest(v.Message, v.Nonce, v.SignatureBase64, sv.PublicKey)
			if err != nil {
				t.Fatalf("vector %d: VerifyForRequest: %v", i, err)
			}
			if !valid {
				t.Errorf("vector %d: signature verification failed", i)
			}

			// Tampered message should fail
			valid, err = VerifyForRequest(v.Message+"x", v.Nonce, v.SignatureBase64, sv.PublicKey)
			if err != nil {
				t.Fatalf("vector %d: tampered verify: %v", i, err)
			}
			if valid {
				t.Errorf("vector %d: tampered message should not verify", i)
			}

			// Tampered nonce should fail
			valid, err = VerifyForRequest(v.Message, v.Nonce+"x", v.SignatureBase64, sv.PublicKey)
			if err != nil {
				t.Fatalf("vector %d: tampered nonce verify: %v", i, err)
			}
			if valid {
				t.Errorf("vector %d: tampered nonce should not verify", i)
			}
		})
	}
}

func TestSignForRequestRoundTrip(t *testing.T) {
	kp, err := GenerateKeyPair()
	if err != nil {
		t.Fatalf("generate: %v", err)
	}

	messages := []string{
		"line1\nline2\nline3",
		"  spaces  ",
		"sign this — with a 🔑",
		strings.Repeat("A", 1100),
	}

	nonce := "test-nonce-uuid"
	for _, msg := range messages {
		sig, err := SignForRequest(msg, nonce, kp.PrivateKey)
		if err != nil {
			t.Fatalf("SignForRequest(%q): %v", msg[:20], err)
		}
		valid, err := VerifyForRequest(msg, nonce, sig, kp.PublicKey)
		if err != nil {
			t.Fatalf("VerifyForRequest(%q): %v", msg[:20], err)
		}
		if !valid {
			t.Errorf("round-trip failed for message %q", msg[:20])
		}
	}
}
