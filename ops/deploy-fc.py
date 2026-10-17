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

def build_zip(with_ort=False):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
        d = os.path.join(HERE, 'fc')
        for f in sorted(os.listdir(d)):
            if f.endswith(('.js', '.json', '.cjs', '.mjs')):
                z.write(os.path.join(d, f), f)
        # 分词器的 JS 实现：部署时从 node_modules 取（第三方代码不进仓库）；
        # 词典 18MB 在 OSS kuromoji/dict/，冷启动拉到 /tmp，也不进包。
        nm = os.path.join(os.path.dirname(HERE), 'node_modules')
        kuro = os.path.join(nm, 'kuromoji')
        src = os.path.join(kuro, 'src')
        for root, _dirs, files in os.walk(src):          # 子目录（viterbi/loader/util/dict）也要打进去
            for f in files:
                p = os.path.join(root, f)
                z.write(p, 'vendor/kuromoji/src/' + os.path.relpath(p, src))
        z.write(os.path.join(kuro, 'package.json'), 'vendor/kuromoji/package.json')
        for dep in ['async', 'doublearray', 'zlibjs', 'lodash']:
            base = os.path.join(nm, dep)
            for root, _dirs, files in os.walk(base):
                if 'node_modules' in root.split(os.sep)[len(base.split(os.sep)):]:
                    continue
                for f in files:
                    p = os.path.join(root, f)
                    z.write(p, 'vendor/node_modules/' + dep + '/' + os.path.relpath(p, base))
        # ONNX 分离器运行时（只留 linux-x64，38MB；模型放 OSS 冷启动拉）
        ort = os.path.join(nm, 'onnxruntime-node')
        if with_ort and os.path.isdir(ort):
            for f in os.listdir(ort):
                p = os.path.join(ort, f)
                if os.path.isfile(p):
                    z.write(p, 'vendor/onnxruntime-node/' + f)
            for sub in ['lib', 'dist', 'script']:
                for root, _d, files in os.walk(os.path.join(ort, sub)):
                    for f in files:
                        p = os.path.join(root, f)
                        z.write(p, 'vendor/onnxruntime-node/' + os.path.relpath(p, ort))
            com = os.path.join(nm, 'onnxruntime-common')
            if os.path.isdir(com):
                for root, _d, files in os.walk(com):
                    for f in files:
                        p = os.path.join(root, f)
                        z.write(p, 'vendor/node_modules/onnxruntime-common/' + os.path.relpath(p, com))
            base = os.path.join(ort, 'bin/napi-v3/linux/x64')
            for f in os.listdir(base):
                p = os.path.join(base, f)
                if os.path.isfile(p):
                    z.write(p, 'vendor/onnxruntime-node/bin/napi-v3/linux/x64/' + f)
        # 伴奏分离：mp3 解码（wasm）+ mp3 编码（lamejs），加起来不到 1MB
        for dep in ['mpg123-decoder', '@wasm-audio-decoders/common', '@eshaz/web-worker', '@breezystack/lamejs', 'simple-yenc']:
            base = os.path.join(nm, dep)
            if not os.path.isdir(base):
                continue
            for root, _dirs, files in os.walk(base):
                for f in files:
                    p = os.path.join(root, f)
                    z.write(p, 'node_modules/' + dep + '/' + os.path.relpath(p, base))
    return base64.b64encode(buf.getvalue()).decode()

def main():
    c = cred()
    env = {
        'OSS_AK': c['accessKeyId'],
        'OSS_SK': c['accessKeySecret'],
        'OSS_BUCKET': 'thlyrics-audio',
        'OSS_HOST': 'thlyrics-audio.oss-cn-hangzhou.aliyuncs.com',
        'TOKEN_SECRET': secret(),
        'ALLOW_ORIGINS': 'https://zfqxuz.github.io,https://localhost,capacitor://localhost,http://127.0.0.1:8848,http://localhost:8848',
        'ROLE': 'auth',
        'SEP_FUNCTION': 'thlyrics-sep',
    }
    body = {
        'runtime': 'nodejs20', 'handler': 'index.handler', 'timeout': 300, 'memorySize': 1024, 'cpu': 1, 'diskSize': 512,
        'code': {'zipFile': build_zip()}, 'environmentVariables': env,
    }
    r = acs3.call('PUT', HOST, f'/2023-03-30/functions/{FUNC}', body=body)
    ok = r.get('functionName') == FUNC
    print('部署', '成功' if ok else '失败', r.get('codeSize') if ok else json.dumps(r, ensure_ascii=False)[:300])
    return 0 if ok else 1

if __name__ == '__main__':
    sys.exit(main())
