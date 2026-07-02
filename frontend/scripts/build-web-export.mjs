import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appDir = path.join(root, "app");
const so101Dir = path.join(appDir, "so101");
const disabledDir = path.join(root, ".robotcloud-desktop-only-so101");
const command = process.execPath;
const args = [path.join(root, "node_modules", "next", "dist", "bin", "next"), "build"];

function cleanBuildOutput() {
  for (const name of [".next", "out"]) {
    fs.rmSync(path.join(root, name), { recursive: true, force: true });
  }
}

function runNextBuild() {
  return spawnSync(command, args, {
    cwd: root,
    env: {
      ...process.env,
      ROBOTCLOUD_DESKTOP_BUILD: "0",
      ROBOTCLOUD_FRONTEND_BASE_PATH: ""
    },
    stdio: "inherit",
    shell: false
  });
}

if (fs.existsSync(disabledDir)) {
  throw new Error(`Refusing to build with stale disabled route directory: ${disabledDir}`);
}

cleanBuildOutput();

let moved = false;
try {
  if (fs.existsSync(so101Dir)) {
    fs.renameSync(so101Dir, disabledDir);
    moved = true;
  }

  const result = runNextBuild();
  if (result.error) {
    console.error(result.error);
  }
  process.exitCode = result.status ?? 1;
} finally {
  if (moved && fs.existsSync(disabledDir)) {
    fs.renameSync(disabledDir, so101Dir);
  }
}
