# Cudy TR3000 deployment — 2026-10-20

## Theme update (r5)

The monitor inherits Aurora's palette for cards, controls, status badges and
canvas charts. Manual light/dark switching and device light/dark changes were
verified on the router without reloading the page. The 390px mobile layout has
no page overflow. Telemetry, proxy and guard status remain healthy.
Screenshots: `.build/monitor-light-r5.png` and `.build/monitor-dark-r5.png`.
Package checks and JavaScript syntax validation passed.

## Monitor update (r4)

The router now has app/Chinese packages 26.10.20-r4 and Xray 26.10.17.
The read-only monitor tab was verified in a real browser at desktop and
390px mobile widths, including authenticated access (anonymous API requests
return 403), safe rendering of device names, stale-data warnings, and pausing
all three polling loops while hidden. Proxy stop and restart, TCP/UDP fail
closed, and an unreachable-relay test passed; cached health does not mask a
stopped proxy. The ATT exit recovered after each test.

Bandix's traffic module is enabled with memory-only storage; DNS/connection
recording and rate limits remain off. Existing segmentation offloads were not
changed. System telemetry collection averaged 15 ms over ten target-router
calls after separating the slower device API. Bandix RSS was about 4 MiB;
these are spot measurements, not a throughput benchmark.

Final r4 IPKs are in `.build/packages/`. The pre-monitor configuration backup
is `.build/before-passwall2-monitor.tar.gz` (0600), including the previous
Bandix settings. Browser screenshots are `.build/monitor-desktop.png` and
`.build/monitor-mobile.png`. No full firmware build was triggered for this
update. The r3 notes and hashes below are retained as the previous deployment.

## Previous guard deployment (r3)

Installed `luci-app-passwall2` and Chinese translations at `26.10.20-r3`
on ImmortalWrt 24.10-SNAPSHOT, kernel 6.6.133, aarch64_cortex-a53.
The selected ATT Reality node and Xray 26.10.10 configuration were preserved.
Kill switch is enabled; trusted LAN defaults to br-lan. Software and hardware
flow offloading were already disabled and remain so. Segmentation offload
settings were not changed.

## Verified on the deployed router

- LuCI renders the Chinese controls and reports protection active. Actual
  browser Save & Apply disables the guard; enabling exposed the application
  lookup bug, fixed in r3 and verified through the same browser operation.
  The previous external guard protected clients during this toggle test.
- After removing the old guard, client TCP HTTPS and UDP STUN both report
  the ATT exit. Stopping PassWall2 blocks pinned-IP TCP and UDP; restarting
  restores both through ATT.
- A temporary output drop for the relay simulates an unreachable node.
  TCP, UDP STUN and a direct public-DNS query fail; removing the drop restores
  ATT access. The temporary test table was removed in a finally block.
- Firewall reload preserves the independent guard. TCP/UDP stop and recovery
  checks pass after reload.
- Full router reboot confirmed by uptime 88 seconds: guard enabled at S18,
  proxy automatically running, only the new guard present, DNS resolution
  works, TCP/UDP still use ATT, and LuCI shows the checked flag and active
  protection after a fresh login.
- Lua policy tests, LuaJIT compatibility, three apply-failure regression
  tests, shell syntax, translation format and nft validation pass.

These checks cover this IPv4 dedicated-router configuration. They do not
establish support for hostname nodes, shunt/chain configurations, other
firmware variants or vendor acceleration. No throughput target was measured
or claimed during deployment. This is a package deployment, not a firmware
upgrade or an SDK build.

## Artifacts and recovery

Packages are in ignored `.build/packages/`; two consecutive builds produce
identical bytes. SHA-256:

```
9864ae99b46466d4589f81445ef4f727a63329f6f921c4a1ac9336c4d2c077e5  luci-app-passwall2_26.10.20-r3_all.ipk
a566be0a4682c4955bb832c3478863651d7dde1735f05a7282d7cd619d3d556e  luci-i18n-passwall2-zh-cn_26.10.20-r3_all.ipk
```

Private pre-install configuration backup is local at
`.build/before-private-passwall2.tar.gz` (mode 0600); never commit it.
The old external include is archived on the router as
`/etc/att-proxy/91-att-proxy.nft.disabled`. It is no longer in firewall4's
include directory and the old `inet att_proxy` table is absent.
To roll back, first load the retained `/etc/att-proxy/guard.nft` and restore
its include, then restore the original packages/configuration. Keep at least
one verified guard active throughout rollback. Free overlay space after
reboot was 33.5 MiB.
