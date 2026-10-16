#!/usr/bin/env python3
"""把截图渲染成字符画（自适应对比度），便于无图形界面时检查布局。
用法：scripts/see.py <png> [cols] [--raw] [--crop y0 y1]
  默认：对比度拉伸到 min-max，文字最黑=@，背景最亮=空格
"""
import sys
from PIL import Image, ImageOps

CH = "@%#*+=-:. "   # 暗 → 亮

def render(im, cols, label):
    W, H = im.size
    rows = max(1, int(cols * (H / W) * 0.5))
    small = im.convert('L').resize((cols, rows), Image.LANCZOS)
    # 自适应拉伸
    lo, hi = small.getextrema()
    if hi - lo < 8:
        hi = lo + 8
    px = small.load()
    print(f"# {label}  {W}x{H}  lum[{lo},{hi}]  → {cols}x{rows}")
    for y in range(rows):
        line = []
        for x in range(cols):
            v = (px[x, y] - lo) / (hi - lo)
            line.append(CH[min(len(CH)-1, int(v * len(CH)))])
        print(''.join(line))

def main():
    path = sys.argv[1]
    cols = int(sys.argv[2]) if len(sys.argv) > 2 and not sys.argv[2].startswith('--') else 78
    im = Image.open(path).convert('RGB')
    if '--crop' in sys.argv:
        i = sys.argv.index('--crop')
        y0, y1 = int(sys.argv[i+1]), int(sys.argv[i+2])
        im = im.crop((0, y0, im.size[0], y1))
    render(im, cols, path)

if __name__ == '__main__':
    main()
