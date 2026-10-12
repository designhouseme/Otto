/**
 * Polskie dni wolne od pracy (ustawa o dniach wolnych od pracy; Wigilia od 2025 r.).
 * Ruchome święta liczymy od Wielkanocy, więc lista działa dla każdego roku bez aktualizacji.
 */

export interface Holiday {
  /** „RRRR-MM-DD” */
  date: string;
  name: string;
}

const pad = (n: number) => String(n).padStart(2, "0");
const key = (ms: number) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};

/** Niedziela Wielkanocna w kalendarzu gregoriańskim (algorytm Meeusa/Jonesa/Butchera), jako północ UTC. */
export function easter(year: number): number {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return Date.UTC(year, month - 1, day);
}

export function holidays(year: number): Holiday[] {
  const e = easter(year);
  const DAY = 86_400_000;
  const fixed = (m: number, d: number, name: string): Holiday => ({ date: `${year}-${pad(m)}-${pad(d)}`, name });
  const moving = (days: number, name: string): Holiday => ({ date: key(e + days * DAY), name });
  const list = [
    fixed(1, 1, "Nowy Rok"),
    fixed(1, 6, "Trzech Króli"),
    moving(0, "Wielkanoc"),
    moving(1, "Poniedziałek Wielkanocny"),
    fixed(5, 1, "Święto Pracy"),
    fixed(5, 3, "Święto Konstytucji 3 Maja"),
    moving(49, "Zielone Świątki"),
    moving(60, "Boże Ciało"),
    fixed(8, 15, "Wniebowzięcie NMP"),
    fixed(11, 1, "Wszystkich Świętych"),
    fixed(11, 11, "Święto Niepodległości"),
    ...(year >= 2025 ? [fixed(12, 24, "Wigilia")] : []),
    fixed(12, 25, "Boże Narodzenie"),
    fixed(12, 26, "Drugi dzień Bożego Narodzenia"),
  ];
  return list.sort((x, y) => (x.date < y.date ? -1 : 1));
}

/** Święta od `from` do `to` włącznie (daty „RRRR-MM-DD”). */
export function holidaysBetween(from: string, to: string): Holiday[] {
  const out: Holiday[] = [];
  for (let year = Number(from.slice(0, 4)); year <= Number(to.slice(0, 4)); year++) {
    out.push(...holidays(year).filter((h) => h.date >= from && h.date <= to));
  }
  return out;
}
