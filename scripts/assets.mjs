// Grafiki: naklejki i avatar bota z geometrii Otta, obrazek do maila i ikony strony,
// plus ilustracje z design/zrodla/ (Codex) przerobione na WebP.
// Uruchomienie: npm run assets
import { readdirSync, writeFileSync } from "node:fs";
import sharp from "sharp";
import { MOODS, ottoSvg } from "./otto-svg.mjs";

const svg = (mood, options) => Buffer.from(ottoSvg(mood, options));

// Naklejki Telegrama: WebP 512 × 512, przezroczyste tło.
for (const mood of Object.keys(MOODS)) {
  await sharp(svg(mood, { pad: 4 })).resize(512, 512).webp({ quality: 92 }).toFile(`public/stickers/${mood}.webp`);
}

// Zdjęcie profilowe bota: Telegram przycina do koła, więc Otto ma zapas od krawędzi.
await sharp(svg("neutral", { background: "#FFD21F", ring: "#151515", pad: 20 })).resize(640, 640).png().toFile("public/img/otto-avatar.png");

// Mail (PNG, bo Gmail i Outlook nie pokazują SVG) i ikony.
await sharp(svg("happy", { pad: 4 })).resize(144, 144).png().toFile("public/mail/otto.png");
await sharp(svg("neutral", { background: "#FFD21F", ring: "#151515", pad: 14 })).resize(180, 180).png().toFile("public/apple-touch-icon.png");
await sharp(svg("neutral", { pad: 2 })).resize(48, 48).png().toFile("public/favicon.png");
writeFileSync("public/favicon.svg", ottoSvg("neutral", { pad: 2 }));

// Ilustracje: znaczki w 2× największego rozmiaru na stronie, postacie mniejsze.
for (const file of readdirSync("design/zrodla").filter((f) => f.endsWith(".png"))) {
  const name = file.replace(/\.png$/, "");
  const width = name.startsWith("osoba-") ? 192 : 480;
  await sharp(`design/zrodla/${file}`).resize({ width }).webp({ quality: 86, alphaQuality: 90 }).toFile(`public/img/${name}.webp`);
}

console.log("gotowe");
