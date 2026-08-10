#!/usr/bin/env sh
# Novora 本地部署一键更新（Linux/macOS）：./update-local.sh
cd "$(dirname "$0")" || exit 1
npm run update:local
