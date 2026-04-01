package main

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/sha512"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"math/big"
	"strings"

	"golang.org/x/crypto/chacha20poly1305"
	"golang.org/x/crypto/curve25519"
	"golang.org/x/crypto/hkdf"
)

const (
	envelopeVersion = 1
	algorithm       = "x25519-xchachapoly"
	hkdfInfo        = "moltnet:seal:v1"
)

// SealedEnvelope is the JSON envelope for encrypted messages.
type SealedEnvelope struct {
	V                 int    `json:"v"`
	EphemeralPublicKey string `json:"ephemeral_public_key"`
	Nonce             string `json:"nonce"`
	Ciphertext        string `json:"ciphertext"`
	Algorithm         string `json:"algorithm"`
}

// DeriveX25519PrivateKey derives an X25519 private key from an Ed25519 seed.
// Follows RFC 8032 §5.1.5: SHA-512(seed)[0:32] with RFC 7748 clamping.
func DeriveX25519PrivateKey(ed25519SeedBase64 string) (string, error) {
	seed, err := base64.StdEncoding.DecodeString(ed25519SeedBase64)
	if err != nil {
		return "", fmt.Errorf("decode seed: %w", err)
	}
	if len(seed) != 32 {
		return "", fmt.Errorf("seed must be 32 bytes, got %d", len(seed))
	}

	// SHA-512 expansion — same as what ed25519.NewKeyFromSeed does internally
	h := sha512.Sum512(seed)
	scalar := h[:32]

	// RFC 7748 clamping
	scalar[0] &= 248  // clear low 3 bits
	scalar[31] &= 127 // clear high bit
	scalar[31] |= 64  // set bit 254

	return base64.StdEncoding.EncodeToString(scalar), nil
}

// DeriveX25519PublicKey derives an X25519 public key from an Ed25519 public key.
// Uses the Edwards→Montgomery birational map via curve25519.X25519.
func DeriveX25519PublicKey(ed25519PublicKey string) (string, error) {
	b64 := strings.TrimPrefix(ed25519PublicKey, "ed25519:")
	edPubBytes, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		return "", fmt.Errorf("decode public key: %w", err)
	}
	if len(edPubBytes) != 32 {
		return "", fmt.Errorf("public key must be 32 bytes, got %d", len(edPubBytes))
	}

	// Edwards → Montgomery conversion
	// The conversion formula: u = (1 + y) / (1 - y) mod p
	// where y is the Ed25519 y-coordinate (the public key bytes encode y).
	montPub := edwardsToMontgomery(edPubBytes)

	return base64.StdEncoding.EncodeToString(montPub), nil
}

// edwardsToMontgomery converts an Ed25519 public key (compressed Edwards y-coordinate)
// to an X25519 public key (Montgomery u-coordinate).
// Formula: u = (1 + y) / (1 - y) mod p, where p = 2^255 - 19.
func edwardsToMontgomery(edPub []byte) []byte {
	// Work in field Fp where p = 2^255 - 19.
	// Ed25519 public key encodes the y-coordinate in little-endian with
	// the sign bit in the top bit of the last byte.
	// For the conversion we only need y (ignore sign bit).
	var y [32]byte
	copy(y[:], edPub)
	y[31] &= 0x7f // clear sign bit

	// u = (1 + y) * inverse(1 - y) mod p
	// Using the field arithmetic from curve25519 is tricky in Go stdlib,
	// so we use a different approach: derive X25519 pub from X25519 priv
	// is what curve25519.X25519 does, but that requires the private key.
	//
	// Instead, implement the field arithmetic directly using big integers
	// modulo p = 2^255 - 19.
	return edwardsToMontgomeryField(y[:])
}

