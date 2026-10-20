# Private PassWall2 customization

This repository retains the upstream history and GPL-3.0 license from
https://github.com/Openwrt-Passwall/openwrt-passwall2. It is an independent
private repository, not a GitHub fork-network member. No deployment secrets
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

## Development and upstream synchronization

Run `./tests/check.sh`. Validate rendered rules with `nft -c -f` on the target
firmware and test actual TCP/UDP failure, DNS, firewall reload and reboot
before replacing an existing deployment. Unit tests alone cannot establish
kernel packet-filter behavior.

Fetch upstream with `git fetch upstream --tags`, merge `upstream/main`, and
rerun checks. Keep customization commits separate. The inherited SDK build
workflow is manually triggered; it must use authenticated checkout when
building this private source. Do not make the repository public to build it.
