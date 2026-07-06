import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

const $ = (id) => document.getElementById(id);

const setStatus = (text) => {
  const el = $("status");
  if (el) el.textContent = text;
};

const setLog = (text) => {
  const el = $("webxrLog");
  if (el) el.textContent = text;
};

const getProductById = (id) => {
  const list = window.WALL_AR_PRODUCTS || [];
  return list.find((p) => p.id === id) || list[0];
};

const getDefaultProduct = () => {
  const params = new URLSearchParams(window.location.search);
  const productId = params.get("product");
  return getProductById(productId);
};

const FALLBACK_URL = "./8thwall-fallback.html";
const SHOW_MANUAL_HINT_AFTER_FRAMES = 120;
const SLOW_DETECTION_AFTER_FRAMES = 360;
const DEFAULT_DISTANCE_M = 1.6;

let renderer = null;
let scene = null;
let camera = null;

let xrSession = null;
let xrReferenceSpace = null;
let hitTestSource = null;
let hitTestSourceRequested = false;
let planeDetectionMode = false;

let posterRoot = null;
let posterMesh = null;
let latestHitPose = null;

let frameWithoutPlane = 0;
let placed = false;
let started = false;

let slowDetectionNoticeShown = false;

const product = getDefaultProduct();

function goFallback(reason) {
  console.warn("Go fallback:", reason);
  setStatus("벽면 감지 실패. 8th Wall 수동 모드로 이동합니다.");
  setLog(`Fallback reason: ${reason}`);

  window.setTimeout(() => {
    window.location.href = FALLBACK_URL;
  }, 500);
}

function setupThree() {
  const canvas = $("xrCanvas");

  renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
  });

  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType("local-floor");

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera();

  const ambient = new THREE.AmbientLight(0xffffff, 1.0);
  scene.add(ambient);

  const directional = new THREE.DirectionalLight(0xffffff, 0.8);
  directional.position.set(0, 4, 2);
  scene.add(directional);

  createPosterObject();

  window.addEventListener("resize", () => {
    if (!renderer) return;
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

function createPosterObject() {
  if (!product) {
    setStatus("상품 데이터가 없습니다. products.js를 확인하세요.");
    return;
  }

  posterRoot = new THREE.Group();
  posterRoot.visible = false;

  const texture = new THREE.TextureLoader().load(
    product.imageUrl,
    () => {
      setLog(`${product.name} 이미지 로드 완료`);
    },
    undefined,
    (err) => {
      console.warn("Texture load failed:", err);
      setLog(`${product.name} 이미지 로드 실패. assets 경로를 확인하세요.`);
    },
  );

  texture.colorSpace = THREE.SRGBColorSpace;

  const geometry = new THREE.PlaneGeometry(product.widthM, product.heightM);

  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    side: THREE.DoubleSide,
  });

  posterMesh = new THREE.Mesh(geometry, material);
  posterRoot.add(posterMesh);

  createPosterBorder(posterRoot, product);

  scene.add(posterRoot);
}

function createPosterBorder(root, productData) {
  const thickness = 0.012;
  const depth = 0.006;
  const w = productData.widthM;
  const h = productData.heightM;

  const borderMaterial = new THREE.MeshBasicMaterial({
    color: 0x00e7ff,
    transparent: true,
    opacity: 0.95,
  });

  const parts = [
    {
      position: [0, h / 2, 0.004],
      size: [w + thickness, thickness, depth],
    },
    {
      position: [0, -h / 2, 0.004],
      size: [w + thickness, thickness, depth],
    },
    {
      position: [-w / 2, 0, 0.004],
      size: [thickness, h + thickness, depth],
    },
    {
      position: [w / 2, 0, 0.004],
      size: [thickness, h + thickness, depth],
    },
  ];

  parts.forEach((part) => {
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(part.size[0], part.size[1], part.size[2]),
      borderMaterial,
    );

    box.position.set(part.position[0], part.position[1], part.position[2]);
    root.add(box);
  });
}

