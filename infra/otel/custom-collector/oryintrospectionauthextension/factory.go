package oryintrospectionauthextension

import (
	"context"

	"go.opentelemetry.io/collector/component"
	"go.opentelemetry.io/collector/extension"
)

const TypeStr = "oryintrospectionauth"

var Type = component.MustNewType(TypeStr)

func NewFactory() extension.Factory {
	return extension.NewFactory(
		Type,
		createDefaultConfig,
		createExtension,
		component.StabilityLevelAlpha,
	)
}

func createDefaultConfig() component.Config {
	return &Config{
		IntrospectionAuth: IntrospectionAuthConfig{Type: authTypeNone},
	}
}

func createExtension(
	_ context.Context,
	settings extension.Settings,
	cfg component.Config,
) (extension.Extension, error) {
	c := cfg.(*Config)
	c.withDefaults()
	return newExtension(c, settings.Logger), nil
}
