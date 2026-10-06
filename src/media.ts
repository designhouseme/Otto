/**
 * Głosówki, zdjęcia i grafiki: co z wiadomości wysyłamy do modelu i w jakich granicach.
 * Pliku nigdzie nie zapisujemy: pobieramy go z Telegrama tylko na czas jednego zapytania do modelu.
 */

import type { Message, TgPhotoSize } from "./telegram";

/** Najdłuższa głosówka. Pobranie i model muszą się zmieścić w ok. 30 s, które Worker ma po odpowiedzi Telegramowi. */
export const MAX_AUDIO_SECONDS = 180;
/** Największy plik. Zapytanie do Gemini ma limit 20 MB razem z instrukcją, a base64 dokłada jedną trzecią. */
export const MAX_MEDIA_BYTES = 8 * 1024 * 1024;

export interface Attachment {
  kind: "image" | "audio";
  fileId: string;
  mime: string;
  /** Jak oznaczyć to w wiadomości dla modelu: „głosówka”, „zdjęcie”… */
  label: string;
  seconds?: number;
  bytes?: number;
}

// Formaty, które przyjmują wszyscy obsługiwani dostawcy (zdjęcia) albo Gemini i transkrypcja OpenAI (dźwięk).
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const AUDIO_TYPES = new Set(["audio/ogg", "audio/mpeg", "audio/mp3", "audio/mp4", "audio/x-m4a", "audio/m4a", "audio/aac", "audio/wav", "audio/x-wav", "audio/flac"]);

export function attachmentOf(msg: Message): Attachment | null {
  if (msg.voice) {
    return { kind: "audio", fileId: msg.voice.file_id, mime: msg.voice.mime_type || "audio/ogg", label: "głosówka", seconds: msg.voice.duration, bytes: msg.voice.file_size };
  }
  if (msg.audio?.mime_type && AUDIO_TYPES.has(msg.audio.mime_type)) {
    return { kind: "audio", fileId: msg.audio.file_id, mime: msg.audio.mime_type, label: "nagranie", seconds: msg.audio.duration, bytes: msg.audio.file_size };
  }
  if (msg.photo?.length) {
    const photo = pickPhoto(msg.photo);
    return { kind: "image", fileId: photo.file_id, mime: "image/jpeg", label: "zdjęcie", bytes: photo.file_size };
  }
  if (msg.document?.mime_type && IMAGE_TYPES.has(msg.document.mime_type)) {
    return { kind: "image", fileId: msg.document.file_id, mime: msg.document.mime_type, label: "obrazek", bytes: msg.document.file_size };
  }
  return null;
}

/** Telegram daje kilka rozmiarów zdjęcia. Bierzemy największy do 1600 px: modelowi wystarczy, a mniej się pobiera i liczy. */
export function pickPhoto(sizes: TgPhotoSize[]): TgPhotoSize {
  const sorted = [...sizes].sort((a, b) => a.width * a.height - b.width * b.height);
  return sorted.filter((p) => Math.max(p.width, p.height) <= 1600).at(-1) ?? sorted[0];
}

/** base64 bez Buffer (Worker działa bez nodejs_compat). Po kawałku, bo String.fromCharCode(...cała tablica) przepełnia stos. */
export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
