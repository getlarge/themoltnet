package moltnetattributionprocessor

import (
	"context"

	"go.opentelemetry.io/collector/component"
	"go.opentelemetry.io/collector/consumer"
	"go.opentelemetry.io/collector/processor"
	"go.opentelemetry.io/collector/processor/processorhelper"
)

const TypeStr = "moltnetattribution"

var Type = component.MustNewType(TypeStr)

type Config struct{}

func NewFactory() processor.Factory {
	return processor.NewFactory(Type, func() component.Config { return &Config{} },
		processor.WithTraces(createTraces, component.StabilityLevelBeta),
		processor.WithLogs(createLogs, component.StabilityLevelBeta),
		processor.WithMetrics(createMetrics, component.StabilityLevelBeta))
}

func createTraces(ctx context.Context, settings processor.Settings, cfg component.Config, next consumer.Traces) (processor.Traces, error) {
	p, err := newAttributor(settings)
	if err != nil {
		return nil, err
	}
	return processorhelper.NewTraces(ctx, settings, cfg, next, p.processTraces)
}
func createLogs(ctx context.Context, settings processor.Settings, cfg component.Config, next consumer.Logs) (processor.Logs, error) {
	p, err := newAttributor(settings)
	if err != nil {
		return nil, err
	}
	return processorhelper.NewLogs(ctx, settings, cfg, next, p.processLogs)
}
func createMetrics(ctx context.Context, settings processor.Settings, cfg component.Config, next consumer.Metrics) (processor.Metrics, error) {
	p, err := newAttributor(settings)
	if err != nil {
		return nil, err
	}
	return processorhelper.NewMetrics(ctx, settings, cfg, next, p.processMetrics)
}
