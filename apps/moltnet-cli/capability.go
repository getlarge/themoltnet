package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"
)

// Host capabilities are served by the daemon through the sandbox proxy at
// https://<name>.moltnet.internal. These verbs are generic protocol glue: they
// carry no MoltNet semantics and no credentials.

const capabilityOriginSuffix = ".moltnet.internal"

func capabilityOrigin(name string) string {
	return "https://" + name + capabilityOriginSuffix
}

// validateCapabilityOverrideURL restricts the --url override to loopback so an
// argv-authorized `capability call` cannot be turned into a generic POST client
// to an arbitrary network-permitted origin. Production uses the derived
// https://<name>.moltnet.internal origin and needs no override.
func validateCapabilityOverrideURL(raw string) error {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return fmt.Errorf("--url must be an absolute URL, got %q", raw)
	}
	host := parsed.Hostname()
	if host == "127.0.0.1" || host == "localhost" || host == "::1" {
		return nil
	}
	return fmt.Errorf("--url override is restricted to loopback (got %q); production uses the derived capability origin", host)
}

// runCapabilityCallCmd POSTs a JSON body to one operation and prints the JSON
// response. baseURL overrides the derived origin (fixtures, non-Gondolin
// sandboxes); an empty baseURL means the conventional origin.
func runCapabilityCallCmd(w io.Writer, baseURL, name, operation, jsonBody string) error {
	if strings.TrimSpace(name) == "" || strings.TrimSpace(operation) == "" {
		return fmt.Errorf("capability name and operation are required")
	}
	body := strings.TrimSpace(jsonBody)
	if body == "" {
		body = "{}"
	}
	if !json.Valid([]byte(body)) {
		return fmt.Errorf("--json must be a JSON document")
	}
	origin := strings.TrimRight(baseURL, "/")
	if origin == "" {
		origin = capabilityOrigin(name)
	} else if err := validateCapabilityOverrideURL(origin); err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, origin+"/"+operation, bytes.NewReader([]byte(body)))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := (&http.Client{Timeout: 30 * time.Second}).Do(req)
	if err != nil {
		return fmt.Errorf("capability %s/%s: %w", name, operation, err)
	}
	defer res.Body.Close()
	payload, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		return err
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		code := "request_failed"
		var failure struct {
			Code string `json:"code"`
		}
		if json.Unmarshal(payload, &failure) == nil && failure.Code != "" {
			code = failure.Code
		}
		return &remoteSignerError{Code: code, Status: res.StatusCode}
	}
	var pretty bytes.Buffer
	if err := json.Indent(&pretty, payload, "", "  "); err != nil {
		_, err = w.Write(payload)
		return err
	}
	pretty.WriteByte('\n')
	_, err = w.Write(pretty.Bytes())
	return err
}

// runCapabilityServeCmd runs a protocol adapter for one capability until the
// process is signalled. Adapters translate a standard protocol (ssh-agent)
// into capability operations; they never hold key material.
func runCapabilityServeCmd(ctx context.Context, name, adapter, socket string) error {
	ctx, stop := signal.NotifyContext(ctx, os.Interrupt, syscall.SIGTERM)
	defer stop()
	switch adapter {
	case "ssh-agent":
		if name != "agent-signing" {
			return fmt.Errorf("the ssh-agent adapter serves the agent-signing capability, got %q", name)
		}
		signer, err := resolveSigner("")
		if err != nil {
			return err
		}
		return serveSSHAgentAdapter(ctx, signer, socket, func() {
			fmt.Fprintf(os.Stderr, "ssh-agent adapter listening on %s\n", socket)
		})
	default:
		return fmt.Errorf("unknown adapter %q (supported: ssh-agent)", adapter)
	}
}
