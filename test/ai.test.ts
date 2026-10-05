import { describe, expect, it } from "vitest";
import { KEY_PATTERN, detectProvider, parseJson } from "../src/ai";
import { seal, unseal } from "../src/crypto";
import { toBotPlan, toSiteReply } from "../src/prompts";

describe("klucze", () => {
  it("rozpoznaje dostawcę", () => {
    expect(detectProvider(`AIza${"x".repeat(35)}`)).toBe("gemini");
    expect(detectProvider(`sk-ant-api03-${"x".repeat(40)}`)).toBe("anthropic");
    expect(detectProvider(`sk-or-v1-${"x".repeat(40)}`)).toBe("openrouter");
    expect(detectProvider(`sk-proj-${"x".repeat(40)}`)).toBe("openai");
    expect(detectProvider("hasło123")).toBeNull();
  });

  it("wyłapuje klucz w zwykłej wiadomości", () => {
    const key = `sk-proj-${"a1".repeat(20)}`;
    expect(`mój klucz to ${key} dzięki`.match(KEY_PATTERN)?.[1]).toBe(key);
    expect(`AIza${"Sy0".repeat(12)}`.match(KEY_PATTERN)).not.toBeNull();
  });

  it("nie kasuje zwykłych wiadomości", () => {
    expect("zadzwonić do Skiby".match(KEY_PATTERN)).toBeNull();
    expect("kupić desk-organizer-for-the-home-office".match(KEY_PATTERN)).toBeNull();
    expect("task-sk-abcdefghij1234567890xyz".match(KEY_PATTERN)).toBeNull();
  });

  it("szyfruje z powiązaniem do czatu", async () => {
    const sealed = await seal("sk-test", "sekret", "123");
    expect(sealed).not.toContain("sk-test");
    expect(await unseal(sealed, "sekret", "123")).toBe("sk-test");
    await expect(unseal(sealed, "sekret", "456")).rejects.toThrow();
    await expect(unseal(sealed, "inny", "123")).rejects.toThrow();
  });
});

describe("odpowiedzi modelu", () => {
  it("wyciąga JSON z otoczki", () => {
    expect(parseJson('```json\n{"reply":"ok"}\n```')).toEqual({ reply: "ok" });
    expect(() => parseJson("bez jsona")).toThrow();
  });

  it("plan bota przepuszcza tylko poprawne pola", () => {
    expect(toBotPlan({ reply: " Jasne ", reminders: ["2026-10-06T09:00", 5, ""], add: ["mleko"], done: [2, "x", -1] })).toEqual({
      reply: "Jasne",
      reminders: ["2026-10-06T09:00"],
      add: ["mleko"],
      done: [2],
    });
    expect(toBotPlan(null)).toEqual({ reply: "", reminders: [], add: [], done: [] });
  });

  it("odpowiedź na stronie ma znaną minę i akcję", () => {
    expect(toSiteReply({ reply: "Hej — tu Otto", mood: "wow", action: "qr" })).toEqual({ reply: "Hej, tu Otto", mood: "wow", action: "qr" });
    expect(toSiteReply({ reply: "Hej", mood: "zły", action: "usuń bazę" })).toEqual({ reply: "Hej", mood: "neutral", action: null });
    expect(toSiteReply({ mood: "happy" })).toBeNull();
  });
});
