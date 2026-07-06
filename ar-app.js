/* global AFRAME, THREE, XR8 */

const $ = (id) => document.getElementById(id)

const setStatus = (text) => {
  const el = $('status')
  if (el) el.textContent = text
}

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

const isValidProduct = (product) => {
  return Boolean(
    product &&
      product.id &&
      product.name &&
      product.imageAssetId &&
      Number.isFinite(product.widthM) &&
      Number.isFinite(product.heightM) &&
      product.widthM > 0 &&
      product.heightM > 0
  )
}

const getProductById = (id) => {
  const list = Array.isArray(window.WALL_AR_PRODUCTS)
    ? window.WALL_AR_PRODUCTS
    : []

  const product = list.find((p) => p.id === id)

  if (isValidProduct(product)) return product

  const fallback = list.find(isValidProduct)

  if (!fallback) {
    console.warn('[Poster AR] valid product not found:', list)
  }

  return fallback
}

const getSelectedProduct = () => {
  const selected = document.querySelector('.product.selected')
  return getProductById(selected?.dataset.productId)
}

const projectedHorizontal = (v) => {
  const out = new THREE.Vector3(v.x, 0, v.z)

  if (out.lengthSq() < 0.0001) {
    return new THREE.Vector3(0, 0, -1)
  }

  return out.normalize()
}

const applyProductToPlane = (plane, product) => {
  if (!plane || !isValidProduct(product)) {
    console.warn('[Poster AR] invalid product:', product)
    return
  }

  plane.setAttribute('width', product.widthM)
  plane.setAttribute('height', product.heightM)

  plane.setAttribute('material', {
    shader: 'flat',
    side: 'double',
    transparent: true,
    src: `#${product.imageAssetId}`,
  })
}

const tryRecenter = () => {
  try {
    if (window.XR8?.XrController?.recenter) {
      window.XR8.XrController.recenter()
      return true
    }

    if (window.XR8?.recenter) {
      window.XR8.recenter()
      return true
    }

    if (window.XR?.recenter) {
      window.XR.recenter()
      return true
    }
  } catch (err) {
    console.warn('[Poster AR] recenter failed:', err)
  }

  return false
}

