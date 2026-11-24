// Fills in the latest release from release.json, which the Pages workflow
// writes at deploy time from the GitHub API. Without it every link still
// points at the latest release page, so the page works as plain HTML.
(async () => {
  const platform = (() => {
    const ua = navigator.userAgent;
    const p = navigator.userAgentData?.platform || navigator.platform || "";
    if (/Win/i.test(p) || /Windows/.test(ua)) return "win";
    if (/Mac/i.test(p) || /Mac OS X/.test(ua)) return "mac";
    if (/Linux|X11/i.test(p) || /Linux/.test(ua)) return "linux";
    return null;
  })();

  const primaryAsset = { mac: "mac-arm", win: "win-msi", linux: "linux-appimage" }[platform];
  const primaryLabel = { mac: "Download for macOS", win: "Download for Windows", linux: "Download for Linux" }[platform];
  const primaryNote = {
    mac: "For Apple Silicon. <a href=\"#download\">Intel Macs</a>, Windows and Linux below",
    win: "64-bit installer. macOS and Linux below",
    linux: "AppImage. <a href=\"#download\">.deb and .rpm</a> below",
  }[platform];
  const rowFor = { mac: 0, win: 2, linux: 3 }[platform];

  let release = null;
  try {
    const res = await fetch("release.json", { cache: "no-cache" });
    if (res.ok) release = await res.json();
  } catch {
    /* offline or not deployed yet: keep the static links */
  }

  if (release?.version) {
    document.querySelectorAll("[data-version]").forEach((el) => (el.textContent = `v${release.version}`));
  }
  if (release?.downloads) {
    document.querySelectorAll("[data-downloads]").forEach(
      (el) => (el.textContent = ` · ${release.downloads.toLocaleString("en-GB")} downloads`),
    );
  }
  if (release?.assets) {
    document.querySelectorAll("[data-asset]").forEach((a) => {
      const url = release.assets[a.dataset.asset];
      if (url) a.href = url;
    });
  }

  const primary = document.querySelector("[data-primary]");
  if (primary && primaryLabel) {
    primary.textContent = primaryLabel;
    const url = release?.assets?.[primaryAsset];
    if (url) primary.href = url;
    const note = document.querySelector("[data-primary-note]");
    if (note) note.innerHTML = primaryNote;
  } else if (primary) {
    primary.textContent = "Download";
    primary.href = "#download";
  }
  if (rowFor != null) document.querySelectorAll(".dl tbody tr")[rowFor]?.setAttribute("data-current", "");
})();
