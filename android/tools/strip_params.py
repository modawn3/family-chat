"""javac 21 이 넣는 MethodParameters 속성 제거 (구버전 d8 호환용)"""
import sys, os, struct
def cp_end(b):
    n = struct.unpack_from('>H', b, 8)[0]; i = 10; k = 1; utf = {}
    while k < n:
        t = b[i]
        if t == 1:
            l = struct.unpack_from('>H', b, i+1)[0]; utf[k] = b[i+3:i+3+l].decode('utf8', 'replace'); i += 3 + l
        elif t in (3, 4): i += 5
        elif t in (5, 6): i += 9; k += 1
        elif t in (7, 8, 16, 19, 20): i += 3
        elif t in (9, 10, 11, 12, 17, 18): i += 5
        elif t == 15: i += 4
        else: raise ValueError(t)
        k += 1
    return i, utf
def strip(path):
    b = open(path, 'rb').read(); i, utf = cp_end(b)
    out = bytearray(b[:i]); i0 = i
    i += 6; ic = struct.unpack_from('>H', b, i)[0]; i += 2 + 2*ic
    out += b[i0:i]
    removed = 0
    for _ in range(2):  # fields, methods
        cnt = struct.unpack_from('>H', b, i)[0]; out += b[i:i+2]; i += 2
        for _ in range(cnt):
            out += b[i:i+6]; i += 6
            ac = struct.unpack_from('>H', b, i)[0]; i += 2
            keep = []
            for _ in range(ac):
                ni, ln = struct.unpack_from('>HI', b, i)
                blob = b[i:i+6+ln]; i += 6 + ln
                if utf.get(ni) == 'MethodParameters': removed += 1
                else: keep.append(blob)
            out += struct.pack('>H', len(keep)) + b''.join(keep)
    out += b[i:]
    if removed: open(path, 'wb').write(out)
    return removed
total = 0
for root, _, fs in os.walk(sys.argv[1]):
    for f in fs:
        if f.endswith('.class'): total += strip(os.path.join(root, f))
print('removed MethodParameters:', total)
