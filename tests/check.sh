#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
lua tests/kill_switch_test.lua
lua tests/monitor_test.lua
lua tests/monitor_history_test.lua
lua tests/monitor_collector_test.lua
node --check luci-app-passwall2/root/www/luci-static/resources/passwall2/monitor.js
node --check luci-app-passwall2/root/www/luci-static/resources/passwall2/monitor-chart.js
node --check luci-app-passwall2/root/www/luci-static/resources/passwall2/monitor-devices.js
node tests/monitor_dashboard_test.js
python3 tests/kill_switch_apply_test.py
python3 tests/package_local_test.py
sh -n luci-app-passwall2/root/usr/share/passwall2/kill_switch.sh
sh -n luci-app-passwall2/root/etc/init.d/passwall2_guard
sh -n luci-app-passwall2/root/etc/init.d/passwall2_history
git diff --check
