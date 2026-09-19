package projectconfig

import "os"

// Windows access is controlled by ACLs rather than POSIX uid/mode bits.
func validateOwner(info os.FileInfo) error { return nil }
