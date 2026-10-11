import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Update } from "../src/telegram";

const fake = vi.hoisted(() => ({ nextId: 9000, calls: [] as { method: string; params: Record<string, unknown> }[] }));
vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    constructor(protected ctx: DurableObjectState, protected env: Env) {}
  },
}));
vi.mock("../src/telegram", async (original) => {
  const actual = await original<typeof import("../src/telegram")>();
  const call = async (method: string, params: Record<string, unknown>) => {
    fake.calls.push({ method, params });
    if (method === "sendMessage") return { message_id: fake.nextId++, date: 0, chat: { id: params.chat_id, type: "private" }, text: params.text };
    if (method === "getChat") return {};
    return true;
  };
  return { ...actual, telegram: () => ({ call, send: (chat_id: number, text: string, extra = {}) => call("sendMessage", { chat_id, text, ...extra }) }) };
});
import { Chat } from "../src/chat";

const NOW = Date.UTC(2026, 9, 8, 10);
const CHAT = 123456;
function fixture() {
  let state: Record<string, unknown> = { chatId: CHAT, tz: "Europe/Warsaw", claimed: true, freeLeft: 10, lastUpdate: 0 };
  const reminders: { id: number; msg_id: number; at: number }[] = [];
  const storage = {
    get: async () => structuredClone(state),
    put: async (_key: string, value: Record<string, unknown>) => { state = structuredClone(value); },
    setAlarm: vi.fn(async () => {}), deleteAlarm: vi.fn(async () => {}),
    sql: { exec(query: string, ...args: number[]) {
      let rows: unknown[] = [];
      if (query.startsWith("INSERT INTO reminders")) reminders.push({ id: reminders.length + 1, msg_id: args[0], at: args[1] });
      if (query.startsWith("SELECT MIN")) rows = [{ at: reminders.length ? Math.min(...reminders.map((r) => r.at)) : null }];
      if (query.startsWith("SELECT id")) rows = reminders;
      return { toArray: () => rows, one: () => rows[0] };
    } },
  };
  const chat = new Chat({ storage } as unknown as DurableObjectState, { DEFAULT_TZ: "Europe/Warsaw" } as Env);
  let updateId = 0;
  const send = (text: string, replyId?: number) => chat.handle({ update_id: ++updateId, message: { message_id: 100 + updateId, date: NOW / 1000, chat: { id: CHAT, type: "private" }, text, ...(replyId ? { reply_to_message: { message_id: replyId, date: 0, chat: { id: CHAT, type: "private" } } } : {}) } }, "https://otto.test");
  const choose = (data: string) => chat.handle({ update_id: ++updateId, callback_query: { id: String(updateId), from: { id: CHAT, first_name: "Test" }, data, message: { message_id: 88, date: 0, chat: { id: CHAT, type: "private" } } } } satisfies Update, "https://otto.test");
  return { chat, send, choose, reminders, storage, state: () => state, pending: () => state.pendingReminder as { target: number; promptId: number; expires: number } | undefined };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); fake.nextId = 9000; fake.calls.length = 0; });
afterEach(() => vi.useRealTimers());

