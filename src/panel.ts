/** Mini App: uwierzytelnienie podpisem Telegrama, bez cookies i kluczy w przeglądarce. */
import { sameSecret } from "./crypto";
import { DAY, isValidTz, partsIn, reminderAt } from "./time";
import { TONES, USES } from "./texts";
import type { Tone } from "./prompts";
import type { Holiday } from "./holidays";

export class PanelError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export type PanelAction =
  | { action: "view" }
  | { action: "taskAdd"; text: string }
  | { action: "taskDone"; listId: number; index: number; hash: string }
  | { action: "reminderCreate"; text: string; local: string }
  | { action: "reminderMove"; id: number; local: string }
  | { action: "reminderDelete"; id: number }
  | { action: "reminderShow"; id: number }
  /** `use`, `digest` i `titles` pomijają panele otwarte przed ich dodaniem: wtedy zostają bez zmian. `digest`: godzina planu dnia albo null. */
  | { action: "settings"; name: string; tone: Tone | ""; tz: string; use?: string; digest?: number | null; titles?: boolean };

export interface PanelSnapshot {
  tz: string;
  name: string;
  tone: Tone | "";
  use: string;
  digest: number | null;
  status: string;
  listId: number | null;
  listAvailable: boolean;
  tasks: { text: string; index: number; hash: string }[];
  /** Czy ktoś włączył tytuły. Bez tego `title` nigdy nie przychodzi. */
  titles: boolean;
  reminders: { id: number; at: number; when: string; title?: string }[];
  /** Polskie święta od dziś na 400 dni, do zaznaczenia w kalendarzu. */
  holidays: Holiday[];
}
export type PanelResult = { data: PanelSnapshot } | { error: string; status: number };

const encoder = new TextEncoder();
async function hmac(keyBytes: Uint8Array, value: string) {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

/** HMAC Telegrama obejmuje każde podpisane pole poza hash, także signature. */
export async function panelUser(initData: string, token: string, now = Date.now()): Promise<number> {
  if (!token) throw new PanelError(503, "Panel jest chwilowo niedostępny.");
  if (!initData || initData.length > 8192) throw new PanelError(401, "Otwórz panel ponownie w Telegramie.");
  const fields = new URLSearchParams(initData);
  const keys = [...fields.keys()];
  if (new Set(keys).size !== keys.length) throw new PanelError(401, "Niepoprawny podpis Telegrama.");
  const hash = fields.get("hash") ?? "";
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new PanelError(401, "Niepoprawny podpis Telegrama.");
  fields.delete("hash");
  const data = [...fields.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, value]) => `${key}=${value}`).join("\n");
  const secret = await hmac(encoder.encode("WebAppData"), token);
  const expected = [...await hmac(secret, data)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  if (!sameSecret(hash, expected)) throw new PanelError(401, "Niepoprawny podpis Telegrama.");
  const date = fields.get("auth_date") ?? "";
  const age = now / 1000 - Number(date);
  if (!/^\d+$/.test(date) || age < -30 || age > 3600) throw new PanelError(401, "Sesja wygasła. Otwórz panel ponownie w Telegramie.");
  let user;
  try { user = JSON.parse(fields.get("user") ?? "null"); } catch { /* błędne podpisane dane */ }
  if (!user || !Number.isSafeInteger(user.id) || user.id <= 0 || user.is_bot) throw new PanelError(401, "Brak konta Telegrama.");
  return user.id;
}

