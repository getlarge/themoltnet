package main

import (
	"embed"
	"encoding/json"
	"fmt"
	"io"

	"github.com/invopop/jsonschema"
)

const jsonSchemaDraft2020 = "https://json-schema.org/draft/2020-12/schema"

//go:embed schemas/moltnet-config-v1.schema.json
var schemaFS embed.FS

func runConfigSchemaCmd(w io.Writer) error {
	schema, err := schemaFS.ReadFile("schemas/moltnet-config-v1.schema.json")
	if err != nil {
		return fmt.Errorf("read embedded schema: %w", err)
	}
	_, err = w.Write(schema)
	if err != nil {
		return fmt.Errorf("write schema: %w", err)
	}
	return nil
}

func generateCredentialsSchemaJSON() ([]byte, error) {
	reflector := jsonschema.Reflector{
		DoNotReference:            true,
		AllowAdditionalProperties: false,
	}

	schema := reflector.Reflect(&CredentialsFile{})
	raw, err := json.Marshal(schema)
	if err != nil {
		return nil, fmt.Errorf("marshal generated schema: %w", err)
	}

	var doc map[string]any
	if err := json.Unmarshal(raw, &doc); err != nil {
		return nil, fmt.Errorf("unmarshal generated schema: %w", err)
	}

	doc["$schema"] = jsonSchemaDraft2020
	doc["$id"] = MoltnetConfigSchemaURL
	doc["title"] = "MoltNet Config"

	formatted, err := json.MarshalIndent(doc, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("marshal formatted schema: %w", err)
	}
	return append(formatted, '\n'), nil
}
