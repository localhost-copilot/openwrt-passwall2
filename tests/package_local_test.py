import importlib.util
import io
from pathlib import Path
import tarfile
import unittest

spec = importlib.util.spec_from_file_location("package_local", Path(__file__).resolve().parents[1] / "scripts/package-local.py")
package = importlib.util.module_from_spec(spec)
spec.loader.exec_module(package)


class PackageLayoutTest(unittest.TestCase):
    def test_new_resource_directories_precede_files_for_opkg(self):
        files = {}
        package.put(files, "www/luci-static/resources/monitor/app.js", b"test")
        with tarfile.open(fileobj=io.BytesIO(package.pack(files)), mode="r:gz") as archive:
            directories = {"."}
            for member in archive:
                self.assertIn(str(Path(member.name).parent), directories)
                if member.isdir():
                    directories.add(str(Path(member.name)))
                else:
                    self.assertEqual(archive.extractfile(member).read(), b"test")


if __name__ == "__main__":
    unittest.main()
