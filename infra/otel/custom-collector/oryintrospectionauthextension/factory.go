package oryintrospectionauthextension

import (
	"context"

	"go.opentelemetry.io/collector/component"
	"go.opentelemetry.io/collector/extension"
)

// TypeStr is the YAML key used to reference this extension in the
// collector config. Must match the key under `extensions:`.
const TypeStr = "oryintrospectionauth"

// Type is the parsed component type used by the collector. Extracted as
// a package-level var because the collector API needs it in a few places.
var Type = component.MustNewType(TypeStr)

// NewFactory returns the extension factory registered with the collector
// builder (via `builder.yaml`). The factory is called once per extension
// instance in the config — each separate `oryintrospectionauth` block
// gets its own factory.create() invocation with its own Config.
func NewFactory() extension.Factory {
	return extension.NewFactory(
		Type,
		createDefaultConfig,
		createExtension,
		component.StabilityLevelAlpha,
	)
}

// createDefaultConfig is invoked by the collector when it needs a blank
// Config to unmarshal YAML into. Return a pointer to a zero-value struct
// with whatever sane defaults apply pre-validation.
func createDefaultConfig() component.Config {
	return &Config{
		// Intentionally leave required fields empty so Validate() fails
		// loudly if operators forget them.
		IntrospectionAuth: IntrospectionAuthConfig{Type: authTypeNone},
	}
}

// createExtension is invoked once per extension instance AFTER the YAML
// has been unmarshalled and Validate() has passed. Its job is to return
// a fully-wired component.
func createExtension(
	_ context.Context,
	settings extension.Settings,
	cfg component.Config,
) (extension.Extension, error) {
	c := cfg.(*Config)
	c.withDefaults()
	return newExtension(c, settings.Logger), nil
}
