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

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

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

const createBorder = (entity, product, scale = 1) => {
  const parent = $('posterBorder')
  if (!parent || !entity || !product) return

  parent.innerHTML = ''

  const thickness = 0.012
  const w = product.widthM * scale
  const h = product.heightM * scale

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
    parent.appendChild(edge)
  })

  parent.object3D.position.copy(entity.object3D.position)
  parent.object3D.quaternion.copy(entity.object3D.quaternion)
}

const applyProductToPlane = (product) => {
  const plane = $('posterPlane')
  if (!plane || !product) return

  plane.setAttribute('width', product.widthM)
  plane.setAttribute('height', product.heightM)
  plane.setAttribute(
    'material',
    `shader: flat; side: double; transparent: true; src: #${product.imageAssetId}`
  )
}

const isUiTarget = (target) => {
  if (!target) return false
  return Boolean(
    target.closest?.(
      'button, .picker, .control-panel, .top-button, .notice, .hud'
    )
  )
}

AFRAME.registerComponent('poster-ar-app', {
  schema: {
    defaultDistanceM: {default: 1.6},
    minScale: {default: 0.35},
    maxScale: {default: 3.0},
    scaleStep: {default: 0.08},
    moveStepM: {default: 0.04},
  },

  init() {
    this.cameraEl = $('camera')
    this.posterEl = $('posterPlane')
    this.borderEl = $('posterBorder')

    this.ready = false
    this.placed = false

    this.product = getSelectedProduct()
    this.posterScale = 1

    applyProductToPlane(this.product)
    this.hidePoster()

    this.bindSceneEvents()
    this.bindUI()
    this.configureXR8()

    setStatus('8th Wall Engine 로딩 중...')
  },

  bindSceneEvents() {
    this.el.addEventListener('realityready', () => {
      this.ready = true
      setStatus('트래킹 시작됨. 벽 앞에서 화면 중앙을 맞춘 뒤 “이미지 배치”를 누르세요.')
    })

    this.el.addEventListener('realityerror', (event) => {
      console.error('realityerror:', event.detail)
      setStatus(`8th Wall 오류: ${event.detail?.error || '알 수 없음'}`)
    })

    this.el.addEventListener('xrtrackingstatus', (event) => {
      console.log('xrtrackingstatus:', event.detail)
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

  bindUI() {
    $('placePoster')?.addEventListener('click', () => {
      this.placePosterAtCenter()
    })

    $('resetPlacement')?.addEventListener('click', () => {
      this.hidePoster()
      this.placed = false
      setStatus('다시 배치할 위치를 화면 중앙에 맞춘 뒤 “이미지 배치”를 누르세요.')
    })

    $('recenter')?.addEventListener('click', () => {
      if (window.XR8?.recenter) window.XR8.recenter()
      setStatus('트래킹 기준을 다시 계산했습니다. 필요하면 이미지를 다시 배치하세요.')
    })

    $('scaleDown')?.addEventListener('click', () => {
      this.adjustScale(-this.data.scaleStep)
    })

    $('scaleUp')?.addEventListener('click', () => {
      this.adjustScale(this.data.scaleStep)
    })

    $('scaleReset')?.addEventListener('click', () => {
      this.setScale(1)
    })

    $('moveUp')?.addEventListener('click', () => {
      this.movePosterLocal(0, this.data.moveStepM, 0)
    })

    $('moveDown')?.addEventListener('click', () => {
      this.movePosterLocal(0, -this.data.moveStepM, 0)
    })

    document.querySelectorAll('.product').forEach((button) => {
      button.addEventListener('click', () => {
        document.querySelectorAll('.product').forEach((b) => b.classList.remove('selected'))
        button.classList.add('selected')

        this.product = getProductById(button.dataset.productId)
        this.posterScale = 1

        applyProductToPlane(this.product)
        this.hidePoster()
        this.placed = false

        setStatus(`${this.product.name} 선택됨. 화면 중앙을 맞춘 뒤 “이미지 배치”를 누르세요.`)
      })
    })

    document.addEventListener('click', (event) => {
      if (isUiTarget(event.target)) return
      if (!this.ready) return

      // 화면 아무 곳이나 탭해도 배치되게 한다.
      this.placePosterAtCenter()
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
  },

  placePosterAtCenter() {
    if (!this.ready) {
      setStatus('카메라/SLAM 초기화 중입니다. 잠시 후 다시 시도하세요.')
      return
    }

    if (!this.cameraEl || !this.posterEl || !this.product) return

    const cam = cameraWorld(this.cameraEl)
    const forward = projectedHorizontal(cam.dir)

    const cameraHeight =
      Number.isFinite(cam.pos.y) && Math.abs(cam.pos.y) > 0.2
        ? cam.pos.y
        : 1.55

    const center = cam.pos
      .clone()
      .add(forward.clone().multiplyScalar(this.data.defaultDistanceM))

    // 사용자가 보통 벽을 바라보고 있을 때, 포스터 중심이 눈높이보다 약간 아래 오도록 배치.
    center.y = Math.max(0.8, Math.min(2.2, cameraHeight - 0.15))

    this.posterEl.object3D.position.copy(center)

    // 배치 순간 카메라를 바라보도록 회전.
    // 배치 후에는 tick에서 다시 갱신하지 않으므로 월드에 고정됨.
    this.posterEl.object3D.lookAt(cam.pos.x, center.y, cam.pos.z)

    // A-Frame plane 앞면 보정
    this.posterEl.object3D.rotateY(Math.PI)

    this.setScale(this.posterScale, {silent: true})

    this.posterEl.setAttribute('visible', 'true')
    this.placed = true

    this.syncBorder()

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

  movePosterLocal(x, y, z) {
    if (!this.placed || !this.posterEl) {
      setStatus('먼저 이미지를 배치하세요.')
      return
    }

    const offset = new THREE.Vector3(x, y, z)
    this.posterEl.object3D.localToWorld(offset)

    const origin = new THREE.Vector3(0, 0, 0)
    this.posterEl.object3D.localToWorld(origin)

    const worldDelta = offset.sub(origin)

    this.posterEl.object3D.position.add(worldDelta)
    this.syncBorder()

    setStatus(`${this.product.name} 위치 조정됨 | 공간에 고정됨`)
  },

  syncBorder() {
    if (!this.posterEl || !this.borderEl || !this.product) return

    createBorder(this.posterEl, this.product, this.posterScale)

    this.borderEl.object3D.position.copy(this.posterEl.object3D.position)
    this.borderEl.object3D.quaternion.copy(this.posterEl.object3D.quaternion)
    this.borderEl.setAttribute('visible', this.posterEl.getAttribute('visible'))
  },

  hidePoster() {
    if (this.posterEl) this.posterEl.setAttribute('visible', 'false')
    if (this.borderEl) this.borderEl.setAttribute('visible', 'false')
  },

  tick() {
    // 의도적으로 비워둔다.
    // 포스터는 배치 순간의 world position/quaternion을 유지해야 하므로
    // 매 프레임 카메라 앞에 따라오게 갱신하지 않는다.
  },
})