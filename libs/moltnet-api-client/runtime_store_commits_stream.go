package moltnetapi

import "io"

// Close releases the streamed commit response body. Call it after consuming
// ListRuntimeStoreCommitsOK.Data, including when parsing stops early.
func (s *ListRuntimeStoreCommitsOK) Close() error {
	if closer, ok := s.Data.(io.Closer); ok {
		return closer.Close()
	}
	return nil
}
