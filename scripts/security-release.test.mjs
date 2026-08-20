import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  allowlistedIdsFromConfig,
  bumpPatch,
  collectNpmBlocking,
  shouldCutRelease,
} from "./security-release.mjs";

describe("bumpPatch", () => {
  it("increments the patch number", () => {
    expect(bumpPatch("0.7.1")).toBe("0.7.2");
  });

  it("rejects a non-semver version", () => {
    expect(() => bumpPatch("1.0")).toThrow(/Unsupported version/);
  });
});

describe("collectNpmBlocking", () => {
  const allow = allowlistedIdsFromConfig(
    readFileSync(resolve(import.meta.dirname, "../audit-ci.jsonc"), "utf8"),
  );

  it("treats allowlisted GHSA ids and wrapper packages as non-blocking", () => {
    const blocking = collectNpmBlocking(
      {
        vulnerabilities: {
          "image-size": {
            severity: "high",
            via: [
              {
                url: "https://github.com/advisories/GHSA-w3rx-r6r6-pgpr",
                title: "ICNS loop",
                source: 1138808,
              },
              {
                url: "https://github.com/advisories/GHSA-5p2g-fcmc-qvqq",
                title: "JXL loop",
                source: 1138809,
              },
            ],
            fixAvailable: false,
          },
          "remark-docx": {
            severity: "high",
            via: ["image-size"],
            fixAvailable: { name: "remark-docx", version: "0.2.1", isSemVerMajor: true },
          },
        },
      },
      allow,
    );
    expect(blocking).toEqual([]);
  });

  it("reports a high advisory that is not on the allowlist", () => {
    const blocking = collectNpmBlocking(
      {
        vulnerabilities: {
          postcss: {
            severity: "high",
            via: [
              {
                url: "https://github.com/advisories/GHSA-xxxx-yyyy-zzzz",
                title: "made up",
              },
            ],
            fixAvailable: true,
          },
        },
      },
      allow,
    );
    expect(blocking).toHaveLength(1);
    expect(blocking[0].name).toBe("postcss");
    expect(blocking[0].ids).toContain("GHSA-xxxx-yyyy-zzzz");
  });
});

describe("shouldCutRelease", () => {
  it("releases only when a blocking advisory was actually remediable", () => {
    expect(shouldCutRelease({ hadBlocking: true, lockfilesChanged: true, auditOk: true })).toBe(true);
  });

  it("does not release for lockfile churn when nothing was blocking", () => {
    expect(shouldCutRelease({ hadBlocking: false, lockfilesChanged: true, auditOk: true })).toBe(false);
  });

  it("does not release when remediations did not clear the audit", () => {
    expect(shouldCutRelease({ hadBlocking: true, lockfilesChanged: true, auditOk: false })).toBe(false);
  });
});
