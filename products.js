window.WALL_AR_PRODUCTS = [
  {
    id: 'poster-60x90',
    name: 'Poster 60×90cm',
    label: '60×90cm',

    // index.html의 <a-assets> 내부 <img id="poster-60x90-img">와 반드시 일치해야 함
    imageAssetId: 'poster-60x90-img',

    // 실제 기준 크기, meter 단위
    widthM: 0.6,
    heightM: 0.9,

    // UI 썸네일 / 향후 동적 asset 생성 fallback 경로
    imageUrl: './assets/poster-60x90.svg',

    // 접근성 / 향후 동적 UI 생성용
    altText: '60×90cm poster preview',
  },
  {
    id: 'frame-50x70',
    name: 'Frame 50×70cm',
    label: '50×70cm',

    // index.html의 <a-assets> 내부 <img id="frame-50x70-img">와 반드시 일치해야 함
    imageAssetId: 'frame-50x70-img',

    // 실제 기준 크기, meter 단위
    widthM: 0.5,
    heightM: 0.7,

    // UI 썸네일 / 향후 동적 asset 생성 fallback 경로
    imageUrl: './assets/frame-50x70.svg',

    // 접근성 / 향후 동적 UI 생성용
    altText: '50×70cm frame preview',
  },
]