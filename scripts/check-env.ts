// `npm run check:env`: checks the environment variables before starting or
// deploying (the same checks the server runs when it starts). Prints names and
// problems only, never values. Exit code 1 if anything would stop the server.
//
//   npm run check:env                 # .env.local, development rules
//   APP_ENV=production npm run check:env   # deployment rules (HTTPS, no localhost, no mock AI)
import { existsSync } from "node:fs"
import { checkEnv, isDeployment } from "../src/server/env"

if (existsSync(".env.local") && !process.env.CI) process.loadEnvFile(".env.local")
const production = isDeployment()
const { errors, warnings } = checkEnv(process.env, production)
console.log(`Checking the environment (${production ? "production" : "development"} rules)…`)
for (const warning of warnings) console.log(`  warning: ${warning}`)
for (const error of errors) console.log(`  ERROR:   ${error}`)
console.log(errors.length ? `${errors.length} problem(s) to fix.` : "OK: nothing blocks the server from starting.")
process.exit(errors.length ? 1 : 0)
