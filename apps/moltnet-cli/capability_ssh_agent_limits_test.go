package main

import (
	"net"
	"testing"
	"time"

	"golang.org/x/crypto/ssh/agent"
)

func TestSSHAgentAdapterRefusesClientsBeyondTheCap(t *testing.T) {
	signer := newRecordingSigner(t)
	sock, _ := startAdapter(t, signer)

	// Hold the maximum number of idle connections open.
	held := make([]net.Conn, 0, sshAgentMaxClients)
	for i := 0; i < sshAgentMaxClients; i++ {
		c, err := net.Dial("unix", sock)
		if err != nil {
			t.Fatal(err)
		}
		held = append(held, c)
	}
	defer func() {
		for _, c := range held {
			_ = c.Close()
		}
	}()
	// Give the server a moment to admit them all.
	time.Sleep(100 * time.Millisecond)

	extra, err := net.Dial("unix", sock)
	if err != nil {
		t.Fatal(err)
	}
	defer extra.Close()
	_ = extra.SetDeadline(time.Now().Add(2 * time.Second))
	if _, err := agent.NewClient(extra).List(); err == nil {
		t.Fatal("expected the over-cap connection to be refused")
	}

	// Releasing one slot admits a new client.
	_ = held[0].Close()
	time.Sleep(100 * time.Millisecond)
	again, err := net.Dial("unix", sock)
	if err != nil {
		t.Fatal(err)
	}
	defer again.Close()
	if keys, err := agent.NewClient(again).List(); err != nil || len(keys) != 1 {
		t.Fatalf("expected the freed slot to serve: keys=%v err=%v", keys, err)
	}
}
