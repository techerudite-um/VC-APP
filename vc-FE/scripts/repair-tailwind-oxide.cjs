/**
 * Tailwind CSS v4 loads @tailwindcss/oxide, which needs a platform-specific optional package.
 * npm sometimes omits those (see npm/cli#4828). This re-installs the Linux x64 binding if missing.
 */
const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const modules = path.join(root, "node_modules");

function isMusl() {
  try {
    return fs.readFileSync("/usr/bin/ldd", "utf8").includes("musl");
  } catch {
    return false;
  }
}

function hasFile(rel) {
  return fs.existsSync(path.join(modules, rel));
}

if (process.platform !== "linux" || process.arch !== "x64") {
  process.exit(0);
}

const musl = isMusl();
const pkg = musl ? "@tailwindcss/oxide-linux-x64-musl@4.3.0" : "@tailwindcss/oxide-linux-x64-gnu@4.3.0";
const ok = musl
  ? hasFile("@tailwindcss/oxide-linux-x64-musl/tailwindcss-oxide.linux-x64-musl.node")
  : hasFile("@tailwindcss/oxide-linux-x64-gnu/tailwindcss-oxide.linux-x64-gnu.node");

if (ok) {
  process.exit(0);
}

console.warn(`[postinstall] Missing Tailwind Oxide native binary; installing ${pkg} …`);
execSync(`npm install ${pkg}`, { cwd: root, stdio: "inherit", env: process.env });
