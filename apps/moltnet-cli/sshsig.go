package main

import (
	"encoding/binary"
	"errors"
	"fmt"
)

// sshsigEnvelope is the PROTOCOL.sshsig blob ssh-keygen asks a signer to sign:
//
//	"SSHSIG" || string(namespace) || string(reserved) || string(hash_alg) || string(H(message))
//
// Parsing it lets the guest adapter and the host broker refuse anything but
// the namespace they serve instead of signing arbitrary bytes.
type sshsigEnvelope struct {
	Namespace     string
	Reserved      []byte
	HashAlgorithm string
	Digest        []byte
}

var sshsigMagic = []byte("SSHSIG")

var sshsigDigestLengths = map[string]int{"sha256": 32, "sha512": 64}

func readSSHString(b []byte, offset int) ([]byte, int, error) {
	if offset+4 > len(b) {
		return nil, 0, errors.New("SSHSIG envelope truncated")
	}
	n := int(binary.BigEndian.Uint32(b[offset:]))
	start := offset + 4
	if start+n > len(b) {
		return nil, 0, errors.New("SSHSIG envelope truncated")
	}
	return b[start : start+n], start + n, nil
}

func parseSshsigEnvelope(b []byte) (*sshsigEnvelope, error) {
	if len(b) < len(sshsigMagic) || string(b[:len(sshsigMagic)]) != string(sshsigMagic) {
		return nil, errors.New("SSHSIG magic missing")
	}
	offset := len(sshsigMagic)
	namespace, offset, err := readSSHString(b, offset)
	if err != nil {
		return nil, err
	}
	reserved, offset, err := readSSHString(b, offset)
	if err != nil {
		return nil, err
	}
	hashAlg, offset, err := readSSHString(b, offset)
	if err != nil {
		return nil, err
	}
	digest, offset, err := readSSHString(b, offset)
	if err != nil {
		return nil, err
	}
	if offset != len(b) {
		return nil, errors.New("SSHSIG envelope has trailing bytes")
	}
	expected, ok := sshsigDigestLengths[string(hashAlg)]
	if !ok {
		return nil, fmt.Errorf("SSHSIG hash algorithm %q unsupported", string(hashAlg))
	}
	if len(digest) != expected {
		return nil, fmt.Errorf("SSHSIG digest length %d does not match %s", len(digest), string(hashAlg))
	}
	return &sshsigEnvelope{
		Namespace:     string(namespace),
		Reserved:      reserved,
		HashAlgorithm: string(hashAlg),
		Digest:        digest,
	}, nil
}

// assertGitSshsigEnvelope pins the envelope to what `git commit -S` produces.
func assertGitSshsigEnvelope(env *sshsigEnvelope) error {
	if env.Namespace != "git" {
		return fmt.Errorf("SSHSIG namespace %q is not \"git\"", env.Namespace)
	}
	if len(env.Reserved) != 0 {
		return errors.New("SSHSIG reserved field must be empty")
	}
	if env.HashAlgorithm != "sha512" {
		return errors.New("SSHSIG git signatures must use sha512")
	}
	return nil
}
