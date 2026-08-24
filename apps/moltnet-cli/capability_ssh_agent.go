package main

import (
	"context"
	"crypto/ed25519"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"time"

	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/agent"
)

// sshAgentAdapter speaks the ssh-agent protocol for one identity key and
// forwards every signing request to the Signer after validating that the
// payload is a git-namespace SSHSIG envelope. Nothing can be added, removed,
// locked or unlocked: the agent is a protocol shim, not a key store.
type sshAgentAdapter struct {
	signer Signer
	pub    ssh.PublicKey
	email  string
}

var errAgentUnsupported = errors.New("operation not supported by the moltnet signing adapter")

const (
	sshAgentMaxClients   = 16
	sshAgentConnDeadline = 30 * time.Second
)

func newSSHAgentAdapter(ctx context.Context, signer Signer) (*sshAgentAdapter, error) {
	identity, err := signer.Identity(ctx)
	if err != nil {
		return nil, err
	}
	raw, err := ParsePublicKey(identity.PublicKey)
	if err != nil {
		return nil, err
	}
	pub, err := ssh.NewPublicKey(ed25519.PublicKey(raw))
	if err != nil {
		return nil, err
	}
	return &sshAgentAdapter{signer: signer, pub: pub, email: identity.GitEmail}, nil
}

func (a *sshAgentAdapter) List() ([]*agent.Key, error) {
	return []*agent.Key{{Format: a.pub.Type(), Blob: a.pub.Marshal(), Comment: a.email}}, nil
}

func (a *sshAgentAdapter) Sign(key ssh.PublicKey, data []byte) (*ssh.Signature, error) {
	return a.SignWithFlags(key, data, 0)
}

func (a *sshAgentAdapter) SignWithFlags(key ssh.PublicKey, data []byte, _ agent.SignatureFlags) (*ssh.Signature, error) {
	if string(key.Marshal()) != string(a.pub.Marshal()) {
		return nil, errors.New("unknown key")
	}
	env, err := parseSshsigEnvelope(data)
	if err != nil {
		return nil, err
	}
	if err := assertGitSshsigEnvelope(env); err != nil {
		return nil, err
	}
	raw, err := a.signer.SignGitCommit(context.Background(), data)
	if err != nil {
		return nil, err
	}
	return &ssh.Signature{Format: a.pub.Type(), Blob: raw}, nil
}

func (a *sshAgentAdapter) Signers() ([]ssh.Signer, error) { return nil, errAgentUnsupported }
func (a *sshAgentAdapter) Add(agent.AddedKey) error       { return errAgentUnsupported }
func (a *sshAgentAdapter) Remove(ssh.PublicKey) error     { return errAgentUnsupported }
func (a *sshAgentAdapter) RemoveAll() error               { return errAgentUnsupported }
func (a *sshAgentAdapter) Lock([]byte) error              { return errAgentUnsupported }
func (a *sshAgentAdapter) Unlock([]byte) error            { return errAgentUnsupported }
func (a *sshAgentAdapter) Extension(string, []byte) ([]byte, error) {
	return nil, agent.ErrExtensionUnsupported
}

// serveSSHAgentAdapter listens on a unix socket (mode 0600) until ctx ends.
// onReady runs once the socket accepts connections.
func serveSSHAgentAdapter(ctx context.Context, signer Signer, socket string, onReady func()) error {
	adapter, err := newSSHAgentAdapter(ctx, signer)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(socket), 0o700); err != nil {
		return fmt.Errorf("create socket dir: %w", err)
	}
	_ = os.Remove(socket)
	listener, err := net.Listen("unix", socket)
	if err != nil {
		return fmt.Errorf("listen on %s: %w", socket, err)
	}
	if err := os.Chmod(socket, 0o600); err != nil {
		listener.Close()
		return err
	}
	go func() {
		<-ctx.Done()
		listener.Close()
	}()
	if onReady != nil {
		onReady()
	}
	// Bound what a guest can do with the socket: a small number of concurrent
	// clients, each with an idle deadline. ssh-keygen opens one short-lived
	// connection per signature; anything else is refused or timed out.
	slots := make(chan struct{}, sshAgentMaxClients)
	for {
		conn, err := listener.Accept()
		if err != nil {
			if ctx.Err() != nil {
				_ = os.Remove(socket)
				return nil
			}
			return err
		}
		select {
		case slots <- struct{}{}:
		default:
			_ = conn.Close()
			continue
		}
		go func() {
			defer func() { <-slots }()
			defer conn.Close()
			_ = conn.SetDeadline(time.Now().Add(sshAgentConnDeadline))
			_ = agent.ServeAgent(adapter, conn)
		}()
	}
}
