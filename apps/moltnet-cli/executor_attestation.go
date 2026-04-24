package main

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strconv"
)

const executorAttestationDomain = "moltnet-task-executor-attestation-v1"
const executorAttestationVersion = "moltnet:task-executor-attestation:v1"

func BuildExecutorClaimAttestationPayload(taskID, executorFingerprint string) map[string]any {
	return map[string]any{
		"v":                   executorAttestationVersion,
		"phase":               "claim",
		"taskId":              taskID,
		"executorFingerprint": executorFingerprint,
	}
}

func BuildExecutorCompleteAttestationPayload(taskID string, attemptN int, outputCID, executorFingerprint string) map[string]any {
	return map[string]any{
		"v":                   executorAttestationVersion,
		"phase":               "complete",
		"taskId":              taskID,
		"attemptN":            attemptN,
		"outputCid":           outputCID,
		"executorFingerprint": executorFingerprint,
	}
}

func CanonicalJSON(v any) (string, error) {
	var buf bytes.Buffer
	if err := writeCanonicalJSON(&buf, v); err != nil {
		return "", err
	}
	return buf.String(), nil
}

func BuildExecutorAttestationSigningBytes(payload any) ([]byte, error) {
	canonical, err := CanonicalJSON(payload)
	if err != nil {
		return nil, err
	}
	payloadHash := sha256.Sum256([]byte(canonical))
	prefix := []byte(executorAttestationDomain)

	buf := make([]byte, 0, len(prefix)+4+len(payloadHash))
	buf = append(buf, prefix...)
	lenBuf := make([]byte, 4)
	binary.BigEndian.PutUint32(lenBuf, uint32(len(payloadHash)))
	buf = append(buf, lenBuf...)
	buf = append(buf, payloadHash[:]...)
	return buf, nil
}

func SignExecutorAttestation(payload any, privateKeyBase64 string) (string, error) {
	seed, err := base64.StdEncoding.DecodeString(privateKeyBase64)
	if err != nil {
		return "", fmt.Errorf("decode private key: %w", err)
	}
	signingBytes, err := BuildExecutorAttestationSigningBytes(payload)
	if err != nil {
		return "", err
	}
	priv := ed25519.NewKeyFromSeed(seed)
	sig := ed25519.Sign(priv, signingBytes)
	return base64.StdEncoding.EncodeToString(sig), nil
}

func VerifyExecutorAttestation(payload any, signatureBase64, publicKey string) (bool, error) {
	pubBytes, err := ParsePublicKey(publicKey)
	if err != nil {
		return false, err
	}
	sig, err := base64.StdEncoding.DecodeString(signatureBase64)
	if err != nil {
		return false, fmt.Errorf("decode signature: %w", err)
	}
	signingBytes, err := BuildExecutorAttestationSigningBytes(payload)
	if err != nil {
		return false, err
	}
	return ed25519.Verify(pubBytes, signingBytes, sig), nil
}

func writeCanonicalJSON(buf *bytes.Buffer, v any) error {
	switch value := v.(type) {
	case nil:
		buf.WriteString("null")
	case string:
		return writeJSONString(buf, value)
	case bool:
		if value {
			buf.WriteString("true")
		} else {
			buf.WriteString("false")
		}
	case int:
		buf.WriteString(strconv.Itoa(value))
	case int64:
		buf.WriteString(strconv.FormatInt(value, 10))
	case float64:
		if !isCanonicalFloat(value) {
			return fmt.Errorf("canonical JSON does not support non-finite numbers")
		}
		buf.WriteString(strconv.FormatFloat(value, 'f', -1, 64))
	case json.Number:
		buf.WriteString(value.String())
	case []any:
		buf.WriteByte('[')
		for i, item := range value {
			if i > 0 {
				buf.WriteByte(',')
			}
			if err := writeCanonicalJSON(buf, item); err != nil {
				return err
			}
		}
		buf.WriteByte(']')
	case map[string]any:
		keys := make([]string, 0, len(value))
		for key := range value {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		buf.WriteByte('{')
		for i, key := range keys {
			if i > 0 {
				buf.WriteByte(',')
			}
			if err := writeJSONString(buf, key); err != nil {
				return err
			}
			buf.WriteByte(':')
			if err := writeCanonicalJSON(buf, value[key]); err != nil {
				return err
			}
		}
		buf.WriteByte('}')
	default:
		return fmt.Errorf("canonical JSON does not support %T", v)
	}
	return nil
}

func writeJSONString(buf *bytes.Buffer, s string) error {
	enc := json.NewEncoder(buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(s); err != nil {
		return err
	}
	b := buf.Bytes()
	if len(b) > 0 && b[len(b)-1] == '\n' {
		buf.Truncate(len(b) - 1)
	}
	return nil
}

func isCanonicalFloat(v float64) bool {
	return !math.IsInf(v, 0) && !math.IsNaN(v)
}
