/**
 * Jeden Otto = jeden obiekt na jedną rozmowę prywatną.
 *
 * Trzymamy tylko: numer czatu, strefę, licznik darmowych wiadomości, zaszyfrowany klucz,
 * numer przypiętej listy i przypomnienia jako (numer wiadomości, godzina).
 * Treść wiadomości zostaje w Telegramie: przypominając, Otto odpowiada na oryginał.
 *
 * Aktualizacje przetwarzamy po kolei (kolejka w pamięci), bo między wywołaniami
 * Telegrama obiekt może dostać kolejne zdarzenie i nadpisać stan.
 */

import { DurableObject } from "cloudflare:workers";
import { AiError, KEY_PATTERN, PROVIDER_NAMES, checkKey, completeJson, defaultModel, detectProvider, type Provider } from "./ai";
import { peppered, seal, sixDigits, unseal } from "./crypto";
import { sendCodeMail } from "./mail";
import { botSystem, toBotPlan } from "./prompts";
import type { BudgetKind } from "./registry";
import { MAX_TASKS, cleanTask, findTask, parseList, renderList, splitTasks } from "./tasks";
import { type Button, type CallbackQuery, type Keyboard, type Message, TgError, type Update, telegram } from "./telegram";
import { T, mask } from "./texts";
import { DAY, HOUR, MINUTE, eveningLabel, formatShort, formatWhen, isValidTz, localIsoToUtc, parseWhen, presetAt } from "./time";

interface State {
  chatId: number;
  tz: string;
  lastUpdate: number;
  freeLeft: number;
  claimed: boolean;
  key?: { provider: Provider; sealed: string; model?: string };
  awaiting?: "email" | "code" | "key";
  /** Mail w trakcie potwierdzania. Jawny adres tylko do wysłania kodu i do pytania o zgodę, potem znika. */
  mail?: { email: string; hash: string; code?: string; expires?: number; attempts?: number; at: number };
  mailSends: number[];
  listId?: number;
  manualCount: number;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MOOD_ORDER = ["neutral", "happy", "look", "wink", "wow", "think"] as const;
type Mood = (typeof MOOD_ORDER)[number];

export class Chat extends DurableObject<Env> {
  private tg = telegram(this.env);
  private sql: SqlStorage;
  private queue: Promise<unknown> = Promise.resolve();
  private origin = "";
  private stickers: string[] | null = null;
  private wiped = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.schema();
  }

  private schema() {
    this.sql.exec("CREATE TABLE IF NOT EXISTS reminders (id INTEGER PRIMARY KEY AUTOINCREMENT, msg_id INTEGER NOT NULL, at INTEGER NOT NULL)");
  }

  /** Wejście z Workera: jedna aktualizacja z webhooka. */
  handle(update: Update, origin: string) {
    this.origin = origin;
    return this.enqueue(() => this.process(update));
  }

  async alarm() {
    await this.enqueue(() => this.fire());
  }

  private enqueue(job: () => Promise<void>) {
    const run = this.queue.then(job, job);
    this.queue = run.catch(() => {});
    return run;
  }

  // ---- stan ----

  private async load(chatId?: number): Promise<State> {
    const saved = await this.ctx.storage.get<State>("state");
    return (
      saved ?? {
        chatId: chatId ?? 0,
        tz: this.env.DEFAULT_TZ,
        lastUpdate: 0,
        freeLeft: 0,
        claimed: false,
        mailSends: [],
        manualCount: 0,
      }
    );
  }

  private async process(update: Update) {
    const message = update.message;
    const query = update.callback_query;
    const chatId = message?.chat.id ?? query?.message?.chat.id ?? query?.from.id;
    if (!chatId) return;

    const s = await this.load(chatId);
    if (update.update_id <= s.lastUpdate) return; // Telegram ponowił dostarczenie
    s.lastUpdate = update.update_id;
    s.chatId = chatId;
    // Niedokończone potwierdzanie maila nie leży w nieskończoność.
    if (s.mail && Date.now() - s.mail.at > DAY) s.mail = undefined;
    this.wiped = false;

    try {
      if (message) await this.onMessage(s, message);
      else if (query) await this.onCallback(s, query);
    } catch (error) {
      console.error("update failed", error instanceof Error ? `${error.name}: ${error.message}` : "unknown");
      await this.tg.send(s.chatId, T.error).catch(() => {});
    } finally {
      if (!this.wiped) await this.ctx.storage.put("state", s);
    }
  }

