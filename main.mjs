import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { layoutNextLine, prepareWithSegments } from '/pretext.js'
import {
  carveTextLineSlots,
  chooseSlot,
  clamp,
  getLayoutCacheKey,
  getMaskIntervalForBand,
  getScrubPose,
  mergeIntervals,
  shouldJustifyLine,
  splitParagraphs,
} from './mask-layout.mjs'

const BODY_FONT_FAMILY = '"Iowan Old Style","Palatino Linotype","Book Antiqua",Palatino,serif'
const BODY_FONT_SIZE = 14
const BODY_FONT = `${BODY_FONT_SIZE}px ${BODY_FONT_FAMILY}`
const BODY_LINE_HEIGHT = 22
const KICKER_FONT_SIZE = 8
const KICKER_LINE_HEIGHT = 12
const TITLE_FONT_SIZE_LARGE = 44
const TITLE_FONT_SIZE_SMALL = 15
const TITLE_LINE_HEIGHT_LARGE = 36
const TITLE_LINE_HEIGHT_SMALL = 18
const MIN_SLOT_WIDTH = 160
const SCRUB_RANGES = {
  yawRange: [-0.6, 0.4],
  pitchRange: [0.02, 0.1],
  distanceRange: [1.3, 0.4],
  panRange: [-0.6, 0.6],
}
const MASK_SIZE = { width: 1024, height: 576 }
const IDLE_SWAY = 0.032
const IDLE_SPEED = 0.00014
const POINTER_EASE = 5.2
const MASK_PADDING = 20
const MIN_JUSTIFY_WIDTH = 180
const FRAME_Y_OFFSET = -0.32
const copyLayer = requireElement('copy-layer')
const sceneLayer = requireElement('scene-layer')
const scrubFill = requireElement('scrub-fill')
const statusChip = requireElement('status-chip')

const BLOCKS = [
  {
    id: 'block-left',
    kicker: 'Template / Overview',
    title: `PRETEXT
3D`,
    bodyAlign: 'left',
    titleAlign: 'left',
    headerOffset: 22,
    text: `
This template turns a single 3D model into an editorial layout that stays readable while the object moves through the page. The model is rendered in Three.js, converted into a high-contrast silhouette, and used as a live obstacle for text composition.

Instead of dropping copy on top of a fixed image, the page measures the visible occupied shape and recalculates legal line slots from that shape. The result feels closer to typesetting around a physical object than around a rectangle.

The default motion stays narrow on purpose. A small horizontal scrub is enough to change the silhouette, expose different negative spaces, and make the copy breathe without turning the page into a scene viewer.

What matters most is not subject matter. Any model with a strong outline, readable mass, and limited visual noise can be used here as long as the page still produces stable text corridors.

The engine is generic. Swap the asset, retune scale and framing, and the same layout system can support architecture, products, sculptures, ruins, or any other object that reads well in silhouette.

This repository is meant to be a clean starting point, not a gallery of finished scenes.
`.trim(),
  },
  {
    id: 'block-center',
    kicker: 'How It Works',
    title: `MASK
REFLOW`,
    bodyAlign: 'left',
    titleAlign: 'left',
    headerOffset: 22,
    text: `
The pipeline is simple. Render the model. Draw a black and white mask. Scan each horizontal band for blocked pixels. Convert the remaining intervals into candidate text slots. Ask Pretext for the next valid line inside each slot.

Because the mask is regenerated from the live camera view, layout responds to motion instead of using hardcoded exclusion boxes. Thin gaps, large masses, and shifting voids all change how the text settles.

That keeps the implementation small but expressive. Most adjustments happen in a handful of parameters: model normalization, framing distance, scrub ranges, mask padding, and minimum slot width.

The core rule is to preserve readability first. Motion is there to reshape the page, not to compete with it.
`.trim(),
  },
  {
    id: 'block-right',
    kicker: 'Model Notes',
    title: `SWAP
THE MODEL`,
    bodyAlign: 'left',
    titleAlign: 'left',
    headerOffset: 22,
    text: `
Use assets/model.glb as the working asset path. The repository keeps that location stable so model replacement does not require code changes unless you want a different filename.

Good inputs usually have one dominant subject, a clear silhouette, and enough mass to carve meaningful negative space. Extremely thin or fragmented models tend to produce noisy slot geometry and weaker typography.

Most model-specific tuning belongs in normalizeModel(), SCRUB_RANGES, and computeFitState(). Layout parameters only come after the object is already framed correctly.
`.trim(),
  },
  {
    id: 'block-note',
    kicker: 'Layout Rule',
    title: `READABLE
MOTION`,
    bodyAlign: 'left',
    titleAlign: 'left',
    headerOffset: 22,
    text: `
The silhouette should interrupt the page cleanly before it starts describing itself in detail. When the outline is strong, the text yields and returns in a way that feels intentional rather than decorative.
`.trim(),
  },
]

