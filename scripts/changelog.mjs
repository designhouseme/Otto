// Jeden plik Markdown → statyczna strona Workera, generowana przy każdym wdrożeniu.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const groups = new Set(["Nowości", "Ulepszenia", "Poprawki"]);
const escape = (value) => value.replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[char]);
const inline = (value) => escape(value).replace(/`([^`]+)`/g, "<code>$1</code>");

export function parseChangelog(markdown) {
  const entries = [];
  let entry, group;
  for (const raw of markdown.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("## ")) {
      const date = line.slice(3);
      if (date !== "Niewydane" && (!/^\d{4}-\d{2}-\d{2}$/.test(date)
        || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)) {
        throw new Error(`Nieprawidłowy nagłówek changeloga: ${date}`);
      }
      if (entries.some((item) => item.date === date)) throw new Error(`Powtórzony wpis: ${date}`);
      if (date === "Niewydane" && entries.length) throw new Error("Niewydane musi być pierwszym wpisem.");
      const previous = entries.at(-1)?.date;
      if (date !== "Niewydane" && previous && previous !== "Niewydane" && date >= previous) {
        throw new Error("Daty changeloga muszą być od najnowszej do najstarszej.");
      }
      entry = { date, groups: [] };
      entries.push(entry);
      group = undefined;
    } else if (entry && line.startsWith("### ")) {
      const title = line.slice(4);
      if (!groups.has(title) || entry.groups.some((item) => item.title === title)) {
        throw new Error(`Nieprawidłowa lub powtórzona sekcja: ${title}`);
      }
      group = { title, items: [] };
      entry.groups.push(group);
    } else if (entry && group && line.startsWith("- ") && line.length > 2) {
      group.items.push(line.slice(2));
    } else if (entry) {
      throw new Error(`Nieobsługiwany zapis changeloga: ${line}`);
    }
  }
  if (!entries.length || entries.some((item) => !item.groups.length || item.groups.some((section) => !section.items.length))) {
    throw new Error("Changelog musi mieć wpisy, sekcje i punkty.");
  }
  return entries;
}

export function renderChangelog(entries) {
  const assets = "../";
  const content = entries.map((entry) => {
    const pending = entry.date === "Niewydane";
    const id = pending ? "niewydane" : entry.date;
    const title = pending ? "W drodze" : new Intl.DateTimeFormat("pl", {
      day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
    }).format(new Date(entry.date));
    return `<article class="release" id="${id}" aria-labelledby="title-${id}">
  <div class="release-meta"><span class="release-badge${pending ? " pending" : ""}">${pending ? "Przed wdrożeniem" : "Historia projektu"}</span>
  ${pending ? "" : `<time datetime="${entry.date}">${escape(entry.date)}</time>`}</div>
  <h2 id="title-${id}"><a href="#${id}">${escape(title)}</a></h2>
  ${pending ? '<p class="release-note">Te zmiany czekają na wdrożenie bota.</p>' : ""}
  ${entry.groups.map((group) => `<section class="release-group"><h3>${escape(group.title)}</h3><ul>${group.items.map((item) => `<li>${inline(item)}</li>`).join("")}</ul></section>`).join("\n  ")}
</article>`;
  }).join("\n");
  return `<!doctype html>
<!-- Generowane z CHANGELOG.md przez scripts/changelog.mjs. -->
<html lang="pl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Co nowego u Otta</title>
<meta name="description" content="Nowe funkcje i poprawki Otta, osobistego asystenta w Telegramie. Historia zmian i zapowiedź kolejnego wydania.">
<meta name="theme-color" content="#FBF7EC">
<link rel="icon" href="${assets}favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="${assets}assets/style.css">
<link rel="stylesheet" href="${assets}assets/changelog.css">
</head>
<body class="updates-page">
<a class="skip" href="#tresc">Przejdź do treści</a>
<header class="top">
  <div class="brand"><a class="brand-dh" href="https://designhouse.me"><img src="${assets}img/design-house.svg" width="152" height="19" alt="Design House"></a><a class="brand-name" href="/">Otto</a></div>
  <nav class="updates-nav" aria-label="Nawigacja"><a href="/">Poznaj Otta <span aria-hidden="true">↗</span></a></nav>
</header>
<main class="updates" id="tresc">
  <div class="updates-intro">
    <div><p class="eyebrow">OTTO SIĘ ROZWIJA</p><h1>Co nowego?</h1><p class="section-lead">Małe poprawki, nowe umiejętności.<br>Zobacz, co zmienia się u Otta.</p>
    <a class="text-link" href="https://github.com/designhouseme/Otto/blob/main/CHANGELOG.md">Changelog na GitHubie <span aria-hidden="true">↗</span></a></div>
    <div class="updates-otto"><img src="${assets}stickers/happy.webp" width="160" height="160" alt="Uśmiechnięty Otto"></div>
  </div>
  <div class="releases">${content}</div>
</main>
<footer class="foot"><p>Otto to projekt <a href="https://designhouse.me">Design House</a>.</p><p><a href="/">Wróć do Otta</a></p></footer>
</body>
</html>
`;
}

export async function buildChangelog() {
  const entries = parseChangelog(await readFile(resolve(root, "CHANGELOG.md"), "utf8"));
  const output = resolve(root, "public/nowosci/index.html");
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, renderChangelog(entries));
  return output;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length) throw new Error("Użycie: node scripts/changelog.mjs");
  console.log(`Changelog: ${await buildChangelog()}`);
}
