import test from 'node:test'
import assert from 'node:assert/strict'

import {
  carveTextLineSlots,
  chooseSlot,
  getLayoutCacheKey,
  getMaskIntervalForBand,
  getScrubPose,
  shouldJustifyLine,
  splitParagraphs,
} from './mask-layout.mjs'

test('getMaskIntervalForBand maps occupied mask pixels into viewport coordinates', () => {
  const width = 8
  const height = 6
  const data = new Uint8ClampedArray(width * height * 4)

  for (let y = 2; y <= 4; y += 1) {
    for (let x = 2; x <= 5; x += 1) {
      const offset = (y * width + x) * 4
      data[offset] = 255
      data[offset + 1] = 255
      data[offset + 2] = 255
      data[offset + 3] = 255
    }
  }

  const interval = getMaskIntervalForBand(
    { data, width, height },
    80,
    140,
    320,
    180,
    { threshold: 32, padding: 10, minPixels: 2 },
  )

  assert.deepEqual(interval, { left: 70, right: 250 })
})

test('getMaskIntervalForBand returns null when a band has no occupied pixels', () => {
  const data = new Uint8ClampedArray(4 * 4 * 4)

  const interval = getMaskIntervalForBand(
    { data, width: 4, height: 4 },
    20,
    30,
    400,
    300,
    { threshold: 32, padding: 12, minPixels: 1 },
  )

  assert.equal(interval, null)
})

test('getMaskIntervalForBand uses color channel occupancy instead of alpha', () => {
  const width = 6
  const height = 4
  const data = new Uint8ClampedArray(width * height * 4)

  for (let x = 1; x <= 4; x += 1) {
    const offset = (2 * width + x) * 4
    data[offset] = 255
    data[offset + 1] = 255
    data[offset + 2] = 255
    data[offset + 3] = 0
  }

  const interval = getMaskIntervalForBand(
    { data, width, height },
    90,
    140,
    300,
    200,
    { threshold: 32, padding: 0, minPixels: 1 },
  )

  assert.deepEqual(interval, { left: 50, right: 250 })
})

test('getMaskIntervalForBand treats a single occupied pixel as a valid hit by default', () => {
  const width = 5
  const height = 5
  const data = new Uint8ClampedArray(width * height * 4)
  const offset = (2 * width + 3) * 4
  data[offset] = 255

  const interval = getMaskIntervalForBand(
    { data, width, height },
    70,
    120,
    500,
    200,
  )

  assert.deepEqual(interval, { left: 300, right: 400 })
})

test('carveTextLineSlots removes blocked area and preserves wide enough runs', () => {
  const slots = carveTextLineSlots(
    { left: 20, right: 260 },
    [{ left: 100, right: 180 }],
    40,
  )

  assert.deepEqual(slots, [
    { left: 20, right: 100 },
    { left: 180, right: 260 },
  ])
})

test('chooseSlot honors alignment tie-break when widths match', () => {
  const slots = [
    { left: 20, right: 120 },
    { left: 140, right: 240 },
  ]

  assert.deepEqual(chooseSlot(slots, 'left'), { left: 20, right: 120 })
  assert.deepEqual(chooseSlot(slots, 'right'), { left: 140, right: 240 })
})

test('getScrubPose clamps progress to the configured corridor', () => {
  const pose = getScrubPose(1.6, {
    yawRange: [-0.2, 0.35],
    pitchRange: [0.04, 0.12],
    distanceRange: [11, 8],
    panRange: [-0.5, 0.75],
  })

  assert.equal(Number(pose.yaw.toFixed(4)), 0.35)
  assert.equal(Number(pose.pitch.toFixed(4)), 0.12)
  assert.equal(Number(pose.distance.toFixed(4)), 8)
  assert.equal(Number(pose.panX.toFixed(4)), 0.75)
})

test('getScrubPose maps single progress to yaw pitch distance and pan', () => {
  const pose = getScrubPose(0.25, {
    yawRange: [-0.6, 0.2],
    pitchRange: [0.02, 0.08],
    distanceRange: [1.1, 0.4],
    panRange: [-0.6, 0.6],
  })

  assert.equal(Number(pose.yaw.toFixed(4)), -0.4)
  assert.equal(Number(pose.pitch.toFixed(4)), 0.035)
  assert.equal(Number(pose.distance.toFixed(4)), 0.925)
  assert.equal(Number(pose.panX.toFixed(4)), -0.3)
})

test('getLayoutCacheKey preserves small progress changes for live reflow', () => {
  const a = getLayoutCacheKey(1440, 900, 0.5001)
  const b = getLayoutCacheKey(1440, 900, 0.5009)

  assert.notEqual(a, b)
})

test('shouldJustifyLine disables justification inside narrow slots', () => {
  assert.equal(shouldJustifyLine('Concrete spans the void', 220, 160), true)
  assert.equal(shouldJustifyLine('Concrete spans the void', 150, 160), false)
  assert.equal(shouldJustifyLine('Only three words', 220, 160), false)
  assert.equal(shouldJustifyLine('Ends with a full stop.', 220, 160), false)
})

test('splitParagraphs preserves paragraph boundaries and removes empty runs', () => {
  assert.deepEqual(
    splitParagraphs('First paragraph.\n\nSecond paragraph.\n\n\nThird paragraph.'),
    ['First paragraph.', 'Second paragraph.', 'Third paragraph.'],
  )
})