const preparedBlocks = BLOCKS.map(block => {
  const titleLines = block.title.split(/\n+/).map(line => line.trim()).filter(Boolean)
  const leadLines = [
    {
      text: block.kicker.toUpperCase(),
      prepared: prepareWithSegments(block.kicker.toUpperCase(), `${KICKER_FONT_SIZE}px "Helvetica Neue", Helvetica, Arial, sans-serif`),
      fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
      fontSize: `${KICKER_FONT_SIZE}px`,
      lineHeight: `${KICKER_LINE_HEIGHT}px`,
      letterSpacing: '0.28em',
      fontWeight: '400',
      textTransform: 'uppercase',
      slotHeight: KICKER_LINE_HEIGHT,
      advanceAfter: 8,
      align: 'left',
    },
    ...titleLines.map((text, index) => {
      const isLead = block.id === 'block-left'
      const fontSize = isLead ? TITLE_FONT_SIZE_LARGE : TITLE_FONT_SIZE_SMALL
      const align = block.titleAlign
      return {
        text,
        prepared: prepareWithSegments(text, `${fontSize}px ${BODY_FONT_FAMILY}`),
        fontFamily: BODY_FONT_FAMILY,
        fontSize: `${fontSize}px`,
        lineHeight: `${isLead ? TITLE_LINE_HEIGHT_LARGE : TITLE_LINE_HEIGHT_SMALL}px`,
        letterSpacing: isLead ? '0.08em' : '0.18em',
        fontWeight: '700',
        textTransform: 'uppercase',
        slotHeight: isLead ? TITLE_LINE_HEIGHT_LARGE : TITLE_LINE_HEIGHT_SMALL,
        advanceAfter: index === 0 ? 0 : 4,
        align,
      }
    }),
  ]

  return {
    ...block,
    titleLines,
    leadLines,
    preparedParagraphs: splitParagraphs(block.text).map(paragraph => prepareWithSegments(paragraph, BODY_FONT)),
  }
})

const linePool = []
const visibleRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
const maskCanvas = document.createElement('canvas')
const maskContext = maskCanvas.getContext('2d', { willReadFrequently: true })
const maskRenderer = new THREE.WebGLRenderer({
  antialias: false,
  alpha: false,
  preserveDrawingBuffer: true,
})
const scene = new THREE.Scene()
const maskScene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100)
const maskCamera = camera.clone()
const clock = new THREE.Clock()
const pointer = {
  dragging: false,
  progress: 0.5,
  target: 0.5,
  startX: 0,
  startProgress: 0.5,
}

let modelRoot = null
let maskRoot = null
let fitState = null
let viewportWidth = window.innerWidth
let viewportHeight = window.innerHeight
let lastLayoutKey = ''
let lastMask = null

initScene()
if (maskContext === null) {
  throw new Error('Unable to create a 2D context for the mask canvas.')
}
void loadModel()
window.addEventListener('resize', handleResize)
document.addEventListener('pointerdown', handlePointerDown)
document.addEventListener('pointermove', handlePointerMove)
document.addEventListener('pointerup', handlePointerUp)
document.addEventListener('pointercancel', handlePointerUp)
requestAnimationFrame(tick)

