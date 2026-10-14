// Markdown → HTML for the Quick Look extension. Runs in JavaScriptCore after
// marked's UMD build (which defines the global `marked`); build-quicklook.mjs
// concatenates the two into render.bundle.js.

/* global marked */
var markappolyRender = (function () {
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // `---` YAML block at the very top of the file.
  var FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;

  function parseFrontmatter(raw) {
    var fields = [];
    raw.split(/\r?\n/).forEach(function (line) {
      var m = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
      if (!m) return;
      var value = m[2]
        .trim()
        .replace(/^\[(.*)\]$/, "$1")
        .replace(/^["']|["']$/g, "");
      if (value) fields.push([m[1], value]);
    });
    return fields;
  }

  function frontmatterHtml(fields) {
    if (!fields.length) return "";
    var title = "";
    var rows = "";
    fields.forEach(function (f) {
      if (!title && /^title$/i.test(f[0])) {
        title = f[1];
        return;
      }
      rows +=
        '<div class="fm-row"><span class="fm-key">' +
        escapeHtml(f[0]) +
        '</span><span class="fm-value">' +
        escapeHtml(f[1]) +
        "</span></div>";
    });
    return (
      '<header class="frontmatter">' +
      (title ? '<div class="fm-title">' + escapeHtml(title) + "</div>" : "") +
      rows +
      "</header>"
    );
  }

  var ALERTS = {
    note: "Note",
    tip: "Tip",
    important: "Important",
    warning: "Warning",
    caution: "Caution",
  };

  // Images: only remote and data: URLs can load inside the sandboxed preview,
  // so local references become a quiet placeholder instead of a broken icon.
  function imageHtml(href, title, text) {
    var src = String(href || "");
    if (/^(https:|data:image\/)/i.test(src)) {
      return (
        '<img src="' +
        escapeHtml(src) +
        '" alt="' +
        escapeHtml(text || "") +
        '"' +
        (title ? ' title="' + escapeHtml(title) + '"' : "") +
        ">"
      );
    }
    return '<span class="img-placeholder">' + escapeHtml(text || src || "image") + "</span>";
  }

  // The page CSP already blocks scripts; drop active content outright too.
  var ACTIVE_HTML = /<\/?(script|iframe|object|embed|frame|frameset|form|base|meta|link)\b[^>]*>/gi;

  var renderer = {
    html: function (token) {
      return String(token.text).replace(ACTIVE_HTML, "");
    },
    image: function (token) {
      return imageHtml(token.href, token.title, token.text);
    },
    blockquote: function (token) {
      var body = this.parser.parse(token.tokens);
      var m = /^<p>\[!(\w+)\][ \t]*(?:<br>)?\s*/i.exec(body);
      if (m && ALERTS[m[1].toLowerCase()]) {
        var kind = m[1].toLowerCase();
        return (
          '<div class="alert alert-' +
          kind +
          '"><p class="alert-title">' +
          ALERTS[kind] +
          "</p><p>" +
          body.slice(m[0].length) +
          "</div>"
        );
      }
      return "<blockquote>" + body + "</blockquote>";
    },
  };

  // Obsidian-style [[Target|Label]] links: no navigation in Quick Look, so
  // just show the label.
  var wikiLink = {
    name: "wikiLink",
    level: "inline",
    start: function (src) {
      var i = src.indexOf("[[");
      return i < 0 ? undefined : i;
    },
    tokenizer: function (src) {
      var m = /^!?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/.exec(src);
      if (m) return { type: "wikiLink", raw: m[0], text: (m[2] || m[1]).trim() };
    },
    renderer: function (token) {
      return '<span class="wikilink">' + escapeHtml(token.text) + "</span>";
    },
  };

  marked.use({ gfm: true, breaks: false, renderer: renderer, extensions: [wikiLink] });

  return function (source) {
    var text = String(source).replace(/^﻿/, "");
    var header = "";
    var fm = FRONTMATTER.exec(text);
    if (fm) {
      header = frontmatterHtml(parseFrontmatter(fm[1]));
      text = text.slice(fm[0].length);
    }
    // Obsidian %%comments%% stay hidden, as in the app.
    text = text.replace(/%%[\s\S]*?%%/g, "");
    return header + marked.parse(text);
  };
})();
