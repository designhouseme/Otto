import { describe, expect, it, vi } from "vitest";
import { panelAction, panelApi, panelReminderAt, panelUser } from "../src/panel";

const TOKEN = "123456:test-token";
const NOW = Date.UTC(2026, 9, 8, 10);
// Generator testowych sesji. Stały wektor poniżej został wyliczony niezależnie w Node.
async function signed(fields: Record<string, string> = {}, now = NOW) {
  const params = new URLSearchParams({ auth_date: String(Math.floor(now / 1000)), user: JSON.stringify({ id: 123456789, first_name: "Ola" }), query_id: "test-query", ...fields });
  const data = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("\n");
  const encoder = new TextEncoder();
  const seed = await crypto.subtle.importKey("raw", encoder.encode("WebAppData"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const secret = await crypto.subtle.sign("HMAC", seed, encoder.encode(TOKEN));
  const key = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  params.set("hash", [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join(""));
  return params.toString();
}

describe("podpis Mini App", () => {
  it("potwierdza konto i obejmuje nowe pole signature", async () => {
    // Stały wektor wyliczony niezależnie, poza implementacją panelu.
    const fixture = 'auth_date=1791453600&user=%7B%22id%22%3A123456789%2C%22first_name%22%3A%22Ola%22%7D&query_id=test-query&hash=e15d46e02aededb8024bcbbcc1f5c37ea276fe94d24fe08b7960483ed70bb867';
    expect(await panelUser(fixture, TOKEN, NOW)).toBe(123456789);
    expect(await panelUser(await signed(), TOKEN, NOW)).toBe(123456789);
    expect(await panelUser(await signed({ signature: "telegram-ed25519-signature" }), TOKEN, NOW)).toBe(123456789);
  });
  it("odrzuca zmienione konto, zły token i duplikaty pól", async () => {
    const params = new URLSearchParams(await signed());
    params.set("user", JSON.stringify({ id: 999999999 }));
    await expect(panelUser(params.toString(), TOKEN, NOW)).rejects.toMatchObject({ status: 401 });
    await expect(panelUser(await signed(), "another-bot", NOW)).rejects.toMatchObject({ status: 401 });
    await expect(panelUser(`${await signed()}&user=${encodeURIComponent('{"id":999}')}`, TOKEN, NOW)).rejects.toMatchObject({ status: 401 });
  });
  it("odrzuca wygasłą sesję, czas z przyszłości i nieprawidłowe ID", async () => {
    await expect(panelUser(await signed({}, NOW - 3601_000), TOKEN, NOW)).rejects.toMatchObject({ status: 401 });
    await expect(panelUser(await signed({}, NOW + 60_000), TOKEN, NOW)).rejects.toMatchObject({ status: 401 });
    for (const id of [-1, 0, 1.5, "123", Number.MAX_SAFE_INTEGER + 1]) {
      await expect(panelUser(await signed({ user: JSON.stringify({ id }) }), TOKEN, NOW)).rejects.toMatchObject({ status: 401 });
    }
    await expect(panelUser(await signed({ user: "{" }), TOKEN, NOW)).rejects.toMatchObject({ status: 401 });
  });
  it("nie otwiera dostępu w dry-run bez podpisu", async () => {
    await expect(panelUser("", TOKEN, NOW)).rejects.toMatchObject({ status: 401 });
    await expect(panelUser(await signed(), "", NOW)).rejects.toMatchObject({ status: 503 });
  });
});

describe("polecenia panelu", () => {
  it("usuwa pola wskazujące cudze konto i waliduje ustawienia", () => {
    expect(panelAction({ action: "view", chatId: 999 })).toEqual({ action: "view" });
    expect(panelAction({ action: "settings", name: " Ola ", tone: "technical", tz: "Europe/Warsaw" })).toEqual({ action: "settings", name: "Ola", tone: "technical", tz: "Europe/Warsaw" });
    for (const b of [null, [], { action: "wipe" }, { action: "taskAdd", text: " " }, { action: "reminderDelete", id: "1" }, { action: "taskDone", listId: 1, index: -1, hash: "abc" }, { action: "settings", name: "Ola", tone: "unknown", tz: "Europe/Warsaw" }, { action: "settings", name: "Ola", tone: "warm", tz: "Unknown/Zone" }]) {
      expect(() => panelAction(b)).toThrow();
    }
  });
  it("liczy czas w strefie konta, odrzuca nieistniejące daty i godziny", () => {
    expect(panelReminderAt("2026-10-09T09:00", NOW, "Europe/Warsaw")).toBe(Date.UTC(2026, 9, 9, 7));
    expect(panelReminderAt("2026-10-09T09:00", NOW, "America/New_York")).toBe(Date.UTC(2026, 9, 9, 13));
    expect(() => panelReminderAt("2026-10-01T09:00", NOW, "Europe/Warsaw")).toThrow();
    expect(() => panelReminderAt("2027-02-31T09:00", NOW, "Europe/Warsaw")).toThrow();
    expect(() => panelReminderAt("2027-03-28T02:30", NOW, "Europe/Warsaw")).toThrow();
    expect(() => panelReminderAt("2029-10-09T09:00", NOW, "Europe/Warsaw")).toThrow();
  });
});

describe("API panelu", () => {
  function environment() {
    const panel = vi.fn(async () => ({ data: { tasks: [], reminders: [] } }));
    const idFromName = vi.fn((id: string) => id);
    const env = { TELEGRAM_BOT_TOKEN: TOKEN, DEV_DRY_RUN: "1", CHAT: { idFromName, get: () => ({ panel }) } } as unknown as Env;
    return { env, panel, idFromName };
  }
  async function request(body: unknown, auth?: string, headers: Record<string, string> = {}) {
    return new Request("https://otto.test/api/panel", { method: "POST", headers: { "content-type": "application/json", authorization: `tma ${auth ?? await signed({}, Date.now())}`, ...headers }, body: JSON.stringify(body) });
  }
  it("kieruje wyłącznie do obiektu podpisanego użytkownika", async () => {
    const { env, panel, idFromName } = environment();
    const result = await panelApi(await request({ action: "view", chatId: 999 }), env);
    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect(idFromName).toHaveBeenCalledWith("123456789");
    expect(panel).toHaveBeenCalledWith(123456789, { action: "view" });
  });
  it("blokuje fałszywy podpis, obcy origin, duże body i błędny JSON", async () => {
    const { env, panel } = environment();
    expect((await panelApi(await request({ action: "view" }, "bad"), env)).status).toBe(401);
    expect((await panelApi(await request({ action: "view" }, undefined, { origin: "https://other.test" }), env)).status).toBe(403);
    expect((await panelApi(await request({ action: "taskAdd", text: "a".repeat(5000) }), env)).status).toBe(413);
    const bad = new Request("https://otto.test/api/panel", { method: "POST", headers: { "content-type": "application/json", authorization: `tma ${await signed({}, Date.now())}` }, body: "{" });
    expect((await panelApi(bad, env)).status).toBe(400);
    expect((await panelApi(new Request("https://otto.test/api/panel"), env)).status).toBe(405);
    expect(panel).not.toHaveBeenCalled();
  });
  it("przekazuje konflikt z obiektu rozmowy", async () => {
    const { env, panel } = environment();
    panel.mockResolvedValueOnce({ error: "Lista się zmieniła.", status: 409 } as never);
    const result = await panelApi(await request({ action: "view" }), env);
    expect(result.status).toBe(409);
    expect(await result.json()).toEqual({ error: "Lista się zmieniła." });
  });
});
