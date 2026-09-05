package main

import (
	"fmt"

	"github.com/spf13/cobra"
)

func runUseCmd(cmd *cobra.Command, agentName string) error {
	path, err := identityCredentialsPath(agentName)
	if err != nil {
		return err
	}
	if !regularFileExists(path) {
		return fmt.Errorf("identity %q not found — run 'moltnet register --name %s'", agentName, agentName)
	}
	if err := writeIdentitySelector(agentName); err != nil {
		return err
	}
	fmt.Fprintf(cmd.OutOrStdout(), "Default identity set to %q\n", agentName)
	return nil
}
