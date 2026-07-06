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

const projectedHorizontal = (v) => {
  const out = new THREE.Vector3(v.x, 0, v.z)

  if (out.lengthSq() < 0.0001) {
    return new THREE.Vector3(0, 0, -1)
  }

  return out.normalize()
}

const applyProductToPlane = (plane, product) => {
  if (!plane || !product) return

  plane.setAttribute('width', product.widthM)
  plane.setAttribute('height', product.heightM)

  plane.setAttribute('material', {
    shader: 'flat',
    side: 'double',
    transparent: true,
    src: `#${product.imageAssetId}`,
  })
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
    this.sceneLoaded = false
    this.placed = false

    this.product = getSelectedProduct()
    this.posterScale = 1

    applyProductToPlane(this.posterEl, this.product)
    this.hidePoster()

    this.bindSceneEvents()
    this.bindUI()
    this.configureXR8()

    setStatus('8th Wall Engine 로딩 중...')
  },

  bindSceneEvents() {
    this.el.addEventListener('loaded', () => {
      this.sceneLoaded = true
      setStatus('Scene 로드됨. 카메라 권한을 허용하세요.')
    })

    this.el.addEventListener('renderstart', () => {
      this.sceneLoaded = true
      if (!this.ready) {
        setStatus('AR 렌더링 시작됨. 벽 앞에서 “이미지 배치”를 눌러보세요.')
      }
    })

    this.el.addEventListener('realityready', () => {
      this.ready = true
      this.sceneLoaded = true
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
        document.querySelectorAll('.product').forEach((b) => {
          b.classList.remove('selected')
        })

        button.classList.add('selected')

        this.product = getProductById(button.dataset.productId)
        this.posterScale = 1

        applyProductToPlane(this.posterEl, this.product)

        this.hidePoster()
        this.placed = false

        setStatus(`${this.product.name} 선택됨. 화면 중앙을 맞춘 뒤 “이미지 배치”를 누르세요.`)
      })
    })

    document.addEventListener('click', (event) => {
      if (isUiTarget(event.target)) return
      if (!this.sceneLoaded && !this.ready) return

      this.placePosterAtCenter()
    })

    window.addEventListener('xrloaded', () => {
      setStatus('8th Wall Engine 로드됨. 카메라 권한을 허용하세요.')
    })

    window.addEventListener('error', (event) => {
      console.error('window error:', event)
    })
  },

  placePosterAtCenter() {
    if (!this.cameraEl || !this.posterEl || !this.product) {
      setStatus('AR 요소를 찾을 수 없습니다. index.html의 id를 확인하세요.')
      return
    }

    if (!this.sceneLoaded && !this.ready) {
      setStatus('아직 AR scene이 준비되지 않았습니다. 잠시 후 다시 누르세요.')
      return
    }

    this.el.object3D.updateMatrixWorld(true)
    this.cameraEl.object3D.updateMatrixWorld(true)

    const camPos = new THREE.Vector3()
    const camDir = new THREE.Vector3()

    this.cameraEl.object3D.getWorldPosition(camPos)
    this.cameraEl.object3D.getWorldDirection(camDir)

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

    this.setScale(this.posterScale, {silent: true})

    this.posterEl.setAttribute('visible', true)
    posterObj.visible = true

    this.placed = true
    this.syncBorder()

    console.log('[Poster AR] placed', {
      camera: camPos,
      forward,
      center,
      product: this.product,
      scale: this.posterScale,
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

    const visible = this.posterEl.getAttribute('visible') === true || this.posterEl.object3D.visible

    this.borderEl.setAttribute('visible', visible)
    this.borderEl.object3D.visible = visible
  },

  hidePoster() {
    if (this.posterEl) {
      this.posterEl.setAttribute('visible', false)
      this.posterEl.object3D.visible = false
    }

    if (this.borderEl) {
      this.borderEl.setAttribute('visible', false)
      this.borderEl.object3D.visible = false
    }
  },

  tick() {
    // 의도적으로 비워둔다.
    // 배치 후 포스터가 카메라를 따라오지 않도록 매 프레임 위치 갱신을 하지 않는다.
  },
})