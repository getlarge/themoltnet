// Package moltnetapi provides a generated Go client for the MoltNet REST API.
//
// The client is generated from apps/rest-api/public/openapi.json using ogen.
// The spec is preprocessed to convert TypeBox-style anyOf enum patterns to
// standard OpenAPI enum arrays before generation.
//
// To regenerate after the OpenAPI spec changes:
//
//go:generate go run ./cmd/normalize-spec ../../apps/rest-api/public/openapi.json openapi-normalized.json
//go:generate go run github.com/ogen-go/ogen/cmd/ogen@latest --target . --package moltnetapi --config ogen.yml --clean openapi-normalized.json
package moltnetapi
