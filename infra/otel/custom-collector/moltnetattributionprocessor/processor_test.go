package moltnetattributionprocessor

import (
	"context"
	"testing"

	"go.opentelemetry.io/collector/client"
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
	logs := plog.NewLogs()
	lr := logs.ResourceLogs().AppendEmpty()
	lr.Resource().Attributes().PutStr(agentIDKey, "spoofed")
	if _, err := p.processLogs(ctx, logs); err != nil {
		t.Fatal(err)
	}
	value, _ = lr.Resource().Attributes().Get(agentIDKey)
	if value.Str() != "trusted-agent" {
		t.Fatal("log identity not replaced")
	}
	metrics := pmetric.NewMetrics()
	mr := metrics.ResourceMetrics().AppendEmpty()
	mr.Resource().Attributes().PutStr(agentIDKey, "spoofed")
	if _, err := p.processMetrics(ctx, metrics); err != nil {
		t.Fatal(err)
	}
	value, _ = mr.Resource().Attributes().Get(agentIDKey)
	if value.Str() != "trusted-agent" {
		t.Fatal("metric identity not replaced")
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

	traces := ptrace.NewTraces()
	span := traces.ResourceSpans().AppendEmpty().ScopeSpans().AppendEmpty().Spans().AppendEmpty()
	span.Attributes().PutStr("taskId", "kept")
	if _, err := p.processTraces(trustedContext(), traces); err != nil {
		t.Fatal(err)
	}
	if value, ok := span.Attributes().Get("taskId"); !ok || value.Str() != "kept" {
		t.Fatal("trace task correlation removed")
	}
}

func TestRejectsMissingTrustedContext(t *testing.T) {
	if _, err := testAttributor(t).processTraces(context.Background(), ptrace.NewTraces()); err == nil {
		t.Fatal("missing auth context accepted")
	}
}
