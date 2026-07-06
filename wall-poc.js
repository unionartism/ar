/* global AFRAME, THREE, XR8 */

const $ = (id) => document.getElementById(id)

const setStatus = (text) => {
  const el = $('status')
  if (el) el.textContent = text
}

const getProductById = (id) => {
  const list = window.WALL_AR_PRODUCTS || []
  return list.find((p) => p.id === id) || list[0]
}

const getSelectedProduct = () => {
  const selected = document.querySelector('.product.selected')
  return getProductById(selected?.dataset.productId)
}

const createBorder = (entity, product) => {
  const parent = $('posterBorder')
  if (!parent || !entity || !product) return

  parent.innerHTML = ''

  const thickness = 0.012
  const w = product.widthM
  const h = product.heightM

  const parts = [
    {pos: `0 ${h / 2} 0.003`, scale: `${w + thickness} ${thickness} ${thickness}`},
    {pos: `0 ${-h / 2} 0.003`, scale: `${w + thickness} ${thickness} ${thickness}`},
    {pos: `${-w / 2} 0 0.003`, scale: `${thickness} ${h + thickness} ${thickness}`},
    {pos: `${w / 2} 0 0.003`, scale: `${thickness} ${h + thickness} ${thickness}`},
  ]

  parts.forEach((p) => {
    const edge = document.createElement('a-box')
    edge.setAttribute('position', p.pos)
    edge.setAttribute('scale', p.scale)
    edge.setAttribute('material', 'shader: flat; color: #00e7ff; opacity: 0.95')
    parent.appendChild(edge)
  })

  parent.object3D.position.copy(entity.object3D.position)
  parent.object3D.quaternion.copy(entity.object3D.quaternion)
}

const applyProduct = (product) => {
  const plane = $('posterPlane')
  const border = $('posterBorder')
  if (!plane || !product) return

  plane.setAttribute('width', product.widthM)
  plane.setAttribute('height', product.heightM)
  plane.setAttribute(
    'material',
    `shader: flat; side: double; transparent: true; src: #${product.imageAssetId}`
  )

  if (border) createBorder(plane, product)
}

const cameraWorld = (cameraEl) => {
  const pos = new THREE.Vector3()
  const quat = new THREE.Quaternion()
  const dir = new THREE.Vector3()

  cameraEl.object3D.getWorldPosition(pos)
  cameraEl.object3D.getWorldQuaternion(quat)
  cameraEl.object3D.getWorldDirection(dir)

  return {pos, quat, dir}
}

const projectedHorizontal = (v) => {
  const out = new THREE.Vector3(v.x, 0, v.z)

  if (out.lengthSq() < 0.0001) {
    return new THREE.Vector3(0, 0, -1)
  }

  return out.normalize()
}

const isUiTarget = (target) => {
  if (!target) return false
  return Boolean(target.closest?.('button, .picker, .recenter, .notice, .hud'))
}