  // ---- wiadomości ----

  private async onMessage(s: State, msg: Message) {
    if (msg.pinned_message) return;
    const text = (msg.text ?? msg.caption ?? "").trim();

    // Klucz API w treści: kasujemy wiadomość, zanim zrobimy cokolwiek innego.
    const key = text.match(KEY_PATTERN)?.[1];
    if (key) {
      await this.tg.call("deleteMessage", { chat_id: s.chatId, message_id: msg.message_id }).catch(() => {});
      return this.connectKey(s, key);
    }

    if (text.startsWith("/")) return this.command(s, msg, text);
    if (s.awaiting === "email" && text.includes("@")) return this.gotEmail(s, msg, text);
    if (s.awaiting === "code" && /^[\d\s-]{4,12}$/.test(text)) return this.gotCode(s, text);
    // Ktoś napisał coś innego niż mail albo klucz: wracamy do zwykłej rozmowy.
    // Na kod czekamy dalej, bo przychodzi z opóźnieniem i działa 15 minut.
    if (s.awaiting === "email" || s.awaiting === "key") s.awaiting = undefined;

    if (text && s.key) return this.ai(s, msg, text, "own");
    if (text && s.freeLeft > 0) return this.ai(s, msg, text, "free");
    return this.manual(s, msg, text);
  }

  private async command(s: State, msg: Message, text: string) {
    const head = text.split(/\s+/, 1)[0];
    const name = head.slice(1).split("@")[0].toLowerCase();
    const arg = text.slice(head.length).trim();
    if (name !== "anuluj" && s.awaiting) s.awaiting = undefined;

    switch (name) {
      case "start":
        return this.start(s);
      case "pomoc":
      case "help":
        return this.help(s);
      case "lista":
        return this.showList(s);
      case "dodaj":
        return this.addCommand(s, msg, arg);
      case "przypomnij":
        return this.remindCommand(s, msg, arg);
      case "przypomnienia":
        return this.showReminders(s);
      case "klucz":
        return this.keyCommand(s, arg);
      case "model":
        return this.modelCommand(s, arg);
      case "pakiet":
        return this.packCommand(s);
      case "strefa":
        return this.tzCommand(s, arg);
      case "anuluj":
        s.awaiting = undefined;
        if (s.mail?.code) s.mail = undefined;
        return this.say(s, T.cancelled);
      case "zapomnij":
        return this.say(s, T.forgetAsk, {
          reply_markup: { inline_keyboard: [[{ text: "Tak, usuń wszystko", callback_data: "wipe" }, { text: "Nie", callback_data: "keep" }]] },
        });
      default:
        return this.say(s, T.unknownCommand);
    }
  }

  private async start(s: State) {
    await this.sticker(s, "happy");
    const free = this.freeMessages();
    const rows: Button[][] = [];
    if (!s.claimed && this.env.GEMINI_API_KEY) rows.push([{ text: T.btnPack(free), callback_data: "pack" }]);
    rows.push([{ text: T.btnKey, callback_data: "key" }, { text: T.btnHow, callback_data: "help" }]);
    const line = s.key || s.freeLeft > 0 ? T.welcomeAi : !s.claimed && this.env.GEMINI_API_KEY ? T.welcomeOffer(free) : T.welcomeManual;
    return this.say(s, T.welcome(line), { reply_markup: { inline_keyboard: rows } });
  }

  private help(s: State) {
    const status = s.key
      ? `Klucz: ${PROVIDER_NAMES[s.key.provider]}, bez limitu.`
      : s.freeLeft > 0
        ? `Darmowe wiadomości AI: ${s.freeLeft}.`
        : "AI: wyłączone, działają przyciski.";
    return this.say(s, T.help(`${status} Strefa: ${s.tz}.`));
  }

