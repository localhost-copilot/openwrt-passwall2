#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
lua tests/kill_switch_test.lua
lua tests/monitor_test.lua
python3 tests/kill_switch_apply_test.py
python3 tests/package_local_test.py
sh -n luci-app-passwall2/root/usr/share/passwall2/kill_switch.sh
sh -n luci-app-passwall2/root/etc/init.d/passwall2_guard
git diff --check