function initScene() {
  visibleRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  visibleRenderer.setSize(viewportWidth, viewportHeight)
  visibleRenderer.outputColorSpace = THREE.SRGBColorSpace
  sceneLayer.appendChild(visibleRenderer.domElement)

  maskRenderer.setSize(MASK_SIZE.width, MASK_SIZE.height, false)
  maskRenderer.setClearColor(0x000000, 1)
  maskRenderer.toneMapping = THREE.NoToneMapping
  maskRenderer.outputColorSpace = THREE.LinearSRGBColorSpace
  maskCanvas.width = MASK_SIZE.width
  maskCanvas.height = MASK_SIZE.height

  scene.background = new THREE.Color(0x000000)
  maskScene.background = new THREE.Color(0x000000)
  maskScene.overrideMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff })

  const hemi = new THREE.HemisphereLight(0xf3e9d3, 0x120f0a, 1.9)
  const key = new THREE.DirectionalLight(0xfff6de, 2.8)
  key.position.set(8, 10, 12)
  const rim = new THREE.DirectionalLight(0x8c6d42, 1.15)
  rim.position.set(-10, 4, -8)
  scene.add(hemi, key, rim)

  camera.position.set(0, 1.3, 10)
  camera.lookAt(0, 1.2, 0)
  handleResize()
}

async function loadModel() {
  try {
    statusChip.textContent = 'Loading model…'

    const loader = new GLTFLoader()
    const gltf = await loader.loadAsync('./assets/model.glb')
    modelRoot = gltf.scene
    normalizeModel(modelRoot)
    scene.add(modelRoot)

    maskRoot = modelRoot.clone(true)
    maskScene.add(maskRoot)

    fitState = computeFitState(modelRoot, camera, viewportWidth, viewportHeight)
    statusChip.textContent = 'Drag horizontally'
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown model load error.'
    statusChip.textContent = 'Model load failed'
    console.error(message)
  }
}

function normalizeModel(root) {
  root.updateWorldMatrix(true, true)
  const box = new THREE.Box3().setFromObject(root)
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const maxDim = Math.max(size.x, size.y, size.z, 0.001)
  const scale = 7.8 / maxDim
  root.scale.setScalar(scale)
  root.updateWorldMatrix(true, true)

  const scaledBox = new THREE.Box3().setFromObject(root)
  const scaledSize = scaledBox.getSize(new THREE.Vector3())
  const scaledCenter = scaledBox.getCenter(new THREE.Vector3())
  root.position.sub(scaledCenter)
  root.position.y -= scaledSize.y * 0.52

  root.traverse(child => {
    if (!(child instanceof THREE.Mesh)) return
    child.castShadow = false
    child.receiveShadow = false
    const materials = Array.isArray(child.material) ? child.material : [child.material]
    for (const material of materials) {
      if (!material) continue
      material.side = THREE.DoubleSide
    }
  })
}

function computeFitState(root, activeCamera, width, height) {
  const box = new THREE.Box3().setFromObject(root)
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const halfFov = THREE.MathUtils.degToRad(activeCamera.fov * 0.5)
  const fitHeightDistance = (size.y * 0.64) / Math.tan(halfFov)
  const fitWidthDistance = (size.x * 0.56) / (Math.tan(halfFov) * activeCamera.aspect)
  const baseDistance = Math.max(fitHeightDistance, fitWidthDistance, 5.8)

  return {
    target: center.clone().setY(center.y + size.y * 0.08 + FRAME_Y_OFFSET),
    baseDistance,
  }
}

function handleResize() {
  viewportWidth = window.innerWidth
  viewportHeight = window.innerHeight
  camera.aspect = viewportWidth / viewportHeight
  camera.updateProjectionMatrix()
  maskCamera.copy(camera)
  visibleRenderer.setSize(viewportWidth, viewportHeight)
  fitState = modelRoot === null ? fitState : computeFitState(modelRoot, camera, viewportWidth, viewportHeight)
  lastLayoutKey = ''
}

function handlePointerDown(event) {
  pointer.dragging = true
  pointer.startX = event.clientX
  pointer.startProgress = pointer.target
}

function handlePointerMove(event) {
  if (!pointer.dragging) return
  const dx = (event.clientX - pointer.startX) / viewportWidth
  pointer.target = clamp(pointer.startProgress + dx, 0, 1)
}

function handlePointerUp() {
  pointer.dragging = false
}

function tick() {
  requestAnimationFrame(tick)
  if (modelRoot === null || maskRoot === null || fitState === null) return

  const dt = clock.getDelta()
  const idleTarget = 0.5 + Math.sin(performance.now() * 0.0002) * 0.05
  pointer.target = pointer.dragging ? pointer.target : idleTarget
  pointer.progress += (pointer.target - pointer.progress) * clamp(dt * 5.0, 0.02, 0.1)
  scrubFill.style.width = '100%'
  scrubFill.style.transform = `scaleX(${clamp(pointer.progress, 0, 1)})`

  updatePose(pointer.progress)
  renderScene()
  layoutCopy(renderMask())
}

