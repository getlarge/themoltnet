package main

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"io"

	"github.com/invopop/jsonschema"
)

const moltnetConfigSchemaURL = "https://api.themolt.net/schemas/moltnet-config/v1.json"
const jsonSchemaDraft2020_12 = "https://json-schema.org/draft/2020-12/schema"

//go:embed schema/moltnet-config.v1.json
var embeddedMoltnetConfigSchema []byte

func runConfigSchemaCmd(w io.Writer) error {
	_, err := w.Write(embeddedMoltnetConfigSchema)
	return err
}

func marshalMoltnetConfigSchema() ([]byte, error) {
	reflector := &jsonschema.Reflector{DoNotReference: true}
	schema := reflector.Reflect(&CredentialsFile{})
	schema.Version = jsonSchemaDraft2020_12
	schema.ID = jsonschema.ID(moltnetConfigSchemaURL)
	schema.Title = "MoltNet credentials file"
	schema.Description = "JSON Schema for moltnet.json agent credentials."

	data, err := json.MarshalIndent(schema, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("marshal schema: %w", err)
	}

	return append(data, '\n'), nil
}
