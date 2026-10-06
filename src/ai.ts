/**
 * Modele językowe. Nasze darmowe wiadomości i rozmowa na stronie idą przez Gemini Flash,
 * a własny klucz użytkownika może być od Gemini, OpenAI, Anthropic albo OpenRouter.
 * Każda odpowiedź to JSON, który sprawdzamy w kodzie, zanim cokolwiek z nim zrobimy.
 */

export type Provider = "gemini" | "openai" | "anthropic" | "openrouter";

export const PROVIDER_NAMES: Record<Provider, string> = {
  gemini: "Gemini",
  openai: "OpenAI",
  anthropic: "Anthropic",
  openrouter: "OpenRouter",
};

/**
 * Coś, co wygląda na klucz API. Taką wiadomość kasujemy od razu, nawet bez /klucz.
 * Tylko samodzielny token z cyfrą, żeby „desk-organizer-…” w zwykłym zdaniu nie zniknął z czatu.
 */
export const KEY_PATTERN =
  /(?<![\w.-])(AIza[0-9A-Za-z_-]{30,}|AQ\.(?=[0-9A-Za-z_-]*\d)[0-9A-Za-z_-]{30,}|sk-(?:ant-|or-|proj-)?(?=[0-9A-Za-z_-]*\d)[0-9A-Za-z_-]{20,})(?![\w-])/;

export function detectProvider(key: string): Provider | null {
  // Google wydaje klucze w dwóch formatach: starszym AIza… i nowszym AQ.…
  if (/^(AIza[0-9A-Za-z_-]{30,}|AQ\.[0-9A-Za-z_-]{30,})$/.test(key)) return "gemini";
  if (/^sk-ant-[0-9A-Za-z_-]{20,}$/.test(key)) return "anthropic";
  if (/^sk-or-[0-9A-Za-z_-]{20,}$/.test(key)) return "openrouter";
  if (/^sk-[0-9A-Za-z_-]{20,}$/.test(key)) return "openai";
  return null;
}

export function defaultModel(provider: Provider, env: Env) {
  switch (provider) {
    case "gemini":
      return env.GEMINI_MODEL;
    case "anthropic":
      return "claude-haiku-4-5";
    case "openai":
      return "gpt-5-mini";
    case "openrouter":
      return "openrouter/auto";
  }
}

export class AiError extends Error {
  constructor(
    readonly kind: "auth" | "quota" | "busy" | "timeout" | "bad" | "unsupported" | "other",
    message: string,
  ) {
    super(message);
  }
}

/** Zdjęcie albo nagranie dołączone do wiadomości, w base64. */
export interface Media {
  kind: "image" | "audio";
  mime: string;
  data: string;
}

export interface Turn {
  role: "user" | "assistant";
  text: string;
  media?: Media[];
}

export interface JsonCall {
  provider: Provider;
  key: string;
  model: string;
  /** Lżejszy model na wypadek przeciążenia, limitu, braku odpowiedzi na czas albo zerwanego połączenia. Ponawiamy raz, w tym samym budżecie czasu. */
  fallbackModel?: string;
  system: string;
  turns: Turn[];
  timeoutMs: number;
}

export async function completeJson(call: JsonCall): Promise<unknown> {
  const deadline = Date.now() + call.timeoutMs;
  const fallback = call.fallbackModel && call.fallbackModel !== call.model ? call.fallbackModel : undefined;
  // Przeciążony Gemini potrafi milczeć do końca budżetu albo oddać 503 po kilkunastu sekundach. Gdy jest model zapasowy,
  // główny dostaje 60% czasu, a zapasowy (zwykle odpowiada w 1-2 s) resztę: razem zawsze mieszczą się w timeoutMs.
  const first = fallback ? Math.round(call.timeoutMs * 0.6) : call.timeoutMs;
  try {
    return parseJson(await complete({ ...call, timeoutMs: first }));
  } catch (error) {
    // Limity Gemini są osobne dla każdego modelu, więc po 429 lżejszy model zwykle jeszcze odpowie.
    if (!(fallback && error instanceof AiError && ["busy", "timeout", "quota", "other"].includes(error.kind))) throw error;
    const left = deadline - Date.now();
    if (left < 2000) throw error;
    return parseJson(await complete({ ...call, model: fallback, timeoutMs: left }));
  }
}

async function complete(call: JsonCall): Promise<string> {
  try {
    const { url, headers, body } = buildRequest(call);
    const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(call.timeoutMs) });
    await assertOk(response);
    return await readReply(call.provider, response);
  } catch (error) {
    throw asAiError(error);
  }
}

/**
 * Zapytanie do dostawcy, bez wysyłania: osobno, żeby kształt dla każdego dostawcy dało się sprawdzić w testach bez kluczy.
 * Zdjęcia przyjmują wszyscy. Dźwięk: Gemini wprost, OpenRouter jako input_audio (zależnie od modelu),
 * OpenAI przez transkrypcję (transcribe), a Claude wcale.
 */
