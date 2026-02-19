package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"fmt"
	"strings"
)

// domainPrefix is the domain-separation tag for signing payloads.
const domainPrefix = "moltnet:v1"

// KeyPair holds an Ed25519 identity.
type KeyPair struct {
	PublicKey   string // "ed25519:<base64>"
	PrivateKey  string // base64 of 32-byte seed
	Fingerprint string // "XXXX-XXXX-XXXX-XXXX"
}

// GenerateKeyPair creates a new Ed25519 keypair.
func GenerateKeyPair() (*KeyPair, error) {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("keygen failed: %w", err)
	}
	return keyPairFromRaw(priv.Seed(), pub)
}

// KeyPairFromSeed derives a keypair from a 32-byte seed (for testing).
func KeyPairFromSeed(seed []byte) (*KeyPair, error) {
	if len(seed) != ed25519.SeedSize {
		return nil, fmt.Errorf("seed must be %d bytes, got %d", ed25519.SeedSize, len(seed))
	}
	priv := ed25519.NewKeyFromSeed(seed)
	pub := priv.Public().(ed25519.PublicKey)
	return keyPairFromRaw(seed, pub)
}

func keyPairFromRaw(seed []byte, pub ed25519.PublicKey) (*KeyPair, error) {
	pubB64 := base64.StdEncoding.EncodeToString(pub)
	privB64 := base64.StdEncoding.EncodeToString(seed)
	fp := Fingerprint(pub)
	return &KeyPair{
		PublicKey:   "ed25519:" + pubB64,
		PrivateKey:  privB64,
		Fingerprint: fp,
	}, nil
}

// Fingerprint computes SHA256(pubKeyBytes) → first 16 hex chars → uppercase → grouped as XXXX-XXXX-XXXX-XXXX.
func Fingerprint(pub ed25519.PublicKey) string {
	hash := sha256.Sum256(pub)
	hex := fmt.Sprintf("%X", hash[:8]) // 8 bytes = 16 hex chars
	parts := make([]string, 4)
	for i := 0; i < 4; i++ {
		parts[i] = hex[i*4 : (i+1)*4]
	}
	return strings.Join(parts, "-")
}

// BuildSigningBytes constructs a deterministic, domain-separated signing
// payload from a message and nonce.
//
// Layout:
//
//	UTF-8("moltnet:v1") || u32be(len(msgHash)) || SHA256(message) || u32be(len(nonceBytes)) || nonceBytes
func BuildSigningBytes(message, nonce string) []byte {
	msgHash := sha256.Sum256([]byte(message))
	nonceBytes := []byte(nonce)
	prefix := []byte(domainPrefix)

	buf := make([]byte, 0, len(prefix)+4+len(msgHash)+4+len(nonceBytes))
	buf = append(buf, prefix...)

	lenBuf := make([]byte, 4)
	binary.BigEndian.PutUint32(lenBuf, uint32(len(msgHash)))
	buf = append(buf, lenBuf...)

	buf = append(buf, msgHash[:]...)

	binary.BigEndian.PutUint32(lenBuf, uint32(len(nonceBytes)))
	buf = append(buf, lenBuf...)

	buf = append(buf, nonceBytes...)

	return buf
}

// @deprecated: use BuildSigningBytes + SignForRequest instead
// Sign signs a message with the given base64-encoded seed and returns a base64-encoded signature.
func Sign(message string, privateKeyBase64 string) (string, error) {
	seed, err := base64.StdEncoding.DecodeString(privateKeyBase64)
	if err != nil {
		return "", fmt.Errorf("decode private key: %w", err)
	}
	priv := ed25519.NewKeyFromSeed(seed)
	sig := ed25519.Sign(priv, []byte(message))
	return base64.StdEncoding.EncodeToString(sig), nil
}

// SignForRequest signs a (message, nonce) pair using BuildSigningBytes.
func SignForRequest(message, nonce, privateKeyBase64 string) (string, error) {
	seed, err := base64.StdEncoding.DecodeString(privateKeyBase64)
	if err != nil {
		return "", fmt.Errorf("decode private key: %w", err)
	}
	priv := ed25519.NewKeyFromSeed(seed)
	signingBytes := BuildSigningBytes(message, nonce)
	sig := ed25519.Sign(priv, signingBytes)
	return base64.StdEncoding.EncodeToString(sig), nil
}

// @deprecated: use VerifyForRequest instead
// Verify verifies a signature against a message and public key.
func Verify(message string, signatureBase64 string, publicKey string) (bool, error) {
	pubBytes, err := ParsePublicKey(publicKey)
	if err != nil {
		return false, err
	}
	sig, err := base64.StdEncoding.DecodeString(signatureBase64)
	if err != nil {
		return false, fmt.Errorf("decode signature: %w", err)
	}
	return ed25519.Verify(pubBytes, []byte(message), sig), nil
}

// VerifyForRequest verifies a signature produced by SignForRequest.
func VerifyForRequest(message, nonce, signatureBase64, publicKey string) (bool, error) {
	pubBytes, err := ParsePublicKey(publicKey)
	if err != nil {
		return false, err
	}
	sig, err := base64.StdEncoding.DecodeString(signatureBase64)
	if err != nil {
		return false, fmt.Errorf("decode signature: %w", err)
	}
	signingBytes := BuildSigningBytes(message, nonce)
	return ed25519.Verify(pubBytes, signingBytes, sig), nil
}

// ParsePublicKey extracts the raw bytes from an "ed25519:<base64>" string.
func ParsePublicKey(publicKey string) (ed25519.PublicKey, error) {
	b64 := strings.TrimPrefix(publicKey, "ed25519:")
	pub, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		return nil, fmt.Errorf("decode public key: %w", err)
	}
	return ed25519.PublicKey(pub), nil
}
