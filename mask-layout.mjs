export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

export function lerp(a, b, t) {
  return a + (b - a) * t
}

export function getScrubPose(progress, ranges) {
  const t = clamp(progress, 0, 1)
  return {
    yaw: lerp(ranges.yawRange[0], ranges.yawRange[1], t),
    pitch: lerp(ranges.pitchRange[0], ranges.pitchRange[1], t),
    distance: lerp(ranges.distanceRange[0], ranges.distanceRange[1], t),
    panX: lerp(ranges.panRange[0], ranges.panRange[1], t),
  }
}

export function getLayoutCacheKey(viewportWidth, viewportHeight, progress) {
  return `${viewportWidth}:${viewportHeight}:${progress}`
}

export function getMaskIntervalForBand(mask, bandTop, bandBottom, viewportWidth, viewportHeight, options = {}) {
  const { data, width, height } = mask
  const threshold = options.threshold ?? 20
  const padding = options.padding ?? 0
  const minPixels = options.minPixels ?? 1
  const top = clamp(Math.floor((bandTop / viewportHeight) * height), 0, height - 1)
  const bottom = clamp(Math.ceil((bandBottom / viewportHeight) * height), 0, height - 1)

  let left = width
  let right = -1
  let hits = 0

  for (let y = top; y <= bottom; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4
      if ((data[offset] ?? 0) < threshold) continue
      left = Math.min(left, x)
      right = Math.max(right, x)
      hits += 1
    }
  }

  if (hits < minPixels || right < left) return null

  const scaleX = viewportWidth / width
  return {
    left: left * scaleX - padding,
    right: (right + 1) * scaleX + padding,
  }
}

export function shouldJustifyLine(text, slotWidth, minJustifyWidth = 160) {
  if (slotWidth < minJustifyWidth) return false
  const words = text.trim().split(/\s+/)
  if (words.length < 4) return false
  if (!text.includes(' ')) return false
  return !/[.!?]$/.test(text.trim())
}

export function splitParagraphs(text) {
  return text
    .split(/\n+/)
    .map(paragraph => paragraph.trim())
    .filter(paragraph => paragraph.length > 0)
}

export function mergeIntervals(intervals, minLeft, maxRight) {
  const clipped = intervals
    .map(interval => ({
      left: Math.max(minLeft, interval.left),
      right: Math.min(maxRight, interval.right),
    }))
    .filter(interval => interval.right > interval.left)
    .sort((a, b) => a.left - b.left)

  if (clipped.length === 0) return []

  const merged = [clipped[0]]
  for (let index = 1; index < clipped.length; index += 1) {
    const current = clipped[index]
    const previous = merged[merged.length - 1]
    if (current.left <= previous.right) {
      previous.right = Math.max(previous.right, current.right)
    } else {
      merged.push(current)
    }
  }
  return merged
}

export function carveTextLineSlots(base, blocked, minSlotWidth) {
  let slots = [base]
  for (const interval of blocked) {
    const next = []
    for (const slot of slots) {
      if (interval.right <= slot.left || interval.left >= slot.right) {
        next.push(slot)
        continue
      }
      if (interval.left > slot.left) next.push({ left: slot.left, right: interval.left })
      if (interval.right < slot.right) next.push({ left: interval.right, right: slot.right })
    }
    slots = next
  }
  return slots.filter(slot => slot.right - slot.left >= minSlotWidth)
}

export function chooseSlot(slots, side) {
  let chosen = slots[0]
  for (let index = 1; index < slots.length; index += 1) {
    const candidate = slots[index]
    const candidateWidth = candidate.right - candidate.left
    const chosenWidth = chosen.right - chosen.left
    if (candidateWidth > chosenWidth) {
      chosen = candidate
      continue
    }
    if (candidateWidth < chosenWidth) continue
    if (side === 'right' ? candidate.left > chosen.left : candidate.left < chosen.left) {
      chosen = candidate
    }
  }
  return chosen
}
