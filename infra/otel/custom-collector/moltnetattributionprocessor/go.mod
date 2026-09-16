module github.com/getlarge/themoltnet/infra/otel/custom-collector/moltnetattributionprocessor

go 1.26.0

require (
	github.com/getlarge/themoltnet/libs/moltnet-authn v0.0.0
	go.opentelemetry.io/collector/client v1.67.0
	go.opentelemetry.io/collector/component v1.67.0
	go.opentelemetry.io/collector/consumer v1.67.0
	go.opentelemetry.io/collector/consumer/consumererror v0.161.0
	go.opentelemetry.io/collector/pdata v1.67.0
	go.opentelemetry.io/collector/processor v1.67.0
	go.opentelemetry.io/collector/processor/processorhelper v0.161.0
	go.opentelemetry.io/otel v1.46.0
	go.opentelemetry.io/otel/metric v1.46.0
)

replace github.com/getlarge/themoltnet/libs/moltnet-authn => ../../../../libs/moltnet-authn

require (
	github.com/cespare/xxhash/v2 v2.3.0 // indirect
	github.com/hashicorp/go-version v1.9.0 // indirect
	github.com/json-iterator/go v1.1.12 // indirect
	github.com/modern-go/concurrent v0.0.0-20180306012644-bacd9c7ef1dd // indirect
	github.com/modern-go/reflect2 v1.0.3-0.20250322232337-35a7c28c31ee // indirect
	github.com/ory/client-go v1.22.66 // indirect
	go.opentelemetry.io/collector/featuregate v1.67.0 // indirect
	go.opentelemetry.io/collector/internal/componentalias v0.161.0 // indirect
	go.opentelemetry.io/collector/pdata/pprofile v0.161.0 // indirect
	go.opentelemetry.io/collector/pipeline v1.67.0 // indirect
	go.opentelemetry.io/otel/trace v1.46.0 // indirect
	go.uber.org/multierr v1.11.0 // indirect
	go.uber.org/zap v1.28.0 // indirect
	golang.org/x/oauth2 v0.36.0 // indirect
	golang.org/x/sys v0.47.0 // indirect
	google.golang.org/genproto/googleapis/rpc v0.0.0-20260526163538-3dc84a4a5aaa // indirect
	google.golang.org/grpc v1.83.2 // indirect
	google.golang.org/protobuf v1.36.12 // indirect
)
