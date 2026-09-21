package projectconfig

import "github.com/getlarge/themoltnet/apps/moltnet-cli/internal/configdir"

func canonicalDiskPath(path string) (string, error) {
	return configdir.CanonicalExisting(path)
}
