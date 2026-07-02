import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const command = process.execPath;
const args = [path.join(root, "node_modules", "next", "dist", "bin", "next"), "build"];
for (const name of [".next", "out"]) {
  fs.rmSync(path.join(root, name), { recursive: true, force: true });
}
fs.rmSync(path.join(root, "out-desktop"), { recursive: true, force: true });

const result = spawnSync(command, args, {
  cwd: root,
  env: {
    ...process.env,
    ROBOTCLOUD_DESKTOP_BUILD: "1",
    ROBOTCLOUD_FRONTEND_BASE_PATH: process.env.ROBOTCLOUD_FRONTEND_BASE_PATH || "/desktop"
  },
  stdio: "inherit",
  shell: false
});
if (result.error) {
  console.error(result.error);
}

if (result.status === 0) {
  const source = path.join(root, "out");
  const target = path.join(root, "out-desktop", "desktop");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true });
  console.log(`Desktop export written to ${target}`);
}

process.exit(result.status ?? 1);
