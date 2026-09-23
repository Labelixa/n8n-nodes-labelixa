#!/usr/bin/env node
// tsc emits only .ts output; n8n loads node icons next to the compiled
// node file, so the .svg files are copied into dist/ after the build.
import { copyFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (name.endsWith(".svg")) out.push(p);
  }
  return out;
}

let copied = 0;
for (const src of walk(join(root, "nodes"))) {
  const dest = join(root, "dist", relative(root, src));
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
  copied++;
}
console.log(`copy-icons: ${copied} file(s)`);
