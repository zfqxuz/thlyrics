#!/usr/bin/env python3
"""阿里云 OpenAPI V3（ACS3-HMAC-SHA256）极简客户端 —— FC 3.0 这类 ROA 接口用。"""
import hashlib, hmac, json, os, sys, urllib.parse, urllib.request, uuid, time

def cred():
    out = {}
    for line in open(os.path.expanduser('~/.dsh/aliyun.credentials.yml'), encoding='utf-8'):
        line = line.strip()
        if ':' in line and not line.startswith('#'):
            k, v = line.split(':', 1); out[k.strip()] = v.strip()
    return out

def call(method, host, path, query=None, body=None, version='2023-03-30', extra_headers=None, account='1373877448225755'):
    c = cred()
    query = dict(query or {})
    payload = json.dumps(body, ensure_ascii=False).encode() if body is not None else b''
    hashed_payload = hashlib.sha256(payload).hexdigest()
    date = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    nonce = str(uuid.uuid4())
    headers = {
        'host': host, 'x-acs-version': version, 'x-acs-date': date,
        'x-acs-signature-nonce': nonce, 'x-acs-content-sha256': hashed_payload,
    }
    if body is not None:
        headers['content-type'] = 'application/json'
    headers.update(extra_headers or {})
    signed = ';'.join(sorted(headers))
    canon_headers = ''.join(f'{k}:{headers[k].strip()}\n' for k in sorted(headers))
    canon_query = '&'.join(f'{urllib.parse.quote(k, safe="~")}={urllib.parse.quote(str(query[k]), safe="~")}' for k in sorted(query))
    canon = '\n'.join([method, path, canon_query, canon_headers, signed, hashed_payload])
    sts = 'ACS3-HMAC-SHA256\n' + hashlib.sha256(canon.encode()).hexdigest()
    sig = hmac.new(c['accessKeySecret'].encode(), sts.encode(), hashlib.sha256).hexdigest()
    headers['Authorization'] = f'ACS3-HMAC-SHA256 Credential={c["accessKeyId"]},SignedHeaders={signed},Signature={sig}'
    url = f'https://{host}{path}' + (('?' + canon_query) if canon_query else '')
    req = urllib.request.Request(url, data=payload if body is not None else None, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            t = r.read().decode()
            return json.loads(t) if t.strip().startswith(('{', '[')) else {'_raw': t[:300]}
    except urllib.error.HTTPError as e:
        return {'_http': e.code, '_body': e.read().decode()[:400]}

if __name__ == '__main__':
    op, host, path = sys.argv[1], sys.argv[2], sys.argv[3]
    q = dict(a.split('=', 1) for a in sys.argv[4:] if '=' in a)
    print(json.dumps(call(op, host, path, q or None), ensure_ascii=False, indent=1)[:1200])
