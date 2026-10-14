#!/usr/bin/env python3
"""极简阿里云 RPC API 客户端（V1 签名，手写，不依赖 SDK）。只读探测用。"""
import base64, hashlib, hmac, json, sys, time, urllib.parse, urllib.request, uuid, os

def _cred():
    p = os.path.expanduser('~/.dsh/aliyun.credentials.yml')
    out = {}
    for line in open(p, encoding='utf-8'):
        line = line.strip()
        if ':' in line and not line.startswith('#'):
            k, v = line.split(':', 1)
            out[k.strip()] = v.strip()
    return out

def call(domain, version, action, params=None, method='POST', region='cn-hangzhou'):
    c = _cred()
    params = dict(params or {})
    params.update({
        'Format': 'JSON', 'Version': version, 'AccessKeyId': c['accessKeyId'],
        'SignatureMethod': 'HMAC-SHA1', 'Timestamp': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'SignatureVersion': '1.0', 'SignatureNonce': str(uuid.uuid4()), 'Action': action,
    })
    if domain.startswith('ecs.') or domain.startswith('rds.') or domain.startswith('vpc.') or domain.startswith('fc.'):
        params.setdefault('RegionId', region)
    q = '&'.join(f'{urllib.parse.quote(k, safe="~")}={urllib.parse.quote(str(v), safe="~")}' for k, v in sorted(params.items()))
    sts = method + '&%2F&' + urllib.parse.quote(q, safe='~')
    sig = base64.b64encode(hmac.new((c['accessKeySecret'] + '&').encode(), sts.encode(), hashlib.sha1).digest()).decode()
    body = (q + '&Signature=' + urllib.parse.quote(sig, safe='~')).encode()
    req = urllib.request.Request('https://' + domain + '/', data=body, method='POST')
    req.add_header('x-acs-action', action)
    req.add_header('x-acs-version', version)
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return {'_http': e.code, '_body': e.read().decode()[:400]}

if __name__ == '__main__':
    dom, ver, act = sys.argv[1], sys.argv[2], sys.argv[3]
    extra = dict(a.split('=', 1) for a in sys.argv[4:])
    print(json.dumps(call(dom, ver, act, extra), ensure_ascii=False, indent=1)[:1500])
