#!/usr/bin/env node
// Writes one build tag into the three places that must agree: the app.js
// cache-buster in index.html, the traffic-vision import in app.js, and the
// ATLAS_BUILD constant the page shows on the version badge. Pattern from the
// Jakarta atlas (scripts/stamp-build-id.mjs there).
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const sha = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
const now = new Date();
const day = now.toISOString().slice(0, 10).replaceAll("-", "");
const tag = `bkk-atlas-${day}-${Math.floor(now.getTime() / 1000)}-${sha}`;

const html = new URL("../public/index.html", import.meta.url);
const app = new URL("../public/app.js", import.meta.url);
const nextHtml = readFileSync(html, "utf8").replace(/src="\/app\.js\?v=[^"]*"/, `src="/app.js?v=${tag}"`);
const nextApp = readFileSync(app, "utf8")
  .replace(/traffic-vision\.js\?v=[^']*'/, `traffic-vision.js?v=${tag}'`)
  .replace(/const ATLAS_BUILD = "[^"]*";/, `const ATLAS_BUILD = "${tag}";`);
if (!nextHtml.includes(tag) || nextApp.split(tag).length !== 3) throw new Error("stamp: a cache-buster or ATLAS_BUILD was not found");
writeFileSync(html, nextHtml);
writeFileSync(app, nextApp);
console.log(tag);
