# 8th Wall Wall AR PoC

앱 설치 없이 iOS Safari / Android Chrome에서 8th Wall Engine Binary 기반 SLAM이 실제로 동작하는지 확인하기 위한 GitHub Pages용 PoC입니다.

## 목적

이 PoC는 다음을 검증합니다.

1. GitHub Pages 정적 호스팅에서 8th Wall Engine Binary가 로드되는지
2. iOS Safari / Android Chrome에서 카메라와 world tracking이 켜지는지
3. `scale: absolute`로 미터 단위 배치가 안정적인지
4. 60×90cm, 50×70cm 이미지 plane이 실제 크기에 가깝게 보이는지
5. 카메라 이동 시 이미지가 월드에 고정되는지

## 중요한 한계

8th Wall World Effects는 SLAM/world tracking을 제공하지만, 이 PoC에서 쓰는 공개 A-Frame/XR8 경로는 “실제 벽면 vertical plane 자동 분류”를 직접 반환하지 않습니다.

그래서 이 PoC는 벽을 자동 검출했다고 속이지 않고, 카메라가 바라보는 방향에 **수직 벽 후보 plane**을 만들고 8th Wall SLAM으로 고정합니다. 이것이 실제 사용감에 충분하지 않으면 Blippar Surface Tracking, Mattercraft, WebXR native plane detection fallback을 추가 비교해야 합니다.

## 업로드 방법

GitHub repo 루트에 아래 파일을 그대로 업로드합니다.

```text
index.html
style.css
wall-poc.js
products.js
README.md
assets/
  poster-60x90.svg
  frame-50x70.svg
```

GitHub Pages 설정:

```text
Settings → Pages → Deploy from a branch → main / root
```

## 테스트 방법

1. iPhone Safari 또는 Android Chrome으로 Pages URL 접속
2. 카메라 권한 허용
3. 벽을 비추고 천천히 좌우로 움직이기
4. 이미지가 자동 배치되는지 확인
5. “다시 계산”으로 재배치 테스트

## 판정 기준

성공:

- 카메라가 정상 실행된다.
- 8th Wall tracking이 시작된다.
- 이미지가 미터 단위 크기로 월드에 고정된다.
- 사용자가 움직여도 이미지가 심하게 미끄러지지 않는다.

실패 또는 미흡:

- 벽 거리/기울기를 정확히 못 맞춘다.
- 이미지가 실제 벽면에 붙어 보이지 않는다.
- 수직 벽 자동 분류가 없어 제품 요구사항에 부족하다.

이 경우 8th Wall은 후보에서 제외하거나, “vertical surface placement” 같은 사용자 1회 보정 방식으로만 쓸 수 있습니다.
