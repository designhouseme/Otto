/**
 * Polecenia dla właściciela instancji, chronione nagłówkiem `Authorization: Bearer ADMIN_TOKEN`.
 *
 * POST /admin/setup     webhook, komendy, opisy i zdjęcie profilowe bota
 * POST /admin/stickers  zestaw naklejek Otta (potrzebny STICKER_OWNER_ID)
 * POST /admin/vip       to samo co /vip w czacie, bez Telegrama: {"chat": NUMER} (AI bez limitu),
 *                       {"chat": NUMER, "vip": false} (cofnięcie) albo {"chat": NUMER, "add": 50}
 */

import { sameSecret } from "./crypto";
import { telegram } from "./telegram";

const COMMANDS = [
  { command: "lista", description: "Twoja lista zadań" },
  { command: "dodaj", description: "Dopisz do listy, np. /dodaj mleko, chleb" },
  { command: "przypomnij", description: "Przypomnienie, np. /przypomnij jutro o 9" },
  { command: "przypomnienia", description: "Zaplanowane przypomnienia" },
  { command: "klucz", description: "Własny klucz AI, bez limitu" },
  { command: "strefa", description: "Strefa czasowa" },
  { command: "pomoc", description: "Co umiem" },
  { command: "osobowosc", description: "Mój styl: serdecznie, rzeczowo, neutralnie, na luzie" },
  { command: "ustawienia", description: "Jak mam się do Ciebie zwracać i jak pisać" },
  { command: "id", description: "Twój numer konta (np. do testów)" },
  { command: "zapomnij", description: "Usuń moje dane" },
];

// Admini widzą w menu dodatkowo swoje komendy (zakres: tylko ich czaty).
const ADMIN_COMMANDS = [
  { command: "vip", description: "Lista VIP-ów albo /vip NUMER [ile]" },
  { command: "unvip", description: "Cofnij VIP: /unvip NUMER" },
];

// Kolejność taka jak MOOD_ORDER w chat.ts: neutral, happy, look, wink, wow, think.
const STICKERS: [string, string][] = [
  ["neutral", "🙂"],
  ["happy", "😊"],
  ["look", "👀"],
  ["wink", "😉"],
  ["wow", "😮"],
  ["think", "🤔"],
];

export async function admin(request: Request, env: Env, url: URL): Promise<Response> {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!env.ADMIN_TOKEN || !sameSecret(token, env.ADMIN_TOKEN)) return new Response("Brak dostępu.", { status: 401 });
  const tg = telegram(env);
  const origin = url.origin;

  if (url.pathname === "/admin/setup" && request.method === "POST") {
    const report: Record<string, string> = {};
    const step = async (name: string, run: () => Promise<unknown>) => {
      try {
        await run();
        report[name] = "ok";
      } catch (error) {
        report[name] = error instanceof Error ? error.message : String(error);
      }
    };
    await step("webhook", () =>
      tg.call("setWebhook", {
        url: `${origin}/tg/webhook`,
        secret_token: env.TELEGRAM_WEBHOOK_SECRET,
        allowed_updates: ["message", "callback_query"],
      }),
    );
    await step("commands", () => tg.call("setMyCommands", { commands: COMMANDS }));
    for (const id of (env.ADMIN_CHAT_IDS ?? "").split(",").map((x) => x.trim()).filter(Boolean)) {
      await step(`commands_admin_${id}`, () =>
        tg.call("setMyCommands", { commands: [...COMMANDS, ...ADMIN_COMMANDS], scope: { type: "chat", chat_id: Number(id) } }),
      );
    }
    await step("description", () =>
      tg.call("setMyDescription", {
        description:
          "Otto pamięta za Ciebie. Napisz, o czym nie chcesz zapomnieć: ustawię przypomnienie albo dopiszę to do Twojej listy. Treść zostaje w Telegramie.",
      }),
    );
    await step("short_description", () => tg.call("setMyShortDescription", { short_description: "Otto · Twój asystent. Przypomnienia i lista zadań." }));
    await step("photo", async () => {
      const photo = await env.ASSETS.fetch(new Request(`${origin}/img/otto-avatar.png`));
      if (!photo.ok) throw new Error("Brak public/img/otto-avatar.png");
      return tg.upload(
        "setMyProfilePhoto",
        { photo: JSON.stringify({ type: "static", photo: "attach://avatar" }) },
        { avatar: await photo.blob() },
      );
    });
    return Response.json(report);
  }

  if (url.pathname === "/admin/stickers" && request.method === "POST") {
    if (!env.STICKER_OWNER_ID || !env.BOT_USERNAME) return new Response("Ustaw STICKER_OWNER_ID i BOT_USERNAME.", { status: 400 });
    const result = await tg
      .call("createNewStickerSet", {
        user_id: Number(env.STICKER_OWNER_ID),
        name: `otto_by_${env.BOT_USERNAME}`,
        title: "Otto",
        stickers: STICKERS.map(([mood, emoji]) => ({ sticker: `${origin}/stickers/${mood}.webp`, format: "static", emoji_list: [emoji] })),
      })
      .then(
        () => "ok",
        (error: Error) => error.message,
      );
    return Response.json({ stickers: result });
  }

  if (url.pathname === "/admin/vip" && request.method === "POST") {
    const body = await request.json<{ chat?: unknown; vip?: unknown; add?: unknown }>().catch(() => null);
    const chat = Number(body?.chat);
    if (!/^-?\d{5,15}$/.test(String(body?.chat ?? "")) || !Number.isSafeInteger(chat)) return new Response("Podaj chat: numer konta z /id.", { status: 400 });
    const add = body?.add;
    if (add !== undefined && (!Number.isInteger(add) || (add as number) < 1 || (add as number) > 1000)) return new Response("add: od 1 do 1000.", { status: 400 });
    const change = add !== undefined ? { add: add as number } : { vip: body?.vip !== false };
    // Tak samo jak /vip: zmiana przez kolejkę obiektu tej rozmowy (z wiadomością do tej osoby) i wpis w rejestrze VIP-ów.
    const result = await env.CHAT.get(env.CHAT.idFromName(String(chat))).grant(chat, change);
    if (change.vip !== undefined) await env.REGISTRY.get(env.REGISTRY.idFromName("main")).setVip(chat, change.vip);
    return Response.json({ chat, ...change, notified: result.notified });
  }

  return new Response("Nie ma takiego polecenia.", { status: 404 });
}
