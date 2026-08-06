package main

import (
	"encoding/json"

	"github.com/getlarge/themoltnet/apps/moltnet-cli/internal/safefile"
)

const privateFileMode = safefile.PrivateMode

func writeFileAtomic(path string, data []byte) error {
	return safefile.Write(path, data)
}

func writeJSONAtomic(path string, value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return writeFileAtomic(path, append(data, '\n'))
}