  // ---- tryb ręczny ----

  private async manual(s: State, msg: Message, text: string, intro?: string) {
    const now = Date.now();
    const target = msg.message_id;
    const parsed = text ? parseWhen(text, now, s.tz) : null;
    const rows = this.reminderButtons("r", target, s, parsed);
    if (text) rows.push([{ text: T.btnList, callback_data: `l:${target}` }]);

    // Raz na jakiś czas przypominamy, że można więcej. Bez nachalności.
    s.manualCount += 1;
    if (s.manualCount === 1 || s.manualCount % 8 === 0) {
      if (!s.claimed && this.env.GEMINI_API_KEY) rows.push([{ text: T.btnPack(this.freeMessages()), callback_data: "pack" }]);
      else if (!s.key) rows.push([{ text: T.btnKey, callback_data: "key" }, { text: T.btnCompany, url: this.env.COMPANY_URL }]);
    }

    const lead = intro ?? (parsed ? T.manualParsed : text ? T.manualAsk : T.manualNoText);
    return this.say(s, lead, { reply_parameters: { message_id: target }, reply_markup: { inline_keyboard: rows } });
  }

  /** Przyciski z terminami. `kind` r = nowe przypomnienie, z = drzemka. */
  private reminderButtons(kind: "r" | "z", target: number, s: State, parsed: number | null = null): Button[][] {
    const now = Date.now();
    const rows: Button[][] = [];
    if (parsed) rows.push([{ text: `⏰ ${capitalize(formatWhen(parsed, now, s.tz))}`, callback_data: `${kind}:${target}:a${Math.floor(parsed / 1000)}` }]);
    if (kind === "z") {
      rows.push([
        { text: "+15 min", callback_data: `z:${target}:m15` },
        { text: "+1 h", callback_data: `z:${target}:h1` },
        { text: "Jutro 9:00", callback_data: `z:${target}:j9` },
      ]);
      rows.push([{ text: T.done, callback_data: "ok" }]);
      return rows;
    }
    rows.push([
      { text: "Za godzinę", callback_data: `r:${target}:h1` },
      { text: "Za 3 godziny", callback_data: `r:${target}:h3` },
    ]);
    rows.push([
      { text: eveningLabel(now, s.tz), callback_data: `r:${target}:e18` },
      { text: "Jutro 9:00", callback_data: `r:${target}:j9` },
      { text: "Za tydzień", callback_data: `r:${target}:w1` },
    ]);
    return rows;
  }

  // ---- AI ----

