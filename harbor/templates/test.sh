#!/bin/bash
set -euo pipefail

export PATH="$HOME/.local/bin:$PATH"

# Judge is pre-installed at /opt/judge with node_modules (baked into image).
# Criteria are uploaded by Harbor into /tests/ at runtime.
exec node /opt/judge/judge.js