AFRAME.registerComponent('wall-poc-controller', {
  schema: {
    autoDistanceM: {default: 1.6},
    minDistanceM: {default: 0.8},
    maxDistanceM: {default: 3.0},
    distanceStepM: {default: 0.1},
    heightStepM: {default: 0.05},
    rotationStepDeg: {default: 5},
    stabilizeFrames: {default: 30},
    autoPlace: {default: true},
  },

  init() {
    this.cameraEl = $('camera')
    this.posterEl = $('posterPlane')
    this.borderEl = $('posterBorder')
    this.product = getSelectedProduct()

    this.ready = false
    this.placed = false
    this.autoPlacing = true

    this.frameCount = 0
    this.lastCamPos = null
    this.motionScore = 999

    this.wallAngleDeg = 0
    this.distanceM = this.data.autoDistanceM
    this.heightOffsetM = -0.15
    this.manualYawDeg = 0

    applyProduct(this.product)

    this.hidePoster()

    this.el.addEventListener('realityready', () => {
      this.ready = true
      this.frameCount = 0
      this.autoPlacing = true
      setStatus('트래킹 시작됨. 벽을 정면으로 비춘 뒤 천천히 움직이세요.')
    })

    this.el.addEventListener('xrtrackingstatus', (event) => {
      console.log('xrtrackingstatus:', event.detail)
    })

    this.el.addEventListener('realityerror', (event) => {
      console.error('realityerror:', event.detail)
      setStatus(`8th Wall 오류: ${event.detail?.error || '알 수 없음'}`)
    })

    document.addEventListener('productchange', (event) => {
      this.product = getProductById(event.detail.productId)
      applyProduct(this.product)

      this.placed = false
      this.autoPlacing = true
      this.frameCount = 0
      this.hidePoster()

      if (!this.ready) {
        setStatus(`${this.product.name} 선택됨. 트래킹 시작을 기다리는 중...`)
        return
      }

      setStatus(`${this.product.name} 선택됨. 벽 후보 위치를 다시 계산합니다.`)
    })

    $('recenter')?.addEventListener('click', () => {
      this.resetPlacement('재계산 중... 벽을 정면으로 비추세요.')
    })

    document.addEventListener('click', (event) => {
      if (isUiTarget(event.target)) return
      if (!this.ready) return

      const cam = cameraWorld(this.cameraEl)
      this.placeEstimatedWall(cam, {
        source: 'tap',
        keepManualAdjustments: true,
      })
    })

    this.bindOptionalAdjustmentButtons()
    this.configureXR8()
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
        }
      } catch (err) {
        console.warn('XR8 configure skipped:', err)
      }
    }

    if (window.XR8) {
      configure()
    } else {
      window.addEventListener('xrloaded', configure)
    }
  },

  bindOptionalAdjustmentButtons() {
    // 아래 버튼들은 HTML에 없어도 문제 없습니다.
    // 나중에 수동 보정 UI를 추가할 때 id만 맞추면 바로 동작합니다.
    $('distanceNear')?.addEventListener('click', () => this.adjustDistance(-this.data.distanceStepM))
    $('distanceFar')?.addEventListener('click', () => this.adjustDistance(this.data.distanceStepM))
    $('heightUp')?.addEventListener('click', () => this.adjustHeight(this.data.heightStepM))
    $('heightDown')?.addEventListener('click', () => this.adjustHeight(-this.data.heightStepM))
    $('rotateLeft')?.addEventListener('click', () => this.adjustYaw(this.data.rotationStepDeg))
    $('rotateRight')?.addEventListener('click', () => this.adjustYaw(-this.data.rotationStepDeg))
  },

  tick() {
    if (!this.cameraEl || !this.posterEl) return

    const cam = cameraWorld(this.cameraEl)

    if (this.lastCamPos) {
      this.motionScore = cam.pos.distanceTo(this.lastCamPos)
    }

    this.lastCamPos = cam.pos.clone()

    if (!this.ready) {
      setStatus('카메라/SLAM 초기화 중... 카메라 권한과 트래킹 시작을 기다리는 중')
      return
    }

    if (this.placed) {
      this.updateDiagnostics(cam)
      return
    }

    if (!this.data.autoPlace || !this.autoPlacing) {
      setStatus('벽을 정면으로 비춘 뒤 화면을 탭해서 배치하세요.')
      return
    }

    this.frameCount += 1

    const stableEnough = this.frameCount > this.data.stabilizeFrames

    if (!stableEnough) {
      const percent = Math.min(
        100,
        Math.round((this.frameCount / this.data.stabilizeFrames) * 100)
      )

      setStatus(`공간 스캔 중... ${percent}%`)
      return
    }

    this.placeEstimatedWall(cam, {
      source: 'auto',
      keepManualAdjustments: false,
    })
  },

  placeEstimatedWall(cam, options = {}) {
    const source = options.source || 'auto'
    const keepManualAdjustments = Boolean(options.keepManualAdjustments)

    const forward = projectedHorizontal(cam.dir)
    const cameraHeight =
      Number.isFinite(cam.pos.y) && Math.abs(cam.pos.y) > 0.2
        ? cam.pos.y
        : 1.55

    if (!keepManualAdjustments) {
      this.heightOffsetM = -0.15
      this.manualYawDeg = 0
    }

    const center = cam.pos.clone().add(forward.clone().multiplyScalar(this.distanceM))
    center.y = Math.max(0.8, Math.min(2.2, cameraHeight + this.heightOffsetM))

    this.posterEl.object3D.position.copy(center)

    this.posterEl.object3D.lookAt(cam.pos.x, center.y, cam.pos.z)

    // A-Frame plane 앞면 보정
    this.posterEl.object3D.rotateY(Math.PI)

    if (this.manualYawDeg !== 0) {
      this.posterEl.object3D.rotateY(THREE.MathUtils.degToRad(this.manualYawDeg))
    }

    this.posterEl.setAttribute('visible', 'true')

    if (this.borderEl) {
      this.borderEl.object3D.position.copy(this.posterEl.object3D.position)
      this.borderEl.object3D.quaternion.copy(this.posterEl.object3D.quaternion)
      this.borderEl.setAttribute('visible', 'true')
      createBorder(this.posterEl, this.product)
    }

    this.wallAngleDeg = THREE.MathUtils.radToDeg(Math.atan2(forward.x, -forward.z))
    this.placed = true
    this.autoPlacing = false

    this.updateDiagnostics(cam, source)
  },

  resetPlacement(message = '재계산 중... 벽을 정면으로 비추세요.') {
    this.placed = false
    this.autoPlacing = true
    this.frameCount = 0

    if (window.XR8?.recenter) {
      window.XR8.recenter()
    }

    this.hidePoster()

    if (!this.ready) {
      setStatus('카메라/SLAM 초기화 중... 트래킹 시작을 기다리는 중')
      return
    }

    setStatus(message)
  },

  hidePoster() {
    if (this.posterEl) this.posterEl.setAttribute('visible', 'false')
    if (this.borderEl) this.borderEl.setAttribute('visible', 'false')
  },

  adjustDistance(delta) {
    this.distanceM = THREE.MathUtils.clamp(
      this.distanceM + delta,
      this.data.minDistanceM,
      this.data.maxDistanceM
    )

    this.reapplyFromCamera('거리 조정됨')
  },

  adjustHeight(delta) {
    this.heightOffsetM = THREE.MathUtils.clamp(
      this.heightOffsetM + delta,
      -0.8,
      0.8
    )

    this.reapplyFromCamera('높이 조정됨')
  },

  adjustYaw(deltaDeg) {
    this.manualYawDeg += deltaDeg
    this.reapplyFromCamera('각도 조정됨')
  },

  reapplyFromCamera(reason) {
    if (!this.ready || !this.cameraEl) {
      setStatus('아직 트래킹이 준비되지 않았습니다.')
      return
    }

    const cam = cameraWorld(this.cameraEl)

    this.placed = false

    this.placeEstimatedWall(cam, {
      source: reason,
      keepManualAdjustments: true,
    })
  },

  updateDiagnostics(cam, source = 'fallback') {
    if (!this.posterEl || !this.posterEl.object3D) return

    const dist = cam.pos.distanceTo(this.posterEl.object3D.position)
    const productName = this.product?.name || 'image'

    setStatus(
      `${productName} | 추정거리 ${dist.toFixed(2)}m | 벽 후보각 ${this.wallAngleDeg.toFixed(0)}° | ${source} 배치`
    )
  },
})

window.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.product').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.product').forEach((b) => b.classList.remove('selected'))
      button.classList.add('selected')

      document.dispatchEvent(
        new CustomEvent('productchange', {
          detail: {
            productId: button.dataset.productId,
          },
        })
      )
    })
  })

  window.addEventListener('xrloaded', () => {
    setStatus('8th Wall Engine 로드됨. 카메라 권한을 허용하세요.')
  })

  window.addEventListener('error', (event) => {
    const message = event?.message || ''

    if (/XR8|xrextras|landing|aframe/i.test(message)) {
      console.error('script error:', event)
      setStatus(`스크립트 오류: ${message}`)
    }
  })
})