export function panelAction(value: unknown): PanelAction {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PanelError(400, "Niepoprawne polecenie.");
  const b = value as Record<string, unknown>;
  const id = (x: unknown): x is number => Number.isSafeInteger(x) && (x as number) > 0;
  const local = (x: unknown): x is string => typeof x === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(x);
  const text = (x: unknown, max: number): x is string => typeof x === "string" && !!x.trim() && x.length <= max;
  switch (b.action) {
    case "view": return { action: "view" };
    case "taskAdd": if (text(b.text, 1000)) return { action: b.action, text: b.text.trim() }; break;
    case "taskDone":
      if (id(b.listId) && Number.isInteger(b.index) && (b.index as number) >= 0 && (b.index as number) < 40 && typeof b.hash === "string" && /^[a-z0-9]{1,7}$/.test(b.hash)) {
        return { action: b.action, listId: b.listId, index: b.index as number, hash: b.hash };
      }
      break;
    case "reminderCreate": if (text(b.text, 500) && local(b.local)) return { action: b.action, text: b.text.trim(), local: b.local }; break;
    case "reminderMove": if (id(b.id) && local(b.local)) return { action: b.action, id: b.id, local: b.local }; break;
    case "reminderDelete":
    case "reminderShow": if (id(b.id)) return { action: b.action, id: b.id }; break;
    case "settings":
      if (typeof b.name === "string" && b.name.length <= 30 && (b.name.trim() === "" || /^[\p{L}][\p{L}\p{M} .'-]*$/u.test(b.name.trim())) && typeof b.tz === "string" && b.tz.length <= 100 && isValidTz(b.tz) && (b.tone === "" || TONES.some(([tone]) => tone === b.tone)) && (b.use === undefined || b.use === "" || (typeof b.use === "string" && Object.hasOwn(USES, b.use))) && (b.digest === undefined || b.digest === null || (Number.isInteger(b.digest) && (b.digest as number) >= 0 && (b.digest as number) <= 23)) && (b.titles === undefined || typeof b.titles === "boolean")) {
        return {
          action: b.action, name: b.name.trim(), tz: b.tz, tone: b.tone as Tone | "",
          ...(b.use === undefined ? {} : { use: b.use as string }),
          ...(b.digest === undefined ? {} : { digest: b.digest as number | null }),
          ...(b.titles === undefined ? {} : { titles: b.titles as boolean }),
        };
      }
      break;
  }
  throw new PanelError(400, "Sprawdź wpisane dane.");
}

/** Nie pozwalamy przeskoczyć na inny dzień ani na nieistniejącą godzinę przy zmianie czasu. */
export function panelReminderAt(local: string, now: number, tz: string): number {
  const at = reminderAt(local, now, tz);
  if (!at || at < now + 30_000 || at > now + 400 * DAY) throw new PanelError(400, "Wybierz przyszły termin, najdalej za 400 dni.");
  const p = partsIn(at, tz);
  const pad = (value: number) => String(value).padStart(2, "0");
  if (`${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}` !== local) throw new PanelError(400, "Ta data lub godzina nie istnieje w Twojej strefie. Wybierz inną.");
  return at;
}

export async function panelApi(request: Request, env: Env): Promise<Response> {
  const respond = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
  if (request.method !== "POST") return new Response("Użyj POST.", { status: 405, headers: { allow: "POST", "cache-control": "no-store" } });
  try {
    if (request.headers.get("origin") && request.headers.get("origin") !== new URL(request.url).origin) throw new PanelError(403, "Brak dostępu.");
    if (!request.headers.get("content-type")?.startsWith("application/json")) throw new PanelError(415, "Użyj JSON.");
    const initData = request.headers.get("authorization")?.replace(/^tma /, "") ?? "";
    const chatId = await panelUser(initData, env.TELEGRAM_BOT_TOKEN);
    // Limitujemy odczyt strumienia, nie tylko zadeklarowany Content-Length.
    const reader = request.body?.getReader();
    let raw = "";
    let size = 0;
    const decoder = new TextDecoder();
    if (reader) {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 4096) { await reader.cancel(); throw new PanelError(413, "Za dużo danych."); }
        raw += decoder.decode(chunk.value, { stream: true });
      }
      raw += decoder.decode();
    }
    let value;
    try { value = JSON.parse(raw); } catch { throw new PanelError(400, "Niepoprawne polecenie."); }
    const action = panelAction(value);
    // Adres panelu do przycisku w planie dnia, który wysyła alarm (bez żądania z Telegrama).
    const result = await env.CHAT.get(env.CHAT.idFromName(String(chatId))).panel(chatId, action, new URL(request.url).origin);
    if ("error" in result) return respond({ error: result.error }, result.status);
    return respond(result);
  } catch (error) {
    if (error instanceof PanelError) return respond({ error: error.message }, error.status);
    console.error("panel failed");
    return respond({ error: "Nie udało się połączyć z Ottem. Spróbuj ponownie." }, 503);
  }
}
