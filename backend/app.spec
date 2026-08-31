# -*- mode: python ; coding: utf-8 -*-


a = Analysis(
    ['app.py', 'server.py'],
    pathex=[],
    binaries=[],
    datas=[
        ('../frontend/dist', 'frontend/dist'),
        ('resources', 'resources'),
        ('../data/college_english_pool.json', 'resources'),
        ('../data/labor_education_pool.json', 'resources'),
        (os.path.join(os.environ['LOCALAPPDATA'], 'ms-playwright/chromium_headless_shell-1223'), 'playwright/chromium_headless_shell-1223'),
        (os.path.join(os.environ['LOCALAPPDATA'], 'ms-playwright/chromium-1223'), 'playwright/chromium-1223'),
        (os.path.join(os.environ['LOCALAPPDATA'], 'ms-playwright/ffmpeg-1011'), 'playwright/ffmpeg-1011'),
        (os.path.join(os.environ['LOCALAPPDATA'], 'ms-playwright/winldd-1007'), 'playwright/winldd-1007'),
    ],
    hiddenimports=[],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        'matplotlib', 'numpy', 'pandas', 'scipy', 'IPython', 'PIL', 'tkinter',
        'PyQt5', 'PyQt6', 'PySide2', 'PySide6', 'wx', 'notebook', 'sphinx',
        'pytest', 'docutils', 'jedi', 'parso', 'wcwidth', 'pygments', 'nbformat',
        'jsonschema', 'zmq', 'tornado', 'babel', 'pytz'
    ],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    [s for s in a.scripts if s[0] == 'app'],
    [],
    exclude_binaries=True,
    name='app',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon='backend.ico',
)

exe_server = EXE(
    pyz,
    [s for s in a.scripts if s[0] == 'server'],
    [],
    exclude_binaries=True,
    name='server',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon='backend.ico',
)

coll = COLLECT(
    exe,
    exe_server,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='app',
)
