// Builds the extension.
//   npm run build:extension         extension/dist, for development: talks to http://localhost:3000
//                                   (load that folder in chrome://extensions)
//   npm run build:extension:store   extension/dist-store + extension/quadernio-extension-<version>.zip,
//                                   for the Chrome Web Store: talks to https://quadernio.com, and asks
//                                   for that site only (no localhost)
//
// Icons: popup.html writes <i data-icon="refresh-cw"></i>; they're replaced with the
// same Lucide SVGs the app uses (read from lucide-react's icon data at build time, so
// the popup ships no React). The Geist font (OFL, license in src/fonts) is copied as is.
import { build } from "esbuild"
import { execFileSync } from "node:child_process"
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const STORE_ADDRESS = "https://quadernio.com"

const root = dirname(fileURLToPath(import.meta.url))
const store = process.argv.includes("--store")
const dist = join(root, store ? "dist-store" : "dist")

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
  // Only the store build has a fixed address; otherwise DEFAULT_ADDRESS falls back to localhost.
  define: store ? { __QUADERNIO_ADDRESS__: JSON.stringify(STORE_ADDRESS) } : {},
  // …and drops the unused localhost fallback from the shipped code.
  minifySyntax: store,
})
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"))
if (store) manifest.host_permissions = [`${STORE_ADDRESS}/*`]
writeFileSync(join(dist, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n")
cpSync(join(root, "icons"), join(dist, "icons"), { recursive: true })
cpSync(join(root, "src/popup.css"), join(dist, "popup.css"))
cpSync(join(root, "src/fonts"), join(dist, "fonts"), { recursive: true })

let html = readFileSync(join(root, "src/popup.html"), "utf8")
for (const [tag, name, className] of [...html.matchAll(/<i data-icon="([a-z0-9-]+)"(?: class="([^"]*)")?><\/i>/g)]) {
  html = html.replace(tag, await lucide(name, className))
}
writeFileSync(join(dist, "popup.html"), html)

if (store) {
  const zip = join(root, `quadernio-extension-${manifest.version}.zip`)
  rmSync(zip, { force: true })
  execFileSync("zip", ["-qrX", zip, "."], { cwd: dist })
  console.log(`Built extension/dist-store and extension/quadernio-extension-${manifest.version}.zip (${STORE_ADDRESS})`)
} else {
  console.log("Built extension/dist")
}