  private async ai(s: State, msg: Message, text: string, mode: "own" | "free") {
    const env = this.env;
    if (mode === "free") {
      if (!env.GEMINI_API_KEY) return this.manual(s, msg, text);
      if (!(await this.registry().spend("bot", Number(env.DAILY_FREE_LIMIT)))) return this.manual(s, msg, text, T.poolEmpty);
      s.freeLeft -= 1;
    }
    this.tg.call("sendChatAction", { chat_id: s.chatId, action: "typing" }).catch(() => {});

    const list = await this.readList(s);
    const replyTo = msg.reply_to_message?.text ?? msg.reply_to_message?.caption;
    let plan;
    try {
      const call =
        mode === "own" && s.key
          ? {
              provider: s.key.provider,
              key: await unseal(s.key.sealed, env.KEY_SECRET ?? "", String(s.chatId)),
              model: s.key.model ?? defaultModel(s.key.provider, env),
              fallbackModel: s.key.provider === "gemini" && !s.key.model ? env.GEMINI_FALLBACK_MODEL : undefined,
            }
          : { provider: "gemini" as const, key: env.GEMINI_API_KEY ?? "", model: env.GEMINI_MODEL, fallbackModel: env.GEMINI_FALLBACK_MODEL };
      const raw = await completeJson({
        ...call,
        system: botSystem(Date.now(), s.tz, list.tasks, replyTo),
        turns: [{ role: "user", text: text.slice(0, 2000) }],
        timeoutMs: 20_000,
      });
      plan = toBotPlan(raw);
    } catch (error) {
      if (mode === "free") {
        s.freeLeft += 1;
        await this.refund("bot");
      }
      console.error("ai failed", error instanceof AiError ? error.kind : "unknown");
      const intro = error instanceof AiError && error.kind === "auth" && mode === "own" ? T.keyBroken : T.aiFailed;
      return this.manual(s, msg, text, intro);
    }

    const now = Date.now();
    const target = msg.reply_to_message?.message_id ?? msg.message_id;
    const lines: string[] = [];
    for (const local of plan.reminders) {
      const at = localIsoToUtc(local, s.tz);
      if (!at || at < now + 30_000 || at > now + 400 * DAY) continue;
      await this.addReminder(target, at);
      lines.push(T.reminderSet(formatWhen(at, now, s.tz)));
    }

    if (plan.add.length || plan.done.length) {
      const kept = list.tasks.filter((_, i) => !plan.done.includes(i + 1));
      const added = plan.add.map(cleanTask).filter(Boolean);
      const tasks = [...kept, ...added].slice(0, MAX_TASKS);
      await this.writeList(s, tasks, list.ok);
      if (added.length) lines.push(`📋 Dopisane do listy (${tasks.length}).`);
      if (kept.length < list.tasks.length) lines.push(`✓ Odhaczone: ${list.tasks.length - kept.length}.`);
    }

    let body = [plan.reply, lines.join("\n")].filter(Boolean).join("\n\n") || "👌";
    let keyboard: Keyboard | undefined;
    if (mode === "free" && s.freeLeft === 0 && !s.key) {
      body += `\n\n${T.lastFree}`;
      keyboard = {
        inline_keyboard: [
          [{ text: T.btnManual, callback_data: "help" }],
          [{ text: T.btnKey, callback_data: "key" }, { text: T.btnCompany, url: env.COMPANY_URL }],
        ],
      };
    } else if (mode === "free" && s.freeLeft <= 2) {
      body += `\n\n${T.fewLeft(s.freeLeft)}`;
    }
    return this.say(s, body, {
      reply_parameters: { message_id: msg.message_id, allow_sending_without_reply: true },
      ...(keyboard ? { reply_markup: keyboard } : {}),
    });
  }

  // ---- lista zadań (przypięta wiadomość) ----

  /**
   * Czyta listę z przypiętej wiadomości. getChat zwraca tylko najnowszą przypiętą,
   * więc jeśli ktoś przypiął w tym czacie coś nowszego, odpinamy wszystko i przypinamy listę z powrotem.
   */
  private async readList(s: State): Promise<{ tasks: string[]; ok: boolean }> {
    if (!s.listId) return { tasks: [], ok: false };
    const chat_id = s.chatId;
    let pinned = (await this.tg.call<{ pinned_message?: Message }>("getChat", { chat_id })).pinned_message;
    if (pinned?.message_id !== s.listId) {
      try {
        await this.tg.call("unpinAllChatMessages", { chat_id });
        await this.tg.call("pinChatMessage", { chat_id, message_id: s.listId, disable_notification: true });
        pinned = (await this.tg.call<{ pinned_message?: Message }>("getChat", { chat_id })).pinned_message;
      } catch {
        pinned = undefined;
      }
    }
    if (pinned?.message_id === s.listId) return { tasks: parseList(pinned.text ?? ""), ok: true };
    s.listId = undefined; // lista usunięta: następny zapis zacznie nową
    return { tasks: [], ok: false };
  }

  private async writeList(s: State, tasks: string[], current: boolean) {
    const { text, reply_markup } = renderList(tasks);
    if (s.listId && current) {
      try {
        await this.tg.call("editMessageText", { chat_id: s.chatId, message_id: s.listId, text, reply_markup });
        return;
      } catch (error) {
        if (error instanceof TgError && error.notModified) return;
      }
    }
    const message = await this.tg.send(s.chatId, text, { reply_markup });
    await this.tg.call("pinChatMessage", { chat_id: s.chatId, message_id: message.message_id, disable_notification: true }).catch(() => {});
    s.listId = message.message_id;
  }

