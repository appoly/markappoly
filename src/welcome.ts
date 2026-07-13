export const WELCOME = `# Welcome to Markappoly

> **Pass Go, straight to preview.** A fast, native Markdown viewer and editor for macOS, Windows, and Linux.

You're looking at a live preview. Press **⌘E** to open the editor and again to come back, or open your own file with **⌘O**. This document shows what Markappoly can render.

## Formatting

Markappoly speaks **GitHub-Flavored Markdown**: **bold**, *italic*, ~~strikethrough~~, \`inline code\`, and [links](https://github.com/appoly/markappoly).

> [!TIP]
> Press **⌘⇧E** for a split view with the editor and this preview side by side, scrolling together.

### Lists and tasks

- Bulleted lists
- with nested items
  - like this one
- [x] Task boxes you can tick
- [ ] Tick this one and watch it save back to the source

1. Numbered lists too
2. in the order you write them

### Tables

| Action         | Shortcut | Notes                          |
| -------------- | -------- | ------------------------------ |
| Open file      | ⌘O       | or drag a file onto the window |
| Edit / preview | ⌘E       | toggle back and forth          |
| Split view     | ⌘⇧E      | editor and preview together    |
| Find           | ⌘F       | search the open document       |
| Present        | ⌘⇧P      | slides split on \`---\`          |

## Code

Fenced code blocks are syntax-highlighted:

\`\`\`js
function greet(name) {
  return "Hello, " + name + "!";
}

greet("Markappoly");
\`\`\`

## Math

Inline math like $E = mc^2$ renders with KaTeX, and so do display blocks:

$$
\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}
$$

## Diagrams

Mermaid diagrams render straight from a fenced \`mermaid\` block:

\`\`\`mermaid
flowchart LR
  A[Open or write] --> B[Preview]
  B --> C{Happy?}
  C -->|Yes| D[Export]
  C -->|No| A
\`\`\`

---

### Do more

- Open several files as **tabs**, then **Compare** two of them side by side
- Browse a whole folder from the sidebar (**⌘⇧O**) and search across all of it
- Paste or drag an image into the editor to attach it
- Export to Word and PDF, or to more formats when Pandoc is installed

New here? The full guide lives in the [user manual](https://github.com/appoly/markappoly/wiki).

> Open a file with ⌘O, or just start typing in **Edit** mode.
`;
