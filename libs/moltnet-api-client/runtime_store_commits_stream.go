package moltnetapi

import (
	"io"
	"sync"
)

// commitResponseStream keeps the request telemetry active while the caller
// consumes the body. EOF and explicit Close both release the response.
type commitResponseStream struct {
	io.ReadCloser
	onFinish func(error)
	once     sync.Once
	closeErr error
}

func (s *commitResponseStream) Read(p []byte) (int, error) {
	n, err := s.ReadCloser.Read(p)
	if err != nil {
		s.finish(err)
	}
	return n, err
}

func (s *commitResponseStream) Close() error {
	s.finish(nil)
	return s.closeErr
}

func (s *commitResponseStream) finish(readErr error) {
	s.once.Do(func() {
		s.closeErr = s.ReadCloser.Close()
		if readErr != nil && readErr != io.EOF {
			s.onFinish(readErr)
		} else {
			s.onFinish(s.closeErr)
		}
	})
}

// Close releases the streamed commit response body. Call it after consuming
// ListRuntimeStoreCommitsOK.Data, including when parsing stops early.
func (s *ListRuntimeStoreCommitsOK) Close() error {
	if closer, ok := s.Data.(io.Closer); ok {
		return closer.Close()
	}
	return nil
}
