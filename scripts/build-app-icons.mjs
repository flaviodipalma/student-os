// Builds the installed-app icons in public/icons/ and the browser extension's icons in
// extension/icons/ from the Quadernio mark (the graduation cap on the brand indigo),
// with sharp. Run after changing the mark:
//   node scripts/build-app-icons.mjs
import { mkdirSync } from "node:fs"
import sharp from "sharp"

const INDIGO = "#4f46e5" // --primary (light theme)
const CAP = `<path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z"/><path d="M22 10v6"/><path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5"/>`

// `inset`: the cap's share of the square (maskable icons keep a safe margin).
// `pad`: transparent margin around the tile (the Chrome Web Store wants 16 of 128 px).
// `stroke`: line width in the cap's 24-unit grid (thicker keeps tiny icons legible).
const icon = (size, { inset, rounded, background = INDIGO, color = "#ffffff", pad = 0, stroke = 2 }) => {
  const tile = size - pad * 2
  const cap = tile * inset
  const offset = pad + (tile - cap) / 2
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  ${background ? `<rect x="${pad}" y="${pad}" width="${tile}" height="${tile}" rx="${rounded ? tile * 0.22 : 0}" fill="${background}"/>` : ""}
  <g transform="translate(${offset} ${offset}) scale(${cap / 24})" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">${CAP}</g>
</svg>`)
}

mkdirSync("public/icons", { recursive: true })
mkdirSync("extension/icons", { recursive: true })
const out = [
  ["public/icons/icon-192.png", 192, { inset: 0.6, rounded: true }],
  ["public/icons/icon-512.png", 512, { inset: 0.6, rounded: true }],
  // Android crops maskable icons to its own shape: full-bleed color, cap in the middle 60%.
  ["public/icons/icon-maskable-512.png", 512, { inset: 0.5, rounded: false }],
  // iPhone rounds the corners itself.
  ["public/icons/apple-touch-icon.png", 180, { inset: 0.6, rounded: false }],
  // The small monochrome icon in Android's status bar (white on transparent).
  ["public/icons/badge-96.png", 96, { inset: 0.8, rounded: false, background: null }],
  // The browser extension: toolbar (16, 32), extensions page (48), Chrome Web Store (128).
  ["extension/icons/icon-16.png", 16, { inset: 0.78, rounded: true, stroke: 2.6 }],
  ["extension/icons/icon-32.png", 32, { inset: 0.72, rounded: true, stroke: 2.4 }],
  ["extension/icons/icon-48.png", 48, { inset: 0.66, rounded: true, stroke: 2.2 }],
  ["extension/icons/icon-128.png", 128, { inset: 0.6, rounded: true, pad: 16 }],
]
for (const [path, size, options] of out) {
  await sharp(icon(size, options)).png().toFile(path)
  console.log("wrote", path)
}
