import { describe, expect, it } from "vitest";
import { formatWhen, localIsoToUtc, parseWhen, presetAt } from "../src/time";

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
