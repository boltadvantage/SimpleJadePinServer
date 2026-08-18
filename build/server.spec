# PyInstaller spec — freezes the PIN server plus its web assets into a
# single self-contained executable with no system Python dependency.
#
# Built per-platform: PyInstaller cannot cross-compile, so the release
# workflow runs this on a native runner for each OS.

import importlib.util
import os
import sys

from PyInstaller.utils.hooks import collect_dynamic_libs

block_cipher = None

ROOT = os.path.abspath(os.path.join(os.getcwd()))

# The web UI ships inside the binary; SimpleJadePinServer resolves it via
# sys._MEIPASS at runtime.
datas = [
    (os.path.join(ROOT, "web"), "web"),
]

# wallycore is a SWIG wrapper whose native half, _wallycore, is a TOP-LEVEL
# extension module sitting beside the package rather than inside it, so
# collect_dynamic_libs("wallycore") does not find it. Locate it explicitly.
binaries = collect_dynamic_libs("wallycore")

_native = importlib.util.find_spec("_wallycore")
if _native is None or not _native.origin:
    raise SystemExit(
        "Could not locate the _wallycore native extension. "
        "Install it with: pip install wallycore"
    )
binaries.append((_native.origin, "."))

a = Analysis(
    [os.path.join(ROOT, "SimpleJadePinServer.py")],
    pathex=[ROOT],
    binaries=binaries,
    datas=datas,
    hiddenimports=["wallycore", "_wallycore"],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    # Keep the binary lean and the attack surface small: this app must never
    # need a GUI toolkit, a test framework, or an HTTP client library.
    # NOTE: http.server pulls in email.utils and http.client, so neither may
    # be excluded. Only genuinely unused subsystems are dropped here.
    excludes=[
        "tkinter", "unittest", "pydoc", "doctest", "test", "lib2to3",
        "distutils", "setuptools", "pip", "pkg_resources",
        "xml", "xmlrpc", "sqlite3", "ftplib", "asyncio", "multiprocessing",
        "numpy", "PIL", "requests", "curses", "readline",
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name="SimpleJadePinServer",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,           # UPX mangles signatures and trips antivirus heuristics
    runtime_tmpdir=None,
    console=True,        # stdout is how the Electron shell reads READY/warnings
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

# electron-builder picks this up from dist/server via extraResources.
coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    name="server",
)
