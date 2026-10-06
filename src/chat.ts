/**
 * Jeden Otto = jeden obiekt na jedną rozmowę prywatną.
 *
 * Trzymamy tylko: numer czatu, strefę, licznik darmowych wiadomości (10 na start, raz na konto),
 * zaszyfrowany klucz, numer przypiętej listy, przypomnienia jako (numer wiadomości, godzina)
 * i to, co ktoś sam podał przy personalizacji (jak się zwracać, jak pisać, do czego używa Otta).
 * Treść wiadomości zostaje w Telegramie: przypominając, Otto odpowiada na oryginał.
 * Głosówki i zdjęcia pobieramy z Telegrama tylko na czas jednego zapytania do modelu.
 *
 * Otto odpowiada zwykłymi wiadomościami. Jedyna odpowiedź „na wiadomość” to samo przypomnienie,
 * bo tylko tak widać, czego dotyczy, skoro treści nie zapisujemy.
 *
 * Aktualizacje przetwarzamy po kolei (kolejka w pamięci), bo między wywołaniami
 * Telegrama obiekt może dostać kolejne zdarzenie i nadpisać stan.
 */

import { DurableObject } from "cloudflare:workers";
import { AiError, KEY_PATTERN, checkKey, completeJson, defaultModel, detectProvider, type Media, type Provider, transcribe } from "./ai";
import { peppered, seal, unseal } from "./crypto";
import { type Attachment, MAX_AUDIO_SECONDS, MAX_MEDIA_BYTES, attachmentOf, toBase64 } from "./media";
import { type Profile, asksForList, botSystem, toBotPlan } from "./prompts";
import type { BudgetKind } from "./registry";
import { MAX_TASKS, cleanTask, findTask, parseList, renderList, splitTasks } from "./tasks";
import { type Button, type CallbackQuery, type Keyboard, type Message, TgError, type Update, telegram } from "./telegram";
import { T, TONES, USES, ZONES, zoneName } from "./texts";
import { DAY, eveningLabel, formatShort, formatWhen, isValidTz, parseWhen, presetAt, reminderAt } from "./time";

