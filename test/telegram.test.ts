import { afterEach, describe, expect, it, vi } from "vitest";
import { Telegram } from "../src/telegram";

afterEach(() => vi.unstubAllGlobals());
describe("status myślenia", () => {
  it("wysyła tymczasowy szkic bez trwałej wiadomości", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => Response.json({ ok: true, result: true }));
    vi.stubGlobal("fetch", fetchMock);
    await new Telegram("test-token", false).thinking(123, 45);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/sendMessageDraft");
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({ chat_id: 123, draft_id: 45, text: "Otto myśli…" });
  });
  it("wraca do statusu pisania, jeśli API nie obsługuje szkiców", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ ok: false, error_code: 404, description: "Not Found" })).mockResolvedValueOnce(Response.json({ ok: true, result: true }));
    vi.stubGlobal("fetch", fetchMock);
    await new Telegram("test-token", false).thinking(123, 45);
    expect(String(fetchMock.mock.calls[1][0])).toContain("/sendChatAction");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ action: "typing" });
  });
  it("awaria obu statusów nie blokuje odpowiedzi", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(new Telegram("test-token", false).thinking(123, 45)).resolves.toBeUndefined();
  });
});