function updatePose(progress) {
  const pose = getScrubPose(progress, SCRUB_RANGES)
  const target = fitState.target.clone()
  target.x += pose.panX

  const distance = fitState.baseDistance * pose.distance
  const cosPitch = Math.cos(pose.pitch)
  const position = new THREE.Vector3(
    Math.sin(pose.yaw) * distance * cosPitch,
    Math.sin(pose.pitch) * distance + target.y,
    Math.cos(pose.yaw) * distance * cosPitch,
  )

  camera.position.copy(position)
  camera.lookAt(target)
  maskCamera.position.copy(camera.position)
  maskCamera.quaternion.copy(camera.quaternion)
}

function renderScene() {
  visibleRenderer.render(scene, camera)
}

function renderMask() {
  maskRenderer.render(maskScene, maskCamera)
  maskContext.clearRect(0, 0, MASK_SIZE.width, MASK_SIZE.height)
  maskContext.drawImage(maskRenderer.domElement, 0, 0, MASK_SIZE.width, MASK_SIZE.height)
  const image = maskContext.getImageData(0, 0, MASK_SIZE.width, MASK_SIZE.height)
  lastMask = image
  return image
}

function layoutCopy(mask) {
  const regions = getRegions(viewportWidth, viewportHeight)
  const layoutKey = getLayoutCacheKey(viewportWidth, viewportHeight, pointer.progress)
  if (layoutKey === lastLayoutKey) return
  lastLayoutKey = layoutKey

  const lines = []
  for (const block of preparedBlocks) {
    const region = regions.find(entry => entry.id === block.id)
    const blockLines = layoutBlock(block, region, mask)
    lines.push(...blockLines)
  }

  syncLinePool(lines.length)
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const node = linePool[index]
    node.textContent = line.text
    node.style.left = `${line.x}px`
    node.style.top = `${line.y}px`
    node.style.wordSpacing = line.wordSpacing
    node.style.width = `${Math.max(line.slotWidth, line.width)}px`
    node.style.textAlign = line.align
    node.style.fontFamily = line.fontFamily
    node.style.fontSize = line.fontSize
    node.style.lineHeight = line.lineHeight
    node.style.letterSpacing = line.letterSpacing
    node.style.fontWeight = line.fontWeight
    node.style.textTransform = line.textTransform
  }
}

function layoutBlock(block, region, mask) {
  const lines = []
  let y = region.y + block.headerOffset

  for (const leadLine of block.leadLines) {
    const placed = placeFlowLine(
      leadLine,
      region,
      mask,
      y,
      BODY_LINE_HEIGHT,
      { allowRightAlign: block.titleAlign === 'right' },
    )
    if (placed === null) {
      y += leadLine.slotHeight
      continue
    }

    lines.push(placed.line)
    y = placed.nextY
  }

  y += 16

  for (const preparedParagraph of block.preparedParagraphs) {
    let cursor = { segmentIndex: 0, graphemeIndex: 0 }

    while (y + BODY_LINE_HEIGHT <= region.y + region.height) {
      const interval = getMaskIntervalForBand(
        mask,
        y - 4,
        y + BODY_LINE_HEIGHT + 2,
        viewportWidth,
        viewportHeight,
        { threshold: 26, padding: MASK_PADDING, minPixels: 1 },
      )

      const merged = interval === null
        ? []
        : mergeIntervals([interval], region.x, region.x + region.width)

      const slots = carveTextLineSlots(
        { left: region.x, right: region.x + region.width },
        merged,
        MIN_SLOT_WIDTH,
      )

      if (slots.length === 0) {
        y += BODY_LINE_HEIGHT
        continue
      }

      const slot = chooseSlot(slots, block.bodyAlign)
      const slotWidth = slot.right - slot.left
      const line = layoutNextLine(preparedParagraph, cursor, slotWidth)

      if (line === null) break

      const wordCount = line.text.trim().split(/\s+/).length
      const isNarrowSlot = slotWidth < MIN_JUSTIFY_WIDTH || wordCount < 4
      const justify = !isNarrowSlot && shouldJustifyLine(line.text, slotWidth, MIN_JUSTIFY_WIDTH)
      const align = justify ? 'justify' : block.bodyAlign

      let wordSpacing = '0px'
      if (justify && wordCount > 1) {
        const rawSpace = Math.max(0, (slotWidth - line.width) / (wordCount - 1))
        wordSpacing = `${Math.floor(rawSpace * 10) / 10}px`
      }

      lines.push({
        x: Math.round(slot.left),
        y: Math.round(y),
        text: line.text,
        width: line.width,
        slotWidth: Math.floor(slotWidth),
        align,
        wordSpacing,
        fontFamily: BODY_FONT_FAMILY,
        fontSize: `${BODY_FONT_SIZE}px`,
        lineHeight: `${BODY_LINE_HEIGHT}px`,
        letterSpacing: '0.006em',
        fontWeight: '400',
        textTransform: 'none',
      })

      cursor = line.end
      y += BODY_LINE_HEIGHT
    }

    y += BODY_LINE_HEIGHT * 0.8
  }

  return lines
}

