/**
 * Czas w strefie użytkownika i rozumienie polskich terminów bez AI:
 * „jutro o 9”, „za 2 h”, „w piątek 15:30”, „12.10 o 8”, „za tydzień”.
 * To podstawa trybu ręcznego, więc działa bez modelu i bez sieci.
 */

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export function isValidTz(tz: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export interface Parts {
  y: number;
  m: number;
  d: number;
  h: number;
  mi: number;
  s: number;
  /** 0 = poniedziałek … 6 = niedziela */
  wd: number;
}

const formats = new Map<string, Intl.DateTimeFormat>();
const WEEKDAYS_EN = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function partsIn(ms: number, tz: string): Parts {
  let format = formats.get(tz);
  if (!format) {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      weekday: "short",
    });
    formats.set(tz, format);
  }
  const p: Record<string, string> = {};
  for (const part of format.formatToParts(new Date(ms))) p[part.type] = part.value;
  return {
    y: Number(p.year),
    m: Number(p.month),
    d: Number(p.day),
    h: Number(p.hour) % 24,
    mi: Number(p.minute),
    s: Number(p.second),
    wd: WEEKDAYS_EN.indexOf(p.weekday),
  };
}

function offset(ms: number, tz: string) {
  const p = partsIn(ms, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
}

/** Lokalna data i godzina w strefie → znacznik czasu. Dzień spoza miesiąca przechodzi dalej (32.01 = 1.02). */
export function zonedToUtc(y: number, m: number, d: number, h: number, mi: number, tz: string) {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const first = offset(guess, tz);
  const at = guess - first;
  const second = offset(at, tz);
  return second === first ? at : guess - second;
}

/** „2026-10-06T09:00” w strefie użytkownika → znacznik czasu (format od modelu). */
export function localIsoToUtc(value: string, tz: string): number | null {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  return zonedToUtc(y, mo, d, h, mi, tz);
}

const pad = (n: number) => String(n).padStart(2, "0");
const WD_IN = ["w poniedziałek", "we wtorek", "w środę", "w czwartek", "w piątek", "w sobotę", "w niedzielę"];
const WD_SHORT = ["pon", "wt", "śr", "czw", "pt", "sob", "nd"];

/** „dziś o 18:00”, „jutro o 9:00”, „w piątek o 9:00”, „12.11 o 9:00”. */
export function formatWhen(at: number, now: number, tz: string) {
  const a = partsIn(at, tz);
  const n = partsIn(now, tz);
  const hm = `${a.h}:${pad(a.mi)}`;
  const days = Math.round((Date.UTC(a.y, a.m - 1, a.d) - Date.UTC(n.y, n.m - 1, n.d)) / DAY);
  if (days === 0) return `dziś o ${hm}`;
  if (days === 1) return `jutro o ${hm}`;
  if (days === 2) return `pojutrze o ${hm}`;
  if (days > 0 && days < 7) return `${WD_IN[a.wd]} o ${hm}`;
  return `${WD_SHORT[a.wd]} ${a.d}.${pad(a.m)}${a.y !== n.y ? `.${a.y}` : ""} o ${hm}`;
}

/** Krótka etykieta do listy przypomnień. */
export function formatShort(at: number, tz: string) {
  const a = partsIn(at, tz);
  return `${WD_SHORT[a.wd]} ${a.d}.${pad(a.m)}, ${a.h}:${pad(a.mi)}`;
}

/** Dzień przesunięty o `days` od dziś w strefie, o podanej godzinie. */
function dayAt(now: number, tz: string, days: number, h: number, mi: number) {
  const n = partsIn(now, tz);
  return zonedToUtc(n.y, n.m, n.d + days, h, mi, tz);
}

// Przyciski trybu ręcznego. Względne liczymy w chwili kliknięcia, nie wysłania przycisków.
export type Preset = "m15" | "h1" | "h3" | "e18" | "j9" | "w1";

export function presetAt(preset: string, now: number, tz: string): number | null {
  switch (preset) {
    case "m15":
      return now + 15 * MINUTE;
    case "h1":
      return now + HOUR;
    case "h3":
      return now + 3 * HOUR;
    case "e18": {
      const today = dayAt(now, tz, 0, 18, 0);
      return today > now + MINUTE ? today : dayAt(now, tz, 1, 18, 0);
    }
    case "j9":
      return dayAt(now, tz, 1, 9, 0);
    case "w1":
      return now + 7 * DAY;
    default: {
      // „a1791234567”: konkretny czas odczytany z wiadomości
      const m = preset.match(/^a(\d{9,11})$/);
      return m ? Number(m[1]) * 1000 : null;
    }
  }
}

export function eveningLabel(now: number, tz: string) {
  return dayAt(now, tz, 0, 18, 0) > now + MINUTE ? "Dziś 18:00" : "Jutro 18:00";
}

// ---- Parser ----

const FOLD: Record<string, string> = { ą: "a", ć: "c", ę: "e", ł: "l", ń: "n", ó: "o", ś: "s", ź: "z", ż: "z" };

/** Małe litery bez polskich znaków: „Środę” → „srode”. Długość się nie zmienia. */
export function fold(text: string) {
  return text.toLowerCase().replace(/[ąćęłńóśźż]/g, (c) => FOLD[c]);
}

const NUMBERS: Record<string, number> = { jedna: 1, jeden: 1, jedno: 1, dwie: 2, dwa: 2, trzy: 3, cztery: 4, piec: 5, szesc: 6 };

const WEEKDAY_WORDS: [RegExp, number][] = [
  [/^(poniedzialek|poniedzialku|pon)$/, 0],
  [/^(wtorek|wtorku|wt)$/, 1],
  [/^(sroda|srode|srody|sr)$/, 2],
  [/^(czwartek|czwartku|czw)$/, 3],
  [/^(piatek|piatku|pt)$/, 4],
  [/^(sobota|sobote|soboty|sob)$/, 5],
  [/^(niedziela|niedziele|niedzieli|niedz|nd)$/, 6],
];

const MONTHS = ["stycznia", "lutego", "marca", "kwietnia", "maja", "czerwca", "lipca", "sierpnia", "wrzesnia", "pazdziernika", "listopada", "grudnia"];

/**
 * Szuka w tekście terminu. Zwraca znacznik czasu w przyszłości albo null.
 * Godzina bez dnia: dziś, a jeśli już minęła, jutro. Dzień bez godziny: 9:00.
 */
export function parseWhen(input: string, now: number, tz: string): number | null {
  let t = ` ${fold(input).replace(/[!?,;]+/g, " ").replace(/\s+/g, " ")} `;
  const n = partsIn(now, tz);

  // 1. Względnie: „za 15 minut”, „za pół godziny”, „za 2 dni”, „za tydzień”
  const rel = t.match(
    /\sza (pol |kwadrans|\d+(?:[.,]5)? ?|jedna |jeden |jedno |dwie |dwa |trzy |cztery |piec |szesc )?(minut[aey]?|min\.?|m|godzin[aey]?|godzine|godz\.?|h|dni|dzien|tydzien|tygodni[ea]?|tyg\.?)?(?=[\s.]|$)/,
  );
  if (rel && (rel[1] || rel[2])) {
    const amountWord = (rel[1] ?? "").trim();
    const unit = rel[2] ?? "";
    let amount = 1;
    if (amountWord === "pol") amount = 0.5;
    else if (amountWord === "kwadrans") return now + 15 * MINUTE;
    else if (amountWord in NUMBERS) amount = NUMBERS[amountWord];
    else if (amountWord) amount = Number(amountWord.replace(",", "."));
    if (!unit || !(amount > 0)) return null;
    if (/^(minut|min|m$)/.test(unit)) return amount <= 600 ? now + amount * MINUTE : null;
    if (/^(godz|h$)/.test(unit)) return amount <= 72 ? now + amount * HOUR : null;
    const days = /^(tydz|tyg)/.test(unit) ? amount * 7 : amount;
    if (!Number.isInteger(days) || days > 365) return null;
    t = t.replace(rel[0], " ");
    const time = findTime(t);
    return future(time ? dayAt(now, tz, days, time.h, time.mi) : now + days * DAY, now);
  }

  // 2. Godzina (wycinamy ją, żeby „12.10” po „o” nie udawało daty)
  const time = findTime(t);
  if (time) t = t.replace(time.match, " ");

  // 3. Dzień
  let date: { y: number; m: number; d: number } | null = null;
  let explicitDate = false;
  let weekday: number | null = null;
  const words = t.trim().split(" ");
  if (/\s(dzis|dzisiaj)\s/.test(t)) date = { y: n.y, m: n.m, d: n.d };
  else if (/\spojutrze\s/.test(t)) date = { y: n.y, m: n.m, d: n.d + 2 };
  else if (/\sjutro\s/.test(t)) date = { y: n.y, m: n.m, d: n.d + 1 };
  else {
    for (const word of words) {
      const hit = WEEKDAY_WORDS.find(([re]) => re.test(word.replace(/\.$/, "")));
      if (hit) {
        weekday = hit[1];
        break;
      }
    }
    const numeric = t.match(/\s(\d{1,2})[./](\d{1,2})(?:[./](\d{4}|\d{2}))?(?=\s)/);
    const named = t.match(new RegExp(`\\s(\\d{1,2}) (${MONTHS.join("|")})(?: (\\d{4}))?(?=\\s)`));
    explicitDate = Boolean(numeric || named);
    if (numeric) {
      const y = numeric[3] ? Number(numeric[3].length === 2 ? `20${numeric[3]}` : numeric[3]) : n.y;
      date = { y, m: Number(numeric[2]), d: Number(numeric[1]) };
      if (!numeric[3] && dateBefore(date, n)) date.y += 1;
    } else if (named) {
      date = { y: named[3] ? Number(named[3]) : n.y, m: MONTHS.indexOf(named[2]) + 1, d: Number(named[1]) };
      if (!named[3] && dateBefore(date, n)) date.y += 1;
    }
  }

  // Pora dnia, gdy nie ma godziny: „jutro rano”, „w piątek wieczorem”
  let clock = time ? { h: time.h, mi: time.mi } : null;
  const evening = /\s(wieczorem|wieczor|po poludniu)\s/.test(` ${fold(input)} `);
  if (clock && evening && clock.h < 12) clock.h += 12;
  if (!clock) {
    if (/\srano\s/.test(t)) clock = { h: 9, mi: 0 };
    else if (/\s(w poludnie|poludnie)\s/.test(t)) clock = { h: 12, mi: 0 };
    else if (/\spo poludniu\s/.test(t)) clock = { h: 15, mi: 0 };
    else if (/\s(wieczorem|wieczor)\s/.test(t)) clock = { h: 19, mi: 0 };
  }

  if (date) {
    if (date.m < 1 || date.m > 12 || date.d < 1 || date.d > 31) return null;
    const c = clock ?? { h: 9, mi: 0 };
    const at = zonedToUtc(date.y, date.m, date.d, c.h, c.mi, tz);
    // Jawna data musi istnieć (31.02 → null). Jutro i pojutrze mogą przejść na kolejny miesiąc.
    if (explicitDate && partsIn(at, tz).d !== date.d) return null;
    return future(at, now);
  }

  if (weekday !== null) {
    const c = clock ?? { h: 9, mi: 0 };
    let ahead = (weekday - n.wd + 7) % 7;
    let at = dayAt(now, tz, ahead, c.h, c.mi);
    if (ahead === 0 && at <= now) {
      ahead = 7;
      at = dayAt(now, tz, ahead, c.h, c.mi);
    }
    return future(at, now);
  }

  if (clock && time) {
    const today = dayAt(now, tz, 0, clock.h, clock.mi);
    return today > now + 30_000 ? today : dayAt(now, tz, 1, clock.h, clock.mi);
  }
  return null;
}

function findTime(t: string): { h: number; mi: number; match: string } | null {
  const patterns: RegExp[] = [
    /\s(?:o |na |godz\.? |o godz\.? |o godzinie )?(\d{1,2}):(\d{2})(?=[\s.]|$)/,
    /\s(?:o|na|godz\.?|o godz\.?|o godzinie) (\d{1,2})\.(\d{2})(?=\s)/,
    /\s(?:o|na|godz\.?|o godz\.?|o godzinie) (\d{1,2})(?=\s)(?! ?[./]\d)/,
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (!m) continue;
    const h = Number(m[1]);
    const mi = m[2] ? Number(m[2]) : 0;
    if (h > 23 || mi > 59) return null;
    return { h, mi, match: m[0] };
  }
  return null;
}

function dateBefore(date: { y: number; m: number; d: number }, n: Parts) {
  return date.m < n.m || (date.m === n.m && date.d < n.d);
}

function future(at: number, now: number) {
  return at > now + 30_000 && at < now + 400 * DAY ? at : null;
}
