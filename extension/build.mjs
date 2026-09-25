// Builds the extension into extension/dist (load that folder in chrome://extensions).
//   npm run build:extension
import { build } from "esbuild"
import { cpSync, mkdirSync, rmSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = dirname(fileURLToPath(import.meta.url))
const dist = join(root, "dist")

rmSync(dist, { recursive: true, force: true })
mkdirSync(dist)
await build({
  entryPoints: [join(root, "src/popup.ts")],
  bundle: true,
  format: "esm",
  target: "chrome120",
  outdir: dist,
  logLevel: "warning",
})
cpSync(join(root, "manifest.json"), join(dist, "manifest.json"))
for (const file of ["popup.html", "popup.css"]) cpSync(join(root, "src", file), join(dist, file))
console.log("Built extension/dist")
