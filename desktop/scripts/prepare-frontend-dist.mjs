import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(desktopRoot, "..");
const frontendRoot = path.join(repoRoot, "frontend");
const frontendOut = path.join(frontendRoot, "out");
const desktopDist = path.join(desktopRoot, "src-tauri", "frontend-dist");

function run(command, args, cwd, env = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: "inherit",
    shell: false
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
}

if (!fs.existsSync(path.join(frontendRoot, "node_modules", "next"))) {
  run("npm", ["install"], frontendRoot);
}

run("npm", ["run", "build"], frontendRoot, {
  ROBOTCLOUD_FRONTEND_BASE_PATH: ""
});

fs.rmSync(desktopDist, { recursive: true, force: true });
fs.mkdirSync(desktopDist, { recursive: true });

for (const entry of [
  "_next",
  "so101",
  "icons",
  "favicon.ico",
  "icon.png",
  "manifest.webmanifest",
  "sw.js",
  "404.html",
  "404"
]) {
  const source = path.join(frontendOut, entry);
  if (!fs.existsSync(source)) {
    continue;
  }
  fs.cpSync(source, path.join(desktopDist, entry), {
    recursive: true,
    force: true,
    verbatimSymlinks: true
  });
}

const so101Entry = path.join(desktopDist, "so101", "index.html");
const nextAssets = path.join(desktopDist, "_next");
if (!fs.existsSync(so101Entry) || !fs.existsSync(nextAssets)) {
  throw new Error("Desktop frontend export is missing so101/index.html or _next assets.");
}

console.log(`Prepared local SO101 frontend at ${desktopDist}`);
