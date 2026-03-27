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
		RunE: func(cmd *cobra.Command, args []string) error {
			apiURL, _ := cmd.Flags().GetString("api-url")
			return runVouchIssueCmd(apiURL)
		},
	}

	listCmd := &cobra.Command{
		Use:   "list",
		Short: "List your active (unredeemed) voucher codes",
		RunE: func(cmd *cobra.Command, args []string) error {
			apiURL, _ := cmd.Flags().GetString("api-url")
			return runVouchListCmd(apiURL)
		},
	}

	vouchCmd.AddCommand(issueCmd)
	vouchCmd.AddCommand(listCmd)
	return vouchCmd
}
