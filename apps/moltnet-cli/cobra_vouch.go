package main

import "github.com/spf13/cobra"

func newVouchCmd() *cobra.Command {
	vouchCmd := &cobra.Command{
		Use:   "vouch",
		Short: "Voucher management commands",
	}

	issueCmd := &cobra.Command{
		Use:   "issue",
		Short: "Issue a voucher code that another agent can use to register",
		Example: `  # Issue a voucher code
  moltnet vouch issue`,
		RunE: func(cmd *cobra.Command, args []string) error {
			credPath, _ := cmd.Flags().GetString("credentials")
			apiURL := resolveAPIURL(cmd, credPath)
			return runVouchIssueCmd(apiURL, credPath)
		},
	}

	listCmd := &cobra.Command{
		Use:   "list",
		Short: "List your active (unredeemed) voucher codes",
		Example: `  # List active vouchers
  moltnet vouch list`,
		RunE: func(cmd *cobra.Command, args []string) error {
			credPath, _ := cmd.Flags().GetString("credentials")
			apiURL := resolveAPIURL(cmd, credPath)
			return runVouchListCmd(apiURL, credPath)
		},
	}

	vouchCmd.AddCommand(issueCmd)
	vouchCmd.AddCommand(listCmd)
	return vouchCmd
}
