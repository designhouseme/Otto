import { afterEach, describe, expect, it, vi } from "vitest";
import { KEY_PATTERN, completeJson, detectProvider, parseJson } from "../src/ai";
import { seal, unseal } from "../src/crypto";
import { toBotPlan, toSiteReply } from "../src/prompts";

describe("klucze", () => {
  it("rozpoznaje dostawcę", () => {
    expect(detectProvider(`AIza${"x".repeat(35)}`)).toBe("gemini");
    expect(detectProvider(`sk-ant-api03-${"x".repeat(40)}`)).toBe("anthropic");
    expect(detectProvider(`sk-or-v1-${"x".repeat(40)}`)).toBe("openrouter");
    expect(detectProvider(`sk-proj-${"x".repeat(40)}`)).toBe("openai");
    expect(detectProvider(`AQ.Ab8${"x9".repeat(20)}`)).toBe("gemini");
    expect(detectProvider("hasło123")).toBeNull();
  });

  it("wyłapuje klucz w zwykłej wiadomości", () => {
    const key = `sk-proj-${"a1".repeat(20)}`;
    expect(`mój klucz to ${key} dzięki`.match(KEY_PATTERN)?.[1]).toBe(key);
    expect(`AIza${"Sy0".repeat(12)}`.match(KEY_PATTERN)).not.toBeNull();
    const google = `AQ.Ab8RN6${"Kq1_".repeat(10)}`;
    expect(`mój nowy klucz: ${google}`.match(KEY_PATTERN)?.[1]).toBe(google);
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

describe("przeciążony model", () => {
  afterEach(() => vi.unstubAllGlobals());
  const call = { provider: "gemini" as const, key: "k", model: "glowny", fallbackModel: "lzejszy", system: "s", turns: [{ role: "user" as const, text: "hej" }], timeoutMs: 1000 };
  const ok = (text: string) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 });

  it("przy 503 ponawia raz na lżejszym modelu", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(url);
      return urls.length === 1 ? new Response("{}", { status: 503 }) : ok('{"reply":"z zapasowego"}');
    });
    expect(await completeJson(call)).toEqual({ reply: "z zapasowego" });
    expect(urls[0]).toContain("/glowny:");
    expect(urls[1]).toContain("/lzejszy:");
  });

  it("zły klucz nie jest ponawiany", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", async () => (calls++, new Response("API key not valid", { status: 400 })));
    await expect(completeJson(call)).rejects.toMatchObject({ kind: "auth" });
    expect(calls).toBe(1);
  });
});
