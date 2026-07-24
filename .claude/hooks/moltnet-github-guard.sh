#!/bin/sh
command -v moltnet >/dev/null 2>&1 || exit 0
moltnet github guard 2>/dev/null || true