async function requestSessionWithPlaneDetection() {
  return navigator.xr.requestSession("immersive-ar", {
    requiredFeatures: ["local-floor", "plane-detection"],
    optionalFeatures: ["hit-test", "anchors", "dom-overlay"],
    domOverlay: {
      root: document.body,
    },
  });
}

async function requestSessionWithHitTestOnly() {
  return navigator.xr.requestSession("immersive-ar", {
    requiredFeatures: ["local-floor"],
    optionalFeatures: ["hit-test", "anchors", "dom-overlay"],
    domOverlay: {
      root: document.body,
    },
  });
}

async function startWebXR() {
  if (started) return;

  started = true;
  const startButton = $("startWebXR");
  const placeButton = $("placeManual");

  if (startButton) startButton.disabled = true;

  if (!navigator.xr) {
    goFallback("navigator.xr 없음");
    return;
  }

  if (!product) {
    goFallback("상품 데이터 없음");
    return;
  }

  setStatus("WebXR AR 세션 요청 중...");
  setLog("plane-detection 세션을 먼저 요청합니다.");

  setupThree();

  try {
    xrSession = await requestSessionWithPlaneDetection();
    planeDetectionMode = true;
    setStatus("WebXR plane-detection 모드 시작됨");
    setLog("벽을 향해 카메라를 천천히 좌우로 움직이세요.");
  } catch (planeErr) {
    console.warn("plane-detection session failed:", planeErr);

    try {
      xrSession = await requestSessionWithHitTestOnly();
      planeDetectionMode = false;
      setStatus("plane-detection 미지원. hit-test 모드로 시작됨");
      setLog("화면 중앙을 벽에 맞춘 뒤 “중앙에 배치”를 누르세요.");
    } catch (hitErr) {
      console.warn("hit-test session failed:", hitErr);
      goFallback("WebXR plane-detection / hit-test 세션 모두 실패");
      return;
    }
  }

  xrSession.addEventListener("end", () => {
    setStatus("WebXR 세션이 종료되었습니다.");
    setLog("다시 시작하려면 페이지를 새로고침하세요.");
  });

  try {
    await renderer.xr.setSession(xrSession);
  } catch (err) {
    console.warn("renderer.xr.setSession failed:", err);
    goFallback("Three.js XR 세션 연결 실패");
    return;
  }

  xrReferenceSpace = renderer.xr.getReferenceSpace();

  if (placeButton) {
    placeButton.disabled = false;
  }

  renderer.setAnimationLoop(onXRFrame);
}

async function ensureHitTestSource() {
  if (!xrSession || hitTestSourceRequested) return;

  hitTestSourceRequested = true;

  try {
    const viewerSpace = await xrSession.requestReferenceSpace("viewer");
    hitTestSource = await xrSession.requestHitTestSource({
      space: viewerSpace,
    });

    setLog("hit-test source 준비됨. 화면 중앙 기준 배치도 가능합니다.");
  } catch (err) {
    console.warn("requestHitTestSource failed:", err);
    setLog(
      "hit-test source를 만들 수 없습니다. plane-detection 또는 fallback을 사용합니다.",
    );
  }
}

