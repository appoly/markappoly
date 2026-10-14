#!/usr/bin/env node
// Builds the macOS Quick Look preview extension (MarkappolyQuickLook.appex)
// into src-tauri/target/quicklook/, where tauri.macos.conf.json copies it into
// Markappoly.app/Contents/PlugIns/. Runs as Tauri's beforeBundleCommand.
//
// Tauri's bundler signs the outer .app without --deep and never signs files
// from bundle.macOS.files, so the extension is signed here first (inside-out),
// with the same Developer ID identity and the same env vars Tauri uses:
//   APPLE_CERTIFICATE (+ _PASSWORD) → imported into a throwaway keychain
//   APPLE_SIGNING_IDENTITY alone    → identity from the login keychain
//   neither                         → ad-hoc signature (local builds)
//
// Flags: --harness also builds the render test harness (quicklook/test).

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(root, "quicklook");
const outDir = path.join(root, "src-tauri", "target", "quicklook");
const appex = path.join(outDir, "MarkappolyQuickLook.appex");
const MODULE = "MarkappolyQuickLook";
const MIN_MACOS = "13.0";

const log = (msg) => console.log(`[quicklook] ${msg}`);

if (process.platform !== "darwin") {
  log("not macOS, skipping");
  process.exit(0);
}
const tauriPlatform = process.env.TAURI_ENV_PLATFORM;
if (tauriPlatform && tauriPlatform !== "darwin") {
  log(`bundling for ${tauriPlatform}, skipping`);
  process.exit(0);
}

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { stdio: ["ignore", "pipe", "inherit"], encoding: "utf8", ...opts });

/** Swift arch names for the target being bundled (lipo'd when universal). */
function targetArchs() {
  const triple = process.env.TAURI_ENV_TARGET_TRIPLE ?? "";
  const arch = process.env.TAURI_ENV_ARCH ?? "";
  if (triple.startsWith("universal")) return ["arm64", "x86_64"];
  if (triple.startsWith("aarch64") || arch === "aarch64") return ["arm64"];
  if (triple.startsWith("x86_64") || arch === "x86_64") return ["x86_64"];
  return [process.arch === "arm64" ? "arm64" : "x86_64"];
}

function compile(archs, sources, output, extraArgs) {
  const sdk = run("xcrun", ["--sdk", "macosx", "--show-sdk-path"]).trim();
  const slices = archs.map((arch) => {
    const slice = archs.length === 1 ? output : `${output}-${arch}`;
    run("xcrun", [
      "swiftc",
      "-sdk", sdk,
      "-target", `${arch}-apple-macos${MIN_MACOS}`,
      "-module-name", MODULE,
      "-O",
      ...extraArgs,
      ...sources,
      "-o", slice,
    ]);
    return slice;
  });
  if (slices.length > 1) {
    run("lipo", ["-create", ...slices, "-output", output]);
    slices.forEach((s) => fs.rmSync(s));
  }
}

function writeResources(resources) {
  fs.mkdirSync(resources, { recursive: true });
  const marked = fs.readFileSync(
    path.join(root, "node_modules", "marked", "lib", "marked.umd.js"),
    "utf8",
  );
  const render = fs.readFileSync(path.join(srcDir, "render.js"), "utf8");
  fs.writeFileSync(path.join(resources, "render.bundle.js"), `${marked}\n;\n${render}`);
  fs.copyFileSync(path.join(srcDir, "style.css"), path.join(resources, "style.css"));
}

function appInfo() {
  const conf = JSON.parse(fs.readFileSync(path.join(root, "src-tauri", "tauri.conf.json"), "utf8"));
  return { version: conf.version, bundleId: `${conf.identifier}.quicklook` };
}

