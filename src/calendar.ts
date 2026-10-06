/**
 * „Dodaj do kalendarza”: Google Kalendarz przez link prosto do Google, Apple i Outlook przez plik .ics.
 * Niczego nie przechowujemy, tytuł i godzina jadą w samym linku: do Google jawnie (i tak trafiają do jego kalendarza),
 * a do nas, po plik .ics, tylko zaszyfrowane, więc w logach Workera widać szyfrogram, nie treść.
 */

import { seal, unseal } from "./crypto";

/** Kontekst szyfrowania linków do .ics: inny niż dla kluczy API, więc jedno nigdy nie odszyfruje się jako drugie. */
const CONTEXT = "kalendarz";
/** Długość wydarzenia w kalendarzu. */
const MINUTES = 30;
const encoder = new TextEncoder();

/** 2026-10-19 07:00 UTC → 20261019T070000Z: format dat w iCalendar i w linku Google. */
export function utcStamp(at: number) {
  return new Date(at).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export function googleCalendarUrl(title: string, at: number) {
  const query = [
    ["action", "TEMPLATE"],
    ["text", title],
    ["dates", `${utcStamp(at)}/${utcStamp(at + MINUTES * 60_000)}`],
    ["details", "Dodane przez Otta"],
  ];
  return `https://calendar.google.com/calendar/render?${query.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&")}`;
}

/** Ukośnik, średnik, przecinek i nowa linia to w iCalendar znaki specjalne (RFC 5545, 3.3.11). */
const escapeText = (text: string) => text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Linie najwyżej po 75 bajtów, kolejne zaczynają się spacją (RFC 5545, 3.1). Nigdy w środku polskiej litery. */
export function fold(line: string) {
  const parts: string[] = [];
  let current = "";
  let bytes = 0;
  for (const ch of line) {
    const size = encoder.encode(ch).length;
    if (bytes + size > (parts.length ? 74 : 75)) {
      parts.push(current);
      current = "";
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

/** Stały identyfikator z tytułu i godziny: ten sam termin zaimportowany drugi raz nie zrobi duplikatu. */
function uid(title: string, at: number) {
  let h = 5381;
  for (const ch of title) h = ((h << 5) + h + ch.codePointAt(0)!) >>> 0;
  return `${utcStamp(at)}-${h.toString(16)}@otto`;
}

export function icsFile(title: string, at: number, now = Date.now()) {
  const summary = escapeText(title);
  return `${[
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Design House//Otto//PL",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid(title, at)}`,
    `DTSTAMP:${utcStamp(now)}`,
    `DTSTART:${utcStamp(at)}`,
    `DTEND:${utcStamp(at + MINUTES * 60_000)}`,
    `SUMMARY:${summary}`,
    "DESCRIPTION:Dodane przez Otta",
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${summary}`,
    "TRIGGER:-PT0M",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ]
    .map(fold)
    .join("\r\n")}\r\n`;
}

/** Link do pliku .ics u nas: tytuł i godzina zaszyfrowane. */
export async function icsLink(origin: string, secret: string, title: string, at: number) {
  return `${origin}/kalendarz?e=${encodeURIComponent(await seal(JSON.stringify({ t: title, at }), secret, CONTEXT))}`;
}

/** GET /kalendarz?e=…: plik .ics z zaszyfrowanego linku. Zły albo cudzy link: 400. */
export async function calendarFile(env: Env, url: URL): Promise<Response> {
  try {
    if (!env.KEY_SECRET) throw new Error("brak KEY_SECRET");
    const { t, at } = JSON.parse(await unseal(url.searchParams.get("e") ?? "", env.KEY_SECRET, CONTEXT)) as { t?: unknown; at?: unknown };
    if (typeof t !== "string" || typeof at !== "number" || !Number.isFinite(at)) throw new Error("zły link");
    return new Response(icsFile(t.slice(0, 120), at), {
      headers: {
        "content-type": "text/calendar; charset=utf-8",
        "content-disposition": 'attachment; filename="otto.ics"',
        "cache-control": "private, max-age=86400",
      },
    });
  } catch {
    return new Response("Ten link do kalendarza jest niepoprawny.", { status: 400 });
  }
}

// Słowa o czasie, które w tytule wydarzenia są zbędne: termin i tak jest w kalendarzu („jutro o 9 faktura” → „Faktura”).
// Granice słów przez \p{L}, bo \b w JS zna tylko litery ASCII i nie złapałby „dziś” ani „środę”.
const word = (source: string) => new RegExp(`(?<![\\p{L}\\d])(?:${source})(?![\\p{L}\\d])`, "giu");
const WHEN_WORDS = [
  word("przypomnij(?:\\s+mi)?"),
  word("dziś|dzisiaj|jutro|pojutrze|rano|wieczorem|po\\s+południu|w\\s+południe"),
  word("we?\\s+(?:poniedziałek|wtorek|środę|czwartek|piątek|sobotę|niedzielę)"),
  word("za\\s+(?:\\d+\\s+)?(?:minut[ęy]?|min|godzin[ęy]?|godz|h|dni|dzień|tydzień|tygodnie|tygodni)"),
  word("o\\s+\\d{1,2}(?:[:.]\\d{2})?"),
  word("\\d{1,2}[.:]\\d{1,2}(?:\\.\\d{2,4})?"),
  word("\\d{1,2}\\s+(?:stycznia|lutego|marca|kwietnia|maja|czerwca|lipca|sierpnia|września|października|listopada|grudnia)"),
];

/** Tytuł wydarzenia z tekstu komendy albo wiadomości, bez słów o czasie. Pusty, gdy nic nie zostało. */
export function cleanTitle(text: string) {
  let title = text.replace(/^\/\S+\s*/, "");
  for (const re of WHEN_WORDS) title = title.replace(re, " ");
  title = title.replace(/\s+/g, " ").replace(/^[\s,.:;-]+|[\s,.:;-]+$/g, "").replace(/^o\s+/i, "");
  return title ? (title[0].toUpperCase() + title.slice(1)).slice(0, 60) : "";
}
