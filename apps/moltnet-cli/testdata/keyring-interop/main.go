package main

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"

	"github.com/zalando/go-keyring"
)

const service = "themolt.net"

type request struct {
	Operation string `json:"operation"`
	Key       string `json:"key"`
	Value     string `json:"value,omitempty"`
}

type response struct {
	Found bool   `json:"found,omitempty"`
	Value string `json:"value,omitempty"`
}

func main() {
	var input request
	if err := json.NewDecoder(os.Stdin).Decode(&input); err != nil {
		fatal(err)
	}
	var output response
	var err error
	switch input.Operation {
	case "read":
		var value string
		value, err = keyring.Get(service, input.Key)
		if errors.Is(err, keyring.ErrNotFound) {
			err = nil
		} else if err == nil {
			output.Found = true
			output.Value = base64.StdEncoding.EncodeToString([]byte(value))
		}
	case "write":
		var value []byte
		value, err = base64.StdEncoding.DecodeString(input.Value)
		if err == nil {
			err = keyring.Set(service, input.Key, string(value))
		}
	case "delete":
		err = keyring.Delete(service, input.Key)
		if errors.Is(err, keyring.ErrNotFound) {
			err = nil
		}
	default:
		err = fmt.Errorf("unsupported operation %q", input.Operation)
	}
	if err != nil {
		fatal(err)
	}
	if err := json.NewEncoder(os.Stdout).Encode(output); err != nil {
		fatal(err)
	}
}

func fatal(err error) {
	fmt.Fprintln(os.Stderr, err)
	os.Exit(1)
}
