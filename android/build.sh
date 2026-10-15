#!/bin/bash
# 나의 달력 안드로이드 앱(위젯 포함) 빌드 스크립트
# GitHub Actions(.github/workflows/android.yml)에서 실행됨. 결과: build/unsigned.apk (서명 전)
# 서명 열쇠는 저장소에 없음(Public). 서명은 열쇠를 가진 쪽에서 tools/sign.mjs 로 따로 함.
set -euo pipefail
cd "$(dirname "$0")"
: "${ANDROID_HOME:?ANDROID_HOME 이 필요해요}"
BT=$ANDROID_HOME/build-tools/$(ls "$ANDROID_HOME/build-tools" | sort -V | tail -1)
PLATFORM=$(ls -d "$ANDROID_HOME"/platforms/android-* | sort -V | tail -1)
ANDROID_JAR=$PLATFORM/android.jar
VERSION_CODE=$(sed -n 's/.*android:versionCode="\([0-9]*\)".*/\1/p' AndroidManifest.xml)
VERSION_NAME=$(sed -n 's/.*android:versionName="\([^"]*\)".*/\1/p' AndroidManifest.xml)
echo "build-tools: $BT / platform: $PLATFORM / 버전 $VERSION_NAME ($VERSION_CODE)"
OUT=build
rm -rf $OUT && mkdir -p $OUT/gen $OUT/classes $OUT/dex

echo "[1/5] 리소스 컴파일"
"$BT/aapt2" compile --dir res -o $OUT/res.zip

echo "[2/5] 리소스 링크"
"$BT/aapt2" link -o $OUT/base.apk -I "$ANDROID_JAR" --manifest AndroidManifest.xml -A assets \
  --java $OUT/gen --min-sdk-version 26 --target-sdk-version 34 \
  --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" --auto-add-overlay $OUT/res.zip

echo "[3/5] 자바 컴파일"
javac --release 8 -nowarn -Xlint:-options -encoding UTF-8 -cp "$ANDROID_JAR" -d $OUT/classes \
  $(find src $OUT/gen -name '*.java')
python3 tools/strip_params.py $OUT/classes

echo "[4/5] dex 변환"
"$BT/d8" --release --min-api 26 --lib "$ANDROID_JAR" --output $OUT/dex $(find $OUT/classes -name '*.class')

echo "[5/5] APK 조립 + 정렬"
python3 tools/assemble.py $OUT/base.apk $OUT/dex/classes.dex $OUT/unsigned.apk
ls -la $OUT/unsigned.apk