function onXRFrame(time, frame) {
  if (!frame || !xrSession) {
    renderer.render(scene, camera);
    return;
  }

  if (!xrReferenceSpace) {
    xrReferenceSpace = renderer.xr.getReferenceSpace();
  }

  if (!xrReferenceSpace) {
    renderer.render(scene, camera);
    return;
  }

  if (!hitTestSourceRequested) {
    ensureHitTestSource();
  }

  // hit-test pose는 계속 업데이트한다.
  // plane detection이 늦어도 사용자가 “중앙에 배치”를 누를 수 있게 하기 위함.
  if (!placed) {
    updateLatestHitPose(frame);
  }

  if (!placed && planeDetectionMode) {
    const found = tryPlaceOnDetectedVerticalPlane(frame);

    if (found) {
      placed = true;
      frameWithoutPlane = 0;
      slowDetectionNoticeShown = false;

      setStatus("실제 vertical plane 감지됨. 포스터를 벽면에 배치했습니다.");
      setLog(
        `${product.name} | ${product.widthM}m × ${product.heightM}m | plane-detection 배치`,
      );

      renderer.render(scene, camera);
      return;
    }

    frameWithoutPlane += 1;

    if (frameWithoutPlane < SHOW_MANUAL_HINT_AFTER_FRAMES) {
      const percent = Math.min(
        100,
        Math.round((frameWithoutPlane / SHOW_MANUAL_HINT_AFTER_FRAMES) * 100),
      );

      setStatus(`자동 벽면 정렬 시도 중... ${percent}%`);
      setLog(
        "벽에 질감, 모서리, 그림자 등이 보이도록 천천히 좌우로 움직이세요.",
      );
    } else if (frameWithoutPlane < SLOW_DETECTION_AFTER_FRAMES) {
      setStatus(
        "자동 정렬이 늦어지고 있습니다. 원하면 “중앙에 배치”를 누르세요.",
      );
      setLog(
        "자동 감지는 계속 시도 중입니다. 흰 벽이나 민무늬 벽은 감지가 늦을 수 있습니다.",
      );
    } else {
      if (!slowDetectionNoticeShown) {
        slowDetectionNoticeShown = true;
        console.warn(
          "Plane detection is slow. Keeping manual placement available.",
        );
      }

      setStatus(
        "자동 정렬이 어렵습니다. 화면 중앙을 벽에 맞춘 뒤 “중앙에 배치”를 누르세요.",
      );
      setLog("감지는 계속 유지됩니다. 벽면이 잡히면 자동 정렬될 수 있습니다.");
    }
  }

  renderer.render(scene, camera);
}

function tryPlaceOnDetectedVerticalPlane(frame) {
  const detectedPlanes = frame.detectedPlanes;

  if (!detectedPlanes || detectedPlanes.size === 0) {
    return false;
  }

  const result = findBestVerticalPlane(frame, detectedPlanes);

  if (!result) {
    return false;
  }

  placePosterOnWallInfo(result, "plane-detection");
  return true;
}

function findBestVerticalPlane(frame, planes) {
  let best = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const plane of planes) {
    const info = getPlaneWorldInfo(frame, plane);
    if (!info) continue;

    const apiSaysVertical = plane.orientation === "vertical";
    const inferredVertical = Math.abs(info.normal.y) < 0.5;

    if (!apiSaysVertical && !inferredVertical) {
      continue;
    }

    if (!isGoodWallPlane(info)) {
      continue;
    }

    const score = scoreWallPlane(info);

    if (score < bestScore) {
      bestScore = score;
      best = info;
    }
  }

  return best;
}

function updateLatestHitPose(frame) {
  if (!hitTestSource || !xrReferenceSpace) return;

  const hits = frame.getHitTestResults(hitTestSource);

  if (!hits || hits.length === 0) {
    latestHitPose = null;
    return;
  }

  latestHitPose = hits[0].getPose(xrReferenceSpace);
}

function placePosterFromPose(pose, source) {
  if (!pose || !posterRoot) return;

  const position = xrPositionToVector3(pose.transform.position);
  const rawQuaternion = xrOrientationToQuaternion(pose.transform.orientation);

  let normal = new THREE.Vector3(0, 0, 1)
    .applyQuaternion(rawQuaternion)
    .normalize();

  const cam = getCameraWorldInfo();
  const toCamera = cam.position.clone().sub(position).normalize();

  if (normal.dot(toCamera) < 0) {
    normal.negate();
  }

  const quaternion = buildWallAlignedQuaternion(normal);

  posterRoot.position.copy(position);
  posterRoot.quaternion.copy(quaternion);
  posterRoot.position.add(normal.clone().multiplyScalar(0.01));
  posterRoot.visible = true;

  setStatus(`${product.name} 배치됨`);
  setLog(`${source} 기준 배치 | ${product.widthM}m × ${product.heightM}m`);
}

