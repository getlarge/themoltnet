package moltnetattributionprocessor

import (
	"context"
	"testing"

	authn "github.com/getlarge/themoltnet/libs/moltnet-authn"
	"go.opentelemetry.io/collector/client"
	"go.opentelemetry.io/collector/consumer/consumererror"
	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/plog"
	"go.opentelemetry.io/collector/pdata/pmetric"
	"go.opentelemetry.io/collector/pdata/ptrace"
	"go.opentelemetry.io/otel/metric/noop"
)

type authData map[string]any

func (a authData) GetAttribute(name string) any { return a[name] }
func (a authData) GetAttributeNames() []string {
	result := make([]string, 0, len(a))
	for key := range a {
		result = append(result, key)
	}
	return result
}
func trustedContext() context.Context {
	return client.NewContext(context.Background(), client.Info{Auth: authData{"moltnet.identity_id": "trusted-agent"}})
}
func testAttributor(t *testing.T) *attributor {
	t.Helper()
	meter := noop.NewMeterProvider().Meter("test")
	conflicts, _ := meter.Int64Counter("conflicts")
	rejected, _ := meter.Int64Counter("rejected")
	return &attributor{conflicts: conflicts, rejected: rejected}
}

func TestAllSignalsOverwriteSpoofedIdentity(t *testing.T) {
	p := testAttributor(t)
	ctx := trustedContext()
	traces := ptrace.NewTraces()
	tr := traces.ResourceSpans().AppendEmpty()
	tr.Resource().Attributes().PutStr(agentIDKey, "spoofed")
	span := tr.ScopeSpans().AppendEmpty().Spans().AppendEmpty()
	span.Attributes().PutStr(agentIDKey, "span-spoofed")
	event := span.Events().AppendEmpty()
	event.Attributes().PutStr(agentIDKey, "event-spoofed")
	link := span.Links().AppendEmpty()
	link.Attributes().PutStr(agentIDKey, "link-spoofed")
	if _, err := p.processTraces(ctx, traces); err != nil {
		t.Fatal(err)
	}
	value, _ := tr.Resource().Attributes().Get(agentIDKey)
	if value.Str() != "trusted-agent" {
		t.Fatal("trace identity not replaced")
	}
	value, _ = span.Attributes().Get(agentIDKey)
	if value.Str() != "trusted-agent" {
		t.Fatal("span identity not replaced")
	}
	if value, _ = event.Attributes().Get(agentIDKey); value.Str() != "trusted-agent" {
		t.Fatal("span event identity not replaced")
	}
	if value, _ = link.Attributes().Get(agentIDKey); value.Str() != "trusted-agent" {
		t.Fatal("span link identity not replaced")
	}
	logs := plog.NewLogs()
	lr := logs.ResourceLogs().AppendEmpty()
	lr.Resource().Attributes().PutStr(agentIDKey, "spoofed")
	ls := lr.ScopeLogs().AppendEmpty()
	ls.Scope().Attributes().PutStr(agentIDKey, "scope-spoofed")
	record := ls.LogRecords().AppendEmpty()
	record.Attributes().PutStr(agentIDKey, "record-spoofed")
	if _, err := p.processLogs(ctx, logs); err != nil {
		t.Fatal(err)
	}
	value, _ = lr.Resource().Attributes().Get(agentIDKey)
	if value.Str() != "trusted-agent" {
		t.Fatal("log identity not replaced")
	}
	if value, _ = ls.Scope().Attributes().Get(agentIDKey); value.Str() != "trusted-agent" {
		t.Fatal("log scope identity not replaced")
	}
	if value, _ = record.Attributes().Get(agentIDKey); value.Str() != "trusted-agent" {
		t.Fatal("log record identity not replaced")
	}
	metrics := pmetric.NewMetrics()
	mr := metrics.ResourceMetrics().AppendEmpty()
	mr.Resource().Attributes().PutStr(agentIDKey, "spoofed")
	ms := mr.ScopeMetrics().AppendEmpty()
	ms.Scope().Attributes().PutStr(agentIDKey, "scope-spoofed")
	metricItem := ms.Metrics().AppendEmpty()
	metricItem.SetEmptyGauge().DataPoints().AppendEmpty().Attributes().PutStr(agentIDKey, "point-spoofed")
	if _, err := p.processMetrics(ctx, metrics); err != nil {
		t.Fatal(err)
	}
	value, _ = mr.Resource().Attributes().Get(agentIDKey)
	if value.Str() != "trusted-agent" {
		t.Fatal("metric identity not replaced")
	}
	if value, _ = ms.Scope().Attributes().Get(agentIDKey); value.Str() != "trusted-agent" {
		t.Fatal("metric scope identity not replaced")
	}
	if value, _ = metricItem.Gauge().DataPoints().At(0).Attributes().Get(agentIDKey); value.Str() != "trusted-agent" {
		t.Fatal("metric point identity not replaced")
	}
}

