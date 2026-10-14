/**
 * Wait until the preview is fully drawn before printing: Mermaid diagrams
 * finished, embedded notes loaded, images decoded, web fonts ready. Printing
 * earlier captures "Rendering diagram…" placeholders and blank images.
 *
 * Bounded by `timeoutMs` so one broken image or a diagram that never settles
 * can't stall the print dialog forever; on timeout we print what we have.
 */
export async function waitForPrintReady(
  getRoot: () => Element | null,
  timeoutMs = 6000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  const withinDeadline = <T>(p: Promise<T>) =>
    Promise.race([p, sleep(Math.max(0, deadline - Date.now()))]);

  // Two frames: the mode switch to Preview commits, then paints.
  await frame();
  await frame();

  const busy = (root: Element) =>
    root.querySelector(".mermaid-diagram[data-pending]") !== null ||
    Array.from(root.querySelectorAll(".embed-note-missing")).some(
      (el) => el.textContent === "Loading…",
    );

  // Diagrams and embeds load asynchronously and can reveal further images,
  // so poll until nothing is pending.
  for (;;) {
    const root = getRoot();
    if (!root || !busy(root) || Date.now() >= deadline) break;
    await sleep(50);
  }

  const root = getRoot();
  if (root) {
    const images = Array.from(root.querySelectorAll("img"));
    await withinDeadline(
      Promise.all(images.map((img) => (img.complete ? null : img.decode().catch(() => null)))),
    );
  }
  if (document.fonts) await withinDeadline(document.fonts.ready);
  await frame();
}
