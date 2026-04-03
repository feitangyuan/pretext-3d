# Pretext 3D Template

This project is a stable template for `3D model -> mask -> Pretext reflow`.

## What This Project Does

Render a `glb` model in Three.js, generate a high-contrast mask, scan each text band for blocked pixels, convert the remaining space into line slots, then let Pretext compute the next legal line for each slot.

Core data flow:

`GLB -> Three.js camera -> black/white mask -> slot widths -> Pretext -> absolutely positioned lines`

## Files That Matter

- `main.mjs`
  Entry point. Loads the model, sets camera motion, builds regions, and places text lines.
- `mask-layout.mjs`
  Low-level layout helpers: mask scanning, slot carving, scrub pose mapping.
- `styles.css`
  Page look and typography.
- `assets/model.glb`
  Your model asset. This file is intentionally ignored by git.

## Normal Workflow For Replacing The Model

1. Put your model at `assets/model.glb`
2. Keep the asset in `glb` format if possible
3. Refresh the page
4. Only then adjust camera and layout parameters

## Change These First When A New Model Looks Wrong

Edit these in `main.mjs`:

- `SCRUB_RANGES`
  Use this first when the model feels too far, too close, rotates too little, or cuts the wrong part of the text.
- `normalizeModel()`
  Use this when the model is too tall, too flat, off center, or sits too low/high after load.
- `computeFitState()`
  Use this when the default camera framing is bad across the whole motion range.
- `getRegions()`
  Use this when a new model mostly affects the wrong columns or misses one side of the page.

## Change These Only If The Silhouette Quality Is Bad

Edit these in `main.mjs` or `mask-layout.mjs`:

- `MASK_SIZE`
  Increase if thin beams, rails, or narrow edges are missed.
- `MASK_PADDING`
  Increase if text gets too close to the model edge.
- `MIN_SLOT_WIDTH`
  Increase if you get noisy fragments or ugly short lines.
- `MIN_JUSTIFY_WIDTH`
  Increase if narrow slots still stretch words too aggressively.

## Validation

Run these after meaningful changes:

```bash
pnpm check
```

Open:

```bash
http://127.0.0.1:4173/
```
