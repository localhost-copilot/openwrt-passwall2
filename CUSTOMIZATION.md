# PassWall2 customization

This repository retains the upstream history and GPL-3.0 license from
https://github.com/Openwrt-Passwall/openwrt-passwall2. It is an independent
public repository at https://github.com/localhost-copilot/openwrt-passwall2,
not a GitHub fork-network member. No deployment secrets
or machine backups belong here.

## Dedicated-router kill switch

Basic Settings includes **Block direct Internet access**, independent of the
main proxy switch, plus a status indicator. It defaults to off. With it on,
stopping PassWall2, a crashed core or an unreachable node cannot enable
ordinary client forwarding. Both IPv4 and IPv6 forwarding are blocked;
TCP/UDP intercepted by the proxy can still exit via the selected node.

Router output is restricted to loopback, trusted LAN devices, the selected
IPv4 node's TCP/UDP port, explicitly configured extra endpoints, IPv4 NTP
addresses already configured in system.ntp, and DHCPv4. This also prevents
direct DNS fallback. Trusted LAN defaults to br-lan; use Linux device names,
never WAN devices. Router management on trusted LAN remains available.

This first version targets an IPv4-addressed single-node dedicated router.
It intentionally does not resolve hostname nodes using direct DNS, permit
IPv6 proxy endpoints, or automatically expand shunt/balancer/chain nodes.
An unsupported or missing endpoint leaves access blocked. Additional fixed
endpoints can be supplied as tcp:IPv4:port or udp:IPv4:port. NTP servers must
be configured as IPv4 addresses for cold-boot clock synchronization.

## Lifecycle

The independent inet passwall2_guard table is applied before proxy startup
and by a START=18 boot service. An atomic cached nft ruleset is replayed by
firewall4 on reload. PassWall2 stop never removes it. Only explicitly saving
and applying the kill-switch option as off removes protection. Malformed
configuration installs a restrictive emergency policy and aborts proxy
startup rather than silently dropping protection. The emergency trusted
device is br-lan; configure LAN devices correctly before enabling.

Existing firewall4 ft flowtable entries are flushed when the policy changes.
Other vendor fast paths that bypass nftables are outside this feature's
guarantee and must be disabled before use. This is a firewall4/nftables
feature, not an iptables implementation. Keep the cached policy during
upgrades; do not delete the firewall include while protection is required.

To migrate from an external guard, enable and verify this guard first, then
remove the old guard. Two drop policies compose restrictively, so disabling
this UI option cannot remove a separately installed external guard.

## Router monitor

The **实时监控** tab (`admin/services/passwall2/monitor`) is a read-only LuCI
dashboard. Its authenticated endpoints expose selected telemetry, not full
UCI or Xray configurations. It uses local static assets without a CDN.

- System CPU, available-memory usage, temperature, uptime, conntrack count,
  WAN interface counters, proxy process and independent guard status refresh
  approximately every two seconds. WAN counters include tunnel overhead and
  router traffic; their rates are not application download speeds.
- Optional Bandix device traffic refreshes separately every five seconds,
  so its slower API cannot delay the system/guard display. With Bandix absent,
  disabled or unavailable, the UI explicitly reports missing device data.
  Device labels are rendered as text, never HTML. Device totals depend on
  Bandix's lifetime/storage configuration; this router uses memory-only data.
- Exit-IP/HTTPS reachability checks use the generated Xray configuration's
  loopback SOCKS inbound. No direct fallback is allowed. Results are cached
  for 30 seconds, bounded by a six-second timeout and a process lock. Stopping
  the proxy invalidates a cached success. The reported duration is an HTTPS
  request time, not ICMP latency; a failed check may also mean the public
  Cloudflare test endpoint is unavailable.
- Sampling stops when the page is hidden or closed. Counter resets/reboots
  do not produce negative speeds. Request failures show a stale-data warning
  and unknown protection/process state rather than preserving green badges.

No monitoring service or firewall interception is added by this package.
Enable Bandix traffic collection separately if device statistics are wanted;
the deployment enabled only its traffic module, without storage, DNS logging
or rate limits. The monitor currently probes Xray's SOCKS inbound; it does not
implement a Clash API or full per-connection inspection.

## Development and upstream synchronization

Run `./tests/check.sh`. Validate rendered rules with `nft -c -f` on the target
firmware and test actual TCP/UDP failure, DNS, firewall reload and reboot
before replacing an existing deployment. Unit tests alone cannot establish
kernel packet-filter behavior.

Fetch upstream with `git fetch upstream --tags`, merge `upstream/main`, and
rerun checks. Keep customization commits separate. The inherited SDK build
workflow is manually triggered and checks out this repository's source.
Public builds do not need a deploy key or personal access token.

## Local package build

`scripts/package-local.py` builds architecture-independent IPKs by applying
this fork's source changes over checksum-pinned upstream 26.10.20 packages.
It preserves upstream package metadata, dependencies and maintainer scripts,
updates the version and conffiles, and compiles the modified Chinese catalog.
This does not compile firmware or replace an SDK build.

```sh
python3 scripts/package-local.py /path/to/upstream-ipks --po2lmo /path/to/po2lmo
```

The input directory must contain the official `passwall2.ipk` and `zh-cn.ipk`
matching the hashes in the script. Outputs go to ignored `.build/packages/`.
Build `po2lmo` from the official LuCI sources (the openwrt-19.07 converter
works with this router's LMO format). Its source directory needs `po2lmo.c`,
`template_lmo.c`, `template_lmo.h`, `plural_formula.y`, and the `contrib/lemon.c`
and `contrib/lempar.c` parser generator. Compile lemon, generate the plural
parser, then link po2lmo with template_lmo and the generated parser.

The r3 deployment fixes a UI dependency check: `api.finded_com()` resolves
configured proxy applications, so it cannot detect the system nft utility.
Use the system command lookup for nft. Verify enabling via the actual LuCI
Save & Apply action, rather than relying only on direct UCI writes.
