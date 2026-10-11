import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { parseChangelog, renderChangelog } from "../scripts/changelog.mjs";

const entry = (date, text = "Zmiana.") => `## ${date}\n\n### Nowości\n- ${text}\n`;

describe("changelog", () => {
  it("reads the real changelog and retains every entry and item", () => {
    const source = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
    const entries = parseChangelog(source);
    expect(entries.map((item) => item.date)).toEqual([...source.matchAll(/^## (.+)$/gm)].map((match) => match[1]));
    expect(entries.flatMap((item) => item.groups.flatMap((group) => group.items))).toHaveLength(source.split("\n").filter((line) => line.startsWith("- ")).length);
  });
  it("accepts CRLF and a history without pending changes", () => {
    expect(parseChangelog(entry("2026-10-08").replaceAll("\n", "\r\n"))[0].date).toBe("2026-10-08");
  });
  it.each(["2026-02-30", "2026-13-01", "08.10.2026", "Niedługo"])("rejects an invalid date or heading: %s", (date) => {
    expect(() => parseChangelog(entry(date))).toThrow();
  });
  it("rejects repeated, unordered, misplaced and empty entries", () => {
    for (const source of [entry("2026-10-06") + entry("2026-10-06"), entry("2026-10-05") + entry("2026-10-06"), entry("2026-10-06") + entry("Niewydane"), "## Niewydane\n### Nowości", "# Pusty plik"]) {
      expect(() => parseChangelog(source)).toThrow();
    }
  });
  it("fails on unsupported content instead of silently dropping it", () => {
    for (const source of [entry("Niewydane") + "Zapomniany akapit", "## Niewydane\n- Bez sekcji", entry("Niewydane") + "### Inne\n- Zmiana", entry("Niewydane") + "### Nowości\n- Duplikat"]) {
      expect(() => parseChangelog(source)).toThrow();
    }
  });
  it("escapes raw HTML and renders commands as code", () => {
    const html = renderChangelog(parseChangelog(entry("Niewydane", '<img src=x onerror="alert(1)"> & `/panel`')));
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; <code>/panel</code>");
  });
  it("makes pending status explicit and gives dated entries permanent anchors", () => {
    const html = renderChangelog(parseChangelog(entry("Niewydane") + entry("2026-10-06")));
    expect(html).toContain("Te zmiany czekają na wdrożenie bota.");
    expect(html).toContain('id="2026-10-06"');
    expect(html).toContain('<time datetime="2026-10-06">2026-10-06</time>');
    expect(html).toContain("6 października 2026");
  });
  it("references only existing local assets and works without JavaScript", () => {
    const html = renderChangelog(parseChangelog(entry("Niewydane")));
    for (const [, path] of html.matchAll(/(?:src|href)="(\.\.\/[^"#]+)"/g)) {
      expect(existsSync(new URL(`../public/nowosci/${path}`, import.meta.url))).toBe(true);
    }
    expect(html).not.toContain("<script");
  });
});