  /** /lista: świeża kopia na dole czatu, stara znika albo dostaje dopisek. */
  private async showList(s: State) {
    const list = await this.readList(s);
    const old = s.listId;
    const { text, reply_markup } = renderList(list.tasks);
    const message = await this.tg.send(s.chatId, text, { reply_markup });
    await this.tg.call("pinChatMessage", { chat_id: s.chatId, message_id: message.message_id, disable_notification: true }).catch(() => {});
    s.listId = message.message_id;
    if (old) {
      await this.tg.call("unpinChatMessage", { chat_id: s.chatId, message_id: old }).catch(() => {});
      await this.tg
        .call("deleteMessage", { chat_id: s.chatId, message_id: old })
        .catch(() => this.edit(s, old, T.oldListNote).catch(() => {}));
    }
  }

  private async addCommand(s: State, msg: Message, arg: string) {
    const source = arg || msg.reply_to_message?.text || msg.reply_to_message?.caption || "";
    const items = arg ? splitTasks(arg) : [cleanTask(source)].filter(Boolean);
    if (!items.length) return this.say(s, T.addUsage);
    const list = await this.readList(s);
    const tasks = [...list.tasks, ...items].slice(0, MAX_TASKS);
    await this.writeList(s, tasks, list.ok);
    await this.react(s, msg.message_id, "👌");
  }

  // ---- przypomnienia ----

  private async remindCommand(s: State, msg: Message, arg: string) {
    const target = msg.reply_to_message?.message_id ?? msg.message_id;
    const now = Date.now();
    const at = arg ? parseWhen(arg, now, s.tz) : null;
    if (at) {
      await this.addReminder(target, at);
      return this.say(s, T.reminderSet(formatWhen(at, now, s.tz)), { reply_parameters: { message_id: msg.message_id } });
    }
    return this.say(s, arg ? T.notUnderstoodTime : T.manualNoText, {
      reply_parameters: { message_id: target, allow_sending_without_reply: true },
      reply_markup: { inline_keyboard: this.reminderButtons("r", target, s) },
    });
  }

  private reminderRows() {
    return this.sql.exec<{ id: number; msg_id: number; at: number }>("SELECT id, msg_id, at FROM reminders ORDER BY at LIMIT 30").toArray();
  }

  private remindersView(s: State) {
    const rows = this.reminderRows();
    if (!rows.length) return { text: T.noReminders, reply_markup: { inline_keyboard: [] as Button[][] } };
    const text = [T.remindersHeader, "", ...rows.map((r, i) => `${i + 1}. ${formatShort(r.at, s.tz)}`), "", T.remindersNote].join("\n");
    const buttons = rows.map((r, i) => ({ text: `✕ ${i + 1}`, callback_data: `x:${r.id}` }));
    const keyboard: Button[][] = [];
    for (let i = 0; i < buttons.length; i += 5) keyboard.push(buttons.slice(i, i + 5));
    return { text, reply_markup: { inline_keyboard: keyboard } };
  }

  private showReminders(s: State) {
    const view = this.remindersView(s);
    return this.say(s, view.text, { reply_markup: view.reply_markup });
  }

  private async addReminder(msgId: number, at: number) {
    this.sql.exec("INSERT INTO reminders (msg_id, at) VALUES (?, ?)", msgId, at);
    await this.rearm();
  }

  /** Obiekt ma jeden alarm: zawsze ustawiamy go na najbliższe przypomnienie. */
  private async rearm() {
    const next = this.sql.exec<{ at: number | null }>("SELECT MIN(at) AS at FROM reminders").one().at;
    if (next) await this.ctx.storage.setAlarm(next);
    else await this.ctx.storage.deleteAlarm();
  }

