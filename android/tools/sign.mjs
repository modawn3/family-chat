// 서명: 같은 열쇠로 서명해야 나중에 업데이트 설치가 됨.
// 열쇠는 저장소에 없음(Public). 사용법: node tools/sign.mjs <unsigned.apk> <signed.apk> <열쇠폴더>
//   열쇠폴더 안에 release.key.pem, release.cert.pem.  필요 패키지: npm i apk_sign_ts
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const { ApkSigner, SigningKey } = await import('apk_sign_ts');
const [inp, out, dir] = process.argv.slice(2);
if (!inp || !out || !dir) { console.error('사용법: node tools/sign.mjs <unsigned.apk> <signed.apk> <열쇠폴더>'); process.exit(1); }
const key = readFileSync(join(dir, 'release.key.pem'), 'utf8');
const cert = readFileSync(join(dir, 'release.cert.pem'), 'utf8');
const signer = new ApkSigner({ signingKey: SigningKey.fromPEM(key, cert), digestAlgorithm: 'SHA-256' });
const { signedApk } = await signer.sign(new Uint8Array(readFileSync(inp)));
writeFileSync(out, signedApk);
console.log('signed', out);