function placePosterInFrontOfCamera() {
  if (!posterRoot || !camera) return;

  const cameraPosition = new THREE.Vector3();
  const cameraDirection = new THREE.Vector3();

  camera.getWorldPosition(cameraPosition);
  camera.getWorldDirection(cameraDirection);

  cameraDirection.y = 0;

  if (cameraDirection.lengthSq() < 0.0001) {
    cameraDirection.set(0, 0, -1);
  }

  cameraDirection.normalize();

  const center = cameraPosition
    .clone()
    .add(cameraDirection.clone().multiplyScalar(DEFAULT_DISTANCE_M));
  center.y = Math.max(1.1, Math.min(1.7, cameraPosition.y - 0.15));

  posterRoot.position.copy(center);
  posterRoot.lookAt(cameraPosition.x, center.y, cameraPosition.z);
  posterRoot.rotateY(Math.PI);
  posterRoot.visible = true;

  placed = true;

  setStatus("화면 중앙 후보 위치에 포스터를 배치했습니다.");
  setLog(
    `${product.name} | 추정거리 ${DEFAULT_DISTANCE_M.toFixed(1)}m | 수동 중앙 배치`,
  );
}

function placeManual() {
  if (latestHitPose) {
    placePosterFromPose(latestHitPose, "hit-test");
    placed = true;
    frameWithoutPlane = 0;

    setStatus("hit-test 위치에 포스터를 배치했습니다.");
    setLog(
      "hit-test 결과를 사용했습니다. 벽과 안 맞으면 수동 모드에서 거리/각도를 조정하세요.",
    );
    return;
  }

  placePosterInFrontOfCamera();
}

function facePosterTowardCameraIfNeeded() {
  if (!posterRoot || !camera) return;

  const cameraPosition = new THREE.Vector3();
  const posterPosition = new THREE.Vector3();

  camera.getWorldPosition(cameraPosition);
  posterRoot.getWorldPosition(posterPosition);

  const toCamera = cameraPosition.sub(posterPosition).normalize();
  const posterNormal = new THREE.Vector3(0, 0, 1)
    .applyQuaternion(posterRoot.quaternion)
    .normalize();

  const facingScore = posterNormal.dot(toCamera);

  // poster의 앞면이 카메라 반대 방향을 보고 있으면 180도 돌린다.
  if (facingScore < 0) {
    posterRoot.rotateY(Math.PI);
  }
}

function xrMatrixToMatrix4(matrix) {
  return new THREE.Matrix4().fromArray(matrix);
}

function getCameraWorldInfo() {
  const position = new THREE.Vector3();
  const direction = new THREE.Vector3();

  camera.getWorldPosition(position);
  camera.getWorldDirection(direction);

  direction.normalize();

  return {
    position,
    direction,
  };
}

function getPlaneWorldInfo(frame, plane) {
  const pose = frame.getPose(plane.planeSpace, xrReferenceSpace);
  if (!pose) return null;

  const matrix = xrMatrixToMatrix4(pose.transform.matrix);
  const quaternion = xrOrientationToQuaternion(pose.transform.orientation);

  let localCenter = new THREE.Vector3(0, 0, 0);

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  if (plane.polygon && plane.polygon.length > 0) {
    plane.polygon.forEach((point) => {
      localCenter.x += point.x;
      localCenter.y += point.y;
      localCenter.z += point.z;

      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y);
      minZ = Math.min(minZ, point.z);
      maxZ = Math.max(maxZ, point.z);
    });

    localCenter.divideScalar(plane.polygon.length);
  }

  const worldCenter = localCenter.clone().applyMatrix4(matrix);

  let width = 0;
  let height = 0;

  if (Number.isFinite(minX)) {
    width = Math.max(maxX - minX, maxZ - minZ);
    height = Math.max(maxY - minY, maxZ - minZ);
  }

  let normal = new THREE.Vector3(0, 0, 1)
    .applyQuaternion(quaternion)
    .normalize();

  const cam = getCameraWorldInfo();
  const toCamera = cam.position.clone().sub(worldCenter).normalize();

  // normal이 카메라 반대 방향이면 뒤집는다.
  if (normal.dot(toCamera) < 0) {
    normal.negate();
  }

  return {
    plane,
    pose,
    position: worldCenter,
    normal,
    width,
    height,
    distance: worldCenter.distanceTo(cam.position),
  };
}

