#!/usr/bin/env python3
"""部署伴奏分离函数 thlyrics-sep（FC 3.0，与 thlyrics-auth 同一份代码包 + ROLE=sep）。

规格：4GB / 2 核 / 512MB 磁盘 / 900s 超时 —— ONNX 推理要 CPU 和内存。
用法：python3 ops/deploy-sep.py
"""
import importlib.util, json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import acs3

FUNC = 'thlyrics-sep'
HOST = 'fcv3.cn-hangzhou.aliyuncs.com'

spec = importlib.util.spec_from_file_location('deploy_fc', os.path.join(HERE, 'deploy-fc.py'))
fc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fc)


def env():
    c = fc.cred()
    return {
        'OSS_AK': c['accessKeyId'],
        'OSS_SK': c['accessKeySecret'],
        'OSS_BUCKET': 'thlyrics-audio',
        'OSS_HOST': 'thlyrics-audio.oss-cn-hangzhou.aliyuncs.com',
        'TOKEN_SECRET': fc.secret(),
        'ALLOW_ORIGINS': 'https://zfqxuz.github.io,https://localhost,capacitor://localhost,http://127.0.0.1:8848,http://localhost:8848',
        'ROLE': 'sep',
    }


def body():
    return {
        'runtime': 'nodejs20', 'handler': 'index.handler', 'timeout': 900,
        'memorySize': 4096, 'cpu': 2, 'diskSize': 512,
        'code': {'zipFile': fc.build_zip(with_ort=True)},
        'environmentVariables': env(),
    }


def main():
    r = acs3.call('GET', HOST, f'/2023-03-30/functions/{FUNC}')
    exists = r.get('functionName') == FUNC
    b = body()
    if exists:
        r = acs3.call('PUT', HOST, f'/2023-03-30/functions/{FUNC}', body=b)
    else:
        b2 = dict(b)
        b2['functionName'] = FUNC
        b2['description'] = '伴奏分离（去人声）'
        r = acs3.call('POST', HOST, '/2023-03-30/functions', body=b2)
    ok = r.get('functionName') == FUNC or (r.get('functionName') is None and not r.get('_http'))
    print('函数', FUNC, '创建/更新', '成功' if ok else '失败', r.get('codeSize') if ok else json.dumps(r, ensure_ascii=False)[:400])
    if not ok:
        return 1
    names = acs3.call('GET', HOST, f'/2023-03-30/functions/{FUNC}/triggers')
    has = FUNC and any(t.get('triggerName') == 'http' for t in (names.get('triggers') or []))
    if not has:
        t = acs3.call('POST', HOST, f'/2023-03-30/functions/{FUNC}/triggers', body={
            'triggerName': 'http', 'triggerType': 'http',
            'triggerConfig': json.dumps({'authType': 'anonymous', 'methods': ['GET', 'POST', 'PUT', 'OPTIONS']}),
        })
        print('触发器', '成功' if t.get('triggerName') else '失败', json.dumps(t, ensure_ascii=False)[:300])
    info = acs3.call('GET', HOST, f'/2023-03-30/functions/{FUNC}/triggers/http')
    print('URL:', info.get('httpTrigger', {}).get('urlInternet') or info.get('urlInternet') or json.dumps(info, ensure_ascii=False)[:300])
    return 0


if __name__ == '__main__':
    sys.exit(main())
