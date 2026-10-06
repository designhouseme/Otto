import { describe, expect, it } from "vitest";
import { calendarFile, cleanTitle, fold, googleCalendarUrl, icsFile, icsLink, utcStamp } from "../src/calendar";

// Poniedziałek 19.10.2026, 9:00 w Warszawie = 7:00 UTC
const AT = Date.UTC(2026, 9, 19, 7, 0);
const NOW = Date.UTC(2026, 9, 6, 7, 0);
const bytes = (s: string) => new TextEncoder().encode(s).length;

describe("kalendarz", () => {
  it("daty w UTC jak w iCalendar", () => {
    expect(utcStamp(AT)).toBe("20261019T070000Z");
  });

  it("link do Google Kalendarza", () => {
    const url = new URL(googleCalendarUrl("Faktura za prąd", AT));
    expect(url.origin + url.pathname).toBe("https://calendar.google.com/calendar/render");
    expect(url.searchParams.get("action")).toBe("TEMPLATE");
    expect(url.searchParams.get("text")).toBe("Faktura za prąd");
    expect(url.searchParams.get("dates")).toBe("20261019T070000Z/20261019T073000Z");
  });

  it("plik .ics: znaki specjalne, CRLF, przypomnienie", () => {
    const ics = icsFile("Spotkanie; Kowalski, sala 2\nwejście B", AT, NOW);
    expect(ics).toContain("SUMMARY:Spotkanie\\; Kowalski\\, sala 2\\nwejście B");
    expect(ics).toContain("DTSTART:20261019T070000Z\r\nDTEND:20261019T073000Z");
    expect(ics).toContain("BEGIN:VALARM");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics.split("\r\n").every((l) => !l.includes("\n"))).toBe(true);
  });

  it("długie polskie linie zawija po 75 bajtów, nie w środku litery", () => {
    const title = "Przegląd auta u mechanika, Żoliborz, ulica Ściegiennego, źródło świateł".repeat(2);
    const lines = fold(`SUMMARY:${title}`).split("\r\n");
    expect(lines.length).toBeGreaterThan(2);
    for (const [i, line] of lines.entries()) {
      expect(bytes(line)).toBeLessThanOrEqual(75);
      if (i) expect(line.startsWith(" ")).toBe(true);
    }
    expect(lines.map((l, i) => (i ? l.slice(1) : l)).join("")).toBe(`SUMMARY:${title}`);
  });

  it("tytuł bez słów o czasie", () => {
    expect(cleanTitle("jutro o 9 faktura")).toBe("Faktura");
    expect(cleanTitle("/przypomnij w piątek 15:30 przegląd auta")).toBe("Przegląd auta");
    expect(cleanTitle("12.10 o 8 dentysta")).toBe("Dentysta");
    expect(cleanTitle("za 2 h wyjąć pranie")).toBe("Wyjąć pranie");
    expect(cleanTitle("25 października urodziny mamy")).toBe("Urodziny mamy");
    expect(cleanTitle("dziś wieczorem zadzwonić do Ewy")).toBe("Zadzwonić do Ewy");
    expect(cleanTitle("jutro o 9")).toBe("");
  });

  it("plik z zaszyfrowanego linku; zły link to 400", async () => {
    const env = { KEY_SECRET: "sekret" } as Env;
    const link = new URL(await icsLink("https://otto.example", "sekret", "Faktura za prąd", AT));
    expect(link.pathname).toBe("/kalendarz");
    expect(link.search).not.toContain("Faktura");
    const ok = await calendarFile(env, link);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
    expect(await ok.text()).toContain("SUMMARY:Faktura za prąd");
    expect((await calendarFile(env, new URL("https://otto.example/kalendarz?e=zepsuty"))).status).toBe(400);
    expect((await calendarFile({ KEY_SECRET: "inny" } as Env, link)).status).toBe(400);
  });
});