function buildWallAlignedQuaternion(normal) {
  const zAxis = normal.clone().normalize();
  const worldUp = new THREE.Vector3(0, 1, 0);

  // 포스터의 위쪽을 항상 월드 위쪽으로 맞춘다.
  const yAxis = worldUp
    .clone()
    .sub(zAxis.clone().multiplyScalar(worldUp.dot(zAxis)));

  if (yAxis.lengthSq() < 0.0001) {
    yAxis.set(0, 1, 0);
  }

  yAxis.normalize();

  const xAxis = yAxis.clone().cross(zAxis).normalize();

  const matrix = new THREE.Matrix4();
  matrix.makeBasis(xAxis, yAxis, zAxis);

  const quaternion = new THREE.Quaternion();
  quaternion.setFromRotationMatrix(matrix);

  return quaternion;
}

function isGoodWallPlane(info) {
  if (!info) return false;

  const cam = getCameraWorldInfo();
  const toPlane = info.position.clone().sub(cam.position).normalize();

  const frontScore = cam.direction.dot(toPlane);

  // 카메라 앞쪽에 있는 plane만 사용
  if (frontScore < 0.25) return false;

  // 너무 가까운/먼 plane 제외
  if (info.distance < 0.35 || info.distance > 4.0) return false;

  // normal이 위/아래를 많이 향하면 벽이 아니라 바닥/천장일 가능성
  if (Math.abs(info.normal.y) > 0.55) return false;

  return true;
}

function scoreWallPlane(info) {
  const cam = getCameraWorldInfo();
  const toPlane = info.position.clone().sub(cam.position).normalize();

  // 화면 중앙에 가까울수록 좋음
  const centerScore = 1 - cam.direction.dot(toPlane);

  // 기본 거리 1.6m 근처 선호
  const distanceScore = Math.abs(info.distance - DEFAULT_DISTANCE_M);

  // 제품이 들어갈 만한 plane이면 보너스
  const sizeBonus =
    info.width >= product.widthM * 0.5 && info.height >= product.heightM * 0.5
      ? -0.25
      : 0.15;

  return centerScore * 2.0 + distanceScore * 0.6 + sizeBonus;
}

function placePosterOnWallInfo(info, source) {
  if (!info || !posterRoot) return;

  const quaternion = buildWallAlignedQuaternion(info.normal);

  posterRoot.position.copy(info.position);
  posterRoot.quaternion.copy(quaternion);

  // z-fighting 방지: 벽에서 살짝 앞으로 띄움
  posterRoot.position.add(info.normal.clone().multiplyScalar(0.01));

  posterRoot.visible = true;

  setStatus(`${product.name} 벽면에 배치됨`);
  setLog(
    `${source} | 거리 ${info.distance.toFixed(2)}m | normal ${info.normal.x.toFixed(2)}, ${info.normal.y.toFixed(2)}, ${info.normal.z.toFixed(2)}`,
  );
}

function xrPositionToVector3(position) {
  return new THREE.Vector3(position.x, position.y, position.z);
}

function xrOrientationToQuaternion(orientation) {
  return new THREE.Quaternion(
    orientation.x,
    orientation.y,
    orientation.z,
    orientation.w,
  );
}

function bindUI() {
  $("startWebXR")?.addEventListener("click", startWebXR);

  $("placeManual")?.addEventListener("click", () => {
    if (!started) {
      setStatus("먼저 벽 감지 시작을 누르세요.");
      return;
    }

    placeManual();
  });

  $("manualFallback")?.addEventListener("click", () => {
    goFallback("사용자가 수동 모드 선택");
  });
}

bindUI();
setStatus("Android Chrome WebXR 준비 완료. “벽 감지 시작”을 누르세요.");
setLog("실제 vertical plane detection을 먼저 시도합니다.");
