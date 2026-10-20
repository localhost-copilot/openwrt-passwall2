#!/usr/bin/env python3
"""Package the reviewed fork delta over the checksum-pinned upstream IPKs.

This is a local architecture-independent package build, not an OpenWrt SDK build.
Requires a compatible LuCI po2lmo executable; emits root-owned tar archives.
"""
import argparse
import hashlib
import gzip
import io
import re
from pathlib import Path
import subprocess
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parents[1]
BASE = "20ecdbee"
MAKEFILE = (ROOT / "luci-app-passwall2/Makefile").read_text()
VERSION = re.search(r"^PKG_VERSION:=(.+)$", MAKEFILE, re.M)[1] + "-r" + re.search(r"^PKG_RELEASE:=(.+)$", MAKEFILE, re.M)[1]


def unpack(blob):
    with tarfile.open(fileobj=io.BytesIO(blob), mode="r:gz") as archive:
        return {m.name.removeprefix("./"): (m, archive.extractfile(m).read() if m.isfile() else None)
                for m in archive if m.name not in (".", "./")}


def put(files, name, data, mode=0o644):
    # opkg's tar extractor needs directory entries for new resource folders.
    for parent in reversed(Path(name).parents):
        if str(parent) != "." and str(parent) not in files:
            info = tarfile.TarInfo(str(parent))
            info.type = tarfile.DIRTYPE
            info.mode = 0o755
            files[str(parent)] = (info, None)
    info = tarfile.TarInfo(name)
    info.mode = mode
    files[name] = (info, data)


def pack(files):
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w", format=tarfile.GNU_FORMAT) as archive:
        for name, (original, data) in sorted(files.items()):
            info = original.replace(name="./" + name, uid=0, gid=0, uname="root", gname="root", mtime=0)
            if data is not None:
                info.size = len(data)
            archive.addfile(info, io.BytesIO(data) if data is not None else None)
    return gzip.compress(buf.getvalue(), mtime=0)


def build(source, checksum, output, translation, compiler):
    blob = source.read_bytes()
    assert hashlib.sha256(blob).hexdigest() == checksum, "Unexpected upstream IPK"
    outer = unpack(blob)
    control = unpack(outer["control.tar.gz"][1])
    data = unpack(outer["data.tar.gz"][1])
    if translation:
        with tempfile.TemporaryDirectory() as tmp:
            lmo = Path(tmp) / "passwall2.zh-cn.lmo"
            subprocess.run([compiler, str(ROOT / "luci-app-passwall2/po/zh-cn/passwall2.po"), str(lmo)], check=True)
            put(data, "usr/lib/lua/luci/i18n/passwall2.zh-cn.lmo", lmo.read_bytes())
    else:
        changed = subprocess.check_output(["git", "diff", "--name-only", BASE, "--", "luci-app-passwall2"], cwd=ROOT, text=True).splitlines()
        for name in changed:
            path = ROOT / name
            for prefix, destination in (("luci-app-passwall2/root/", ""), ("luci-app-passwall2/luasrc/", "usr/lib/lua/luci/")):
                if name.startswith(prefix):
                    put(data, destination + name[len(prefix):], path.read_bytes(), path.stat().st_mode & 0o777)
        put(control, "conffiles", control["conffiles"][1] + b"/etc/passwall2/kill-switch.nft\n")
    lines = control["control"][1].decode().splitlines()
    lines = ["Version: " + VERSION if line.startswith("Version:") else
             "Installed-Size: " + str(sum(len(v[1]) for v in data.values() if v[1] is not None))
             if line.startswith("Installed-Size:") else line for line in lines]
    put(control, "control", ("\n".join(lines) + "\n").encode())
    put(outer, "control.tar.gz", pack(control))
    put(outer, "data.tar.gz", pack(data))
    output.write_bytes(pack(outer))
    print(hashlib.sha256(output.read_bytes()).hexdigest(), output)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("upstream_dir", type=Path)
    parser.add_argument("--po2lmo", required=True)
    parser.add_argument("--output", type=Path, default=ROOT / ".build/packages")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    for source, sha, name, translation in (
        ("passwall2.ipk", "55e74d464f847e96b7346fbabb2bb02cd022b0b16457d9c9ab3d1259be03347d", "luci-app-passwall2", False),
        ("zh-cn.ipk", "44fa35426a83c68c2566c8001e24e21fb13698ae5109309447e5db3675f9bc43", "luci-i18n-passwall2-zh-cn", True),
    ):
        build(args.upstream_dir / source, sha, args.output / (name + "_" + VERSION + "_all.ipk"), translation, args.po2lmo)
