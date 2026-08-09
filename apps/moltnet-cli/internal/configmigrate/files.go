package configmigrate

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"

	"github.com/getlarge/themoltnet/apps/moltnet-cli/internal/safefile"
)

const privateFileMode = safefile.PrivateMode

func ReadPlan(path string, limit int64) (Plan, error) {
	data, err := ReadBoundedRegularFile(path, limit)
	if err != nil {
		return Plan{}, fmt.Errorf("read migration plan: %w", err)
	}
	var plan Plan
	if err := json.Unmarshal(data, &plan); err != nil {
		return Plan{}, fmt.Errorf("parse migration plan: %w", err)
	}
	return plan, nil
}

func WritePlan(path string, plan Plan) error {
	data, err := json.MarshalIndent(plan, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal migration plan: %w", err)
	}
	if err := safefile.Write(path, append(data, '\n')); err != nil {
		return fmt.Errorf("write migration plan: %w", err)
	}
	return nil
}

func ReadOptionalBoundedRegularFile(path string, limit int64) ([]byte, error) {
	data, err := ReadBoundedRegularFile(path, limit)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	return data, err
}

func ReadBoundedRegularFile(path string, limit int64) ([]byte, error) {
	return safefile.ReadBoundedRegularFile(path, limit)
}

func ReplaceRegularFileAtomic(path string, expected, updated []byte, limit int64) error {
	return safefile.Replace(path, expected, updated, limit)
}
