import { defineConfig } from 'vite'
import { execSync } from 'node:child_process'

let sha = 'dev'
try { sha = execSync('git rev-parse --short HEAD').toString().trim() } catch { /* not a git checkout */ }

export default defineConfig({
  define: { __BUILD__: JSON.stringify(process.env.npm_package_version + '+' + sha) },
})
