// Otto jako SVG: sama kula z dwiema kapsułami oczu (siatka 120 × 120, geometria jak na designhouse.me).
// Wspólne dla skryptu grafik (naklejki, avatar, mail) i dla strony (public/assets/otto.js ma kopię MOODS).

export const MOODS = {
  neutral: [
    { x: 38, y: 41, w: 16, h: 38, r: 8 },
    { x: 66, y: 41, w: 16, h: 38, r: 8 },
  ],
  happy: [
    { x: 37, y: 53, w: 18, h: 16, r: 9 },
    { x: 65, y: 53, w: 18, h: 16, r: 9 },
  ],
  look: [
    { x: 46, y: 43, w: 15, h: 34, r: 7.5 },
    { x: 72, y: 43, w: 15, h: 34, r: 7.5 },
  ],
  wink: [
    { x: 38, y: 41, w: 16, h: 38, r: 8 },
    { x: 65, y: 57, w: 18, h: 7, r: 3.5 },
  ],
  wow: [
    { x: 34, y: 35, w: 24, h: 48, r: 12 },
    { x: 62, y: 35, w: 24, h: 48, r: 12 },
  ],
  think: [
    { x: 40, y: 33, w: 15, h: 26, r: 7.5 },
    { x: 68, y: 31, w: 15, h: 26, r: 7.5 },
  ],
};

/**
 * @param {keyof MOODS} mood
 * @param {{ background?: string, pad?: number }} options
 *   background: tło pod Ottem (np. do avatara), pad: margines w jednostkach siatki
 */
export function ottoSvg(mood = "neutral", { background, pad = 0 } = {}) {
  const view = 120 + pad * 2;
  const eyes = MOODS[mood]
    .map((e) => `<rect x="${e.x}" y="${e.y}" width="${e.w}" height="${e.h}" rx="${e.r}" fill="#fff"/>`)
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-pad} ${-pad} ${view} ${view}" width="${view * 8}" height="${view * 8}">
  <defs>
    <radialGradient id="head" cx="34%" cy="24%" r="88%">
      <stop offset="0%" stop-color="#33383e"/><stop offset="55%" stop-color="#15171a"/><stop offset="100%" stop-color="#090a0c"/>
    </radialGradient>
    <radialGradient id="spec" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#fff" stop-opacity=".22"/><stop offset="100%" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  ${background ? `<rect x="${-pad}" y="${-pad}" width="${view}" height="${view}" fill="${background}"/>` : ""}
  <circle cx="60" cy="60" r="51" fill="url(#head)"/>
  <ellipse cx="44" cy="30" rx="18" ry="11" fill="url(#spec)"/>
  ${eyes}
</svg>`;
}
