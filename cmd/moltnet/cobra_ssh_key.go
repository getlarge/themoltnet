package main

import "github.com/spf13/cobra"

func newSSHKeyCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "ssh-key",
		Short: "Export MoltNet identity as SSH key files",
		Long: `Export MoltNet Ed25519 identity as SSH key files.
Reads the keypair from moltnet.json and writes id_ed25519 and
id_ed25519.pub to the output directory.`,
		Example: `  moltnet ssh-key
  moltnet ssh-key --output-dir /path/to/keys
  moltnet ssh-key --credentials /path/to/moltnet.json`,
		RunE: func(cmd *cobra.Command, args []string) error {
			credPath, _ := cmd.Flags().GetString("credentials")
			outDir, _ := cmd.Flags().GetString("output-dir")
			return runSSHKeyExportCmd(credPath, outDir)
		},
	}

	cmd.Flags().String("output-dir", "", "Output directory for SSH keys (default: ~/.config/moltnet/ssh/)")

	return cmd
}