function sign(target) {
  const entitlements = path.join(srcDir, "entitlements.plist");
  const identity = process.env.APPLE_SIGNING_IDENTITY;
  const certificate = process.env.APPLE_CERTIFICATE;
  const base = ["--force", "--options", "runtime", "--entitlements", entitlements];

  if (!identity) {
    log("no APPLE_SIGNING_IDENTITY, ad-hoc signing");
    run("codesign", [...base, "--sign", "-", target]);
    return;
  }
  if (!certificate) {
    log(`signing with "${identity}" from the login keychain`);
    run("codesign", [...base, "--timestamp", "--sign", identity, target]);
    return;
  }

  // Mirror tauri-macos-sign: throwaway keychain holding the imported .p12.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "markappoly-ql-"));
  const keychain = path.join(tmp, "quicklook.keychain-db");
  const password = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const certPath = path.join(tmp, "cert.p12");
  fs.writeFileSync(certPath, Buffer.from(certificate.replace(/\s+/g, ""), "base64"));
  const previous = run("security", ["list-keychains", "-d", "user"])
    .split("\n")
    .map((l) => l.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);
  try {
    run("security", ["create-keychain", "-p", password, keychain]);
    run("security", ["unlock-keychain", "-p", password, keychain]);
    run("security", ["set-keychain-settings", "-t", "3600", "-u", keychain]);
    run("security", [
      "import", certPath,
      "-P", process.env.APPLE_CERTIFICATE_PASSWORD ?? "",
      "-T", "/usr/bin/codesign",
      "-T", "/usr/bin/pkgbuild",
      "-T", "/usr/bin/productbuild",
      "-k", keychain,
    ]);
    run("security", [
      "set-key-partition-list",
      "-S", "apple-tool:,apple:,codesign:",
      "-s", "-k", password, keychain,
    ]);
    run("security", ["list-keychains", "-d", "user", "-s", ...previous, keychain]);
    log(`signing with "${identity}" from the imported certificate`);
    run("codesign", [...base, "--timestamp", "--keychain", keychain, "--sign", identity, target]);
  } finally {
    try {
      run("security", ["list-keychains", "-d", "user", "-s", ...previous]);
    } catch {}
    try {
      run("security", ["delete-keychain", keychain]);
    } catch {}
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const archs = targetArchs();
log(
  `target: platform=${tauriPlatform ?? "-"} arch=${process.env.TAURI_ENV_ARCH ?? "-"} triple=${process.env.TAURI_ENV_TARGET_TRIPLE ?? "-"}`,
);
const { version, bundleId } = appInfo();
log(`building ${bundleId} ${version} for ${archs.join("+")}`);

fs.rmSync(appex, { recursive: true, force: true });
const contents = path.join(appex, "Contents");
fs.mkdirSync(path.join(contents, "MacOS"), { recursive: true });

const plist = fs
  .readFileSync(path.join(srcDir, "Info.plist"), "utf8")
  .replaceAll("__BUNDLE_ID__", bundleId)
  .replaceAll("__VERSION__", version);
fs.writeFileSync(path.join(contents, "Info.plist"), plist);
writeResources(path.join(contents, "Resources"));

compile(
  archs,
  [path.join(srcDir, "PreviewProvider.swift"), path.join(srcDir, "Renderer.swift")],
  path.join(contents, "MacOS", MODULE),
  // App extensions start in NSExtensionMain rather than a main() of their own.
  ["-parse-as-library", "-application-extension", "-Xlinker", "-e", "-Xlinker", "_NSExtensionMain"],
);

sign(appex);
run("codesign", ["--verify", "--strict", "--verbose=2", appex], { stdio: "inherit" });
log(`built ${path.relative(root, appex)}`);

if (process.argv.includes("--harness")) {
  const harness = path.join(outDir, "harness");
  compile(
    [process.arch === "arm64" ? "arm64" : "x86_64"],
    [path.join(srcDir, "Renderer.swift"), path.join(srcDir, "test", "main.swift")],
    harness,
    [],
  );
  log(`harness: ${path.relative(root, harness)} ${path.relative(root, path.join(contents, "Resources"))} <file.md>`);
}
