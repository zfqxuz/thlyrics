#!/usr/bin/env python3
"""把 ops/fc 打包上传到阿里云函数计算（FC 3.0），并设置环境变量。

用法：python3 ops/deploy-fc.py
密钥：~/.dsh/aliyun.credentials.yml（AK/SK）+ ~/.dsh/thlyrics-fc.secret（TOKEN_SECRET，首次自动生成）
"""
import base64, json, os, sys, zipfile, io, secrets
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import acs3

HERE = os.path.dirname(os.path.abspath(__file__))
FUNC = 'thlyrics-auth'
HOST = 'fcv3.cn-hangzhou.aliyuncs.com'

def cred():
    out = {}
    for line in open(os.path.expanduser('~/.dsh/aliyun.credentials.yml'), encoding='utf-8'):
        line = line.strip()
        if ':' in line and not line.startswith('#'):
            k, v = line.split(':', 1); out[k.strip()] = v.strip()
    return out

def secret():
    p = os.path.expanduser('~/.dsh/thlyrics-fc.secret')
    if not os.path.exists(p):
        open(p, 'w').write(secrets.token_hex(32)); os.chmod(p, 0o600)
    return open(p).read().strip()

def build_zip():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
        d = os.path.join(HERE, 'fc')
        for f in sorted(os.listdir(d)):
            if f.endswith(('.js', '.json', '.cjs', '.mjs')):
                z.write(os.path.join(d, f), f)
    return base64.b64encode(buf.getvalue()).decode()

def main():
    c = cred()
    env = {
        'OSS_AK': c['accessKeyId'],
        'OSS_SK': c['accessKeySecret'],
        'OSS_BUCKET': 'thlyrics-audio',
        'OSS_HOST': 'thlyrics-audio.oss-cn-hangzhou.aliyuncs.com',
        'TOKEN_SECRET': secret(),
        'ALLOW_ORIGINS': 'https://zfqxuz.github.io,http://127.0.0.1:8848,http://localhost:8848',
    }
    body = {
        'runtime': 'nodejs20', 'handler': 'index.handler', 'timeout': 30, 'memorySize': 256,
        'code': {'zipFile': build_zip()}, 'environmentVariables': env,
    }
    r = acs3.call('PUT', HOST, f'/2023-03-30/functions/{FUNC}', body=body)
    ok = r.get('functionName') == FUNC
    print('部署', '成功' if ok else '失败', r.get('codeSize') if ok else json.dumps(r, ensure_ascii=False)[:300])
    return 0 if ok else 1

if __name__ == '__main__':
    sys.exit(main())