export function buildRequest({ provider, key, model, system, turns }: JsonCall): { url: string; headers: Record<string, string>; body: unknown } {
  const audio = turns.some((t) => t.media?.some((m) => m.kind === "audio"));

  if (provider === "gemini") {
    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: {
        systemInstruction: { parts: [{ text: system }] },
        contents: turns.map((t) => ({
          role: t.role === "assistant" ? "model" : "user",
          parts: [...(t.media ?? []).map((m) => ({ inlineData: { mimeType: m.mime, data: m.data } })), { text: t.text }],
        })),
        generationConfig: { responseMimeType: "application/json" },
      },
    };
  }

  if (provider === "anthropic") {
    if (audio) throw new AiError("unsupported", "Claude nie przyjmuje dźwięku.");
    return {
      url: "https://api.anthropic.com/v1/messages",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: {
        model,
        max_tokens: 1024,
        system,
        messages: turns.map((t) => ({
          role: t.role,
          content: t.media?.length
            ? [...t.media.map((m) => ({ type: "image", source: { type: "base64", media_type: m.mime, data: m.data } })), { type: "text", text: t.text }]
            : t.text,
        })),
      },
    };
  }

  // chat/completions OpenAI nie przyjmuje OGG z Telegrama: głosówka idzie tam jako tekst z transcribe().
  if (provider === "openai" && audio) throw new AiError("unsupported", "OpenAI: głosówka tylko przez transkrypcję.");
  return {
    url: `${provider === "openai" ? "https://api.openai.com/v1" : "https://openrouter.ai/api/v1"}/chat/completions`,
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: {
      model,
      messages: [
        { role: "system", content: system },
        ...turns.map((t) => ({
          role: t.role,
          content: t.media?.length
            ? [
                { type: "text", text: t.text },
                ...t.media.map((m) =>
                  m.kind === "image"
                    ? { type: "image_url", image_url: { url: `data:${m.mime};base64,${m.data}` } }
                    : { type: "input_audio", input_audio: { data: m.data, format: audioFormat(m.mime) } },
                ),
              ]
            : t.text,
        })),
      ],
      response_format: { type: "json_object" },
    },
  };
}

async function readReply(provider: Provider, response: Response): Promise<string> {
  if (provider === "gemini") {
    const data = await response.json<{ candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[] }>();
    return (data.candidates?.[0]?.content?.parts ?? [])
      .filter((p) => !p.thought)
      .map((p) => p.text ?? "")
      .join("");
  }
  if (provider === "anthropic") {
    const data = await response.json<{ content?: { type: string; text?: string }[] }>();
    return (data.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
  }
  const data = await response.json<{ choices?: { message?: { content?: string } }[] }>();
  return data.choices?.[0]?.message?.content ?? "";
}

/** Format nagrania dla OpenAI i OpenRouter (i rozszerzenie pliku) z typu MIME. */
export function audioFormat(mime: string) {
  if (/mpeg|mp3/.test(mime)) return "mp3";
  if (/mp4|m4a/.test(mime)) return "m4a";
  if (/wav/.test(mime)) return "wav";
  if (/aac/.test(mime)) return "aac";
  if (/flac/.test(mime)) return "flac";
  return "ogg";
}

/**
 * Głosówka na tekst przez OpenAI, dla klucza OpenAI. Najpierw nowszy model transkrypcji,
 * a gdy konto go nie ma (400 albo 404), whisper-1. Oba podejścia mieszczą się w timeoutMs.
 */
export async function transcribe(key: string, audio: Uint8Array, mime: string, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (const model of ["gpt-4o-mini-transcribe", "whisper-1"]) {
    try {
      const form = new FormData();
      form.append("model", model);
      form.append("file", new Blob([audio], { type: mime }), `voice.${audioFormat(mime)}`);
      const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { authorization: `Bearer ${key}` },
        body: form,
        signal: AbortSignal.timeout(Math.max(1000, deadline - Date.now())),
      });
      if ((response.status === 400 || response.status === 404) && model !== "whisper-1") continue;
      await assertOk(response);
      return ((await response.json<{ text?: string }>()).text ?? "").trim();
    } catch (error) {
      throw asAiError(error);
    }
  }
  throw new AiError("other", "Transkrypcja się nie udała.");
}

function asAiError(error: unknown): AiError {
  if (error instanceof AiError) return error;
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) return new AiError("timeout", "Model nie odpowiedział na czas.");
  return new AiError("other", error instanceof Error ? error.message : String(error));
}

async function assertOk(response: Response) {
  if (response.ok) return;
  const body = (await response.text().catch(() => "")).slice(0, 200);
  // Gemini odrzuca zły klucz kodem 400 z „API key not valid”.
  if (response.status === 401 || response.status === 403 || /api key not valid/i.test(body)) {
    throw new AiError("auth", `Klucz odrzucony (${response.status}).`);
  }
  if (response.status === 429) throw new AiError("quota", "Limit u dostawcy modelu.");
  if ([500, 502, 503, 504].includes(response.status)) throw new AiError("busy", `Model przeciążony (${response.status}).`);
  if (response.status === 400 || response.status === 404) throw new AiError("bad", `Model odrzucił zapytanie (${response.status}): ${body}`);
  throw new AiError("other", `Dostawca modelu: ${response.status}`);
}

export function parseJson(raw: string): unknown {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new AiError("bad", "Model nie zwrócił JSON-a.");
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new AiError("bad", "Model zwrócił niepoprawny JSON.");
  }
}

/** Sprawdza klucz zapytaniem, które nic nie kosztuje (lista modeli albo opis klucza). */
export async function checkKey(provider: Provider, key: string): Promise<"ok" | "invalid" | "error"> {
  const requests: Record<Provider, [string, Record<string, string>]> = {
    gemini: ["https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", { "x-goog-api-key": key }],
    openai: ["https://api.openai.com/v1/models", { authorization: `Bearer ${key}` }],
    anthropic: ["https://api.anthropic.com/v1/models?limit=1", { "x-api-key": key, "anthropic-version": "2023-06-01" }],
    openrouter: ["https://openrouter.ai/api/v1/key", { authorization: `Bearer ${key}` }],
  };
  const [url, headers] = requests[provider];
  try {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
    if (response.ok) return "ok";
    if ([400, 401, 403].includes(response.status)) return "invalid";
    return "error";
  } catch {
    return "error";
  }
}
