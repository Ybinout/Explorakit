#!/usr/bin/env python3
"""Lossless deduplication of immutable dist-before backup copies, never live dist.

Dry-run by default. Identical bytes AND permissions/owner/mtime/xattrs are required.
All paths remain restorable. Restore by copying, never by editing backup files.
"""
import argparse
import filecmp
import hashlib
import json
import os
from pathlib import Path
import stat
import uuid


def signature(path):
    s = path.lstat()
    return (s.st_dev, s.st_ino, s.st_size, s.st_mode, s.st_uid, s.st_gid, s.st_mtime_ns)


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def deduplicate(root, apply=False):
    root = Path(root).resolve(strict=True)
    groups = {}
    report = {'filesChecked': 0, 'duplicates': 0, 'bytesSaved': 0, 'applied': apply}
    for release in sorted(root.iterdir()):
        if release.is_symlink() or not release.is_dir():
            continue
        copy = release / 'dist-before'
        if copy.is_symlink() or not copy.is_dir():
            continue
        for directory, dirs, files in os.walk(copy, followlinks=False):
            dirs[:] = sorted(d for d in dirs if not Path(directory, d).is_symlink())
            for name in sorted(files):
                p = Path(directory, name)
                before = signature(p)
                if not stat.S_ISREG(before[3]) or before[2] == 0:
                    continue
                attributes = tuple((k, os.getxattr(p, k)) for k in sorted(os.listxattr(p)))
                key = (before[0], *before[2:], attributes)
                report['filesChecked'] += 1
                checksum = digest(p)
                if signature(p) != before:
                    raise RuntimeError('Backup changed during scan: ' + str(p))
                key += (checksum,)
                previous = groups.get(key)
                if previous is None:
                    groups[key] = (p, before)
                    continue
                source, original = previous
                if before[:2] == original[:2]:
                    continue
                if signature(source) != original or not filecmp.cmp(source, p, shallow=False):
                    raise RuntimeError('Backup changed or bytes differ: ' + str(p))
                # Already-linked files are left alone: no assumptions about other paths.
                if p.stat().st_nlink != 1:
                    continue
                allocated = p.stat().st_blocks * 512
                if apply:
                    temp = p.with_name('.dedup-' + uuid.uuid4().hex)
                    try:
                        os.link(source, temp, follow_symlinks=False)
                        if signature(p) != before or signature(source) != original:
                            raise RuntimeError('Backup changed before replacement')
                        os.replace(temp, p)
                        if digest(p) != checksum:
                            raise RuntimeError('Post-replacement checksum mismatch')
                    finally:
                        temp.unlink(missing_ok=True)
                report['duplicates'] += 1
                report['bytesSaved'] += allocated
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', default='/home/ubuntu/dev/backups')
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    print(json.dumps(deduplicate(args.root, args.apply)))
