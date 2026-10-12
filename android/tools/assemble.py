"""base.apk + classes.dex -> 정렬된 unsigned.apk (zipalign 대신)"""
import sys, zipfile
src, dex, out = sys.argv[1:4]
zin = zipfile.ZipFile(src)
with open(out, 'wb') as f:
    zout = zipfile.ZipFile(f, 'w')
    def put(name, data, ctype):
        zi = zipfile.ZipInfo(name, date_time=(2008, 1, 1, 0, 0, 0))
        zi.compress_type = ctype
        zi.create_system = 0
        if ctype == zipfile.ZIP_STORED:
            # 압축 안 한 파일은 내용 시작 위치를 4바이트 경계에 맞춤
            off = f.tell() + 30 + len(name.encode('utf-8'))
            pad = (4 - off % 4) % 4
            zi.extra = b'\x00' * pad
        zout.writestr(zi, data)
    names = zin.namelist()
    if 'AndroidManifest.xml' in names:
        names.remove('AndroidManifest.xml'); names.insert(0, 'AndroidManifest.xml')
    for n in names:
        info = zin.getinfo(n)
        ctype = zipfile.ZIP_STORED if n == 'resources.arsc' or n.endswith('.png') else info.compress_type
        put(n, zin.read(n), ctype)
    put('classes.dex', open(dex, 'rb').read(), zipfile.ZIP_DEFLATED)
    zout.close()
# 확인
z = zipfile.ZipFile(out)
for i in z.infolist():
    if i.compress_type == zipfile.ZIP_STORED:
        with open(out, 'rb') as f:
            f.seek(i.header_offset + 26); import struct
            nl, el = struct.unpack('<HH', f.read(4))
            assert (i.header_offset + 30 + nl + el) % 4 == 0, i.filename
print('assembled', len(z.infolist()), 'entries')
