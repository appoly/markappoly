#!/usr/bin/env node
/**
 * Daily dependency-audit helper.
 *
 *   node scripts/security-release.mjs           # report only
 *   node scripts/security-release.mjs --apply   # apply non-breaking fixes, bump if clean
 *
 * Writes GitHub Actions outputs when $GITHUB_OUTPUT is set:
 *   remediated, audit_ok, version, notes, remaining
 *
 * High/critical npm findings listed in audit-ci.jsonc are treated as known
 * (currently the unpatched image-size DoS advisories). cargo-audit warnings
 * (unmaintained / unsound) stay warnings, matching CI.
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const apply = process.argv.includes("--apply");

const NPM_LOCK = resolve(root, "package-lock.json");
const CARGO_TOML = resolve(root, "src-tauri/Cargo.toml");
const CARGO_LOCK = resolve(root, "src-tauri/Cargo.lock");
const PACKAGE_JSON = resolve(root, "package.json");
const TAURI_CONF = resolve(root, "src-tauri/tauri.conf.json");
const AUDIT_CI = resolve(root, "audit-ci.jsonc");

function run(cmd, opts = {}) {
  return execSync(cmd, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...opts,
  });
}

function runAllowFail(cmd) {
  try {
    return { ok: true, stdout: run(cmd), stderr: "" };
  } catch (err) {
    return {
      ok: false,
      stdout: String(err.stdout ?? ""),
      stderr: String(err.stderr ?? ""),
    };
  }
}

export function parseJsonc(text) {
  const stripped = text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  return JSON.parse(stripped);
}

export function allowlistedIdsFromConfig(text) {
  const config = parseJsonc(text);
  return new Set((config.allowlist ?? []).map(String));
}

function allowlistedIds() {
  if (!existsSync(AUDIT_CI)) return new Set();
  return allowlistedIdsFromConfig(readFileSync(AUDIT_CI, "utf8"));
}

function ghsaIdsFromVuln(vuln, vulns, seen = new Set()) {
  const ids = [];
  for (const item of vuln.via ?? []) {
    if (typeof item === "string") {
      if (seen.has(item) || !vulns[item]) continue;
      seen.add(item);
      ids.push(...ghsaIdsFromVuln(vulns[item], vulns, seen));
      continue;
    }
    if (item.url) {
      const match = String(item.url).match(/GHSA-[a-z0-9-]+/i);
      if (match) ids.push(match[0]);
    }
  }
  return [...new Set(ids)];
}

export function collectNpmBlocking(audit, allow) {
  const blocking = [];
  const vulns = audit.vulnerabilities ?? {};
  for (const [name, vuln] of Object.entries(vulns)) {
    if (vuln.severity !== "high" && vuln.severity !== "critical") continue;
    const ids = ghsaIdsFromVuln(vuln, vulns);
    const known = ids.length > 0 && ids.every((id) => allow.has(id));
    if (known) continue;
    blocking.push({
      name,
      severity: vuln.severity,
      ids,
      fixAvailable: vuln.fixAvailable,
      title: (vuln.via ?? [])
        .filter((item) => item && typeof item === "object")
        .map((item) => item.title)
        .filter(Boolean)
        .join("; "),
    });
  }
  return blocking;
}

function readNpmAudit() {
  const result = runAllowFail("npm audit --omit=dev --json");
  const raw = result.stdout.trim() || "{}";
  let audit;
  try {
    audit = JSON.parse(raw);
  } catch {
    throw new Error(`npm audit did not return JSON:\n${raw}\n${result.stderr}`);
  }
  return audit;
}

function readCargoAudit() {
  if (!commandExists("cargo-audit")) {
    return { missing: true, vulns: [] };
  }
  const result = runAllowFail("cargo audit --file src-tauri/Cargo.lock --json");
  const raw = (result.stdout || result.stderr).trim();
  if (!raw) {
    return { missing: false, vulns: [], parseError: result.stderr };
  }
  let report;
  try {
    report = JSON.parse(raw);
  } catch {
    // cargo-audit prints progress on stderr and JSON on stdout; if JSON
    // parse failed, treat a zero exit as clean and a non-zero as blocking.
    if (result.ok) return { missing: false, vulns: [] };
    return {
      missing: false,
      vulns: [
        {
          crate: "unknown",
          id: "cargo-audit",
          title: "cargo audit failed",
          detail: raw.slice(0, 2000),
        },
      ],
    };
  }
  const list = report.vulnerabilities?.list ?? [];
  return {
    missing: false,
    vulns: list.map((item) => ({
      crate: item.package?.name ?? item.advisory?.package ?? "unknown",
      version: item.package?.version,
      id: item.advisory?.id,
      title: item.advisory?.title,
    })),
  };
}

function commandExists(name) {
  try {
    run(`command -v ${name}`);
    return true;
  } catch {
    return false;
  }
}

function snapshotLocks() {
  return {
    npm: existsSync(NPM_LOCK) ? readFileSync(NPM_LOCK, "utf8") : "",
    cargo: existsSync(CARGO_LOCK) ? readFileSync(CARGO_LOCK, "utf8") : "",
  };
}

function currentVersion() {
  return JSON.parse(readFileSync(PACKAGE_JSON, "utf8")).version;
}

export function shouldCutRelease({ hadBlocking, lockfilesChanged, auditOk }) {
  return Boolean(hadBlocking && lockfilesChanged && auditOk);
}

export function bumpPatch(version) {
  const parts = version.split(".").map((n) => Number(n));
  if (parts.length !== 3 || parts.some((n) => !Number.isInteger(n))) {
    throw new Error(`Unsupported version: ${version}`);
  }
  parts[2] += 1;
  return parts.join(".");
}

function replaceVersion(path, from, to) {
  const original = readFileSync(path, "utf8");
  const updated = original.split(from).join(to);
  if (updated === original) {
    throw new Error(`Could not bump version in ${path}`);
  }
  writeFileSync(path, updated);
}

function bumpProjectVersion(next) {
  const current = currentVersion();
  replaceVersion(PACKAGE_JSON, `"version": "${current}"`, `"version": "${next}"`);
  replaceVersion(TAURI_CONF, `"version": "${current}"`, `"version": "${next}"`);
  replaceVersion(CARGO_TOML, `version = "${current}"`, `version = "${next}"`);
  const lockNeedle = `name = "markdown-viewer"\nversion = "${current}"`;
  const lockNext = `name = "markdown-viewer"\nversion = "${next}"`;
  replaceVersion(CARGO_LOCK, lockNeedle, lockNext);
}

function formatNotes({ nextVersion, npmBefore, npmAfter, cargoBefore, cargoAfter }) {
  const fixedNpm = npmBefore.filter(
    (item) => !npmAfter.some((after) => after.name === item.name),
  );
  const fixedCargo = cargoBefore.filter(
    (item) => !cargoAfter.some((after) => after.id === item.id),
  );

  const lines = [
    `Security dependency updates for ${nextVersion}.`,
    "",
  ];
  if (fixedNpm.length) {
    lines.push("npm:");
    for (const item of fixedNpm) {
      const ids = item.ids.length ? ` (${item.ids.join(", ")})` : "";
      lines.push(`- ${item.name}${ids}${item.title ? ` — ${item.title}` : ""}`);
    }
    lines.push("");
  }
  if (fixedCargo.length) {
    lines.push("Rust:");
    for (const item of fixedCargo) {
      lines.push(
        `- ${item.crate}${item.id ? ` (${item.id})` : ""}${item.title ? ` — ${item.title}` : ""}`,
      );
    }
    lines.push("");
  }
  if (!fixedNpm.length && !fixedCargo.length) {
    lines.push("Applied lockfile remediations for outstanding advisories.");
    lines.push("");
  }
  lines.push("Existing installs will offer to update automatically.");
  return lines.join("\n");
}

function formatRemaining(npmBlocking, cargoVulns) {
  const lines = [];
  if (npmBlocking.length) {
    lines.push("npm high/critical (not allowlisted):");
    for (const item of npmBlocking) {
      const fix =
        item.fixAvailable === false
          ? "no fix"
          : typeof item.fixAvailable === "object"
            ? `fix via ${item.fixAvailable.name}@${item.fixAvailable.version}${item.fixAvailable.isSemVerMajor ? " (major)" : ""}`
            : "fix available";
      lines.push(`- ${item.name} (${item.severity}, ${fix}) ${item.ids.join(", ")}`);
    }
  }
  if (cargoVulns.length) {
    lines.push("Rust vulnerabilities:");
    for (const item of cargoVulns) {
      lines.push(`- ${item.crate} ${item.version ?? ""} ${item.id ?? ""} ${item.title ?? ""}`.trim());
    }
  }
  return lines.join("\n");
}

function setOutput(name, value) {
  const dest = process.env.GITHUB_OUTPUT;
  if (!dest) return;
  const text = String(value);
  if (text.includes("\n")) {
    const delim = `EOF_${name}_${Math.random().toString(36).slice(2)}`;
    writeFileSync(dest, `${name}<<${delim}\n${text}\n${delim}\n`, { flag: "a" });
  } else {
    writeFileSync(dest, `${name}=${text}\n`, { flag: "a" });
  }
}

function main() {
  const allow = allowlistedIds();
  const beforeLocks = snapshotLocks();

  const npmBefore = collectNpmBlocking(readNpmAudit(), allow);
  const cargoBefore = readCargoAudit();
  const hadBlocking = npmBefore.length > 0 || cargoBefore.vulns.length > 0;
  if (apply && hadBlocking && cargoBefore.missing) {
    throw new Error("cargo-audit is required to remediate Rust advisories");
  }

  // Do not run audit-fix when the only findings are allowlisted: npm audit fix
  // can rewrite the lockfile without remediating anything, which would look
  // like a release candidate.
  if (apply && hadBlocking) {
    runAllowFail("npm audit fix --omit=dev");
    if (commandExists("cargo-audit")) {
      runAllowFail("cargo audit fix --file src-tauri/Cargo.lock");
    }
  }

  const afterLocks = snapshotLocks();
  const lockfilesChanged =
    beforeLocks.npm !== afterLocks.npm || beforeLocks.cargo !== afterLocks.cargo;

  const npmAfter = collectNpmBlocking(readNpmAudit(), allow);
  const cargoAfter = readCargoAudit();
  const auditOk = npmAfter.length === 0 && (cargoAfter.missing || cargoAfter.vulns.length === 0);
  const remediated = shouldCutRelease({ hadBlocking, lockfilesChanged, auditOk });

  let version = currentVersion();
  let notes = "";
  if (apply && remediated) {
    const next = bumpPatch(version);
    bumpProjectVersion(next);
    version = next;
    notes = formatNotes({
      nextVersion: next,
      npmBefore,
      npmAfter,
      cargoBefore: cargoBefore.vulns,
      cargoAfter: cargoAfter.vulns,
    });
  }

  const remaining = formatRemaining(npmAfter, cargoAfter.vulns ?? []);

  const report = [
    `version=${version}`,
    `apply=${apply}`,
    `remediated=${remediated}`,
    `audit_ok=${auditOk}`,
    remaining ? `remaining:\n${remaining}` : "remaining: none (allowlisted findings only)",
    notes ? `notes:\n${notes}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  console.log(report);

  setOutput("remediated", remediated ? "true" : "false");
  setOutput("audit_ok", auditOk ? "true" : "false");
  setOutput("version", version);
  setOutput("notes", notes);
  setOutput("remaining", remaining);

  // Non-zero only on unexpected failure — outstanding vulns are reported via outputs.
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    main();
  } catch (err) {
    console.error(err instanceof Error ? err.stack || err.message : err);
    process.exit(1);
  }
}
