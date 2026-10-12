import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Telegram } from "../src/telegram";

const method = (call: unknown[]) => String(call[0]).split("/").at(-1);

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("status „pisze…”", () => {
  it("pokazuje status od razu, odnawia go co 4 s i kończy na odpowiedzi", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => Response.json({ ok: true, result: { message_id: 1 } }));
    vi.stubGlobal("fetch", fetchMock);
    const tg = new Telegram("test-token", false);
    tg.startTyping(123);
    expect(fetchMock.mock.calls.map(method)).toEqual(["sendChatAction"]);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({ chat_id: 123, action: "typing" });
    await vi.advanceTimersByTimeAsync(8_000);
    expect(fetchMock.mock.calls.map(method)).toEqual(["sendChatAction", "sendChatAction", "sendChatAction"]);
    await tg.send(123, "Gotowe");
    await vi.advanceTimersByTimeAsync(20_000);
    expect(fetchMock.mock.calls.map(method)).toEqual(["sendChatAction", "sendChatAction", "sendChatAction", "sendMessage"]);
  });
  it("wysyła odpowiedź dopiero po trwającym odświeżeniu statusu", async () => {
    let release!: () => void;
    const fetchMock = vi.fn((url: string) => url.endsWith("/sendChatAction")
      ? new Promise<Response>((resolve) => { release = () => resolve(Response.json({ ok: true, result: true })); })
      : Promise.resolve(Response.json({ ok: true, result: { message_id: 1 } })));
    vi.stubGlobal("fetch", fetchMock);
    const tg = new Telegram("test-token", false);
    tg.startTyping(123);
    const reply = tg.send(123, "Gotowe");
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock.mock.calls.map(method)).toEqual(["sendChatAction"]);
    release();
    await reply;
    expect(fetchMock.mock.calls.map(method)).toEqual(["sendChatAction", "sendMessage"]);
  });
  it("awaria statusu nie blokuje odpowiedzi, a stopTyping kończy odświeżanie", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/sendChatAction")) throw new Error("offline");
      return Response.json({ ok: true, result: { message_id: 1 } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const tg = new Telegram("test-token", false);
    tg.startTyping(123);
    await expect(tg.send(123, "Gotowe")).resolves.toMatchObject({ message_id: 1 });
    tg.startTyping(123);
    tg.stopTyping();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(fetchMock.mock.calls.map(method)).toEqual(["sendChatAction", "sendMessage", "sendChatAction"]);
  });
});
