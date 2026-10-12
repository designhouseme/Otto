import { describe, expect, it } from "vitest";
import { easter, holidays, holidaysBetween } from "../src/holidays";

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

describe("polskie święta", () => {
  it("liczy Wielkanoc, także skrajne daty", () => {
    expect([2024, 2025, 2026, 2027, 2038, 2285].map((y) => day(easter(y)))).toEqual(["2024-03-31", "2025-04-20", "2026-04-05", "2027-03-28", "2038-04-25", "2285-03-22"]);
  });
  it("ma święta ruchome i Wigilię od 2025 roku", () => {
    const y2026 = Object.fromEntries(holidays(2026).map((h) => [h.date, h.name]));
    expect(y2026).toMatchObject({ "2026-04-06": "Poniedziałek Wielkanocny", "2026-05-24": "Zielone Świątki", "2026-06-04": "Boże Ciało", "2026-11-11": "Święto Niepodległości", "2026-12-24": "Wigilia" });
    expect(holidays(2026)).toHaveLength(14);
    expect(holidays(2024).some((h) => h.date === "2024-12-24")).toBe(false);
  });
  it("wybiera zakres przez granicę roku, w kolejności", () => {
    expect(holidaysBetween("2026-12-25", "2027-01-06").map((h) => h.date)).toEqual(["2026-12-25", "2026-12-26", "2027-01-01", "2027-01-06"]);
    expect(holidaysBetween("2026-10-12", "2026-10-31")).toEqual([]);
  });
});
