import { afterEach, describe, expect, it, vi } from "vitest";
import { KEY_PATTERN, audioFormat, buildRequest, completeJson, detectProvider, parseJson, transcribe } from "../src/ai";
import { seal, unseal } from "../src/crypto";
import { asksForList, botSystem, toBotPlan, toSiteReply } from "../src/prompts";

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
  const call = { provider: "gemini" as const, key: "k", model: "glowny", fallbackModel: "lzejszy", system: "s", turns: [{ role: "user" as const, text: "hej" }], timeoutMs: 10_000 };
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

  it("limit na głównym modelu (429): odpowiada zapasowy, który ma własny limit", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", async () => (++calls === 1 ? new Response("{}", { status: 429 }) : ok('{"reply":"z zapasowego"}')));
    expect(await completeJson(call)).toEqual({ reply: "z zapasowego" });
    expect(calls).toBe(2);
  });

  it("główny model milczy: po swojej części czasu odpowiada zapasowy", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(url);
      if (urls.length === 1) throw Object.assign(new Error("czas minął"), { name: "TimeoutError" });
      return ok('{"reply":"z zapasowego"}');
    });
    expect(await completeJson(call)).toEqual({ reply: "z zapasowego" });
    expect(urls.map((u) => u.includes("/lzejszy:"))).toEqual([false, true]);
  });

  it("zapasowy model dostaje tylko to, co zostało z czasu", async () => {
    // 503 przyszło dopiero tuż przed końcem budżetu: drugiej próby już nie ma
    let calls = 0;
    const start = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => (calls === 0 ? start : start + 9_500));
    vi.stubGlobal("fetch", async () => (calls++, new Response("{}", { status: 503 })));
    await expect(completeJson(call)).rejects.toMatchObject({ kind: "busy" });
    expect(calls).toBe(1);
    vi.restoreAllMocks();
  });
});

describe("zdjęcia i głosówki w zapytaniu", () => {
  const image = { kind: "image" as const, mime: "image/jpeg", data: "QUJD" };
  const voice = { kind: "audio" as const, mime: "audio/ogg", data: "T2dn" };
  const req = (provider: "gemini" | "openai" | "anthropic" | "openrouter", media: (typeof image | typeof voice)[]) =>
    buildRequest({ provider, key: "k", model: "m", system: "s", turns: [{ role: "user", text: "[zdjęcie]", media }], timeoutMs: 1000 }) as {
      url: string;
      body: Record<string, any>;
    };

  it("Gemini: obraz i dźwięk jako inlineData przed tekstem", () => {
    const parts = req("gemini", [voice]).body.contents[0].parts;
    expect(parts).toEqual([{ inlineData: { mimeType: "audio/ogg", data: "T2dn" } }, { text: "[zdjęcie]" }]);
    expect(req("gemini", []).body.contents[0].parts).toEqual([{ text: "[zdjęcie]" }]);
  });

  it("Anthropic: zdjęcie tak, dźwięk nie", () => {
    expect(req("anthropic", [image]).body.messages[0].content).toEqual([
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "QUJD" } },
      { type: "text", text: "[zdjęcie]" },
    ]);
    expect(() => req("anthropic", [voice])).toThrow(expect.objectContaining({ kind: "unsupported" }));
  });

  it("OpenAI: zdjęcie jako data URL, głosówka tylko przez transkrypcję", () => {
    expect(req("openai", [image]).body.messages[1].content[1]).toEqual({ type: "image_url", image_url: { url: "data:image/jpeg;base64,QUJD" } });
    expect(() => req("openai", [voice])).toThrow(expect.objectContaining({ kind: "unsupported" }));
  });

  it("OpenRouter: głosówka jako input_audio w formacie ogg", () => {
    const r = req("openrouter", [voice]);
    expect(r.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(r.body.messages[1].content[1]).toEqual({ type: "input_audio", input_audio: { data: "T2dn", format: "ogg" } });
    expect(audioFormat("audio/mpeg")).toBe("mp3");
    expect(audioFormat("audio/x-m4a")).toBe("m4a");
  });
});

describe("transkrypcja OpenAI", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("bez nowszego modelu przechodzi na whisper-1", async () => {
    const models: string[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      models.push(String((init.body as FormData).get("model")));
      return models.length === 1 ? new Response("{}", { status: 404 }) : Response.json({ text: " jutro o 9 przypomnij mi o fakturze " });
    });
    expect(await transcribe("k", new Uint8Array([1, 2, 3]), "audio/ogg", 10_000)).toBe("jutro o 9 przypomnij mi o fakturze");
    expect(models).toEqual(["gpt-4o-mini-transcribe", "whisper-1"]);
  });

  it("zły klucz to błąd klucza, bez drugiej próby", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", async () => (calls++, new Response("{}", { status: 401 })));
    await expect(transcribe("k", new Uint8Array([1]), "audio/ogg", 10_000)).rejects.toMatchObject({ kind: "auth" });
    expect(calls).toBe(1);
  });
});

describe("instrukcja dla modelu", () => {
  const NOW = Date.UTC(2026, 9, 6, 7, 0); // wtorek 6.10, 9:00 w Warszawie
  it("ma kalendarz z dniami tygodnia", () => {
    const text = botSystem(NOW, "Europe/Warsaw", []);
    expect(text).toContain("wtorek 2026-10-06  (dziś)");
    expect(text).toContain("środa 2026-10-07  (jutro)");
    expect(text).toContain("piątek 2026-10-09");
    expect(text).toContain("godzina 09:00");
  });

  it("styl rozmowy; dawne „short” to rzeczowo", () => {
    expect(botSystem(NOW, "Europe/Warsaw", [], undefined, { tone: "technical" })).toContain("rzeczowo i precyzyjnie");
    expect(botSystem(NOW, "Europe/Warsaw", [], undefined, { tone: "short" })).toContain("rzeczowo i precyzyjnie");
    expect(botSystem(NOW, "Europe/Warsaw", [], undefined, { tone: "warm" })).toContain("serdecznie i ciepło");
    expect(botSystem(NOW, "Europe/Warsaw", [])).toContain("ciepło i życzliwie");
  });
});

describe("prośba o listę", () => {
  it.each([
    ["dopisz do listy chleb", true],
    ["dodaj mleko", true],
    ["co mam na liście?", true],
    ["zanotuj: oddać książkę", true],
    ["przypomnij jutro i wrzuć na listę", true],
    ["5 listopada przegląd auta", false],
    ["w listopadzie urodziny mamy", false],
    ["w piątek o 15:30 przegląd auta", false],
  ])("%s → %s", (text, expected) => expect(asksForList(text)).toBe(expected));
});
