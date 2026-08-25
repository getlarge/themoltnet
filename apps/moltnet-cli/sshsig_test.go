package main

import (
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

type sshsigVectors struct {
	Valid []struct {
		Name           string `json:"name"`
		EnvelopeBase64 string `json:"envelopeBase64"`
		Namespace      string `json:"namespace"`
		HashAlgorithm  string `json:"hashAlgorithm"`
	} `json:"valid"`
	Invalid []struct {
		Name           string `json:"name"`
		EnvelopeBase64 string `json:"envelopeBase64"`
		Error          string `json:"error"`
	} `json:"invalid"`
	GitRejected []struct {
		Name           string `json:"name"`
		EnvelopeBase64 string `json:"envelopeBase64"`
		Error          string `json:"error"`
	} `json:"gitRejected"`
}

func loadSshsigVectors(t *testing.T) sshsigVectors {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("..", "..", "test-fixtures", "sshsig-vectors.json"))
	if err != nil {
		t.Fatalf("read vectors: %v", err)
	}
	var v sshsigVectors
	if err := json.Unmarshal(data, &v); err != nil {
		t.Fatalf("parse vectors: %v", err)
	}
	return v
}

func TestParseSshsigEnvelopeVectors(t *testing.T) {
	v := loadSshsigVectors(t)
	for _, tc := range v.Valid {
		raw, _ := base64.StdEncoding.DecodeString(tc.EnvelopeBase64)
		env, err := parseSshsigEnvelope(raw)
		if err != nil {
			t.Fatalf("%s: unexpected error %v", tc.Name, err)
		}
		want := 64
		if tc.HashAlgorithm == "sha256" {
			want = 32
		}
		if env.Namespace != tc.Namespace || env.HashAlgorithm != tc.HashAlgorithm || len(env.Digest) != want {
			t.Fatalf("%s: parsed %+v", tc.Name, env)
		}
	}
	for _, tc := range v.Invalid {
		raw, _ := base64.StdEncoding.DecodeString(tc.EnvelopeBase64)
		_, err := parseSshsigEnvelope(raw)
		if err == nil || err.Error() != tc.Error {
			t.Fatalf("%s: expected %q, got %v", tc.Name, tc.Error, err)
		}
	}
}

func TestAssertGitSshsigEnvelopeRejectsSharedVectors(t *testing.T) {
	v := loadSshsigVectors(t)
	for _, tc := range v.GitRejected {
		raw, _ := base64.StdEncoding.DecodeString(tc.EnvelopeBase64)
		env, err := parseSshsigEnvelope(raw)
		if err != nil {
			t.Fatalf("%s: envelope must parse: %v", tc.Name, err)
		}
		if err := assertGitSshsigEnvelope(env); err == nil || err.Error() != tc.Error {
			t.Fatalf("%s: expected %q, got %v", tc.Name, tc.Error, err)
		}
	}
}

func TestAssertGitSshsigEnvelope(t *testing.T) {
	v := loadSshsigVectors(t)
	gitRaw, _ := base64.StdEncoding.DecodeString(v.Valid[0].EnvelopeBase64)
	fileRaw, _ := base64.StdEncoding.DecodeString(v.Valid[1].EnvelopeBase64)
	gitEnv, _ := parseSshsigEnvelope(gitRaw)
	fileEnv, _ := parseSshsigEnvelope(fileRaw)
	if err := assertGitSshsigEnvelope(gitEnv); err != nil {
		t.Fatalf("git envelope rejected: %v", err)
	}
	if err := assertGitSshsigEnvelope(fileEnv); err == nil {
		t.Fatal("file namespace accepted")
	}
}
