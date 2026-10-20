"""Exercise the apply script's failure boundaries without changing host firewall state."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


class ApplyPolicyTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.commands = self.root / 'commands'
        self.commands.mkdir()
        source = Path('luci-app-passwall2/root/usr/share/passwall2/kill_switch.sh').read_text()
        source = source.replace('/etc/passwall2', str(self.root / 'etc'))
        source = source.replace('/var/lock', str(self.root / 'locks'))
        self.script = self.root / 'apply.sh'
        self.script.write_text(source)
        self.env = dict(os.environ, PATH=str(self.commands) + os.pathsep + os.environ['PATH'],
                        TEST_ROOT=str(self.root), RENDER_STATUS='0', NFT_CHECK_STATUS='0')
        self.command('flock', '#!/bin/sh\nexit 0\n')
        self.command('logger', '#!/bin/sh\nexit 0\n')
        self.command('lua', '#!/bin/sh\ncat "$TEST_ROOT/rendered"\nexit "$RENDER_STATUS"\n')
        self.command('nft', '''#!/bin/sh
printf '%s\n' "$*" >> "$TEST_ROOT/nft-calls"
if [ "$1" = -c ]; then exit "$NFT_CHECK_STATUS"; fi
if [ "$1" = -f ]; then cp "$2" "$TEST_ROOT/applied"; fi
''')
        (self.root / 'rendered').write_text('add table inet passwall2_guard\ndelete table inet passwall2_guard\n')

    def command(self, name, content):
        path = self.commands / name
        path.write_text(content)
        path.chmod(0o755)

    def run_apply(self):
        return subprocess.run(['sh', str(self.script)], env=self.env, capture_output=True)

    def test_success_caches_exactly_the_applied_policy(self):
        self.assertEqual(self.run_apply().returncode, 0)
        self.assertEqual((self.root / 'applied').read_text(), (self.root / 'etc/kill-switch.nft').read_text())

    def test_renderer_failure_installs_and_persists_deny_policy(self):
        self.env['RENDER_STATUS'] = '1'
        (self.root / 'rendered').write_text('')
        self.assertNotEqual(self.run_apply().returncode, 0)
        applied = (self.root / 'applied').read_text()
        self.assertIn('policy drop;', applied)
        self.assertIn('br-lan', applied)
        self.assertEqual(applied, (self.root / 'etc/kill-switch.nft').read_text())

    def test_nft_validation_failure_keeps_last_known_policy(self):
        self.env['NFT_CHECK_STATUS'] = '1'
        (self.root / 'etc').mkdir()
        cached = self.root / 'etc/kill-switch.nft'
        cached.write_text('existing protected policy')
        self.assertNotEqual(self.run_apply().returncode, 0)
        self.assertEqual(cached.read_text(), 'existing protected policy')
        self.assertFalse((self.root / 'applied').exists())


if __name__ == '__main__':
    unittest.main()
