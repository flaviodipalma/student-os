// Builds src/server/schools/schools.json, the list behind the School field.
//
//   US schools: IPEDS "Institutional Characteristics" (HD<year>.csv, US Department of
//   Education, public domain), active degree-granting institutions, official names.
//     https://nces.ed.gov/ipeds/datacenter/data/HD2023.zip
//   Everywhere else: "world universities and domains" (Hipo, MIT license).
//     https://github.com/Hipo/university-domains-list (world_universities_and_domains.json)
//
// Usage (refresh yearly): download both, then
//   node scripts/build-school-list.mjs <HD2023.csv> <world_universities_and_domains.json>
import { readFileSync, writeFileSync } from "node:fs"

const [ipedsPath, worldPath] = process.argv.slice(2)
if (!ipedsPath || !worldPath) throw new Error("usage: node scripts/build-school-list.mjs <HD2023.csv> <world_universities_and_domains.json>")

function parseCsvLine(line) {
  const out = []
  let cur = ""
  let quoted = false
  for (const c of line) {
    if (quoted && c === '"') quoted = false
    else if (quoted) cur += c
    else if (c === '"') quoted = true
    else if (c === ",") {
      out.push(cur)
      cur = ""
    } else cur += c
  }
  out.push(cur)
  return out
}

// "www.qu.edu/" or "https://www.x.edu/about" -> "qu.edu"
function domainOf(address) {
  const raw = (address ?? "").trim()
  if (!raw) return null
  try {
    const host = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.toLowerCase().replace(/^www\./, "")
    return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) ? host : null
  } catch {
    return null
  }
}

const lines = readFileSync(ipedsPath, "utf8").replace(/^﻿/, "").split(/\r?\n/).filter(Boolean)
const head = parseCsvLine(lines[0])
const col = (name) => head.indexOf(name)
const us = lines
  .slice(1)
  .map(parseCsvLine)
  .filter((row) => row[col("CYACTIVE")] === "1" && row[col("DEGGRANT")] === "1")
  .map((row) => [row[col("INSTNM")].trim(), domainOf(row[col("WEBADDR")]), "US"])

const world = JSON.parse(readFileSync(worldPath, "utf8"))
  .filter((u) => u.alpha_two_code && u.alpha_two_code !== "US" && typeof u.name === "string" && u.name.trim())
  .map((u) => [u.name.trim(), domainOf(u.domains?.[0]), u.alpha_two_code])

// One entry per name and country.
const seen = new Set()
const schools = [...us, ...world].filter(([name, , country]) => {
  const key = `${name.toLowerCase()}|${country}`
  if (seen.has(key)) return false
  seen.add(key)
  return true
})
schools.sort((a, b) => a[0].localeCompare(b[0]))

writeFileSync(
  new URL("../src/server/schools/schools.json", import.meta.url),
  JSON.stringify(schools).replace(/\],\[/g, "],\n[") + "\n"
)
console.log(`${schools.length} schools (${us.length} US, ${schools.length - us.length} elsewhere)`)