  private async fire() {
    const s = await this.load();
    if (!s.chatId) return;
    const due = this.sql
      .exec<{ id: number; msg_id: number }>("SELECT id, msg_id FROM reminders WHERE at <= ? ORDER BY at LIMIT 20", Date.now() + 1000)
      .toArray();
    for (const r of due) {
      this.sql.exec("DELETE FROM reminders WHERE id = ?", r.id);
      try {
        const message = await this.tg.send(s.chatId, T.reminder, {
          reply_parameters: { message_id: r.msg_id, allow_sending_without_reply: true },
          reply_markup: { inline_keyboard: this.reminderButtons("z", r.msg_id, s) },
        });
        // Oryginał usunięty: Telegram wysłał bez cytatu, więc mówimy wprost, co się stało.
        if (!message.reply_to_message) await this.edit(s, message.message_id, T.reminderOrphan).catch(() => {});
      } catch (error) {
        console.error("reminder failed", error instanceof TgError ? error.code : "unknown");
      }
    }
    await this.rearm();
  }

  // ---- przyciski ----

  private async onCallback(s: State, q: CallbackQuery) {
    const [kind, a, b] = (q.data ?? "").split(":");
    const message = q.message;
    let toast: string | undefined;

    switch (kind) {
      case "r":
      case "z": {
        const now = Date.now();
        const at = presetAt(b ?? "", now, s.tz);
        if (!at || at < now + 30_000) {
          toast = T.timePassed;
          break;
        }
        await this.addReminder(Number(a), at);
        if (message) await this.edit(s, message.message_id, T.reminderSet(formatWhen(at, now, s.tz)));
        toast = "Ustawione";
        break;
      }
      case "l": {
        const source = message?.reply_to_message;
        const task = cleanTask(source?.text ?? source?.caption ?? "");
        if (!task) {
          toast = T.nothingToAdd;
          break;
        }
        const list = await this.readList(s);
        const tasks = [...list.tasks, task].slice(0, MAX_TASKS);
        await this.writeList(s, tasks, list.ok);
        if (message) await this.edit(s, message.message_id, T.addedToList(tasks.length));
        toast = "Dopisane";
        break;
      }
      case "ok":
        if (message) await this.edit(s, message.message_id, T.done);
        break;
      case "d": {
        if (!message) break;
        if (message.message_id !== s.listId) {
          toast = T.staleList;
          break;
        }
        const tasks = parseList(message.text ?? "");
        const index = findTask(tasks, Number(a), b ?? "");
        if (index < 0) {
          toast = "To już odhaczone";
          break;
        }
        tasks.splice(index, 1);
        await this.writeList(s, tasks, true);
        toast = "Odhaczone ✓";
        break;
      }
      case "x": {
        this.sql.exec("DELETE FROM reminders WHERE id = ?", Number(a));
        await this.rearm();
        if (message) {
          const view = this.remindersView(s);
          await this.edit(s, message.message_id, view.text, view.reply_markup);
        }
        toast = "Usunięte";
        break;
      }
      case "pack":
        await this.packCommand(s);
        break;
      case "key":
        await this.keyCommand(s, "");
        break;
      case "help":
        await this.help(s);
        break;
      case "consent": {
        if (s.mail && a === "1") await this.registry().addContact(s.mail.email, await this.chatHash(s));
        s.mail = undefined;
        if (message) await this.edit(s, message.message_id, a === "1" ? T.consentYes : T.consentNo);
        break;
      }
      case "tz": {
        const tz = [a, b].filter(Boolean).join(":");
        if (isValidTz(tz)) {
          s.tz = tz;
          if (message) await this.edit(s, message.message_id, T.tzSet(tz));
        }
        break;
      }
      case "wipe":
        await this.forget(s, message);
        break;
      case "keep":
        if (message) await this.edit(s, message.message_id, T.notForgotten);
        break;
    }
    await this.tg.call("answerCallbackQuery", { callback_query_id: q.id, ...(toast ? { text: toast } : {}) }).catch(() => {});
  }

  // ---- darmowy pakiet za maila ----

  private freeMessages() {
    return Number(this.env.FREE_MESSAGES) || 10;
  }

