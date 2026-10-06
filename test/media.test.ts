import { describe, expect, it } from "vitest";
import { MAX_AUDIO_SECONDS, attachmentOf, pickPhoto, toBase64 } from "../src/media";
import type { Message } from "../src/telegram";

const msg = (extra: Partial<Message>): Message => ({ message_id: 1, date: 0, chat: { id: 1, type: "private" }, ...extra });

describe("głosówki i zdjęcia", () => {
  it("głosówka", () => {
    expect(attachmentOf(msg({ voice: { file_id: "v", duration: 12, mime_type: "audio/ogg", file_size: 2000 } }))).toEqual({
      kind: "audio",
      fileId: "v",
      mime: "audio/ogg",
      label: "głosówka",
      seconds: 12,
      bytes: 2000,
    });
    // Telegram czasem nie podaje typu: głosówki są zawsze w OGG
    expect(attachmentOf(msg({ voice: { file_id: "v", duration: 3 } }))?.mime).toBe("audio/ogg");
  });

  it("zdjęcie: największe do 1600 px", () => {
    const photo = [
      { file_id: "s", width: 90, height: 60 },
      { file_id: "xl", width: 2560, height: 1707 },
      { file_id: "l", width: 1280, height: 853 },
    ];
    expect(attachmentOf(msg({ photo }))).toMatchObject({ kind: "image", fileId: "l", mime: "image/jpeg", label: "zdjęcie" });
    expect(pickPhoto([{ file_id: "xl", width: 2560, height: 1707 }]).file_id).toBe("xl");
  });

  it("obrazek wysłany jako plik tak, PDF i inne pliki nie", () => {
    expect(attachmentOf(msg({ document: { file_id: "d", mime_type: "image/png" } }))).toMatchObject({ kind: "image", mime: "image/png", label: "obrazek" });
    expect(attachmentOf(msg({ document: { file_id: "d", mime_type: "application/pdf" } }))).toBeNull();
    expect(attachmentOf(msg({ text: "hej" }))).toBeNull();
  });

  it("plik dźwiękowy tylko w znanym formacie", () => {
    expect(attachmentOf(msg({ audio: { file_id: "a", duration: 30, mime_type: "audio/mpeg" } }))).toMatchObject({ kind: "audio", label: "nagranie" });
    expect(attachmentOf(msg({ audio: { file_id: "a", duration: 30, mime_type: "audio/x-ms-wma" } }))).toBeNull();
  });

  it("limit głosówki mieści się w budżecie czasu", () => {
    expect(MAX_AUDIO_SECONDS).toBeLessThanOrEqual(180);
  });

  it("base64 bez Buffer, także dla dużych plików", () => {
    expect(toBase64(new TextEncoder().encode("Otto"))).toBe("T3R0bw==");
    expect(toBase64(new Uint8Array())).toBe("");
    // 300 kB w obie strony: każdy bajt wraca na swoje miejsce, bez przepełnienia stosu
    const bytes = new Uint8Array(300_000).map((_, i) => (i * 7) % 256);
    const back = Uint8Array.from(atob(toBase64(bytes)), (c) => c.charCodeAt(0));
    expect(back).toEqual(bytes);
  });
});
