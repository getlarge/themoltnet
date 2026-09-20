package main

import (
	"os"
	"path/filepath"

	"github.com/spf13/cobra"
)

type nativeProjectOptions struct {
	ConfigPath, Binding   string
	ConfigSet, BindingSet bool
}

func addNativeProjectFlags(cmd *cobra.Command) {
	cmd.Flags().String("config-file", "", "Project configuration file (overrides the launched session)")
	cmd.Flags().String("binding", "", "Project binding (overrides the launched session)")
}
func nativeProjectOptionsFromCommand(cmd *cobra.Command) nativeProjectOptions {
	config, _ := cmd.Flags().GetString("config-file")
	binding, _ := cmd.Flags().GetString("binding")
	return nativeProjectOptions{ConfigPath: config, Binding: binding, ConfigSet: cmd.Flags().Changed("config-file"), BindingSet: cmd.Flags().Changed("binding")}
}
func nativeProjectSelection(agentDir string, opts nativeProjectOptions) (string, string) {
	config, binding := "", ""
	// A launched session's selection belongs to that identity. Selecting another
	// identity must not inherit the previous identity's folder registration.
	if os.Getenv("MOLTNET_ACTIVE_IDENTITY") == filepath.Base(agentDir) {
		config, binding = os.Getenv("MOLTNET_PROJECT_CONFIG"), os.Getenv("MOLTNET_PROJECT_BINDING")
	}
	if opts.ConfigSet {
		config = opts.ConfigPath
		binding = ""
	}
	if opts.BindingSet {
		binding = opts.Binding
	}
	return config, binding
}
func resolveNativeProjectContext(agentDir, directory string, opts ...nativeProjectOptions) (resolvedContextBinding, error) {
	var option nativeProjectOptions
	if len(opts) > 0 {
		option = opts[0]
	}
	config, binding := nativeProjectSelection(agentDir, option)
	return resolveContextBindingWithProjectOptions(agentDir, directory, config, binding)
}