  private async packCommand(s: State) {
    if (s.claimed) {
      if (s.freeLeft > 0) return this.say(s, T.packLeft(s.freeLeft));
      return this.say(s, T.packUsed, {
        reply_markup: { inline_keyboard: [[{ text: T.btnKey, callback_data: "key" }, { text: T.btnCompany, url: this.env.COMPANY_URL }]] },
      });
    }
    if (!this.env.GEMINI_API_KEY) return this.say(s, T.packOff);
    s.awaiting = "email";
    return this.say(s, T.askEmail);
  }

  private async gotEmail(s: State, msg: Message, text: string) {
    // Mail nie zostaje w historii czatu.
    await this.tg.call("deleteMessage", { chat_id: s.chatId, message_id: msg.message_id }).catch(() => {});
    const email = text.toLowerCase();
    if (!EMAIL.test(email) || email.length > 254) return this.say(s, T.badEmail);

    const now = Date.now();
    s.mailSends = s.mailSends.filter((t) => t > now - HOUR);
    if (s.mailSends.length >= 3) {
      s.awaiting = undefined;
      return this.say(s, T.tooManyCodes);
    }
    const hash = await peppered(`mail:${email}`, this.env);
    if (await this.registry().isEmailClaimed(hash)) {
      s.awaiting = undefined;
      return this.say(s, T.emailUsed);
    }

    const code = sixDigits();
    try {
      await sendCodeMail(this.env, email, code, this.origin);
    } catch (error) {
      console.error("mail failed", error instanceof Error ? error.message : "unknown");
      s.awaiting = undefined;
      return this.say(s, T.mailFailed);
    }
    s.mailSends.push(now);
    s.mail = { email, hash, code: await peppered(`code:${hash}:${code}`, this.env), expires: now + 15 * MINUTE, attempts: 0, at: now };
    s.awaiting = "code";
    return this.say(s, T.codeSent(mask(email)));
  }

  private async gotCode(s: State, text: string) {
    const code = text.replace(/\s/g, "");
    if (!/^\d{6}$/.test(code)) return this.say(s, T.codeFormat);
    const mail = s.mail;
    if (!mail?.code || !mail.expires || mail.expires < Date.now() || (mail.attempts ?? 0) >= 5) {
      s.awaiting = undefined;
      s.mail = undefined;
      return this.say(s, T.codeExpired);
    }
    if ((await peppered(`code:${mail.hash}:${code}`, this.env)) !== mail.code) {
      mail.attempts = (mail.attempts ?? 0) + 1;
      return this.say(s, T.codeWrong(5 - mail.attempts));
    }

    s.awaiting = undefined;
    const result = await this.registry().claim(mail.hash, await this.chatHash(s));
    if (result !== "ok") {
      s.mail = undefined;
      return this.say(s, result === "email" ? T.emailUsed : T.chatUsed);
    }
    s.claimed = true;
    s.freeLeft = this.freeMessages();
    // Zostaje tylko adres do pytania o zgodę. Bez zgody znika po kliknięciu „Nie” albo po dobie.
    s.mail = { email: mail.email, hash: mail.hash, at: Date.now() };
    await this.sticker(s, "wow");
    await this.say(s, T.packReady(s.freeLeft));
    return this.say(s, T.consentAsk, {
      reply_markup: { inline_keyboard: [[{ text: "Tak, mogą", callback_data: "consent:1" }, { text: "Nie, dzięki", callback_data: "consent:0" }]] },
    });
  }

  // ---- własny klucz ----

  private async keyCommand(s: State, arg: string) {
    if (/^usu[nń]$/i.test(arg)) {
      if (!s.key) return this.say(s, T.keyNone);
      s.key = undefined;
      return this.say(s, T.keyRemoved);
    }
    if (arg) return this.say(s, T.keyUnknown);
    if (!this.env.KEY_SECRET) return this.say(s, T.keyOff);
    s.awaiting = "key";
    const has = s.key ? T.keyHas(s.key.provider, s.key.model ?? defaultModel(s.key.provider, this.env)) : null;
    return this.say(s, T.keyInfo(has));
  }

