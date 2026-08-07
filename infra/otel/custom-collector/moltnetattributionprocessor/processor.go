package moltnetattributionprocessor

import (
	"context"
	"errors"

	"go.opentelemetry.io/collector/client"
	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/plog"
	"go.opentelemetry.io/collector/pdata/pmetric"
	"go.opentelemetry.io/collector/pdata/ptrace"
	"go.opentelemetry.io/collector/processor"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
)

const agentIDKey = "moltnet.agent.id"

var taskIDKeys = []string{"moltnet.task.id", "task.id", "taskId", "task_id"}

type attributor struct {
	conflicts metric.Int64Counter
	rejected  metric.Int64Counter
}

func newAttributor(settings processor.Settings) (*attributor, error) {
	meter := settings.MeterProvider.Meter("github.com/getlarge/themoltnet/infra/otel/moltnetattribution")
	conflicts, err := meter.Int64Counter("moltnet.attribution.conflicts")
	if err != nil {
		return nil, err
	}
	rejected, err := meter.Int64Counter("moltnet.attribution.rejected")
	if err != nil {
		return nil, err
	}
	return &attributor{conflicts: conflicts, rejected: rejected}, nil
}

func trustedIdentity(ctx context.Context, rejected metric.Int64Counter, signal string) (string, error) {
	info := client.FromContext(ctx)
	if info.Auth == nil {
		rejected.Add(ctx, 1, metric.WithAttributes(attribute.String("signal", signal)))
		return "", errors.New("trusted MoltNet authentication context is required")
	}
	identity, ok := info.Auth.GetAttribute("moltnet.identity_id").(string)
	if !ok || identity == "" {
		rejected.Add(ctx, 1, metric.WithAttributes(attribute.String("signal", signal)))
		return "", errors.New("trusted MoltNet identity is required")
	}
	return identity, nil
}

func (p *attributor) setIdentity(ctx context.Context, attrs pcommon.Map, identity, signal string) {
	if current, ok := attrs.Get(agentIDKey); ok && current.Str() != identity {
		p.conflicts.Add(ctx, 1, metric.WithAttributes(attribute.String("signal", signal)))
	}
	attrs.PutStr(agentIDKey, identity)
}

func (p *attributor) replaceIdentityIfPresent(ctx context.Context, attrs pcommon.Map, identity, signal string) {
	if _, ok := attrs.Get(agentIDKey); !ok {
		return
	}
	p.setIdentity(ctx, attrs, identity, signal)
}

func (p *attributor) processTraces(ctx context.Context, data ptrace.Traces) (ptrace.Traces, error) {
	identity, err := trustedIdentity(ctx, p.rejected, "traces")
	if err != nil {
		return data, err
	}
	resources := data.ResourceSpans()
	for i := 0; i < resources.Len(); i++ {
		resource := resources.At(i)
		p.setIdentity(ctx, resource.Resource().Attributes(), identity, "traces")
		scopes := resource.ScopeSpans()
		for j := 0; j < scopes.Len(); j++ {
			scope := scopes.At(j)
			p.replaceIdentityIfPresent(ctx, scope.Scope().Attributes(), identity, "traces")
			spans := scope.Spans()
			for k := 0; k < spans.Len(); k++ {
				p.replaceIdentityIfPresent(ctx, spans.At(k).Attributes(), identity, "traces")
			}
		}
	}
	return data, nil
}
func (p *attributor) processLogs(ctx context.Context, data plog.Logs) (plog.Logs, error) {
	identity, err := trustedIdentity(ctx, p.rejected, "logs")
	if err != nil {
		return data, err
	}
	resources := data.ResourceLogs()
	for i := 0; i < resources.Len(); i++ {
		resource := resources.At(i)
		p.setIdentity(ctx, resource.Resource().Attributes(), identity, "logs")
		scopes := resource.ScopeLogs()
		for j := 0; j < scopes.Len(); j++ {
			scope := scopes.At(j)
			p.replaceIdentityIfPresent(ctx, scope.Scope().Attributes(), identity, "logs")
			records := scope.LogRecords()
			for k := 0; k < records.Len(); k++ {
				p.replaceIdentityIfPresent(ctx, records.At(k).Attributes(), identity, "logs")
			}
		}
	}
	return data, nil
}
func (p *attributor) processMetrics(ctx context.Context, data pmetric.Metrics) (pmetric.Metrics, error) {
	identity, err := trustedIdentity(ctx, p.rejected, "metrics")
	if err != nil {
		return data, err
	}
	resources := data.ResourceMetrics()
	for i := 0; i < resources.Len(); i++ {
		resource := resources.At(i)
		attrs := resource.Resource().Attributes()
		p.setIdentity(ctx, attrs, identity, "metrics")
		removeTaskIDDimensions(attrs)
		scopes := resource.ScopeMetrics()
		for j := 0; j < scopes.Len(); j++ {
			scope := scopes.At(j)
			scopeAttrs := scope.Scope().Attributes()
			removeTaskIDDimensions(scopeAttrs)
			p.replaceIdentityIfPresent(ctx, scopeAttrs, identity, "metrics")
			metrics := scope.Metrics()
			for k := 0; k < metrics.Len(); k++ {
				p.cleanMetric(ctx, metrics.At(k), identity)
			}
		}
	}
	return data, nil
}

