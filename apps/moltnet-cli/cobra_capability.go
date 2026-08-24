package main

import (
	"os"

	"github.com/spf13/cobra"
)

func newCapabilityCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "capability",
		Short: "Call or serve host capabilities inside a sandbox",
		Long: `Host capabilities are served by the trusted daemon through the sandbox
proxy at https://<name>.moltnet.internal. 'call' performs one operation;
'serve' runs a protocol adapter (for example an ssh-agent socket) that
forwards standard tooling to a capability. No key material is involved.`,
	}

	call := &cobra.Command{
		Use:   "call <name> <operation>",
		Short: "POST a JSON body to one capability operation",
		Args:  cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			return runCapabilityCallCmd(os.Stdout, flagString(cmd, "url"), args[0], args[1], flagString(cmd, "json"))
		},
	}
	call.Flags().String("json", "{}", "JSON request body")
	call.Flags().String("url", "", "Override the capability origin (default https://<name>.moltnet.internal)")

	serve := &cobra.Command{
		Use:   "serve <name>",
		Short: "Serve a protocol adapter for a capability",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			return runCapabilityServeCmd(cmd.Context(), args[0], flagString(cmd, "adapter"), flagString(cmd, "socket"))
		},
	}
	serve.Flags().String("adapter", "ssh-agent", "Adapter protocol (ssh-agent)")
	serve.Flags().String("socket", "/run/moltnet/signer.sock", "Unix socket path for socket adapters")

	cmd.AddCommand(call, serve)
	return cmd
}
