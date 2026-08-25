package main

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"errors"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/crypto/ssh"

	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
	"golang.org/x/crypto/ssh/agent"
)

// recordingSigner signs with a local key and records envelopes it was given.
type recordingSigner struct {
	priv      ed25519.PrivateKey
	identity  SignerIdentity
	envelopes [][]byte
	fail      error
}

func newRecordingSigner(t *testing.T) *recordingSigner {
	t.Helper()
	kp, err := GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}
	seed, _ := base64.StdEncoding.DecodeString(kp.PrivateKey)
	return &recordingSigner{
		priv: ed25519.NewKeyFromSeed(seed),
		identity: SignerIdentity{
			AgentName: "legreffier", IdentityID: "id", PublicKey: kp.PublicKey,
			Fingerprint: kp.Fingerprint, GitName: "LeGreffier", GitEmail: "l@x",
		},
	}
}

func (r *recordingSigner) Identity(context.Context) (SignerIdentity, error) { return r.identity, nil }
func (r *recordingSigner) SignDiaryEntry(context.Context, *moltnetapi.Client, string) (string, error) {
	return "", errors.New("not used")
}
func (r *recordingSigner) SignGitCommit(_ context.Context, sshsig []byte) ([]byte, error) {
	if r.fail != nil {
		return nil, r.fail
	}
	r.envelopes = append(r.envelopes, sshsig)
	return ed25519.Sign(r.priv, sshsig), nil
}

func startAdapter(t *testing.T, signer Signer) (string, context.CancelFunc) {
	t.Helper()
	// macOS limits unix socket paths to 104 bytes; t.TempDir() is longer.
	dir, err := os.MkdirTemp("/tmp", "mns-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	sock := filepath.Join(dir, "signer.sock")
	ctx, cancel := context.WithCancel(context.Background())
	ready := make(chan error, 1)
	go func() { ready <- serveSSHAgentAdapter(ctx, signer, sock, func() { ready <- nil }) }()
	if err := <-ready; err != nil {
		t.Fatalf("serve: %v", err)
	}
	t.Cleanup(cancel)
	return sock, cancel
}

func TestSSHAgentAdapterListsOnlyTheIdentityKey(t *testing.T) {
	signer := newRecordingSigner(t)
	sock, _ := startAdapter(t, signer)
	conn, err := net.Dial("unix", sock)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	keys, err := agent.NewClient(conn).List()
	if err != nil {
		t.Fatal(err)
	}
	if len(keys) != 1 || keys[0].Format != "ssh-ed25519" || keys[0].Comment != "l@x" {
		t.Fatalf("unexpected keys %+v", keys)
	}
	pubSSH, _ := ToSSHPublicKey(signer.identity.PublicKey)
	if !strings.HasPrefix(pubSSH, keys[0].Format+" "+base64.StdEncoding.EncodeToString(keys[0].Blob)) {
		t.Fatal("listed key does not match the identity public key")
	}
}

func TestSSHAgentAdapterSignsGitEnvelopesOnly(t *testing.T) {
	signer := newRecordingSigner(t)
	sock, _ := startAdapter(t, signer)
	conn, err := net.Dial("unix", sock)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	client := agent.NewClient(conn)
	keys, _ := client.List()
	pub, _ := ssh.ParsePublicKey(keys[0].Blob)

	envelope := gitSshsigEnvelope()
	sig, err := client.Sign(pub, envelope)
	if err != nil {
		t.Fatalf("Sign: %v", err)
	}
	if sig.Format != "ssh-ed25519" || !bytes.Equal(signer.envelopes[0], envelope) {
		t.Fatalf("unexpected signature %+v", sig)
	}
	if err := pub.Verify(envelope, sig); err != nil {
		t.Fatalf("verify: %v", err)
	}

	fileEnvelope := bytes.Replace(envelope, []byte("\x00\x00\x00\x03git"), []byte("\x00\x00\x00\x04file"), 1)
	if _, err := client.Sign(pub, fileEnvelope); err == nil {
		t.Fatal("file namespace was signed")
	}
	if _, err := client.Sign(pub, []byte("not an envelope")); err == nil {
		t.Fatal("arbitrary bytes were signed")
	}
	if err := client.Add(agent.AddedKey{}); err == nil {
		t.Fatal("Add must be refused")
	}
}

func TestSSHAgentAdapterWorksWithSSHKeygen(t *testing.T) {
	if _, err := exec.LookPath("ssh-keygen"); err != nil {
		t.Skip("ssh-keygen not installed")
	}
	signer := newRecordingSigner(t)
	sock, _ := startAdapter(t, signer)
	dir := t.TempDir()
	pubSSH, _ := ToSSHPublicKey(signer.identity.PublicKey)
	pubPath := filepath.Join(dir, "id.pub")
	msgPath := filepath.Join(dir, "msg")
	signersPath := filepath.Join(dir, "allowed_signers")
	_ = os.WriteFile(pubPath, []byte(pubSSH+"\n"), 0o644)
	_ = os.WriteFile(msgPath, []byte("commit object"), 0o644)
	_ = os.WriteFile(signersPath, []byte("l@x namespaces=\"git\" "+pubSSH+"\n"), 0o644)

	sign := exec.Command("ssh-keygen", "-Y", "sign", "-n", "git", "-f", pubPath, "-U", msgPath)
	sign.Env = append(os.Environ(), "SSH_AUTH_SOCK="+sock)
	if out, err := sign.CombinedOutput(); err != nil {
		t.Fatalf("ssh-keygen sign: %v\n%s", err, out)
	}
	verify := exec.Command("ssh-keygen", "-Y", "verify", "-n", "git", "-f", signersPath, "-I", "l@x", "-s", msgPath+".sig")
	msg, _ := os.Open(msgPath)
	verify.Stdin = msg
	if out, err := verify.CombinedOutput(); err != nil {
		t.Fatalf("ssh-keygen verify: %v\n%s", err, out)
	}
	if len(signer.envelopes) != 1 {
		t.Fatalf("expected one brokered signature, got %d", len(signer.envelopes))
	}
}
