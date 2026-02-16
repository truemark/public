#!/usr/bin/env bash

set -euo pipefail
cd "$(dirname "${0}")/test" || exit 1
find . -name "node_modules" -exec rm -rf {} \;
find . -name ".npm_cache" -exec rm -rf {} \;