// edwardsToMontgomeryField performs u = (1 + y) / (1 - y) mod p
// using big.Int field arithmetic. Not constant-time, but the input
// is a public key so timing leaks are not a concern here.
// p = 2^255 - 19.
func edwardsToMontgomeryField(yBytes []byte) []byte {
	// Import as little-endian integer
	// Reverse to big-endian for math/big
	yBE := make([]byte, 32)
	for i := 0; i < 32; i++ {
		yBE[i] = yBytes[31-i]
	}

	// p = 2^255 - 19
	p := new(big.Int).SetBit(new(big.Int), 255, 1)
	p.Sub(p, big.NewInt(19))

	y := new(big.Int).SetBytes(yBE)
	y.Mod(y, p)

	one := big.NewInt(1)

	// numerator = 1 + y
	num := new(big.Int).Add(one, y)
	num.Mod(num, p)

	// denominator = 1 - y
	den := new(big.Int).Sub(one, y)
	den.Mod(den, p)

	// u = num * den^(-1) mod p
	denInv := new(big.Int).ModInverse(den, p)
	u := new(big.Int).Mul(num, denInv)
	u.Mod(u, p)

	// Encode as 32-byte little-endian
	uBytes := u.Bytes() // big-endian
	result := make([]byte, 32)
	for i, b := range uBytes {
		result[len(uBytes)-1-i] = b
	}
	return result
}

// EncryptForAgent encrypts plaintext for a recipient identified by their Ed25519 public key.
// Uses ephemeral X25519 ECDH + HKDF-SHA256 + XChaCha20-Poly1305.
func EncryptForAgent(plaintext string, recipientEd25519PublicKey string) (string, error) {
	recipientX25519Pub, err := DeriveX25519PublicKey(recipientEd25519PublicKey)
	if err != nil {
		return "", fmt.Errorf("derive recipient X25519 key: %w", err)
	}
	recipientPubBytes, err := base64.StdEncoding.DecodeString(recipientX25519Pub)
	if err != nil {
		return "", fmt.Errorf("decode recipient X25519 key: %w", err)
	}

	return encryptWithEphemeral(plaintext, recipientPubBytes, nil, nil)
}

// encryptWithEphemeral encrypts with optional deterministic ephemeral key and nonce (for testing).
func encryptWithEphemeral(plaintext string, recipientX25519Pub []byte, ephPriv []byte, nonce []byte) (string, error) {
	// Generate or use provided ephemeral X25519 keypair
	if ephPriv == nil {
		ephPriv = make([]byte, 32)
		if _, err := rand.Read(ephPriv); err != nil {
			return "", fmt.Errorf("generate ephemeral key: %w", err)
		}
	}
	ephPub, err := curve25519.X25519(ephPriv, curve25519.Basepoint)
	if err != nil {
		return "", fmt.Errorf("ephemeral public key: %w", err)
	}

	// ECDH shared secret
	shared, err := curve25519.X25519(ephPriv, recipientX25519Pub)
	if err != nil {
		return "", fmt.Errorf("ECDH: %w", err)
	}

	// HKDF-SHA256: derive 32-byte key
	key, err := deriveKey(shared)
	if err != nil {
		return "", fmt.Errorf("HKDF: %w", err)
	}

	// Generate or use provided nonce (24 bytes for XChaCha20)
	if nonce == nil {
		nonce = make([]byte, chacha20poly1305.NonceSizeX)
		if _, err := rand.Read(nonce); err != nil {
			return "", fmt.Errorf("generate nonce: %w", err)
		}
	}

	// Encrypt with XChaCha20-Poly1305
	// AAD authenticates envelope metadata — prevents algorithm/version field swapping
	aad := []byte(fmt.Sprintf("%d:%s", envelopeVersion, algorithm))
	aead, err := chacha20poly1305.NewX(key)
	if err != nil {
		return "", fmt.Errorf("create cipher: %w", err)
	}
	ciphertext := aead.Seal(nil, nonce, []byte(plaintext), aad)

	envelope := SealedEnvelope{
		V:                 envelopeVersion,
		EphemeralPublicKey: base64.StdEncoding.EncodeToString(ephPub),
		Nonce:             base64.StdEncoding.EncodeToString(nonce),
		Ciphertext:        base64.StdEncoding.EncodeToString(ciphertext),
		Algorithm:         algorithm,
	}

	data, err := json.Marshal(envelope)
	if err != nil {
		return "", fmt.Errorf("marshal envelope: %w", err)
	}
	return string(data), nil
}

