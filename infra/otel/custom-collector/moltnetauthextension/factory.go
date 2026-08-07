package moltnetauthextension

import (
	"context"

	"go.opentelemetry.io/collector/component"
	"go.opentelemetry.io/collector/extension"
)

const TypeStr = "moltnetauth"

var Type = component.MustNewType(TypeStr)

func NewFactory() extension.Factory {
	return extension.NewFactory(Type, createDefaultConfig, createExtension, component.StabilityLevelBeta)
}

func createDefaultConfig() component.Config { cfg := &Config{}; cfg.withDefaults(); return cfg }

func createExtension(_ context.Context, settings extension.Settings, raw component.Config) (extension.Extension, error) {
	cfg := raw.(*Config)
	cfg.withDefaults()
	return newExtension(cfg, settings)
}
