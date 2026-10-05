// Grafiki z geometrii Otta: naklejki i avatar bota oraz ikony strony.
// Uruchomienie: npm run assets
import { writeFileSync } from "node:fs";
import sharp from "sharp";
import { MOODS, ottoSvg } from "./otto-svg.mjs";

const svg = (mood, options) => Buffer.from(ottoSvg(mood, options));

// Naklejki Telegrama: WebP 512 × 512, przezroczyste tło.
for (const mood of Object.keys(MOODS)) {
  await sharp(svg(mood, { pad: 4 })).resize(512, 512).webp({ quality: 92 }).toFile(`public/stickers/${mood}.webp`);
}

// Zdjęcie profilowe bota: Telegram przycina do koła, więc Otto ma zapas od krawędzi.
await sharp(svg("neutral", { background: "#FFD21F", pad: 16 })).resize(640, 640).png().toFile("public/img/otto-avatar.png");

// Ikony.
await sharp(svg("neutral", { background: "#FFD21F", pad: 12 })).resize(180, 180).png().toFile("public/apple-touch-icon.png");
await sharp(svg("neutral", { pad: 2 })).resize(48, 48).png().toFile("public/favicon.png");
writeFileSync("public/favicon.svg", ottoSvg("neutral", { pad: 2 }));

console.log("gotowe");
