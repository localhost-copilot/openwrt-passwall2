# Local routing with the kill switch enabled

The kill switch normally blocks all forwarding between LAN and the uplink.
An enabled `kill_switch_lan_route` section permits bidirectional IPv4 forwarding
between two explicit private subnets and physical devices. It does not grant
router input/output access, change NAT, or configure ordinary firewall rules.
Public, overlapping, and non-canonical subnets are rejected. Internet traffic,
including established direct connections, remains blocked by the guard.

For a travel router with LAN `192.168.6.0/24` on `br-lan` and a home uplink
`192.168.50.0/24` on `eth0`, add this to `/etc/config/passwall2`:

```uci
config kill_switch_lan_route 'home_lan'
	option enabled '1'
	option lan_device 'br-lan'
	option lan_subnet '192.168.6.0/24'
	option uplink_device 'eth0'
	option uplink_subnet '192.168.50.0/24'
```

The LAN device must also be trusted by `kill_switch_lan_devices` (default:
`br-lan`). The uplink device must not be a trusted LAN device. These names refer
to Linux devices, not UCI firewall zones or network interface section names.

Also configure the surrounding network:

- Reserve the travel router's WAN DHCP address on the home router and add a
  route to `192.168.6.0/24` through that address. Keep the travel router's WAN
  as a DHCP client so it works with other upstream networks.
- On the travel router, allow ordinary firewall forwarding from WAN source
  `192.168.50.0/24` to LAN destination `192.168.6.0/24`. Keep LAN-to-WAN
  forwarding and WAN masquerading. The home router's static route also permits
  home hosts to initiate connections to travel LAN addresses with masquerading
  enabled. For connections initiated by travel hosts, home devices see the
  travel router's WAN address; this accommodates devices with other default
  gateways or access policies that only allow their own subnet.
- To preserve travel host source addresses, optionally exclude destination
  `192.168.50.0/24` from WAN masquerading. Every home device must then have a
  return route through the home router and permit the travel subnet.
- Keep both private networks out of any proxy interception on either router.
- Enable the desired services and firewall permissions on the destination host.

Apply and cache the guard policy using `/etc/init.d/passwall2_guard start`.
The cached policy is replayed by firewall reloads and survives PassWall2 stop.
Disabling a route revokes its exception on the next policy application:

```sh
uci set passwall2.home_lan.enabled='0'
uci commit passwall2
/etc/init.d/passwall2_guard start
```

Disable the home exception before using an untrusted uplink. Subnet matching
does not authenticate a home network: another network can use the same addresses.
The exception is IPv4-only; it does not enable IPv6 forwarding or multicast
service discovery. Router-originated DNS and other Internet output keep their
existing restrictions.
