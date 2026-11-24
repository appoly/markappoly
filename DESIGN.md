---
name: Markappoly
description: A desktop reader and reviewer for Markdown that agents write; changes read as numbered parts in a manual.
colors:
  chassis: "#e9e7e2"
  chassis-translucent: "rgba(233, 231, 226, 0.9)"
  reading: "#f7f6f3"
  text: "#2a2a28"
  muted: "#62605a"
  hairline: "rgba(42, 42, 40, 0.14)"
  panel: "rgba(42, 42, 40, 0.05)"
  panel-strong: "rgba(42, 42, 40, 0.09)"
  code-bg: "rgba(42, 42, 40, 0.055)"
  accent-graphite: "#2a2a28"
  accent-text: "#f7f6f3"
  link: "#2a2a28"
  link-line: "rgba(42, 42, 40, 0.38)"
  signal: "#c94a0a"
  signal-text: "#ffffff"
  signal-ink: "#a83f08"
  signal-tint: "color-mix(in srgb, #e8590c 9%, #f7f6f3)"
  signal-line: "rgba(201, 74, 10, 0.55)"
  signal-brand: "#e8590c"
  selection: "rgba(232, 89, 12, 0.16)"
  confirm: "#2f6b3a"
  danger: "#b3261e"
  syntax-comment: "#6f6c66"
  syntax-keyword: "#a83f08"
  syntax-entity: "#5a4a8a"
  syntax-string: "#2f6b3a"
  syntax-constant: "#1f5a7a"
  syntax-tag: "#7a4a12"
  alert-note: "#1f5a7a"
  alert-tip: "#2f6b3a"
  alert-important: "#5a4a8a"
  alert-warning: "#7a5a00"
  alert-caution: "#b3261e"
  chassis-dark: "#262624"
  chassis-translucent-dark: "rgba(38, 38, 36, 0.92)"
  reading-dark: "#1d1d1b"
  modal-dark: "#242321"
  text-dark: "#edebe6"
  muted-dark: "#a8a49c"
  hairline-dark: "rgba(237, 235, 230, 0.13)"
  panel-dark: "rgba(237, 235, 230, 0.06)"
  panel-strong-dark: "rgba(237, 235, 230, 0.11)"
  code-bg-dark: "rgba(237, 235, 230, 0.07)"
  accent-graphite-dark: "#edebe6"
  accent-text-dark: "#1d1d1b"
  link-line-dark: "rgba(237, 235, 230, 0.4)"
  signal-dark: "#ff7a2f"
  signal-text-dark: "#1d1d1b"
  signal-ink-dark: "#ff8a47"
  signal-tint-dark: "color-mix(in srgb, #ff7a2f 7.5%, #1d1d1b)"
  signal-line-dark: "rgba(255, 122, 47, 0.6)"
  selection-dark: "rgba(255, 122, 47, 0.26)"
  confirm-dark: "#6fbf7a"
  danger-dark: "#ff8a80"
  syntax-comment-dark: "#8f8b83"
  syntax-keyword-dark: "#ff8a47"
  syntax-entity-dark: "#c3b4f0"
  syntax-string-dark: "#8fd09a"
  syntax-constant-dark: "#8cc4e0"
  syntax-tag-dark: "#e8b46a"
  alert-warning-dark: "#e0b24a"
typography:
  chrome:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"SF Pro Text\", \"Segoe UI\", sans-serif"
    fontSize: "13px"
    fontWeight: 400
  chrome-strong:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"SF Pro Text\", \"Segoe UI\", sans-serif"
    fontSize: "13px"
    fontWeight: 600
  section-label:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"SF Pro Text\", \"Segoe UI\", sans-serif"
    fontSize: "13px"
    fontWeight: 600
    letterSpacing: "0.06em"
    fontFeature: "all-small-caps"
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"SF Pro Text\", \"Segoe UI\", sans-serif"
    fontSize: "11px"
    fontWeight: 600
    letterSpacing: "0.04em"
  callout-number:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 700
    lineHeight: "18px"
    fontFeature: "tabular-nums"
  reading-body:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"SF Pro Text\", \"Segoe UI\", sans-serif"
    fontSize: "calc(17px * var(--zoom, 1))"
    fontWeight: 400
    lineHeight: 1.65
  reading-h1:
    fontSize: "2em"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  reading-h2:
    fontSize: "1.41em"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  reading-h3:
    fontSize: "1.18em"
    fontWeight: 600
    lineHeight: 1.25
  reading-h4:
    fontSize: "0.82em"
    fontWeight: 600
    letterSpacing: "0.08em"
  mono:
    fontFamily: "\"SF Mono\", ui-monospace, \"Cascadia Mono\", Menlo, Consolas, monospace"
    fontSize: "85%"
