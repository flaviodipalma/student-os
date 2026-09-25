// Builds the extension into extension/dist (load that folder in chrome://extensions).
//   npm run build:extension
//
// Icons: popup.html writes <i data-icon="refresh-cw"></i>; they're replaced with the
// same Lucide SVGs the app uses (read from lucide-react's icon data at build time, so
// the popup ships no React). The Geist font (OFL, license in src/fonts) is copied as is.
import { build } from "esbuild"
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = dirname(fileURLToPath(import.meta.url))
const dist = join(root, "dist")

async function lucide(name, className) {
  const { __iconData } = await import(`lucide-react/dist/esm/icons/${name}.mjs`)
  const children = __iconData.node
    .map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).filter(([key]) => key !== "key").map(([key, value]) => `${key}="${value}"`).join(" ")}/>`)
    .join("")
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon${className ? ` ${className}` : ""}" aria-hidden="true">${children}</svg>`
}

rmSync(dist, { recursive: true, force: true })
mkdirSync(dist)
await build({
  entryPoints: [join(root, "src/popup.ts"), join(root, "src/background.ts"), join(root, "src/marker.ts")],
  bundle: true,
  format: "esm",
  target: "chrome120",
  outdir: dist,
  logLevel: "warning",
})
cpSync(join(root, "manifest.json"), join(dist, "manifest.json"))
cpSync(join(root, "src/popup.css"), join(dist, "popup.css"))
cpSync(join(root, "src/fonts"), join(dist, "fonts"), { recursive: true })

let html = readFileSync(join(root, "src/popup.html"), "utf8")
for (const [tag, name, className] of [...html.matchAll(/<i data-icon="([a-z0-9-]+)"(?: class="([^"]*)")?><\/i>/g)]) {
  html = html.replace(tag, await lucide(name, className))
}
writeFileSync(join(dist, "popup.html"), html)
console.log("Built extension/dist")
