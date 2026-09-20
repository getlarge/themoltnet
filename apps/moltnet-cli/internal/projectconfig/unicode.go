package projectconfig

import (
	"errors"
	"strconv"
	"unicode/utf8"
)

// encoding/json replaces malformed surrogate escapes; reject before decoding
// so names and paths retain the same identity in JavaScript and Go.
func validateJSONUnicode(data []byte) error {
	fail := errors.New("strings must contain well-formed Unicode")
	if !utf8.Valid(data) {
		return fail
	}
	for i := 0; i < len(data); i++ {
		if data[i] != '\\' {
			continue
		}
		i++
		if i >= len(data) || data[i] != 'u' || i+4 >= len(data) {
			continue
		}
		value, err := strconv.ParseUint(string(data[i+1:i+5]), 16, 16)
		if err != nil {
			continue
		}
		i += 4
		if value >= 0xdc00 && value <= 0xdfff {
			return fail
		}
		if value < 0xd800 || value > 0xdbff {
			continue
		}
		if i+6 >= len(data) || data[i+1] != '\\' || data[i+2] != 'u' {
			return fail
		}
		low, err := strconv.ParseUint(string(data[i+3:i+7]), 16, 16)
		if err != nil || low < 0xdc00 || low > 0xdfff {
			return fail
		}
		i += 6
	}
	return nil
}