function placeFlowLine(lineSpec, region, mask, y, fallbackLineHeight, options = {}) {
  let currentY = y
  const lineHeight = parseFloat(lineSpec.lineHeight) || fallbackLineHeight

  while (currentY + lineHeight <= region.y + region.height) {
    const interval = getMaskIntervalForBand(
      mask,
      currentY - 4,
      currentY + lineHeight + 2,
      viewportWidth,
      viewportHeight,
      { threshold: 26, padding: MASK_PADDING, minPixels: 1 },
    )

    const merged = interval === null
      ? []
      : mergeIntervals([interval], region.x, region.x + region.width)

    const slots = carveTextLineSlots(
      { left: region.x, right: region.x + region.width },
      merged,
      MIN_SLOT_WIDTH,
    )

    if (slots.length === 0) {
      currentY += lineHeight
      continue
    }

    const slot = chooseSlot(slots, options.allowRightAlign ? 'right' : 'left')
    const slotWidth = slot.right - slot.left
    const line = layoutNextLine(lineSpec.prepared, { segmentIndex: 0, graphemeIndex: 0 }, slotWidth)
    if (line === null) {
      currentY += lineHeight
      continue
    }

    return {
      line: {
        x: Math.round(slot.left),
        y: Math.round(currentY),
        text: line.text,
        width: line.width,
        slotWidth: Math.floor(slotWidth),
        align: lineSpec.align,
        wordSpacing: '0px',
        fontFamily: lineSpec.fontFamily,
        fontSize: lineSpec.fontSize,
        lineHeight: lineSpec.lineHeight,
        letterSpacing: lineSpec.letterSpacing,
        fontWeight: lineSpec.fontWeight,
        textTransform: lineSpec.textTransform,
      },
      nextY: currentY + lineHeight + (lineSpec.advanceAfter ?? 0),
    }
  }

  return null
}

function getRegions(width, height) {
  if (width < 980) {
    const fullWidth = width - 44
    return [
      { id: 'block-left', x: 22, y: 24, width: fullWidth, height: 210 },
      { id: 'block-center', x: 22, y: 152, width: fullWidth, height: 224 },
      { id: 'block-right', x: 22, y: 280, width: fullWidth, height: 172 },
      { id: 'block-note', x: 22, y: 460, width: fullWidth, height: 132 },
    ]
  }

  const rightColWidth = Math.min(width * 0.27, 360)
  const rightColX = width - rightColWidth - 38

  return [
    { id: 'block-left', x: 32, y: 30, width: Math.min(width * 0.3, 430), height: height * 0.7 },
    { id: 'block-center', x: width * 0.356, y: 30, width: Math.min(width * 0.29, 400), height: height * 0.7 },
    { id: 'block-right', x: rightColX, y: 30, width: rightColWidth, height: height * 0.4 },
    { id: 'block-note', x: rightColX, y: Math.max(380, height * 0.5), width: rightColWidth, height: height * 0.4 },
  ]
}

function syncLinePool(count) {
  while (linePool.length < count) {
    const node = document.createElement('div')
    node.className = 'copy-line'
    copyLayer.appendChild(node)
    linePool.push(node)
  }

  while (linePool.length > count) {
    linePool.pop().remove()
  }
}

function requireElement(id) {
  const element = document.getElementById(id)
  if (!(element instanceof HTMLElement)) {
    throw new Error(`Missing #${id}`)
  }
  return element
}
