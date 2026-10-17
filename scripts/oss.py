#!/usr/bin/env python3
"""阿里云 OSS 极简客户端（V1 签名）—— 只做本仓库要用的几件事：put / get / sign / ls / delete。

密钥读 ~/.dsh/aliyun.credentials.yml（不进仓库）。
"""
import base64, hashlib, hmac, email.utils, json, os, urllib.parse, urllib.request

BUCKET = 'thlyrics-audio'
HOST = f'{BUCKET}.oss-cn-hangzhou.aliyuncs.com'


def _cred():
    out = {}
    for line in open(os.path.expanduser('~/.dsh/aliyun.credentials.yml'), encoding='utf-8'):
        line = line.strip()
        if ':' in line and not line.startswith('#'):
            k, v = line.split(':', 1)
            out[k.strip()] = v.strip()
    return out


C = _cred()
AK, SK = C['accessKeyId'], C['accessKeySecret']


def put(key, body, ctype='application/octet-stream'):
    md5 = base64.b64encode(hashlib.md5(body).digest()).decode()
    date = email.utils.formatdate(usegmt=True)
    resource = f'/{BUCKET}/{key}'
    sts = '\n'.join(['PUT', md5, ctype, date, resource])
    sig = base64.b64encode(hmac.new(SK.encode(), sts.encode(), hashlib.sha1).digest()).decode()
    req = urllib.request.Request(f'https://{HOST}/{urllib.parse.quote(key)}', data=body, method='PUT')
    req.add_header('Date', date)
    req.add_header('Content-Type', ctype)
    req.add_header('Content-MD5', md5)
    req.add_header('Authorization', f'OSS {AK}:{sig}')
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.status


def get(key):
    date = email.utils.formatdate(usegmt=True)
    sts = '\n'.join(['GET', '', '', date, f'/{BUCKET}/{key}'])
    sig = base64.b64encode(hmac.new(SK.encode(), sts.encode(), hashlib.sha1).digest()).decode()
    req = urllib.request.Request(f'https://{HOST}/{urllib.parse.quote(key)}')
    req.add_header('Date', date)
    req.add_header('Authorization', f'OSS {AK}:{sig}')
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def sign(key, expires=315360000):
    """签名 URL（默认 10 年）。"""
    import time
    exp = int(time.time()) + int(expires)
    sts = '\n'.join(['GET', '', '', str(exp), f'/{BUCKET}/{key}'])
    sig = base64.b64encode(hmac.new(SK.encode(), sts.encode(), hashlib.sha1).digest()).decode()
    q = urllib.parse.urlencode({'OSSAccessKeyId': AK, 'Expires': exp, 'Signature': sig})
    return f'https://{HOST}/{urllib.parse.quote(key)}?{q}'


def ls(prefix=''):
    date = email.utils.formatdate(usegmt=True)
    resource = f'/{BUCKET}/'
    sts = '\n'.join(['GET', '', '', date, resource])
    sig = base64.b64encode(hmac.new(SK.encode(), sts.encode(), hashlib.sha1).digest()).decode()
    q = urllib.parse.urlencode({'prefix': prefix, 'max-keys': '1000'})
    req = urllib.request.Request(f'https://{HOST}/?{q}')
    req.add_header('Date', date)
    req.add_header('Authorization', f'OSS {AK}:{sig}')
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode()


def delete(key):
    date = email.utils.formatdate(usegmt=True)
    sts = '\n'.join(['DELETE', '', '', date, f'/{BUCKET}/{key}'])
    sig = base64.b64encode(hmac.new(SK.encode(), sts.encode(), hashlib.sha1).digest()).decode()
    req = urllib.request.Request(f'https://{HOST}/{urllib.parse.quote(key)}', method='DELETE')
    req.add_header('Date', date)
    req.add_header('Authorization', f'OSS {AK}:{sig}')
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status