func TestMetricsRemoveTaskDimensionsOnly(t *testing.T) {
	p := testAttributor(t)
	metrics := pmetric.NewMetrics()
	resource := metrics.ResourceMetrics().AppendEmpty()
	resource.Resource().Attributes().PutStr("taskId", "resource-task")
	scope := resource.ScopeMetrics().AppendEmpty()
	scope.Scope().Attributes().PutStr("task_id", "scope-task")
	scope.Scope().Attributes().PutStr(agentIDKey, "scope-spoofed")
	metricItem := scope.Metrics().AppendEmpty()
	metricItem.SetName("requests")
	point := metricItem.SetEmptyGauge().DataPoints().AppendEmpty()
	point.Attributes().PutStr("moltnet.task.id", "point-task")
	exemplar := point.Exemplars().AppendEmpty()
	exemplar.FilteredAttributes().PutStr("task.id", "exemplar-task")
	exemplar.FilteredAttributes().PutStr(agentIDKey, "exemplar-spoofed")
	if _, err := p.processMetrics(trustedContext(), metrics); err != nil {
		t.Fatal(err)
	}
	if _, ok := resource.Resource().Attributes().Get("taskId"); ok {
		t.Fatal("resource task ID retained")
	}
	if _, ok := point.Attributes().Get("moltnet.task.id"); ok {
		t.Fatal("point task ID retained")
	}
	if _, ok := scope.Scope().Attributes().Get("task_id"); ok {
		t.Fatal("scope task ID retained")
	}
	if value, ok := scope.Scope().Attributes().Get(agentIDKey); !ok || value.Str() != "trusted-agent" {
		t.Fatal("scope identity not replaced")
	}
	if _, ok := exemplar.FilteredAttributes().Get("task.id"); ok {
		t.Fatal("exemplar task ID retained")
	}
	if value, ok := exemplar.FilteredAttributes().Get(agentIDKey); !ok || value.Str() != "trusted-agent" {
		t.Fatal("exemplar identity not replaced")
	}

	traces := ptrace.NewTraces()
	span := traces.ResourceSpans().AppendEmpty().ScopeSpans().AppendEmpty().Spans().AppendEmpty()
	span.Attributes().PutStr("taskId", "kept")
	if _, err := p.processTraces(trustedContext(), traces); err != nil {
		t.Fatal(err)
	}
	if value, ok := span.Attributes().Get("taskId"); !ok || value.Str() != "kept" {
		t.Fatal("trace task correlation removed")
	}
	logs := plog.NewLogs()
	record := logs.ResourceLogs().AppendEmpty().ScopeLogs().AppendEmpty().LogRecords().AppendEmpty()
	record.Attributes().PutStr("task_id", "kept")
	if _, err := p.processLogs(trustedContext(), logs); err != nil {
		t.Fatal(err)
	}
	if value, ok := record.Attributes().Get("task_id"); !ok || value.Str() != "kept" {
		t.Fatal("log task correlation removed")
	}
}

func TestAllMetricTypesRemoveTaskDimensions(t *testing.T) {
	metricAttributes := []struct {
		name string
		add  func(pmetric.Metric) pcommon.Map
	}{
		{"gauge", func(metric pmetric.Metric) pcommon.Map {
			return metric.SetEmptyGauge().DataPoints().AppendEmpty().Attributes()
		}},
		{"sum", func(metric pmetric.Metric) pcommon.Map {
			return metric.SetEmptySum().DataPoints().AppendEmpty().Attributes()
		}},
		{"histogram", func(metric pmetric.Metric) pcommon.Map {
			return metric.SetEmptyHistogram().DataPoints().AppendEmpty().Attributes()
		}},
		{"exponential histogram", func(metric pmetric.Metric) pcommon.Map {
			return metric.SetEmptyExponentialHistogram().DataPoints().AppendEmpty().Attributes()
		}},
		{"summary", func(metric pmetric.Metric) pcommon.Map {
			return metric.SetEmptySummary().DataPoints().AppendEmpty().Attributes()
		}},
	}

	for _, tc := range metricAttributes {
		t.Run(tc.name, func(t *testing.T) {
			metrics := pmetric.NewMetrics()
			metricItem := metrics.ResourceMetrics().AppendEmpty().ScopeMetrics().AppendEmpty().Metrics().AppendEmpty()
			attrs := tc.add(metricItem)
			attrs.PutStr("task.id", "remove-me")
			attrs.PutStr(agentIDKey, "spoofed")

			if _, err := testAttributor(t).processMetrics(trustedContext(), metrics); err != nil {
				t.Fatal(err)
			}
			if _, ok := attrs.Get("task.id"); ok {
				t.Fatal("task dimension retained")
			}
			if value, ok := attrs.Get(agentIDKey); !ok || value.Str() != "trusted-agent" {
				t.Fatal("metric identity not replaced")
			}
		})
	}
}

func TestRejectsMissingTrustedContext(t *testing.T) {
	contexts := []struct {
		name string
		ctx  context.Context
	}{
		{"missing auth", context.Background()},
		{"empty identity", client.NewContext(context.Background(), client.Info{Auth: authData{authn.IdentityIDAttribute: ""}})},
	}
	for _, tc := range contexts {
		t.Run(tc.name, func(t *testing.T) {
			processor := testAttributor(t)
			errors := []error{}
			_, err := processor.processTraces(tc.ctx, ptrace.NewTraces())
			errors = append(errors, err)
			_, err = processor.processLogs(tc.ctx, plog.NewLogs())
			errors = append(errors, err)
			_, err = processor.processMetrics(tc.ctx, pmetric.NewMetrics())
			errors = append(errors, err)
			for _, signalErr := range errors {
				if signalErr == nil {
					t.Fatal("untrusted signal accepted")
				}
				if !consumererror.IsPermanent(signalErr) {
					t.Fatalf("missing auth context must not be retried: %v", signalErr)
				}
			}
		})
	}
}
