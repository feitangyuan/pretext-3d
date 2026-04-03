# pretext-3d

`pretext-3d` is a minimal open-source template for combining Three.js scene rendering with Pretext text reflow.

It renders a `glb` model, turns the visible silhouette into a mask, and uses that mask to carve live text slots so the copy wraps around the object instead of sitting on top of a static image.

## Stack

- `Three.js`
- `@chenglou/pretext`
- `Vite`

## Getting Started

```bash
pnpm install
pnpm dev
```

Then open `http://127.0.0.1:4173/`.

## Add Your Own Model

Put your model at `assets/model.glb`.

The `assets/` directory is kept in the repo, but `.glb` files are ignored so you can use your own private model without publishing it.

## Check

```bash
pnpm check
```

## Key Files

- `main.mjs` for scene setup, mask generation, camera motion, and layout orchestration
- `mask-layout.mjs` for slot carving and layout helpers
- `styles.css` for the visual system
- `MODEL_SWAP.md` for model tuning notes
