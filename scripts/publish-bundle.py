#!/usr/bin/env python3
"""发布内容包（OTA）：把 docs/ 打进 zip → 传 OSS → 写 docs/update.json。

用法：
  node scripts/bump-version.mjs      # 先推版本号（改过前端就必须做）
  python3 scripts/publish-bundle.py  # 再发布内容包
  git add -A && git commit && git push   # update.json 上 Pages 之后客户端才看得到

客户端逻辑见 docs/platform/ota.js：清单读 Pages 的 update.json，包从 OSS 下（10 年签名 URL）。
"""
import hashlib, json, os, sys, time, zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import oss

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS = os.path.join(ROOT, 'docs')
SKIP_DIRS = {'dl', '_screenshots', 'node_modules'}
SKIP_FILES = {'update.json', '.DS_Store'}


def version():
    for line in open(os.path.join(DOCS, 'version.js'), encoding='utf-8'):
        if 'export const V' in line:
            return line.split("'")[1]
    raise SystemExit('读不到 docs/version.js 的版本号')


def build_zip(dest):
    n = 0
    with zipfile.ZipFile(dest, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for dirpath, dirnames, filenames in os.walk(DOCS):
            rel_dir = os.path.relpath(dirpath, DOCS)
            parts = [] if rel_dir == '.' else rel_dir.split(os.sep)
            dirnames[:] = [d for d in sorted(dirnames) if d not in SKIP_DIRS]
            for f in sorted(filenames):
                if f in SKIP_FILES:
                    continue
                full = os.path.join(dirpath, f)
                rel = '/'.join(parts + [f])
                z.write(full, rel)
                n += 1
    return n


def main():
    v = version()
    key = f'bundles/thlyrics-{v}.zip'
    tmp = f'/tmp/thlyrics-bundle-{v}.zip'
    n = build_zip(tmp)
    body = open(tmp, 'rb').read()
    sha = hashlib.sha256(body).hexdigest()
    size = len(body)
    print(f'包：{n} 个文件 · {size/1024/1024:.2f} MB · sha256 {sha[:16]}…')
    st = oss.put(key, body, 'application/zip')
    print(f'上传：{key} → HTTP {st}')
    url = oss.sign(key)
    manifest = {
        'version': v,
        'url': url,
        'size': size,
        'sha256': sha,
        'at': int(time.time() * 1000),
    }
    out = os.path.join(DOCS, 'update.json')
    open(out, 'w', encoding='utf-8').write(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    print(f'清单：docs/update.json → {v}')
    print(f'URL：{url[:110]}…')


if __name__ == '__main__':
    main()
