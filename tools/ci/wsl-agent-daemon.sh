#!/usr/bin/env bash
set -euo pipefail

case "${1:-}" in
  setup)
    sudo apt-get update -qq
    sudo apt-get install -y --no-install-recommends ca-certificates curl git qemu-utils qemu-system-x86
    sudo rm -rf /usr/local/go
    curl -fsSL https://go.dev/dl/go1.25.0.linux-amd64.tar.gz | sudo tar -C /usr/local -xz
    sudo ln -sf /usr/local/go/bin/{go,gofmt} /usr/local/bin/
    go version
    curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
    sudo apt-get install -y --no-install-recommends nodejs
    corepack enable
    corepack prepare pnpm@10 --activate
    ;;
  bundle)
    cd ~/src/themoltnet
    pnpm install --frozen-lockfile
    pnpm exec nx run @moltnet/tools:test:agent-bundle
    pnpm exec nx run @themoltnet/agent-daemon:bundle
    node tools/release/agent-bundle/build.mjs --out dist/agent-bundle --pack-only
    archive=dist/agent-bundle/moltnet-agent-linux-x64.tar.gz
    MOLTNET_AGENT_ARCHIVE="$archive" MOLTNET_AGENT_ALLOW_UNSIGNED=1 MOLTNET_AGENT_ALLOW_UNVERIFIED=1 sh tools/release/agent-bundle/install.sh
    "$HOME/.local/bin/moltnet-agent" --help
    "$HOME/.local/bin/moltnet-agent" server --help
    if [ -e /dev/kvm ]; then echo 'KVM available'; else echo 'KVM unavailable; QEMU TCG fallback expected'; fi
    nohup "$HOME/.local/bin/moltnet-agent" server > "$HOME/moltnet-agent-server.log" 2>&1 &
    echo $! > "$HOME/moltnet-agent-server.pid"
    for _ in $(seq 1 30); do
      curl -fsS http://127.0.0.1:17374/health && break
      sleep 1
    done
    curl -fsS http://127.0.0.1:17374/health
    ;;
  integrations)
    cd ~/src/themoltnet
    export MOLTNET_PI_VM_INTEGRATION=1
    pnpm exec nx run @themoltnet/sandbox-gondolin:test-ci--src/vm-manager.integration.test.ts
    pnpm exec nx run @moltnet/execution-integrations:test-ci--src/gondolin.integration.test.ts
    ;;
  *)
    echo "usage: $0 {setup|bundle|integrations}" >&2
    exit 64
    ;;
esac
