/**
 * Cienki klient Bot API. Tylko to, czego Otto używa, bez frameworka.
 * Z DEV_DRY_RUN=1 nic nie wychodzi do Telegrama: wywołania lądują w konsoli,
 * a odpowiedzi są udawane na tyle wiernie, żeby dało się przejść całe ścieżki lokalnie.
 */

export interface TgUser {
  id: number;
  first_name: string;
  username?: string;
  language_code?: string;
}

export interface TgChat {
  id: number;
  type: string;
}

export interface Message {
  message_id: number;
  date: number;
  chat: TgChat;
  from?: TgUser;
  text?: string;
  caption?: string;
  reply_to_message?: Message;
  pinned_message?: Message;
}

export interface CallbackQuery {
  id: string;
  from: TgUser;
  message?: Message;
  data?: string;
}

export interface Update {
  update_id: number;
  message?: Message;
  callback_query?: CallbackQuery;
}

export interface Button {
  text: string;
  callback_data?: string;
  url?: string;
  copy_text?: { text: string };
}

export interface Keyboard {
  inline_keyboard: Button[][];
}

export class TgError extends Error {
  constructor(
    readonly method: string,
    readonly code: number,
    readonly description: string,
  ) {
    super(`${method} ${code}: ${description}`);
  }

  /** Edycja bez zmian treści: Telegram zwraca błąd, a dla nas to sukces. */
  get notModified() {
    return this.description.includes("message is not modified");
  }
}

export function telegram(env: Env) {
  return new Telegram(env.TELEGRAM_BOT_TOKEN, env.DEV_DRY_RUN === "1");
}

export class Telegram {
  constructor(
    private readonly token: string | undefined,
    private readonly dry: boolean,
  ) {}

  async call<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (this.dry) return dryRun(method, params) as T;
    if (!this.token) throw new Error("Brak TELEGRAM_BOT_TOKEN.");
    const response = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(15_000),
    });
    return this.unwrap<T>(method, response);
  }

  /** Wysyłka z plikiem (multipart), np. zdjęcie profilowe bota. */
  async upload<T = unknown>(method: string, fields: Record<string, string>, files: Record<string, Blob>): Promise<T> {
    if (this.dry) return dryRun(method, fields) as T;
    if (!this.token) throw new Error("Brak TELEGRAM_BOT_TOKEN.");
    const form = new FormData();
    for (const [name, value] of Object.entries(fields)) form.append(name, value);
    for (const [name, blob] of Object.entries(files)) form.append(name, blob, name);
    const response = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(30_000),
    });
    return this.unwrap<T>(method, response);
  }

  send(chatId: number, text: string, extra: Record<string, unknown> = {}) {
    return this.call<Message>("sendMessage", {
      chat_id: chatId,
      text,
      link_preview_options: { is_disabled: true },
      ...extra,
    });
  }

  private async unwrap<T>(method: string, response: Response): Promise<T> {
    const data = await response
      .json<{ ok: boolean; result?: T; description?: string; error_code?: number }>()
      .catch(() => ({ ok: false, description: `HTTP ${response.status}` }) as { ok: false; description: string; error_code?: number; result?: T });
    if (!data.ok) throw new TgError(method, data.error_code ?? response.status, data.description ?? "");
    return data.result as T;
  }
}

// Udawany Telegram do lokalnych testów. Pamięta wysłane wiadomości i przypiętą,
// bo bez tego lista zadań (czytana z przypiętej wiadomości) nie dałaby się sprawdzić.
let nextId = 9000;
const sent = new Map<number, Message>();
const pinned = new Map<number, number>();

function dryRun(method: string, params: Record<string, unknown>): unknown {
  console.log(`[tg] ${method} ${JSON.stringify(params).slice(0, 2000)}`);
  const chatId = Number(params.chat_id);
  const chat = { id: chatId, type: "private" };
  switch (method) {
    case "sendMessage": {
      const reply = params.reply_parameters as { message_id: number } | undefined;
      const message: Message = {
        message_id: nextId++,
        date: Math.floor(Date.now() / 1000),
        chat,
        text: String(params.text ?? ""),
        ...(reply ? { reply_to_message: sent.get(reply.message_id) ?? { message_id: reply.message_id, date: 0, chat } } : {}),
      };
      sent.set(message.message_id, message);
      return message;
    }
    case "editMessageText": {
      const message = sent.get(Number(params.message_id));
      if (message) message.text = String(params.text ?? "");
      return message ?? true;
    }
    case "pinChatMessage":
      pinned.set(chatId, Number(params.message_id));
      return true;
    case "unpinAllChatMessages":
      pinned.delete(chatId);
      return true;
    case "getChat": {
      const id = pinned.get(chatId);
      return { ...chat, ...(id && sent.has(id) ? { pinned_message: sent.get(id) } : {}) };
    }
    case "getStickerSet":
      throw new TgError(method, 400, "Bad Request: STICKERSET_INVALID");
    default:
      return true;
  }
}
