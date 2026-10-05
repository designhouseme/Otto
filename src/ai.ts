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
    readonly kind: "auth" | "quota" | "busy" | "timeout" | "bad" | "other",
    message: string,
  ) {
    super(message);
  }
}

export interface Turn {
  role: "user" | "assistant";
  text: string;
}

export interface JsonCall {
  provider: Provider;
  key: string;
  model: string;
  /** Lżejszy model na wypadek przeciążenia (503). Ponawiamy raz, tylko przy szybkiej odmowie, nie po przekroczeniu czasu. */
  fallbackModel?: string;
  system: string;
  turns: Turn[];
  timeoutMs: number;
}

export async function completeJson(call: JsonCall): Promise<unknown> {
  try {
    return parseJson(await complete(call));
  } catch (error) {
    if (!(error instanceof AiError && error.kind === "busy" && call.fallbackModel && call.fallbackModel !== call.model)) throw error;
    return parseJson(await complete({ ...call, model: call.fallbackModel }));
  }
}

async function complete({ provider, key, model, system, turns, timeoutMs }: JsonCall): Promise<string> {
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    if (provider === "gemini") {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": key },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: turns.map((t) => ({ role: t.role === "assistant" ? "model" : "user", parts: [{ text: t.text }] })),
            generationConfig: { responseMimeType: "application/json" },
          }),
          signal,
        },
      );
      await assertOk(response);
      const data = await response.json<{
        candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[];
      }>();
      return (data.candidates?.[0]?.content?.parts ?? [])
        .filter((p) => !p.thought)
        .map((p) => p.text ?? "")
        .join("");
    }

    if (provider === "anthropic") {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model,
          max_tokens: 1024,
          system,
          messages: turns.map((t) => ({ role: t.role, content: t.text })),
        }),
        signal,
      });
      await assertOk(response);
      const data = await response.json<{ content?: { type: string; text?: string }[] }>();
      return (data.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
    }

    const base = provider === "openai" ? "https://api.openai.com/v1" : "https://openrouter.ai/api/v1";
    const response = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [{ role: "system", content: system }, ...turns.map((t) => ({ role: t.role, content: t.text }))],
        response_format: { type: "json_object" },
      }),
      signal,
    });
    await assertOk(response);
    const data = await response.json<{ choices?: { message?: { content?: string } }[] }>();
    return data.choices?.[0]?.message?.content ?? "";
  } catch (error) {
    if (error instanceof AiError) throw error;
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new AiError("timeout", "Model nie odpowiedział na czas.");
    }
    throw new AiError("other", error instanceof Error ? error.message : String(error));
  }
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
