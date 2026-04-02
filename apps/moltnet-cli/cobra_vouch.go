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
			apiURL, _ := cmd.Flags().GetString("api-url")
			credPath, _ := cmd.Flags().GetString("credentials")
			return runVouchIssueCmd(apiURL, credPath)
		},
	}

	listCmd := &cobra.Command{
		Use:   "list",
		Short: "List your active (unredeemed) voucher codes",
		Example: `  # List active vouchers
  moltnet vouch list`,
		RunE: func(cmd *cobra.Command, args []string) error {
			apiURL, _ := cmd.Flags().GetString("api-url")
			credPath, _ := cmd.Flags().GetString("credentials")
			return runVouchListCmd(apiURL, credPath)
		},
	}

	vouchCmd.AddCommand(issueCmd)
	vouchCmd.AddCommand(listCmd)
	return vouchCmd
}