// DecryptFromAgent decrypts a sealed envelope using the recipient's Ed25519 private key seed.
func DecryptFromAgent(sealedEnvelopeJSON string, ed25519SeedBase64 string) (string, error) {
	var envelope SealedEnvelope
	if err := json.Unmarshal([]byte(sealedEnvelopeJSON), &envelope); err != nil {
		return "", fmt.Errorf("parse envelope: %w", err)
	}

	if envelope.V != envelopeVersion {
		return "", fmt.Errorf("unsupported envelope version: %d", envelope.V)
	}
	if envelope.Algorithm != algorithm {
		return "", fmt.Errorf("unsupported algorithm: %s", envelope.Algorithm)
	}

	ephPub, err := base64.StdEncoding.DecodeString(envelope.EphemeralPublicKey)
	if err != nil {
		return "", fmt.Errorf("decode ephemeral key: %w", err)
	}
	nonce, err := base64.StdEncoding.DecodeString(envelope.Nonce)
	if err != nil {
		return "", fmt.Errorf("decode nonce: %w", err)
	}
	ciphertext, err := base64.StdEncoding.DecodeString(envelope.Ciphertext)
	if err != nil {
		return "", fmt.Errorf("decode ciphertext: %w", err)
	}

	// Derive X25519 private key from Ed25519 seed
	x25519PrivB64, err := DeriveX25519PrivateKey(ed25519SeedBase64)
	if err != nil {
		return "", fmt.Errorf("derive X25519 key: %w", err)
	}
	x25519Priv, err := base64.StdEncoding.DecodeString(x25519PrivB64)
	if err != nil {
		return "", fmt.Errorf("decode X25519 key: %w", err)
	}

	// ECDH shared secret
	shared, err := curve25519.X25519(x25519Priv, ephPub)
	if err != nil {
		return "", fmt.Errorf("ECDH: %w", err)
	}

	// HKDF-SHA256
	key, err := deriveKey(shared)
	if err != nil {
		return "", fmt.Errorf("HKDF: %w", err)
	}

	// Decrypt — AAD must match what was used during encryption
	aad := []byte(fmt.Sprintf("%d:%s", envelope.V, envelope.Algorithm))
	aead, err := chacha20poly1305.NewX(key)
	if err != nil {
		return "", fmt.Errorf("create cipher: %w", err)
	}
	plaintext, err := aead.Open(nil, nonce, ciphertext, aad)
	if err != nil {
		return "", fmt.Errorf("decrypt: %w", err)
	}

	return string(plaintext), nil
}

// deriveKey uses HKDF-SHA256 to derive a 32-byte key from a shared secret.
// Salt is nil per RFC 5869 §3.1 — acceptable because the ECDH shared secret
// has full entropy from the ephemeral keypair.
func deriveKey(shared []byte) ([]byte, error) {
	hkdfReader := hkdf.New(sha256.New, shared, nil, []byte(hkdfInfo))
	key := make([]byte, 32)
	if _, err := io.ReadFull(hkdfReader, key); err != nil {
		return nil, err
	}
	return key, nil
}

func runEncryptCmd(w io.Writer, recipient string, args []string) error {
	if recipient == "" {
		return fmt.Errorf("recipient public key is required")
	}

	plaintext, err := readPayload(args)
	if err != nil {
		return err
	}

	sealed, err := EncryptForAgent(plaintext, recipient)
	if err != nil {
		return fmt.Errorf("encrypt: %w", err)
	}

	fmt.Fprintln(w, sealed)
	return nil
}

func runDecryptCmd(w io.Writer, credPath string, args []string) error {
	creds, err := loadCredentials(credPath)
	if err != nil {
		return err
	}

	sealedJSON, err := readPayload(args)
	if err != nil {
		return err
	}

	plaintext, err := DecryptFromAgent(sealedJSON, creds.Keys.PrivateKey)
	if err != nil {
		return fmt.Errorf("decrypt: %w", err)
	}

	fmt.Fprint(w, plaintext)
	return nil
}