// removeTaskIDDimensions prevents client-supplied task identifiers from
// becoming unbounded public metric dimensions. Traces and logs retain task IDs
// as client-supplied correlation data.
func removeTaskIDDimensions(attrs pcommon.Map) {
	for _, key := range taskIDKeys {
		attrs.Remove(key)
	}
}
func (p *attributor) cleanMetric(ctx context.Context, item pmetric.Metric, identity string) {
	switch item.Type() {
	case pmetric.MetricTypeGauge:
		points := item.Gauge().DataPoints()
		for i := 0; i < points.Len(); i++ {
			point := points.At(i)
			attrs := point.Attributes()
			removeTaskIDDimensions(attrs)
			p.replaceIdentityIfPresent(ctx, attrs, identity, "metrics")
			p.cleanExemplars(ctx, point.Exemplars(), identity)
		}
	case pmetric.MetricTypeSum:
		points := item.Sum().DataPoints()
		for i := 0; i < points.Len(); i++ {
			point := points.At(i)
			attrs := point.Attributes()
			removeTaskIDDimensions(attrs)
			p.replaceIdentityIfPresent(ctx, attrs, identity, "metrics")
			p.cleanExemplars(ctx, point.Exemplars(), identity)
		}
	case pmetric.MetricTypeHistogram:
		points := item.Histogram().DataPoints()
		for i := 0; i < points.Len(); i++ {
			point := points.At(i)
			attrs := point.Attributes()
			removeTaskIDDimensions(attrs)
			p.replaceIdentityIfPresent(ctx, attrs, identity, "metrics")
			p.cleanExemplars(ctx, point.Exemplars(), identity)
		}
	case pmetric.MetricTypeExponentialHistogram:
		points := item.ExponentialHistogram().DataPoints()
		for i := 0; i < points.Len(); i++ {
			point := points.At(i)
			attrs := point.Attributes()
			removeTaskIDDimensions(attrs)
			p.replaceIdentityIfPresent(ctx, attrs, identity, "metrics")
			p.cleanExemplars(ctx, point.Exemplars(), identity)
		}
	case pmetric.MetricTypeSummary:
		points := item.Summary().DataPoints()
		for i := 0; i < points.Len(); i++ {
			attrs := points.At(i).Attributes()
			removeTaskIDDimensions(attrs)
			p.replaceIdentityIfPresent(ctx, attrs, identity, "metrics")
		}
	}
}

func (p *attributor) cleanExemplars(ctx context.Context, exemplars pmetric.ExemplarSlice, identity string) {
	for i := 0; i < exemplars.Len(); i++ {
		attrs := exemplars.At(i).FilteredAttributes()
		removeTaskIDDimensions(attrs)
		p.replaceIdentityIfPresent(ctx, attrs, identity, "metrics")
	}
}
