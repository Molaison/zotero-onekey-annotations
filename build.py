#!/usr/bin/env python3
"""Build reproducible Zotero .xpi from this directory (Python stdlib only)."""
from pathlib import Path
import json
import zipfile

ROOT=Path(__file__).resolve().parent
manifest=json.loads((ROOT/'manifest.json').read_text(encoding='utf-8'))
version=manifest['version']
name=f'onekey-pdf-annotations-{version}.xpi'
files=['manifest.json','bootstrap.js','content/onekey.js']
out=ROOT / name
with zipfile.ZipFile(out,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
    for f in files:
        info=zipfile.ZipInfo(f,date_time=(2026,10,22,0,0,0))
        info.compress_type=zipfile.ZIP_DEFLATED
        info.external_attr=(0o644 << 16)
        z.writestr(info,(ROOT/f).read_bytes(),compress_type=zipfile.ZIP_DEFLATED,compresslevel=9)
with zipfile.ZipFile(out) as z:
    assert sorted(z.namelist())==sorted(files)
    assert z.testzip() is None
    assert json.loads(z.read('manifest.json'))['version']==version
print(out)