interface State {
  chatId: number;
  tz: string;
  lastUpdate: number;
  freeLeft: number;
  claimed: boolean;
  key?: { provider: Provider; sealed: string; model?: string };
  /** AI bez limitu na kluczu serwera, nadane przez admina (/vip). Dzienny bezpiecznik kosztów dalej działa. */
  vip?: boolean;
  /** Personalizacja: tylko to, co ktoś sam podał. */
  profile?: Profile;
  onboarded?: boolean;
  awaiting?: "key" | "name";
  listId?: number;
}

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

  private enqueue<T>(job: () => Promise<T>) {
    const run = this.queue.then(job, job);
    this.queue = run.catch(() => {});
    return run;
  }

  // ---- stan ----

  private async load(chatId?: number): Promise<State> {
    const saved = await this.ctx.storage.get<State>("state");
    return saved ?? { chatId: chatId ?? 0, tz: this.env.DEFAULT_TZ, lastUpdate: 0, freeLeft: 0, claimed: false };
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
    this.wiped = false;
    // Darmowe wiadomości AI: każde konto dostaje je przy pierwszym kontakcie, raz (także po /zapomnij).
    if (!s.claimed) {
      s.claimed = true;
      s.freeLeft = (await this.registry().claimChat(await this.chatHash(s))) ? this.freeMessages() : 0;
    }

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

  /** Czy ta osoba może teraz pisać zwykłymi zdaniami (AI)? */
  private aiMode(s: State): "own" | "vip" | "free" | null {
    if (s.key) return "own";
    if (!this.env.GEMINI_API_KEY) return null;
    if (s.vip) return "vip";
    return s.freeLeft > 0 ? "free" : null;
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
    if (s.awaiting === "name" && text) return this.gotName(s, text);
    // Ktoś napisał coś innego niż klucz: wracamy do zwykłej rozmowy.
    if (s.awaiting === "key") s.awaiting = undefined;

    const attachment = attachmentOf(msg);
    const mode = this.aiMode(s);
    if ((text || attachment) && mode) return this.ai(s, msg, text, mode, attachment);
    return this.commandMode(s, text, attachment);
  }

  private async command(s: State, msg: Message, text: string) {
    const head = text.split(/\s+/, 1)[0];
    const name = head.slice(1).split("@")[0].toLowerCase();
    const arg = text.slice(head.length).trim();
    if (name !== "anuluj" && s.awaiting) s.awaiting = undefined;

    switch (name) {
      case "start":
        return this.start(s);
      case "ustawienia":
        return this.onboardAsk(s);
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
      case "strefa":
        return this.tzCommand(s, arg);
      case "anuluj":
        s.awaiting = undefined;
        return this.say(s, T.cancelled);
      case "id":
        return this.say(s, T.yourId(s.chatId), {
          reply_markup: { inline_keyboard: [[{ text: T.btnCopyId, copy_text: { text: String(s.chatId) } }]] },
        });
      case "vip":
      case "unvip":
      case "admin":
        if (this.isAdmin(s)) return this.adminCommand(s, name, arg);
        return this.say(s, T.unknownCommand);
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
    if (!s.onboarded) return this.onboardAsk(s, true);
    return this.say(s, T.welcomeBack(s.profile?.name, this.modeLine(s)), {
      reply_markup: { inline_keyboard: [[{ text: T.btnKey, callback_data: "key" }, { text: T.btnCommands, callback_data: "help" }]] },
    });
  }

  private modeLine(s: State) {
    const mode = this.aiMode(s);
    if (mode === "own") return T.lineKey;
    if (mode === "vip") return T.lineVip;
    if (mode === "free") return T.lineFree(s.freeLeft);
    return T.lineCommands;
  }

  private help(s: State) {
    const status = s.key ? T.statusKey(s.key.provider) : s.vip ? T.vipStatus : s.freeLeft > 0 ? T.statusFree(s.freeLeft) : T.freeUsedStatus;
    return this.say(s, T.help(`${status} Strefa: ${zoneName(s.tz)}.`));
  }

  // ---- personalizacja: cztery pytania, każde można pominąć ----

  private onboardAsk(s: State, first = false) {
    const text = first ? `${T.hello}\n\n${T.onboardAsk}` : T.onboardAsk;
    return this.say(s, text, {
      reply_markup: { inline_keyboard: [[{ text: T.btnOnboardGo, callback_data: "p:go" }, { text: T.btnSkip, callback_data: "p:skip" }]] },
    });
  }

  private askName(s: State) {
    s.awaiting = "name";
    return this.say(s, T.askName, { reply_markup: { inline_keyboard: [[{ text: T.btnSkip, callback_data: "p:noname" }]] } });
  }

  private gotName(s: State, text: string) {
    const name = text.replace(/\s+/g, " ").trim();
    if (name.length > 30 || !/^[\p{L}][\p{L}\p{M} .'-]*$/u.test(name)) return this.say(s, T.badName);
    s.profile = { ...s.profile, name };
    s.awaiting = undefined;
    return this.askTone(s);
  }

  private askTone(s: State) {
    return this.say(s, T.askTone, {
      reply_markup: { inline_keyboard: [0, 2].map((i) => TONES.slice(i, i + 2).map(([id, label]) => ({ text: label, callback_data: `p:tone:${id}` }))) },
    });
  }

  private askUse(s: State) {
    const buttons = Object.entries(USES).map(([id, label]) => ({ text: label, callback_data: `p:use:${id}` }));
    return this.say(s, T.askUse, { reply_markup: { inline_keyboard: [buttons.slice(0, 2), buttons.slice(2)] } });
  }

  private async finishOnboarding(s: State, extra?: string) {
    s.onboarded = true;
    s.awaiting = undefined;
    const text = T.onboardDone(s.profile?.name, this.modeLine(s), zoneName(s.tz));
    return this.say(s, extra ? `${extra}\n\n${text}` : text);
  }

  private async onboardingCallback(s: State, step: string, value: string | undefined, message?: Message) {
    // Odpowiedź zostaje widoczna w pytaniu, a przyciski znikają.
    const answer = (label: string) => (message ? this.edit(s, message.message_id, T.answered(message.text ?? "", label)) : undefined);
    switch (step) {
      case "go":
        if (message) await this.edit(s, message.message_id, message.text ?? T.onboardAsk);
        return this.askName(s);
      case "skip":
        if (message) await this.edit(s, message.message_id, message.text ?? T.onboardAsk);
        return this.finishOnboarding(s);
      case "noname":
        s.awaiting = undefined;
        await answer("(pominięte)");
        return this.askTone(s);
      case "tone": {
        // „short” to przycisk z dawnej wersji personalizacji (dziś: rzeczowo)
        const pick = TONES.find(([id]) => id === (value === "short" ? "technical" : value));
        if (!pick) return;
        s.profile = { ...s.profile, tone: pick[0] };
        await answer(pick[1]);
        return this.askUse(s);
      }
      case "use":
        if (!value || !USES[value]) return;
        s.profile = { ...s.profile, use: value };
        await answer(USES[value]);
        // O strefę już nie pytamy: domyślnie Polska, a za granicą zmienia się ją przez /strefa.
        return this.finishOnboarding(s);
      case "tz": {
        if (value === "other") {
          await answer(T.tzOther);
          return this.finishOnboarding(s, T.tzOtherHint);
        }
        if (!value || !isValidTz(value)) return;
        s.tz = value;
        await answer(ZONES.find(([, tz]) => tz === value)?.[0] ?? value);
        return this.finishOnboarding(s);
      }
    }
  }

  // ---- tryb komend: bez AI odpowiadamy krótką podpowiedzią, bez przycisków pod każdą wiadomością ----

  private commandMode(s: State, text: string, attachment: Attachment | null = null) {
    if (!text && attachment) return this.say(s, T.commandMediaAi, { reply_markup: { inline_keyboard: this.upsellRows() } });
    if (!text) return this.say(s, T.commandMedia);
    const at = parseWhen(text, Date.now(), s.tz);
    if (at) {
      const command = `/przypomnij ${text}`.slice(0, 256);
      return this.say(s, T.commandModeTime(formatWhen(at, Date.now(), s.tz)), {
        reply_markup: { inline_keyboard: [[{ text: T.btnCopyCommand, copy_text: { text: command } }]] },
      });
    }
    return this.say(s, T.commandMode, { reply_markup: { inline_keyboard: this.upsellRows() } });
  }

  /** Trzy drogi po darmowych wiadomościach: komendy, własny klucz, abonament Design House. */
  private upsellRows(withCommands = false): Button[][] {
    const rows: Button[][] = [];
    if (withCommands) rows.push([{ text: T.btnCommands, callback_data: "help" }]);
    rows.push([{ text: T.btnKey, callback_data: "key" }, { text: T.btnSubscription, url: this.env.CONTACT_URL }]);
    return rows;
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

  private async ai(s: State, msg: Message, text: string, mode: "own" | "free" | "vip", attachment: Attachment | null = null) {
    const env = this.env;
    const provider: Provider = mode === "own" && s.key ? s.key.provider : "gemini";
    // To, czego i tak nie obsłużymy, odrzucamy, zanim zużyjemy darmową wiadomość.
    if (attachment) {
      if (attachment.kind === "audio" && provider === "anthropic") return this.say(s, T.voiceAnthropic);
      if (attachment.kind === "audio" && (attachment.seconds ?? 0) > MAX_AUDIO_SECONDS) return this.say(s, T.voiceTooLong);
      if ((attachment.bytes ?? 0) > MAX_MEDIA_BYTES) return this.say(s, T.fileTooBig);
    }
    if (mode !== "own") {
      if (!(await this.registry().spend("bot", Number(env.DAILY_FREE_LIMIT)))) return this.say(s, T.poolEmpty);
      if (mode === "free") s.freeLeft -= 1;
    }
    const giveBack = async () => {
      if (mode === "own") return;
      if (mode === "free") s.freeLeft += 1;
      await this.refund("bot");
    };
    this.tg.call("sendChatAction", { chat_id: s.chatId, action: "typing" }).catch(() => {});
    // Całość (pobranie pliku, transkrypcja, model) musi się zmieścić w ok. 30 s, które Worker ma po odpowiedzi Telegramowi.
    const deadline = Date.now() + (attachment ? 24_000 : 20_000);

    const list = await this.readList(s);
    const replyTo = msg.reply_to_message?.text ?? msg.reply_to_message?.caption;
    let plan;
    // Co ta osoba napisała albo powiedziała (tekst, podpis, transkrypcja); pusto, gdy model sam słucha głosówki.
    let said = "";
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
      // Wiadomość dla modelu: tekst (albo podpis) oznaczony tym, co przyszło razem z nim.
      let prompt = text.slice(0, 2000);
      said = text;
      const media: Media[] = [];
      if (attachment) {
        const bytes = await this.tg.download(attachment.fileId, MAX_MEDIA_BYTES);
        if (attachment.kind === "audio" && call.provider === "openai") {
          const heard = await transcribe(call.key, bytes, attachment.mime, Math.min(12_000, deadline - Date.now()));
          if (!heard) {
            await giveBack();
            return this.say(s, T.voiceEmpty);
          }
          said = `${heard} ${text}`;
          prompt = `[${attachment.label} zapisana tekstem]\n${heard.slice(0, 4000)}${prompt ? `\n[podpis] ${prompt}` : ""}`;
        } else {
          media.push({ kind: attachment.kind, mime: attachment.mime, data: toBase64(bytes) });
          prompt = `[${attachment.label}]${prompt ? `\n${prompt}` : ""}`;
        }
      }
      const raw = await completeJson({
        ...call,
        system: botSystem(Date.now(), s.tz, list.tasks, replyTo, s.profile),
        turns: [{ role: "user", text: prompt, media }],
        timeoutMs: Math.max(5_000, deadline - Date.now()),
      });
      plan = toBotPlan(raw);
    } catch (error) {
      await giveBack();
      console.error("ai failed", error instanceof AiError ? error.kind : error instanceof TgError ? `tg ${error.code}` : "unknown");
      if (error instanceof TgError) return this.say(s, error.code === 413 ? T.fileTooBig : T.mediaFailed);
      if (error instanceof AiError && error.kind === "auth" && mode === "own") return this.say(s, T.keyBroken);
      // Wybrany model nie przyjmuje zdjęć albo dźwięku (OpenRouter, starsze modele): podpowiadamy /model.
      if (attachment && error instanceof AiError && (error.kind === "unsupported" || (error.kind === "bad" && provider !== "gemini"))) {
        return this.say(s, T.mediaModel);
      }
      return this.say(s, T.aiFailed);
    }

    const now = Date.now();
    const target = msg.reply_to_message?.message_id ?? msg.message_id;
    const lines: string[] = [];
    for (const local of plan.reminders) {
      const at = reminderAt(local, now, s.tz);
      if (!at || at < now + 30_000 || at > now + 400 * DAY) continue;
      await this.addReminder(target, at);
      lines.push(T.reminderSet(formatWhen(at, now, s.tz)));
    }

    // Lista i przypomnienia to osobne rzeczy, a model lubi dopisać na listę to, o czym ma przypomnieć.
    // Gdy ktoś napisał (albo powiedział) coś z terminem i nie prosił o listę, wpisy do listy pomijamy.
    if (plan.reminders.length && plan.add.length && said && !asksForList(said)) plan.add = [];

    if (plan.add.length || plan.done.length) {
      const kept = list.tasks.filter((_, i) => !plan.done.includes(i + 1));
      const added = plan.add.map(cleanTask).filter(Boolean);
      const tasks = [...kept, ...added].slice(0, MAX_TASKS);
      await this.writeList(s, tasks, list.ok);
      if (added.length) lines.push(`📋 Dopisane do listy (${tasks.length}).`);
      if (kept.length < list.tasks.length) lines.push(`✓ Odhaczone: ${list.tasks.length - kept.length}.`);
    }

    const body = [plan.reply, lines.join("\n")].filter(Boolean).join("\n\n") || "👌";
    if (mode === "free" && s.freeLeft === 0) {
      // Ostatnia darmowa: odpowiedź, a osobno trzy drogi dalej.
      await this.say(s, body);
      return this.say(s, T.lastFree, { reply_markup: { inline_keyboard: this.upsellRows(true) } });
    }
    return this.say(s, mode === "free" && s.freeLeft <= 2 ? `${body}\n\n${T.fewLeft(s.freeLeft)}` : body);
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
    const replied = msg.reply_to_message?.message_id;
    if (!arg && !replied) return this.say(s, T.remindUsage);
    const target = replied ?? msg.message_id;
    const now = Date.now();
    const at = arg ? parseWhen(arg, now, s.tz) : null;
    if (at) {
      await this.addReminder(target, at);
      return this.say(s, T.reminderSet(formatWhen(at, now, s.tz)));
    }
    // Termin do wybrania: przyciski muszą wskazywać, o którą wiadomość chodzi, więc tu odpowiadamy na nią.
    return this.say(s, arg ? T.notUnderstoodTime : T.remindWhen, {
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
        // Jedyna odpowiedź „na wiadomość”: tylko tak widać, o czym przypominamy.
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
    const [kind, a, ...rest] = (q.data ?? "").split(":");
    const b = rest.join(":");
    const message = q.message;
    let toast: string | undefined;

    switch (kind) {
      case "p":
        await this.onboardingCallback(s, a ?? "", b || undefined, message);
        break;
      case "r":
      case "z": {
        const now = Date.now();
        const at = presetAt(b, now, s.tz);
        if (!at || at < now + 30_000) {
          toast = T.timePassed;
          break;
        }
        await this.addReminder(Number(a), at);
        if (message) await this.edit(s, message.message_id, T.reminderSet(formatWhen(at, now, s.tz)));
        toast = "Ustawione";
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
        const index = findTask(tasks, Number(a), b);
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
      case "key":
        await this.keyCommand(s, "");
        break;
      case "help":
        await this.help(s);
        break;
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

  // ---- VIP: admin daje komuś więcej wiadomości ----

  private isAdmin(s: State) {
    return (this.env.ADMIN_CHAT_IDS ?? "").split(",").map((x) => x.trim()).includes(String(s.chatId));
  }

  private async adminCommand(s: State, name: string, arg: string) {
    const [idText, amountText] = arg.split(/\s+/).filter(Boolean);
    if (name === "admin" || (name === "vip" && !idText)) {
      const ids = (await this.registry().vips()).map((v) => v.chat_id);
      return this.say(s, `${T.adminVipList(ids)}\n\n${T.adminHelp}`);
    }
    const target = Number(idText);
    if (!/^-?\d{5,15}$/.test(idText ?? "") || !Number.isSafeInteger(target)) return this.say(s, T.adminBadId);
    let change: { vip?: boolean; add?: number };
    let what: string;
    if (name === "unvip") {
      change = { vip: false };
      what = "VIP cofnięty";
    } else if (amountText !== undefined) {
      const add = Number(amountText);
      if (!Number.isInteger(add) || add < 1 || add > 1000) return this.say(s, T.adminBadAmount);
      change = { add };
      what = `Dorzucone ${add} wiadomości`;
    } else {
      change = { vip: true };
      what = "AI bez limitu";
    }
    let result: { notified: boolean };
    if (target === s.chatId) {
      // Admin sam sobie: zmiana od razu w bieżącym stanie (wywołanie własnego obiektu zakleszczyłoby kolejkę).
      if (change.vip !== undefined) s.vip = change.vip;
      if (change.add) s.freeLeft += change.add;
      result = { notified: true };
    } else {
      result = await this.env.CHAT.get(this.env.CHAT.idFromName(String(target))).grant(target, change);
    }
    if (change.vip !== undefined) await this.registry().setVip(target, change.vip);
    return this.say(s, T.adminDone(what, target, result.notified));
  }

  /** Wywołuje obiekt rozmowy admina. Zmiana idzie przez kolejkę tego czatu, żeby nie ścigać się z jego wiadomościami. */
  grant(chatId: number, change: { vip?: boolean; add?: number }) {
    return this.enqueue(async () => {
      const s = await this.load(chatId);
      s.chatId = chatId;
      // Ktoś, kto jeszcze nie pisał do Otta, i tak dostaje swoje darmowe na start.
      if (!s.claimed) {
        s.claimed = true;
        s.freeLeft = (await this.registry().claimChat(await this.chatHash(s))) ? this.freeMessages() : 0;
      }
      if (change.vip !== undefined) s.vip = change.vip;
      if (change.add) s.freeLeft += change.add;
      await this.ctx.storage.put("state", s);
      const text = change.add ? T.messagesAdded(change.add) : change.vip ? T.vipGranted : T.vipRemoved;
      const notified = await this.tg.send(chatId, text).then(
        () => true,
        () => false,
      );
      return { notified };
    }) as Promise<{ notified: boolean }>;
  }

  // ---- darmowe wiadomości ----

  private freeMessages() {
    return Number(this.env.FREE_MESSAGES) || 10;
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
    if (s.vip) await this.registry().setVip(s.chatId, false);
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
      // Zestawu jeszcze nie ma albo Telegram nie odpowiedział: nie zapamiętujemy porażki, następnym razem spróbujemy znowu.
      this.stickers = null;
    }
  }
}

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