rounded:
  hairline-lamp: "1px"
  sm: "4px"
  float: "8px"
  dot: "50%"
spacing:
  chrome-inset: "14px"
  toolbar-height: "52px"
  traffic-light-clearance: "84px"
  sidebar-width: "232px"
  reading-measure: "760px"
  reading-pad-top: "44px"
  reading-pad-inline-start: "56px"
  reading-pad-inline-end: "40px"
  callout-gutter: "50px"
components:
  button-signal:
    backgroundColor: "{colors.signal}"
    textColor: "{colors.signal-text}"
    rounded: "{rounded.sm}"
    padding: "0 9px"
    height: "26px"
    typography: "{typography.chrome-strong}"
  button-primary:
    backgroundColor: "{colors.accent-graphite}"
    textColor: "{colors.accent-text}"
    rounded: "{rounded.sm}"
    padding: "7px 12px"
  button-secondary:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    padding: "0 9px"
    height: "26px"
  button-secondary-hover:
    backgroundColor: "{colors.panel-strong}"
  segmented:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.sm}"
    padding: "2px"
  segmented-active:
    backgroundColor: "{colors.accent-graphite}"
    textColor: "{colors.accent-text}"
    rounded: "{rounded.sm}"
    padding: "4px 14px"
    typography: "{typography.chrome-strong}"
  tab-active:
    backgroundColor: "{colors.reading}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    typography: "{typography.chrome-strong}"
  menu-item-hover:
    backgroundColor: "{colors.accent-graphite}"
    textColor: "{colors.accent-text}"
    rounded: "{rounded.sm}"
    padding: "6px 12px 6px 6px"
  review-num:
    backgroundColor: "{colors.signal}"
    textColor: "{colors.signal-text}"
    rounded: "{rounded.dot}"
    size: "18px"
    typography: "{typography.callout-number}"
  review-num-seen:
    textColor: "{colors.signal-ink}"
    rounded: "{rounded.dot}"
    size: "18px"
  review-legend-item-current:
    backgroundColor: "{colors.panel-strong}"
    rounded: "{rounded.sm}"
    padding: "3px 8px 3px 4px"
  changed-block:
    backgroundColor: "{colors.signal-tint}"
  alert:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    padding: "0.75em 1em"
  frontmatter-tag:
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    padding: "1px 7px"
---

# Design system: Markappoly

## Overview

Creative north star: "The Instruction Manual".

Markappoly is modelled on a Braun manual from the 1960s and 70s. The chassis (toolbar, sidebar, tabs, status bar) is warm-grey matte plastic over the OS vibrancy material. The document sits on a lighter reading panel, and ink is graphite, never pure black. Agent changes are shown as the manual's numbered parts: an orange dot in the margin, a hairline leader to the changed block, and a legend above the document that lists the same numbers. A review means stepping from 1 to n and watching each dot go hollow.

The chrome is quiet and dense, and the reading panel is generous. Chrome uses one size (13px) and ranks by weight, small caps and tracking, never by size. Only the reading surface uses a modular scale. The UI uses almost no colour: everything is warm neutrals and graphite, so the one orange can mean "this changed" without ambiguity. The design avoids the usual GitHub grey and Apple blue look of Markdown apps.

Native chrome is required. The toolbar is the title bar, the traffic lights sit inside it, and the chassis is translucent over native vibrancy (acrylic on Windows). The same tokens must hold on Windows and Linux, where those materials fall back to solid.

Main characteristics:
- Warm-grey chassis, lighter reading panel, graphite ink. Light and dark modes are both fully supported.
- One signal orange, reserved for changes and the single primary review action.
- One 13px chrome size, ranked by weight, small caps and tracking.
- Hairlines (1px) and 4px corners everywhere in flow; no gradients and no decorative shadow.
- Numbered margin callouts with filled (unreviewed), hollow (seen) and current states.

