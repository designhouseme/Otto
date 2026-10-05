/**
 * Rozmowa z Ottem na stronie. Krótkie odpowiedzi z Gemini Flash, z limitami:
 * na adres (hash IP, 12 pytań na 10 minut i 60 na dobę) i na całą stronę (SITE_DAILY_LIMIT na dobę).
 * Bez klucza, po limicie albo przy błędzie modelu odpowiadamy `{ fallback: true }` (status 200),
 * a przeglądarka przechodzi na gotowe odpowiedzi, więc Otto nigdy nie milknie.
 */

import { AiError, completeJson } from "./ai";
import { peppered } from "./crypto";
import { siteSystem, toSiteReply } from "./prompts";
import { DAY, MINUTE } from "./time";

interface AskBody {
  messages?: { role?: string; text?: string }[];
}

export async function ask(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method" }, 405);
  let body: AskBody;
  try {
    body = await request.json<AskBody>();
  } catch {
    return json({ error: "bad" }, 400);
  }
  const turns = (Array.isArray(body.messages) ? body.messages : [])
    .slice(-8)
    .filter((m) => typeof m.text === "string" && m.text.trim())
    .map((m) => ({ role: m.role === "otto" ? ("assistant" as const) : ("user" as const), text: String(m.text).slice(0, 500) }));
  // Pierwsza musi być od człowieka, ostatnia też.
  while (turns.length && turns[0].role !== "user") turns.shift();
  if (!turns.length || turns[turns.length - 1].role !== "user") return json({ error: "bad" }, 400);

  if (!env.GEMINI_API_KEY) return json({ fallback: true });

  const registry = env.REGISTRY.get(env.REGISTRY.idFromName("main"));
  const ip = await peppered(`ip:${request.headers.get("cf-connecting-ip") ?? "local"}`, env);
  if (!(await registry.hit(`ask:${ip}`, 10 * MINUTE, 12)) || !(await registry.hit(`ask-day:${ip}`, DAY, 60))) {
    return json({ fallback: true, reason: "limit" });
  }
  if (!(await registry.spend("site", Number(env.SITE_DAILY_LIMIT)))) return json({ fallback: true, reason: "pool" });

  try {
    const raw = await completeJson({
      provider: "gemini",
      key: env.GEMINI_API_KEY,
      model: env.GEMINI_MODEL,
      fallbackModel: env.GEMINI_FALLBACK_MODEL,
      system: siteSystem(Number(env.FREE_MESSAGES) || 10),
      turns,
      timeoutMs: 15_000,
    });
    const reply = toSiteReply(raw);
    if (!reply) throw new AiError("bad", "pusta odpowiedź");
    return json(reply);
  } catch (error) {
    await registry.refund("site").catch(() => {});
    console.error("ask failed", error instanceof AiError ? error.kind : "unknown");
    return json({ fallback: true, reason: "error" });
  }
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
