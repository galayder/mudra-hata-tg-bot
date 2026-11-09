// Runs after `npm install`.
//
// Newer npm versions (e.g. the one bundled with Node 24 on Bot-Hosting.net) block
// dependency install scripts unless they are allow-listed, so better-sqlite3 never
// fetches its native binary. Our own postinstall still runs, so we do that step here:
// the same command better-sqlite3's install script would run. Then we compile TypeScript.
"use strict";

const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const sqliteDir = path.join(root, "node_modules", "better-sqlite3");
const binding = path.join(sqliteDir, "build", "Release", "better_sqlite3.node");

function run(cmd, cwd) {
  console.log(`[postinstall] ${cmd}`);
  execSync(cmd, { cwd, stdio: "inherit" });
}

if (fs.existsSync(sqliteDir) && !fs.existsSync(binding)) {
  // Prefer the prebuilt binary; fall back to compiling from source.
  run("prebuild-install || node-gyp rebuild --release", sqliteDir);
}

run("tsc", root);
