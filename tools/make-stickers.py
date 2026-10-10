#!/usr/bin/env python3
"""GIF 이모티콘을 앱용 움직이는 WebP 로 바꾸고 stickers.js 에 등록합니다.

사용법 (저장소 맨 위 폴더에서):
    pip install pillow
    python tools/make-stickers.py 고양이.gif cat_meow "애옹"
    python tools/make-stickers.py a.gif id1 "이름1" b.gif id2 "이름2"   # 여러 개도 가능

하는 일:
  1. 흰 여백을 모든 프레임 기준으로 잘라냄 (움직이는 부분이 잘리지 않게)
  2. 정사각형은 긴 변 320px, 가로로 긴 것은 가로 400px 로 줄임 (화면에는 절반 크기로 보임)
  3. 움직이는 WebP(품질 72)로 저장 → 보통 GIF 대비 80~90% 작아짐
  4. stickers/<id>.webp 저장 + stickers.js 목록 끝에 한 줄 추가
"""
import os
import re
import sys

from PIL import Image, ImageChops, ImageSequence

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STICKER_DIR = os.path.join(ROOT, "stickers")
STICKERS_JS = os.path.join(ROOT, "stickers.js")


def convert(src, sticker_id, label):
    if not re.fullmatch(r"[a-z0-9_]+", sticker_id):
        sys.exit(f"id 는 영어 소문자/숫자/_ 만 쓸 수 있어요: {sticker_id}")
    im = Image.open(src)
    frames, durations = [], []
    for fr in ImageSequence.Iterator(im):
        frames.append(fr.convert("RGB"))
        durations.append(fr.info.get("duration", 60) or 60)
    W, H = frames[0].size

    # 흰 여백 자르기 (모든 프레임의 흰색 아닌 영역을 합침)
    white = Image.new("RGB", (W, H), (255, 255, 255))
    bbox = None
    for fr in frames:
        mask = ImageChops.difference(fr, white).convert("L").point(lambda v: 255 if v > 18 else 0)
        b = mask.getbbox()
        if b:
            bbox = b if bbox is None else (min(bbox[0], b[0]), min(bbox[1], b[1]), max(bbox[2], b[2]), max(bbox[3], b[3]))
    bbox = bbox or (0, 0, W, H)
    pad = int(max(W, H) * 0.04)
    x0, y0 = max(0, bbox[0] - pad), max(0, bbox[1] - pad)
    x1, y1 = min(W, bbox[2] + pad), min(H, bbox[3] + pad)
    square = W == H
    if square:  # 정사각형은 정사각형으로 유지
        side = min(max(x1 - x0, y1 - y0), W)
        cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
        x0 = max(0, min(W - side, cx - side // 2))
        y0 = max(0, min(H - side, cy - side // 2))
        x1, y1 = x0 + side, y0 + side
    cw, ch = x1 - x0, y1 - y0
    scale = min(1, (320 / max(cw, ch)) if square else (400 / cw))
    size = (max(1, round(cw * scale)), max(1, round(ch * scale)))
    out = [f.crop((x0, y0, x1, y1)).resize(size, Image.LANCZOS) for f in frames]

    os.makedirs(STICKER_DIR, exist_ok=True)
    dst = os.path.join(STICKER_DIR, f"{sticker_id}.webp")
    out[0].save(dst, save_all=True, append_images=out[1:], duration=durations, loop=0,
                quality=72, method=6, minimize_size=True)

    js = open(STICKERS_JS, encoding="utf-8").read()
    if f'id: "{sticker_id}"' in js:
        print(f"  (stickers.js 에 {sticker_id} 가 이미 있어요 → 파일만 교체. 같은 이름으로 바꿨으니 STICKER_VERSION 을 올리세요)")
    else:
        line = f'  {{ id: "{sticker_id}", label: "{label}", w: {size[0]}, h: {size[1]} }},\n'
        js = js.replace("];", line + "];", 1)
        open(STICKERS_JS, "w", encoding="utf-8").write(js)
    before, after = os.path.getsize(src), os.path.getsize(dst)
    print(f"{label}: {before/1e6:.2f}MB {W}x{H} → {after/1e3:.0f}KB {size[0]}x{size[1]} ({len(out)}프레임)")


if __name__ == "__main__":
    args = sys.argv[1:]
    if not args or len(args) % 3:
        sys.exit(__doc__)
    for i in range(0, len(args), 3):
        convert(*args[i:i + 3])
