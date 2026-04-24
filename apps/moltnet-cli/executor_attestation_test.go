package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

type executorAttestationVectorFile struct {
	Vectors []struct {
		Name            string         `json:"name"`
		Payload         map[string]any `json:"payload"`
		Canonical       string         `json:"canonical"`
		SHA256          string         `json:"sha256"`
		SigningBytesHex string         `json:"signingBytesHex"`
	} `json:"vectors"`
}

func TestExecutorAttestationVectors(t *testing.T) {
	path := filepath.Join("..", "..", "test-vectors", "executor-attestation-v1.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var vf executorAttestationVectorFile
	if err := json.Unmarshal(raw, &vf); err != nil {
		t.Fatal(err)
	}

	for _, vector := range vf.Vectors {
		t.Run(vector.Name, func(t *testing.T) {
			canonical, err := CanonicalJSON(vector.Payload)
			if err != nil {
				t.Fatal(err)
			}
			if canonical != vector.Canonical {
				t.Fatalf("canonical mismatch\n got: %s\nwant: %s", canonical, vector.Canonical)
			}

			hash := sha256.Sum256([]byte(canonical))
			if got := hex.EncodeToString(hash[:]); got != vector.SHA256 {
				t.Fatalf("sha256 mismatch\n got: %s\nwant: %s", got, vector.SHA256)
			}

			signingBytes, err := BuildExecutorAttestationSigningBytes(vector.Payload)
			if err != nil {
				t.Fatal(err)
			}
			if got := hex.EncodeToString(signingBytes); got != vector.SigningBytesHex {
				t.Fatalf("signing bytes mismatch\n got: %s\nwant: %s", got, vector.SigningBytesHex)
			}
		})
	}
}

func TestExecutorAttestationSignatureRoundTrip(t *testing.T) {
	kp, err := KeyPairFromSeed([]byte("12345678901234567890123456789012"))
	if err != nil {
		t.Fatal(err)
	}
	payload := BuildExecutorClaimAttestationPayload(
		"11111111-1111-4111-8111-111111111111",
		"bafkclaim",
	)

	sig, err := SignExecutorAttestation(payload, kp.PrivateKey)
	if err != nil {
		t.Fatal(err)
	}
	valid, err := VerifyExecutorAttestation(payload, sig, kp.PublicKey)
	if err != nil {
		t.Fatal(err)
	}
	if !valid {
		t.Fatal("expected signature to verify")
	}
}
