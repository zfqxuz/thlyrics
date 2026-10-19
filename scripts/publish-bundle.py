#!/usr/bin/env python3
"""发布内容包（OTA）：增量（按文件）为主，整包 zip 兜底。

用法：
  node scripts/bump-version.mjs
  node scripts/build-frontend.mjs     # 打 app.bundle.js（网页版首屏只发一个 JS）
  node scripts/gen-sw.mjs
  python3 scripts/publish-bundle.py
  git add -A && git commit && git push

原理：
  - 每个文件按 sha256 传到 OSS `bundles/files/<sha256>`（内容寻址，同样的文件只传一次）
  - `docs/update.json` 里同时给 manifest（每个文件的 hash + 签名 URL）和整包 zip 的 url
  - 客户端（docs/platform/ota.js）优先用 manifest：Capgo 只在本地没有该 hash 时才下那个文件
  - 老客户端不认识 manifest，仍走 url 的整包
"""
import hashlib, os, sys, time, zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import oss

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS = os.path.join(ROOT, 'docs')
SKIP_DIRS = {'dl', '_screenshots', 'node_modules'}
SKIP_FILES = {'update.json', '.DS_Store'}
FILES_PREFIX = 'bundles/files/'

CTYPE = {
    '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
    '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.gz': 'application/gzip',
    '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8',
    '.webmanifest': 'application/manifest+json', '.zip': 'application/zip', '.mp3': 'audio/mpeg',
}


def version():
    for line in open(os.path.join(DOCS, 'version.js'), encoding='utf-8'):
        if 'export const V' in line:
            return line.split("'")[1]
    raise SystemExit('读不到 docs/version.js 的版本号')


def walk_files():
    out = []
    for dirpath, dirnames, filenames in os.walk(DOCS):
        rel_dir = os.path.relpath(dirpath, DOCS)
        parts = [] if rel_dir == '.' else rel_dir.split(os.sep)
        dirnames[:] = [d for d in sorted(dirnames) if d not in SKIP_DIRS]
        for f in sorted(filenames):
            if f in SKIP_FILES:
                continue
            full = os.path.join(dirpath, f)
            rel = '/'.join(parts + [f])
            out.append((rel, full))
    return out


def build_zip(dest, files):
    with zipfile.ZipFile(dest, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for rel, full in files:
            z.write(full, rel)


def main():
    v = version()
    files = walk_files()
    manifest, uploaded, reused = [], 0, 0
    total_new = 0
    for rel, full in files:
        body = open(full, 'rb').read()
        sha = hashlib.sha256(body).hexdigest()
        key = FILES_PREFIX + sha
        if oss.exists(key):
            reused += 1
        else:
            ext = os.path.splitext(rel)[1].lower()
            oss.put(key, body, CTYPE.get(ext, 'application/octet-stream'))
            uploaded += 1
            total_new += len(body)
        manifest.append({'file_name': rel, 'file_hash': sha, 'download_url': oss.sign(key)})

    # 整包（老客户端兜底）
    tmp = f'/tmp/thlyrics-bundle-{v}.zip'
    build_zip(tmp, files)
    body = open(tmp, 'rb').read()
    zip_sha = hashlib.sha256(body).hexdigest()
    zip_key = f'bundles/thlyrics-{v}.zip'
    oss.put(zip_key, body, 'application/zip')

    out = {
        'version': v,
        'url': oss.sign(zip_key),          # 兜底：整包
        'size': len(body),
        'sha256': zip_sha,
        'manifest': manifest,               # 首选：按文件增量
        'at': int(time.time() * 1000),
    }
    import json
    open(os.path.join(DOCS, 'update.json'), 'w', encoding='utf-8').write(json.dumps(out, ensure_ascii=False) + '\n')
    print(f'包：{len(files)} 个文件 · 整包 {len(body)/1048576:.1f} MB')
    print(f'增量：新传 {uploaded} 个（{total_new/1048576:.2f} MB）· 复用 {reused} 个')
    print(f'清单：docs/update.json → {v}（manifest {len(manifest)} 条）')


if __name__ == '__main__':
    main()