  private async connectKey(s: State, key: string) {
    s.awaiting = undefined;
    if (!this.env.KEY_SECRET) return this.say(s, `${T.keyDeletedWarning} ${T.keyOff}`);
    const provider = detectProvider(key);
    if (!provider) return this.say(s, `${T.keyDeletedWarning} ${T.keyUnknown}`);
    this.tg.call("sendChatAction", { chat_id: s.chatId, action: "typing" }).catch(() => {});
    const check = await checkKey(provider, key);
    if (check === "invalid") return this.say(s, T.keyInvalid(provider));
    if (check === "error") return this.say(s, T.keyCheckFailed);
    s.key = { provider, sealed: await seal(key, this.env.KEY_SECRET, String(s.chatId)) };
    await this.sticker(s, "wink");
    return this.say(s, T.keyOk(provider, defaultModel(provider, this.env)));
  }

  private modelCommand(s: State, arg: string) {
    if (!s.key) return this.say(s, T.modelNeedsKey);
    if (!arg) return this.say(s, T.keyHas(s.key.provider, s.key.model ?? defaultModel(s.key.provider, this.env)));
    if (!/^[\w.\-/:]{2,80}$/.test(arg)) return this.say(s, T.modelBad);
    s.key.model = arg;
    return this.say(s, T.modelSet(arg));
  }

  // ---- strefa i dane ----

  private tzCommand(s: State, arg: string) {
    if (arg) {
      if (!isValidTz(arg)) return this.say(s, T.tzBad);
      s.tz = arg;
      return this.say(s, T.tzSet(arg));
    }
    const zones = ["Europe/Warsaw", "Europe/London", "Europe/Berlin", "Europe/Dublin", "America/New_York", "America/Chicago"];
    const rows: Button[][] = [];
    for (let i = 0; i < zones.length; i += 2) rows.push(zones.slice(i, i + 2).map((z) => ({ text: z, callback_data: `tz:${z}` })));
    return this.say(s, T.tzCurrent(s.tz), { reply_markup: { inline_keyboard: rows } });
  }

  private async forget(s: State, message?: Message) {
    await this.registry().forgetChat(await this.chatHash(s));
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    this.schema();
    this.wiped = true;
    if (message) await this.edit(s, message.message_id, T.forgotten);
  }

  // ---- pomocnicze ----

  private registry() {
    return this.env.REGISTRY.get(this.env.REGISTRY.idFromName("main"));
  }

  private async refund(kind: BudgetKind) {
    await this.registry()
      .refund(kind)
      .catch(() => {});
  }

  private chatHash(s: State) {
    return peppered(`chat:${s.chatId}`, this.env);
  }

  private say(s: State, text: string, extra: Record<string, unknown> = {}) {
    return this.tg.send(s.chatId, text, extra);
  }

  private async edit(s: State, messageId: number, text: string, keyboard: Keyboard = { inline_keyboard: [] }) {
    try {
      await this.tg.call("editMessageText", { chat_id: s.chatId, message_id: messageId, text, reply_markup: keyboard });
    } catch (error) {
      if (!(error instanceof TgError && error.notModified)) throw error;
    }
  }

  private react(s: State, messageId: number, emoji: string) {
    return this.tg
      .call("setMessageReaction", { chat_id: s.chatId, message_id: messageId, reaction: [{ type: "emoji", emoji }] })
      .catch(() => {});
  }

  /** Naklejki Otta (zestaw zakłada /admin/stickers). Bez zestawu po prostu ich nie ma. */
  private async sticker(s: State, mood: Mood) {
    const username = this.env.BOT_USERNAME;
    if (!username) return;
    try {
      if (!this.stickers) {
        const set = await this.tg.call<{ stickers: { file_id: string }[] }>("getStickerSet", { name: `otto_by_${username}` });
        this.stickers = set.stickers.map((st) => st.file_id);
      }
      const id = this.stickers[MOOD_ORDER.indexOf(mood)];
      if (id) await this.tg.call("sendSticker", { chat_id: s.chatId, sticker: id });
    } catch {
      this.stickers = [];
    }
  }
}

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