AFRAME.registerComponent('poster-ar-app', {
  schema: {
    defaultDistanceM: {default: 1.6},
    minScale: {default: 0.35},
    maxScale: {default: 3.0},
    scaleStep: {default: 0.08},
    moveStepM: {default: 0.04},
    depthStepM: {default: 0.05},
    rotateStepDeg: {default: 3},
  },

  init() {
    this.cameraEl = $('camera')
    this.posterEl = $('posterPlane')
    this.borderEl = $('posterBorder')

    this.ready = false
    this.sceneLoaded = false
    this.placed = false

    this.product = getSelectedProduct()
    this.posterScale = 1
    this.baseQuaternion = null

    applyProductToPlane(this.posterEl, this.product)
    this.hidePoster()
    this.setPlacedState(false)

    this.bindSceneEvents()
    this.bindUI()
    this.configureXR8()

    console.log('[Poster AR] component initialized', {
      cameraEl: this.cameraEl,
      posterEl: this.posterEl,
      borderEl: this.borderEl,
      product: this.product,
    })

    setStatus('8th Wall Engine 로딩 중...')
  },

  bindSceneEvents() {
    this.el.addEventListener('loaded', () => {
      this.sceneLoaded = true

      console.log('[Poster AR] scene loaded')

      setStatus('Scene 로드됨. 카메라 권한을 허용하세요.')
    })

    this.el.addEventListener('renderstart', () => {
      this.sceneLoaded = true

      console.log('[Poster AR] renderstart')

      if (!this.ready) {
        setStatus('AR 렌더링 시작됨. 트래킹이 잡히면 “이미지 배치”를 누르세요.')
      }
    })

    this.el.addEventListener('realityready', () => {
      this.ready = true
      this.sceneLoaded = true

      console.log('[Poster AR] realityready')

      setStatus('트래킹 시작됨. 벽 앞에서 화면 중앙을 맞춘 뒤 “이미지 배치”를 누르세요.')
    })

    this.el.addEventListener('realityerror', (event) => {
      console.error('[Poster AR] realityerror:', event.detail)

      setStatus(`8th Wall 오류: ${event.detail?.error || '알 수 없음'}`)
    })

    this.el.addEventListener('xrtrackingstatus', (event) => {
      console.log('[Poster AR] xrtrackingstatus:', event.detail)
    })
  },

  configureXR8() {
    const configure = () => {
      try {
        if (window.XR8?.XrController) {
          window.XR8.XrController.configure({
            disableWorldTracking: false,
            enableLighting: true,
            scale: 'absolute',
          })

          console.log('[Poster AR] XR8 configured')
        }
      } catch (err) {
        console.warn('[Poster AR] XR8 configure skipped:', err)
      }
    }

    if (window.XR8) {
      configure()
    } else {
      window.addEventListener('xrloaded', configure, {once: true})
    }
  },

  bindUI() {
    const placeButton = $('placePoster')

    if (!placeButton) {
      console.error('[Poster AR] #placePoster button not found')
    }

    placeButton?.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()

      console.log('[Poster AR] place button clicked')

      setStatus('이미지 배치 버튼 눌림. 포스터 생성 시도 중...')

      this.placePosterAtCenter()
    })

    $('resetPlacement')?.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()

      this.hidePoster()
      this.baseQuaternion = null
      this.setPlacedState(false)

      setStatus('다시 배치할 위치를 화면 중앙에 맞춘 뒤 “이미지 배치”를 누르세요.')
    })

    $('recenter')?.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()

      const ok = tryRecenter()

      if (ok) {
        setStatus('트래킹 기준을 다시 계산했습니다. 필요하면 이미지를 다시 배치하세요.')
      } else {
        setStatus('recenter 기능을 아직 사용할 수 없습니다. 트래킹이 시작된 뒤 다시 시도하세요.')
      }
    })

    $('scaleDown')?.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()

      this.adjustScale(-this.data.scaleStep)
    })

    $('scaleUp')?.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()

      this.adjustScale(this.data.scaleStep)
    })

    $('scaleReset')?.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()

      this.setScale(1)
    })

    $('scaleFit')?.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()

      this.fitToActualSize()
    })

    $('moveUp')?.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()

      this.movePosterLocal(0, this.data.moveStepM, 0)
    })

    $('moveDown')?.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()

      this.movePosterLocal(0, -this.data.moveStepM, 0)
    })

    $('moveCloser')?.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()

      this.movePosterDepth(this.data.depthStepM)
    })

    $('moveFarther')?.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()

      this.movePosterDepth(-this.data.depthStepM)
    })

    $('rotateLeft')?.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()

      this.rotatePosterYaw(THREE.MathUtils.degToRad(this.data.rotateStepDeg))
    })

    $('rotateRight')?.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()

      this.rotatePosterYaw(THREE.MathUtils.degToRad(-this.data.rotateStepDeg))
    })

    $('rotateReset')?.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()

      this.resetPosterRotation()
    })

    document.querySelectorAll('.product').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()

        document.querySelectorAll('.product').forEach((b) => {
          b.classList.remove('selected')
        })

        button.classList.add('selected')

        const nextProduct = getProductById(button.dataset.productId)

        if (!isValidProduct(nextProduct)) {
          console.error('[Poster AR] invalid selected product:', {
            productId: button.dataset.productId,
            product: nextProduct,
          })

          setStatus('상품 정보를 찾을 수 없습니다. products.js를 확인하세요.')
          return
        }

        this.product = nextProduct
        this.posterScale = 1
        this.baseQuaternion = null

        applyProductToPlane(this.posterEl, this.product)

        this.hidePoster()
        this.setPlacedState(false)

        console.log('[Poster AR] product selected:', this.product)

        setStatus(`${this.product.name} 선택됨. 화면 중앙을 맞춘 뒤 “이미지 배치”를 누르세요.`)
      })
    })

    window.addEventListener('xrloaded', () => {
      console.log('[Poster AR] xrloaded')

      setStatus('8th Wall Engine 로드됨. 카메라 권한을 허용하세요.')
    })

    window.addEventListener('error', (event) => {
      console.error('[Poster AR] window error:', event)
    })

    console.log('[Poster AR] UI bound')
  },

  placePosterAtCenter() {
    console.log('[Poster AR] placePosterAtCenter called', {
      sceneLoaded: this.sceneLoaded,
      ready: this.ready,
      cameraEl: this.cameraEl,
      posterEl: this.posterEl,
      product: this.product,
    })

    if (!this.cameraEl || !this.posterEl || !this.product) {
      console.error('[Poster AR] missing required elements', {
        cameraEl: this.cameraEl,
        posterEl: this.posterEl,
        product: this.product,
      })

      setStatus('AR 요소를 찾을 수 없습니다. camera, posterPlane, products.js를 확인하세요.')
      return
    }

    if (!this.sceneLoaded) {
      setStatus('아직 Scene이 준비되지 않았습니다. 잠시 후 다시 누르세요.')
      return
    }

    if (!this.ready) {
      console.warn('[Poster AR] tracking is not ready yet, but placing for debug')
      setStatus('트래킹 준비 전이지만 디버그 배치를 시도합니다.')
    }

    this.el.object3D.updateMatrixWorld(true)
    this.cameraEl.object3D.updateMatrixWorld(true)

    const camPos = new THREE.Vector3()
    const camDir = new THREE.Vector3()

    this.cameraEl.object3D.getWorldPosition(camPos)
    this.cameraEl.object3D.getWorldDirection(camDir)

    console.log('[Poster AR] camera info', {
      camPos: camPos.clone(),
      camDir: camDir.clone(),
    })

    const forward = projectedHorizontal(camDir)

    const cameraHeight =
      Number.isFinite(camPos.y) && Math.abs(camPos.y) > 0.2
        ? camPos.y
        : 1.55

    const center = camPos
      .clone()
      .add(forward.clone().multiplyScalar(this.data.defaultDistanceM))

    center.y = Math.max(0.8, Math.min(2.2, cameraHeight - 0.15))

    const posterObj = this.posterEl.object3D

    posterObj.position.copy(center)

    // 배치 순간 카메라를 바라보게 한다.
    posterObj.lookAt(camPos.x, center.y, camPos.z)

    // a-plane 앞면 방향 보정
    posterObj.rotateY(Math.PI)

    // 회전 초기화를 위해 배치 순간의 기본 회전을 저장한다.
    this.baseQuaternion = posterObj.quaternion.clone()

    // 디버깅용: material을 한 번 더 확실히 적용한다.
    applyProductToPlane(this.posterEl, this.product)

    this.setScale(this.posterScale, {silent: true})

    this.posterEl.setAttribute('visible', 'true')
    posterObj.visible = true

    this.setPlacedState(true)
    this.syncBorder()

    console.log('[Poster AR] placed', {
      camera: camPos.clone(),
      cameraDirection: camDir.clone(),
      forward: forward.clone(),
      center: center.clone(),
      product: this.product,
      scale: this.posterScale,
      visibleAttribute: this.posterEl.getAttribute('visible'),
      objectVisible: this.posterEl.object3D.visible,
      posterPosition: this.posterEl.object3D.position.clone(),
      posterRotation: this.posterEl.object3D.rotation.clone(),
    })

    setStatus(
      `${this.product.name} 배치됨 | 크기 ${Math.round(this.posterScale * 100)}% | 공간에 고정됨`
    )
  },

  adjustScale(delta) {
    if (!this.placed) {
      setStatus('먼저 이미지를 배치하세요.')
      return
    }

    this.setScale(this.posterScale + delta)
  },

  setScale(scale, options = {}) {
    this.posterScale = clamp(scale, this.data.minScale, this.data.maxScale)

    if (!this.posterEl || !this.product) return

    this.posterEl.setAttribute('width', this.product.widthM * this.posterScale)
    this.posterEl.setAttribute('height', this.product.heightM * this.posterScale)

    this.syncBorder()

    if (!options.silent) {
      setStatus(
        `${this.product.name} | 크기 ${Math.round(this.posterScale * 100)}% | ${this.placed ? '공간에 고정됨' : '배치 전'}`
      )
    }
  },

  fitToActualSize() {
    if (!this.product) {
      setStatus('상품 정보를 찾을 수 없습니다.')
      return
    }

    this.setScale(1)

    setStatus(
      `${this.product.name} | 실제 기준 크기 100%로 맞춤 | ${this.placed ? '공간에 고정됨' : '배치 전'}`
    )
  },

  movePosterLocal(x, y, z) {
    if (!this.placed || !this.posterEl) {
      setStatus('먼저 이미지를 배치하세요.')
      return
    }

    const origin = new THREE.Vector3()
    const target = new THREE.Vector3(x, y, z)

    this.posterEl.object3D.localToWorld(origin)
    this.posterEl.object3D.localToWorld(target)

    const worldDelta = target.sub(origin)

    this.posterEl.object3D.position.add(worldDelta)
    this.syncBorder()

    setStatus(`${this.product.name} 위치 조정됨 | 공간에 고정됨`)
  },

  movePosterDepth(deltaM) {
    if (!this.placed || !this.posterEl || !this.cameraEl) {
      setStatus('먼저 이미지를 배치하세요.')
      return
    }

    this.cameraEl.object3D.updateMatrixWorld(true)
    this.posterEl.object3D.updateMatrixWorld(true)

    const camPos = new THREE.Vector3()
    const posterPos = new THREE.Vector3()

    this.cameraEl.object3D.getWorldPosition(camPos)
    this.posterEl.object3D.getWorldPosition(posterPos)

    const towardCamera = camPos.clone().sub(posterPos)
    towardCamera.y = 0

    if (towardCamera.lengthSq() < 0.0001) {
      const camDir = new THREE.Vector3()
      this.cameraEl.object3D.getWorldDirection(camDir)
      towardCamera.copy(projectedHorizontal(camDir).multiplyScalar(-1))
    } else {
      towardCamera.normalize()
    }

    this.posterEl.object3D.position.add(towardCamera.multiplyScalar(deltaM))
    this.syncBorder()

    setStatus(
      `${this.product.name} ${deltaM > 0 ? '가까이 이동됨' : '멀리 이동됨'} | 공간에 고정됨`
    )
  },

  rotatePosterYaw(deltaRad) {
    if (!this.placed || !this.posterEl) {
      setStatus('먼저 이미지를 배치하세요.')
      return
    }

    this.posterEl.object3D.rotateY(deltaRad)
    this.syncBorder()

    setStatus(`${this.product.name} 회전 조정됨 | 공간에 고정됨`)
  },

  resetPosterRotation() {
    if (!this.placed || !this.posterEl) {
      setStatus('먼저 이미지를 배치하세요.')
      return
    }

    if (!this.baseQuaternion) {
      setStatus('초기 회전값이 없습니다. 이미지를 다시 배치하세요.')
      return
    }

    this.posterEl.object3D.quaternion.copy(this.baseQuaternion)
    this.syncBorder()

    setStatus(`${this.product.name} 회전 초기화됨 | 공간에 고정됨`)
  },

  syncBorder() {
    if (!this.posterEl || !this.borderEl || !this.product) return

    this.borderEl.innerHTML = ''

    const thickness = 0.012
    const w = this.product.widthM * this.posterScale
    const h = this.product.heightM * this.posterScale

    const parts = [
      {
        pos: `0 ${h / 2} 0.004`,
        scale: `${w + thickness} ${thickness} ${thickness}`,
      },
      {
        pos: `0 ${-h / 2} 0.004`,
        scale: `${w + thickness} ${thickness} ${thickness}`,
      },
      {
        pos: `${-w / 2} 0 0.004`,
        scale: `${thickness} ${h + thickness} ${thickness}`,
      },
      {
        pos: `${w / 2} 0 0.004`,
        scale: `${thickness} ${h + thickness} ${thickness}`,
      },
    ]

    parts.forEach((p) => {
      const edge = document.createElement('a-box')

      edge.setAttribute('position', p.pos)
      edge.setAttribute('scale', p.scale)
      edge.setAttribute('material', 'shader: flat; color: #00e7ff; opacity: 0.95')

      this.borderEl.appendChild(edge)
    })

    this.borderEl.object3D.position.copy(this.posterEl.object3D.position)
    this.borderEl.object3D.quaternion.copy(this.posterEl.object3D.quaternion)

    const visible = Boolean(this.posterEl.object3D.visible)

    this.borderEl.setAttribute('visible', visible)
    this.borderEl.object3D.visible = visible
  },

  hidePoster() {
    if (this.posterEl) {
      this.posterEl.setAttribute('visible', 'false')
      this.posterEl.object3D.visible = false
    }

    if (this.borderEl) {
      this.borderEl.setAttribute('visible', 'false')
      this.borderEl.object3D.visible = false
    }
  },

  setPlacedState(placed) {
    this.placed = placed
    document.body?.classList.toggle('poster-placed', placed)
  },

  tick() {
    // 의도적으로 비워둔다.
    // 배치 후 포스터가 카메라를 따라오지 않도록 매 프레임 위치 갱신을 하지 않는다.
  },
})