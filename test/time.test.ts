import { describe, expect, it } from "vitest";
import { calendar, formatWhen, localIsoToUtc, parseWhen, presetAt, reminderAt } from "../src/time";

const TZ = "Europe/Warsaw";
// Poniedziałek 5 października 2026, 14:00 w Warszawie (UTC+2).
const NOW = Date.UTC(2026, 9, 5, 12, 0);
const utc = (iso: string) => Date.parse(`${iso}Z`);
const when = (text: string) => parseWhen(text, NOW, TZ);

describe("parseWhen", () => {
  it.each([
    ["jutro o 9", "2026-10-06T07:00"],
    ["Jutro rano", "2026-10-06T07:00"],
    ["jutro wieczorem", "2026-10-06T17:00"],
    ["pojutrze 10:30", "2026-10-07T08:30"],
    ["w piątek 15:30", "2026-10-09T13:30"],
    ["w srode o 12:15", "2026-10-07T10:15"],
    ["w piątek o 7 wieczorem", "2026-10-09T17:00"],
    ["w poniedziałek", "2026-10-12T07:00"],
    ["o 18", "2026-10-05T16:00"],
    ["o 8", "2026-10-06T06:00"],
    ["10:30", "2026-10-06T08:30"],
    ["12.10 o 8", "2026-10-12T06:00"],
    ["1.03", "2027-03-01T08:00"],
    ["25 października", "2026-10-25T08:00"],
    ["za 3 dni o 10", "2026-10-08T08:00"],
  ])("%s", (text, expected) => {
    expect(when(text)).toBe(utc(expected));
  });

  it("czas względny", () => {
    expect(when("za 2 h")).toBe(NOW + 2 * 3600_000);
    expect(when("za 15 minut")).toBe(NOW + 15 * 60_000);
    expect(when("za pół godziny")).toBe(NOW + 30 * 60_000);
    expect(when("za godzinę")).toBe(NOW + 3600_000);
    expect(when("za kwadrans")).toBe(NOW + 15 * 60_000);
    expect(when("za tydzień")).toBe(NOW + 7 * 86400_000);
  });

  it.each(["kupić mleko", "dziękuję za pomoc", "31.02", "dziś o 10", "za 2 miesiące", "o 25"])("brak terminu: %s", (text) => {
    expect(when(text)).toBeNull();
  });
});

describe("czas lokalny", () => {
  it("uwzględnia zmianę czasu", () => {
    expect(localIsoToUtc("2026-10-24T09:00", TZ)).toBe(utc("2026-10-24T07:00"));
    expect(localIsoToUtc("2026-10-25T09:00", TZ)).toBe(utc("2026-10-25T08:00"));
    expect(localIsoToUtc("nie data", TZ)).toBeNull();
  });

  it("formatuje po ludzku", () => {
    expect(formatWhen(utc("2026-10-05T16:00"), NOW, TZ)).toBe("dziś o 18:00");
    expect(formatWhen(utc("2026-10-06T07:00"), NOW, TZ)).toBe("jutro o 9:00");
    expect(formatWhen(utc("2026-10-09T13:30"), NOW, TZ)).toBe("w piątek o 15:30");
    expect(formatWhen(utc("2026-11-20T08:00"), NOW, TZ)).toBe("pt 20.11 o 9:00");
  });

  it("przyciski liczą czas w chwili kliknięcia", () => {
    expect(presetAt("e18", NOW, TZ)).toBe(utc("2026-10-05T16:00"));
    expect(presetAt("e18", utc("2026-10-05T17:30"), TZ)).toBe(utc("2026-10-06T16:00"));
    expect(presetAt("j9", NOW, TZ)).toBe(utc("2026-10-06T07:00"));
    expect(presetAt("a1791234567", NOW, TZ)).toBe(1791234567000);
    expect(presetAt("cokolwiek", NOW, TZ)).toBeNull();
  });
});

describe("kalendarz dla modelu", () => {
  it("zaczyna od dziś z poprawnymi dniami tygodnia", () => {
    const days = calendar(NOW, TZ);
    expect(days).toHaveLength(14);
    expect(days[0]).toEqual({ date: "2026-10-05", weekday: "poniedziałek" });
    expect(days[1]).toEqual({ date: "2026-10-06", weekday: "wtorek" });
    expect(days[4]).toEqual({ date: "2026-10-09", weekday: "piątek" });
    expect(days[13]).toEqual({ date: "2026-10-18", weekday: "niedziela" });
  });

  it("zmiana czasu niczego nie przesuwa", () => {
    // Sobota 24.10, 23:30 w Warszawie: w nocy cofamy zegarki (doba ma 25 godzin)
    const days = calendar(Date.UTC(2026, 9, 24, 21, 30), TZ, 3).map((d) => d.date);
    expect(days).toEqual(["2026-10-24", "2026-10-25", "2026-10-26"]);
    // Sobota 28.03.2026, 23:30: w nocy przesuwamy na letni (doba ma 23 godziny)
    expect(calendar(Date.UTC(2026, 2, 28, 22, 30), TZ, 3).map((d) => d.date)).toEqual(["2026-03-28", "2026-03-29", "2026-03-30"]);
  });

  it("liczy po dacie w strefie użytkownika, nie w UTC", () => {
    // 22:30 UTC 5.10 to już 00:30 6.10 w Warszawie
    expect(calendar(Date.UTC(2026, 9, 5, 22, 30), TZ, 1)[0].date).toBe("2026-10-06");
  });
});

describe("termin z planu modelu", () => {
  it("czas od teraz liczy kod", () => {
    expect(reminderAt("+20m", NOW, TZ)).toBe(NOW + 20 * 60_000);
    expect(reminderAt("+2h", NOW, TZ)).toBe(NOW + 2 * 3_600_000);
    expect(reminderAt("+90 min", NOW, TZ)).toBe(NOW + 90 * 60_000);
  });

  it("czas lokalny w strefie użytkownika", () => {
    expect(reminderAt("2026-10-09T15:30", NOW, TZ)).toBe(utc("2026-10-09T13:30"));
  });

  it("odrzuca śmieci", () => {
    expect(reminderAt("jutro", NOW, TZ)).toBeNull();
    expect(reminderAt("+5x", NOW, TZ)).toBeNull();
  });
});
