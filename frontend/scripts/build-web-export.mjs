import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const command = process.execPath;
const args = [path.join(root, "node_modules", "next", "dist", "bin", "next"), "build"];
const staleBrowserDataWarningFilter = path.join(
  root,
  "scripts",
  "suppress-stale-browser-data-warnings.cjs"
);
const nodeOptions = [
  process.env.NODE_OPTIONS,
  `--require=${staleBrowserDataWarningFilter}`
]
  .filter(Boolean)
  .join(" ");

for (const name of [".next", "out"]) {
  fs.rmSync(path.join(root, name), { recursive: true, force: true });
}

const result = spawnSync(command, args, {
  cwd: root,
  env: {
    ...process.env,
    BROWSERSLIST_IGNORE_OLD_DATA: "1",
    NODE_OPTIONS: nodeOptions,
    ROBOTCLOUD_FRONTEND_BASE_PATH: ""
  },
  stdio: "inherit",
  shell: false
});
if (result.error) {
  console.error(result.error);
}

process.exit(result.status ?? 1);
