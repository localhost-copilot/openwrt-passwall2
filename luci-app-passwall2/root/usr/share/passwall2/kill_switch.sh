#!/bin/sh
# This table must outlive PassWall2 stop, crash, and firewall reload.
command -v nft >/dev/null 2>&1 || {
	[ "$(uci -q get passwall2.@global[0].kill_switch)" != "1" ]
	exit $?
}
mkdir -p /etc/passwall2 /var/lock || exit 1
exec 8>/var/lock/passwall2_guard.lock
flock -x 8 || exit 1
candidate="/etc/passwall2/kill-switch.nft.tmp.$$"
trap 'rm -f "$candidate"' EXIT HUP INT TERM
valid=1
if ! lua /usr/share/passwall2/kill_switch.lua > "$candidate" || [ ! -s "$candidate" ]; then
	# Also cover missing Lua modules and runtime errors: never cache an empty
	# policy that would silently disable protection on the next firewall reload.
	valid=0
	logger -t passwall2 "Cannot generate kill switch policy; installing emergency LAN-only guard"
	cat > "$candidate" <<'EOF'
add table inet passwall2_guard
delete table inet passwall2_guard
table inet passwall2_guard {
    chain forward {
        type filter hook forward priority -10; policy drop;
        iifname "br-lan" oifname "br-lan" accept
    }
    chain output {
        type filter hook output priority -10; policy drop;
        oifname { "lo", "br-lan" } accept
        meta nfproto ipv4 udp sport 68 udp dport 67 accept
    }
}
EOF
fi
nft -c -f "$candidate" && nft -f "$candidate" || exit 1
mv -f "$candidate" /etc/passwall2/kill-switch.nft || exit 1
# Existing accelerated direct flows must not survive enabling the guard.
nft flush flowtable inet fw4 ft 2>/dev/null || true
[ "$valid" = 1 ]
