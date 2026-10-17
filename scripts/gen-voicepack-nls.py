#!/usr/bin/env python3
"""用阿里云智能语音交互(NLS)批量生成「词音频包」。

用法：
  NLS_APPKEY=xxxx python3 scripts/gen-voicepack-nls.py /tmp/ali-pack [voice]

- 文本取 docs/data/index.json 的 reading（假名），和 Kokoro 包同一套 key（sha1(text).mp3）
- 输出 audio/<sha1>.mp3 + index.json {meta, files:{text:file}}，可直接打成 voice pack
- token 用 ~/.dsh/aliyun.credentials.yml 里的 AK 现取，24h 有效，脚本内自动续
- 并发 4、失败重试 3 次（NLS 有 QPS 限制，太猛会被限流）
"""
import os, sys, json, time, hashlib, threading, queue, urllib.parse, urllib.request
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'ops'))
from aliyun_api import call

APPKEY = os.environ.get('NLS_APPKEY') or sys.exit('缺 NLS_APPKEY')
OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/ali-pack'
VOICE = sys.argv[2] if len(sys.argv) > 2 else 'tomoka'
AUDIO = os.path.join(OUT, 'audio')
os.makedirs(AUDIO, exist_ok=True)

_lock = threading.Lock()
_tok = {'v': None, 'at': 0}

def token():
    with _lock:
        if _tok['v'] and time.time() - _tok['at'] < 6 * 3600:
            return _tok['v']
        r = call('nls-meta.cn-shanghai.aliyuncs.com', '2019-02-28', 'CreateToken')
        _tok['v'] = r['Token']['Id']; _tok['at'] = time.time()
        print('token 刷新', time.strftime('%H:%M:%S'), flush=True)
        return _tok['v']

def tts(text, retry=3):
    q = dict(appkey=APPKEY, token=token(), text=text, format='mp3', sample_rate='24000',
             voice=VOICE, volume='50', speech_rate='0', pitch_rate='0')
    url = 'https://nls-gateway-cn-shanghai.aliyuncs.com/stream/v1/tts?' + urllib.parse.urlencode(q)
    last = ''
    for i in range(retry):
        try:
            with urllib.request.urlopen(url, timeout=20) as r:
                ct = r.headers.get('content-type', '')
                b = r.read()
                # MP3 帧同步是 11 个 1：FF E0+（MPEG-1 是 FFFB，MPEG-2/2.5 是 FFF3，别写死）
                if len(b) > 400 and ((b[0] == 0xFF and (b[1] & 0xE0) == 0xE0) or b[:3] == b'ID3'):
                    return b
                last = '非mp3 ' + b[:120].decode('utf-8', 'ignore')
        except Exception as e:
            last = str(e)[:120]
            body = getattr(e, 'read', lambda: b'')()
            if body:
                s = body[:200].decode('utf-8', 'ignore')
                last = s
                if 'TOKEN' in s.upper() or '403' in s: _tok['v'] = None      # token 失效 → 换一个再试
        time.sleep(0.6 * (i + 1))
    return None, last

def work(item):
    text = item
    fn = hashlib.sha1(text.encode('utf-8')).hexdigest() + '.mp3'
    path = os.path.join(AUDIO, fn)
    if os.path.exists(path) and os.path.getsize(path) > 400:
        return (text, fn, os.path.getsize(path))
    r = tts(text)
    if isinstance(r, tuple):
        return (text, '', -1, r[1])
    tmp = path + '.part'
    open(tmp, 'wb').write(r)
    os.replace(tmp, path)
    return (text, fn, len(r))

def main():
    src = json.load(open(os.path.join(ROOT, 'docs/data/index.json'), encoding='utf-8'))
    texts = sorted({(x.get('reading') or x.get('word') or '').strip() for x in src.get('vocab') or []} - {''})
    for t in ['こんにちは', 'ありがとう', 'こんばんは', 'おはよう', 'おやすみ',
              'はじめまして', 'さようなら', 'すみません', 'お願いします']:
        if t not in texts: texts.append(t)
    print(f'texts {len(texts)}  voice={VOICE}', flush=True)
    t0 = time.time(); mapping = {}; fails = []
    q = queue.Queue()
    for t in texts: q.put(t)
    done = [0]
    def worker():
        while True:
            try: t = q.get_nowait()
            except queue.Empty: return
            r = work(t)
            if r[1]: mapping[r[0]] = r[1]
            else: fails.append(r)
            done[0] += 1
            if done[0] % 200 == 0:
                print(f'{done[0]}/{len(texts)} {time.time()-t0:.0f}s fails {len(fails)}', flush=True)
    ths = [threading.Thread(target=worker) for _ in range(4)]
    for t in ths: t.start()
    for t in ths: t.join()
    meta = {'engine': 'aliyun-nls', 'voice': VOICE, 'sampleRate': 24000, 'format': 'mp3',
            'count': len(mapping), 'generatedAt': time.strftime('%Y-%m-%dT%H:%M:%S'),
            'source': 'https://help.aliyun.com/zh/isi/', 'license': '阿里云智能语音交互（账号内商用）'}
    json.dump({'meta': meta, 'files': mapping},
              open(os.path.join(OUT, 'index.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    json.dump(fails, open(os.path.join(OUT, 'fails.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(f'done {len(mapping)} fails {len(fails)} elapsed {round(time.time()-t0)}s', flush=True)

if __name__ == '__main__': main()