describe("własny termin bez AI", () => {
  it("otwiera odpowiedź i przypomina o źródle, zamiast o pytaniu bota", async () => {
    const f = fixture();
    await f.choose("c:55");
    expect(fake.calls.find((c) => c.method === "sendMessage")?.params).toMatchObject({ reply_parameters: { message_id: 55 }, reply_markup: { force_reply: true } });
    await f.send("za 45 minut", f.pending()!.promptId);
    expect(f.reminders).toEqual([{ id: 1, msg_id: 55, at: NOW + 45 * 60_000 }]);
    expect(f.pending()).toBeUndefined();
    expect(f.state().freeLeft).toBe(10);
    expect(f.storage.setAlarm).toHaveBeenCalledWith(NOW + 45 * 60_000);
  });
  it("nie przechwytuje zwykłej wiadomości i ponawia pytanie przy nieczytelnym terminie", async () => {
    const f = fixture();
    await f.choose("c:55");
    const first = f.pending()!;
    await f.send("za 45 minut");
    expect(f.reminders).toHaveLength(0);
    expect(f.pending()).toEqual(first);
    await f.send("nie wiem", first.promptId);
    expect(f.pending()!.target).toBe(55);
    expect(f.pending()!.promptId).not.toBe(first.promptId);
    await f.send("jutro o 9", f.pending()!.promptId);
    expect(f.reminders[0]).toMatchObject({ msg_id: 55, at: Date.UTC(2026, 9, 9, 7) });
  });
  it("anuluje i odrzuca odpowiedź po wygaśnięciu", async () => {
    const f = fixture();
    await f.choose("c:55");
    await f.send("/anuluj");
    expect(f.pending()).toBeUndefined();
    await f.choose("c:66");
    const prompt = f.pending()!.promptId;
    vi.setSystemTime(NOW + 16 * 60_000);
    await f.send("za godzinę", prompt);
    expect(f.reminders).toHaveLength(0);
    expect(f.pending()).toBeUndefined();
    expect(fake.calls.at(-1)?.params.text).toContain("wygasł");
  });
  it("odrzuca niepoprawne identyfikatory źródła", async () => {
    const f = fixture();
    for (const data of ["c:0", "c:-55", "c:NaN", "c:1.5"]) await f.choose(data);
    expect(f.pending()).toBeUndefined();
    expect(fake.calls.every((c) => c.method === "answerCallbackQuery")).toBe(true);
  });
  it("otwiera panel przez przycisk Mini App", async () => {
    const f = fixture();
    await f.send("/panel");
    expect(fake.calls.at(-1)?.params).toMatchObject({ reply_markup: { inline_keyboard: [[{ style: "primary", web_app: { url: "https://otto.test/panel/" } }]] } });
  });
});

describe("powiązanie panelu z rozmową", () => {
  it("odmawia dostępu do cudzej rozmowy i nie zmienia ustawień", async () => {
    const f = fixture();
    expect(await f.chat.panel(CHAT + 1, { action: "settings", name: "Intruz", tz: "Europe/London", tone: "warm" })).toMatchObject({ status: 409 });
    expect(f.state().tz).toBe("Europe/Warsaw");
    expect(fake.calls).toHaveLength(0);
  });
  it("udostępnia tylko metadane i serializuje zmiany strefy", async () => {
    const f = fixture();
    await Promise.all([
      f.chat.panel(CHAT, { action: "settings", name: "Ola", tz: "Europe/London", tone: "technical" }),
      f.send("/strefa Europe/Warsaw"),
    ]);
    const result = await f.chat.panel(CHAT, { action: "view" });
    expect(result).toMatchObject({ data: { tz: "Europe/Warsaw", name: "Ola", tone: "technical" } });
    expect(JSON.stringify(result)).not.toContain("key");
  });
  it("odświeżenie panelu nie odpina nowszej wiadomości użytkownika", async () => {
    const f = fixture();
    const state = f.state();
    state.listId = 333;
    const result = await f.chat.panel(CHAT, { action: "view" });
    expect(result).toMatchObject({ data: { listId: 333, listAvailable: false, tasks: [] } });
    expect(fake.calls.every((c) => c.method === "getChat")).toBe(true);
  });
  it("ogranicza serię żądań panelu i ponownie pozwala po upływie okna", async () => {
    const f = fixture();
    for (let i = 0; i < 30; i++) expect(await f.chat.panel(CHAT, { action: "view" })).toHaveProperty("data");
    expect(await f.chat.panel(CHAT, { action: "view" })).toMatchObject({ status: 429 });
    vi.setSystemTime(NOW + 61_000);
    expect(await f.chat.panel(CHAT, { action: "view" })).toHaveProperty("data");
  });
});