## Colors

Warm neutrals and graphite carry the UI. A single orange is the only accent, and muted syntax and alert hues appear only in content.

### Primary
- **Graphite Ink** (`accent-graphite`, dark `accent-graphite-dark`): text colour, the active segment of the Preview/Edit/Split control, menu item hover, focus outlines (2px), the caret, ordinary primary buttons (Save comment, dialog confirm) and the reading-surface link colour. In dark mode graphite inverts to warm off-white with dark text on it.

### Secondary
- **Signal Orange** (`signal`, dark `signal-dark`): change callout dots, the review legend numbers, outline change dots, the dashed rule where text was removed, the reduced-motion focus outline, and the one "Mark as reviewed" button. `signal-brand` (#e8590c) is the pure brand orange. It is used only in the app icon and as the mix base for `signal-tint` and `selection`; on screen it is darkened to `signal` so white numerals pass contrast.
- **Signal Ink** (`signal-ink`): the darker orange for text and hollow-state numerals on the reading panel, and the Markdown/code keyword hue.
- **Signal Tint** (`signal-tint`): the wash behind an unreviewed changed block, extended 12px past the text on both sides.
- **Signal Line** (`signal-line`): the 1px leader from a filled callout dot to its block.

### Tertiary
- **Confirm Green** (`confirm`) and **Danger Red** (`danger`): status only (outdated-comment and error text, success states). Never used as decoration.
- **Syntax and alert hues** (`syntax-*`, `alert-*`): desaturated, ink-like content colours for code highlighting and GitHub alert lamps. They appear inside the document and never in chrome. Note, tip, important and caution share hues with the syntax constants, strings, entities and danger; warning has its own ochre.

### Neutral
- **Chassis Grey** (`chassis`, applied as `chassis-translucent` over vibrancy): toolbar, sidebar, tab strip and status bar.
- **Reading Paper** (`reading`): the document panel, the active tab, the format/review bar, and modals in light mode (`modal-dark` in dark).
- **Graphite Muted** (`muted`): secondary text, section labels, line numbers, dates.
- **Hairline** (`hairline`): every border, divider, leader for a seen callout, table rule and inset tag outline.
- **Panel / Panel Strong** (`panel`, `panel-strong`): resting and hover/current fills for controls, alerts, legend items and active sidebar rows.
- **Code Wash** (`code-bg`): inline code, code blocks, table headers, active editor line.

### Named rules
**The Signal Rule.** Orange means "changed since you last read it". It is also used for exactly one primary action, Mark as reviewed. Every other primary action is graphite. Any other orange mark in the UI is a bug. Two low-key uses are exempt: the text-selection wash (`selection`) and the keyword hue in code (`signal-ink`).

**The Graphite Link Rule.** Links are graphite with a 1px underline at 38% (40% in dark) that goes solid on hover. The chrome uses no blue anywhere.

**The Paired Theme Rule.** Every token has a light and a dark value, and the dark value is declared twice: once under the system-dark media query (`:root:not([data-theme])`) and once under `[data-theme="dark"]`. A new token goes into all three blocks or none.

## Typography

Chrome font: system UI (-apple-system / SF Pro Text, Segoe UI on Windows, the platform sans on Linux).
Reading font: the same system sans by default. The user can switch to system serif or mono in Settings.
Mono font: SF Mono, ui-monospace, Cascadia Mono, Menlo, Consolas.

The type is the platform's own face, set like a technical manual: one size for every control, small caps for section names, and a single modular scale used only in the document.

### Hierarchy
- **Chrome** (400, 13px): every button, tab, sidebar row, status bar, menu item and legend entry. Active and current states change weight to 600 and keep the same size.
- **Section label** (600, 13px, all-small-caps, 0.06em): sidebar section titles (Files, Outline) and frontmatter keys.
- **Label** (600, 11px, uppercase, 0.04 to 0.05em): menu headers and shortcut-sheet group headings. Callout dots use 11px/700 tabular figures.
- **Reading body** (400, 17px × user zoom, line-height 1.65 default): the document, centred on a 760px measure (600 / 920 by preference).
- **Reading H1** (600, 2em, 1.15, -0.02em), **H2** (600, 1.41em, -0.02em), **H3** (600, 1.18em): the modular scale, with balanced wrapping.
- **Reading H4 to H6** (0.82em, uppercase, 0.08em): minor headings, styled as labels.
- **Alert title** (600, 0.8em, uppercase, 0.08em): the GitHub alert kind, next to its lamp.

### Named rules
**The One Chrome Size Rule.** Chrome is 13px. Rank with weight (600), small caps, tracking or muted colour. The only smaller step is 11px, used for labels and numerals.

**The Scale Lives in the Document Rule.** The 2 / 1.41 / 1.18 ratio applies only inside the reading panel. Chrome never uses it.

## Layout

The desktop shell has three zones: a 52px chassis toolbar that doubles as the drag region (84px left inset clears the traffic lights), a 232px chassis sidebar (resizable, 190px to 45vw), and a main column of tab strip, format/review bar, reading panel and status bar. Chrome rows inset content 14px.

The reading panel centres a 760px measure with 44px top padding, 56px start and 40px end inline padding. The extra start padding is the margin gutter for numbered callouts (dot at 50px left of the text, 26px leader). Changed blocks extend their tint 12px outside the text column. Consecutive blocks of one change bridge the gap between them, so a multi-block change reads as one part.

Below 800px the toolbar tightens to 8px gaps, labelled buttons drop to icons, and the review legend wraps onto its own row. Below 640px the legend moves directly under the change count. Spacing is small and even (2, 4, 6, 8, 10, 14, 16px) and is set per component, not from a scale.

## Elevation and depth

Surfaces in flow are flat. Depth comes from tone: chassis grey behind, reading paper in front, panel fills for controls. Hairlines separate every zone, and nothing in the document or chrome rows casts a shadow.

Only floating layers are raised. Menus, the find bar, the comment composer and modals take a soft drop shadow and an 8px corner. Menus and the find bar also blur what is beneath them (20px), like native popovers. The backdrop behind modals is 30% black.

### Shadow vocabulary
- **Pop** (`--shadow-pop`: `0 1px 0 rgba(42,42,40,0.06), 0 12px 32px rgba(42,42,40,0.16)` light; `0 1px 0 rgba(0,0,0,0.3), 0 14px 36px rgba(0,0,0,0.45)` dark): the elevation token for floating surfaces.
- **Menu** (`0 12px 32px rgba(0,0,0,0.24)`): popover menus.
- **Composer** (`0 10px 28px rgba(0,0,0,0.22)`): the floating comment composer.

### Named rules
**The Flat Chassis Rule.** Nothing that sits in the layout has a gradient or a shadow. A shadow means the element floats above the window and will go away.

## Shapes

Geometry is small and close to square. Every in-flow control, panel, tag and alert uses a 4px corner, and floating layers use 8px. Indicator lamps are near-square (1px radius): the alert kind lamps (0.6em) and the comment marker (7px) in the right margin. The only circles are the callout dots: 18px numbered dots in the margin and legend, and 6px dots in the outline. Borders are always 1px hairlines. Inset hairlines (`box-shadow: inset 0 0 0 1px`) outline the active tab and frontmatter tags without shifting layout.

## Components

### Buttons
- Buttons have 4px corners and are 26px tall in bars. Toolbar icon buttons are 30px.
- **Toolbar buttons:** borderless and transparent at rest, `panel-strong` on hover, with a 0.5px press nudge.
- **Secondary (bar buttons, dialog buttons):** `panel` fill with a hairline border; `panel-strong` on hover.
- **Primary:** graphite fill, paper text. Used for Save comment and dialog confirms.
- **Signal:** orange fill, white text (dark text in dark mode), weight 600. Used only for "Mark as reviewed". Hover mixes 12% graphite into the orange.
- **Focus:** 2px graphite outline, 2px offset (1px in the toolbar).

### Segmented control
- Preview / Edit / Split sit in a `panel` well with a hairline border and 2px inset. The active segment is graphite with paper text at 600; inactive segments hover to `panel-strong`.

### Tabs
- Tabs sit on the chassis strip. Inactive tabs are muted text on transparent. The active tab is reading paper with an inset hairline and weight 600, so it reads as the front of the stack.

### Sidebar
- Chassis background, small-caps section titles with a drawn disclosure chevron, and 13px rows. Hover is `panel`; the active file or outline item is `panel-strong` at weight 600. Outline headings that contain changes carry a 6px signal dot, filled when unreviewed and hollow when seen.

### Menus
- Floating `panel-strong` with blur, 8px corners and a hairline border. Items hover to graphite with paper text, a full inversion like a native menu. Headers use the 11px uppercase label.

### Numbered margin callout (signature)
The callout is the manual's part number.
- **Unreviewed:** 18px filled signal dot with an 11px/700 tabular numeral, a 26px 1px `signal-line` leader to the block, and the block washed in `signal-tint`.
- **Seen:** the dot goes hollow (1.25px signal ring, `signal-ink` numeral), the leader turns hairline grey, and the tint is removed.
- **Current:** when the user steps to it (F7 / ⇧F7), the block takes the review-focus pulse.
- **Removed text:** a 1px dashed signal rule where the text used to be, extending 12px on either side.
- Callouts are drawn as background layers of one pseudo-element, so the document never reflows.

### Review legend (signature)
The legend is the parts list above the document, in the format bar.
- It starts with a count summary in 600 tabular figures ("3 changes in 3 sections"), then one entry per change: an 18px number dot plus the section label.
- **Unreviewed:** filled signal number, graphite label.
- **Seen:** hollow number, muted label struck through.
- **Current** (`aria-current="step"`): `panel-strong` fill and weight 600.
- After the entries come the Prev/Next icon buttons, Comments, Source diff, and the signal "Mark as reviewed" button at the far end.

### Comments
- A 7px near-square graphite lamp in the right margin marks a commented block, and the anchored passage is highlighted at 22% signal. The composer floats (8px corner, composer shadow), with a hairline textarea on reading paper and a graphite Save button.

### Alerts
- A flat `panel` box with a hairline border, 4px corners and 0.75em × 1em padding. The kind is an uppercase 600 title preceded by a square indicator lamp in the alert hue, like a status light on a control panel. GitHub's octicon glyphs are hidden.

### Frontmatter line
- A plain spec line above the document; it is not a card. It has an optional title (1.15em, 600) and muted description, then a wrapping row of small-caps muted keys with plain values, muted tabular dates, and tags as 4px inset-hairline chips. A hairline closes the line.

### Motion
- **Review focus pulse:** a single 0.9s `cubic-bezier(0.16, 1, 0.3, 1)` fade from 26% signal to the block's own background when the user steps to a change. It does not loop.
- **Reduced motion:** a static 1px signal outline at 4px offset replaces the pulse.
- Everything else is a 0.12s state change (hover fills, disclosure chevron rotation).

## Do's and don'ts

### Do:
- Keep orange to changes and the one "Mark as reviewed" button. Every other primary action is graphite.
- Use `signal-ink` rather than `signal` for orange text on the reading panel.
- Keep chrome at 13px and rank with weight 600, small caps (0.06em) or the 11px label.
- Separate with 1px hairlines and fill with `panel` / `panel-strong`. Use 4px corners in flow and 8px only for floating layers.
- Show callout state by fill: filled for unreviewed, hollow for seen, `panel-strong` for current.
- Keep the toolbar as the title bar with the traffic lights inside it, keep chassis surfaces translucent over native vibrancy, and give every macOS-only material a solid fallback for Windows and Linux.
- Define each new colour for light, system-dark and explicit-dark.
- Give any new motion a static equivalent under `prefers-reduced-motion`.

### Don't:
- Use orange for any UI mark (dot, badge, fill, button, border) other than a change or that single action. The selection wash and code keywords are the only exceptions.
- Introduce blue links, accent blue, or GitHub grey in the chrome.
- Add visible colour gradients, or shadows or glass on in-flow surfaces. Blur is only for native vibrancy and floating menus. The callout's hard-stop background layers count as drawing and are allowed.
- Add a second chrome font size between 11px and 13px or above 13px.
- Reflow the document to show review state. Callouts sit in the margin gutter.
- Make the app depend on a macOS-only effect without a fallback.
