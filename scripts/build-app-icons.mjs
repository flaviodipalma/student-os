// Builds the installed-app icons in public/icons/ from the Student OS mark (the
// graduation cap on the brand indigo), with sharp. Run after changing the mark:
//   node scripts/build-app-icons.mjs
import { mkdirSync } from "node:fs"
import sharp from "sharp"

const INDIGO = "#4f46e5" // --primary (light theme)
const CAP = `<path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z"/><path d="M22 10v6"/><path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5"/>`

// `inset`: the cap's share of the square (maskable icons keep a safe margin).
const icon = (size, { inset, rounded, background = INDIGO, color = "#ffffff" }) => {
  const cap = size * inset
  const offset = (size - cap) / 2
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  ${background ? `<rect width="${size}" height="${size}" rx="${rounded ? size * 0.22 : 0}" fill="${background}"/>` : ""}
  <g transform="translate(${offset} ${offset}) scale(${cap / 24})" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${CAP}</g>
</svg>`)
}

mkdirSync("public/icons", { recursive: true })
const out = [
  ["icon-192.png", 192, { inset: 0.6, rounded: true }],
  ["icon-512.png", 512, { inset: 0.6, rounded: true }],
  // Android crops maskable icons to its own shape: full-bleed color, cap in the middle 60%.
  ["icon-maskable-512.png", 512, { inset: 0.5, rounded: false }],
  // iPhone rounds the corners itself.
  ["apple-touch-icon.png", 180, { inset: 0.6, rounded: false }],
  // The small monochrome icon in Android's status bar (white on transparent).
  ["badge-96.png", 96, { inset: 0.8, rounded: false, background: null }],
]
for (const [name, size, options] of out) {
  await sharp(icon(size, options)).png().toFile(`public/icons/${name}`)
  console.log("wrote", `public/icons/${name}`)
}
