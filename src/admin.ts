/**
 * Polecenia dla właściciela instancji, chronione nagłówkiem `Authorization: Bearer ADMIN_TOKEN`.
 *
 * POST /admin/setup     webhook, komendy, opisy i zdjęcie profilowe bota
 * POST /admin/stickers  zestaw naklejek Otta (potrzebny STICKER_OWNER_ID)
 * GET  /admin/contacts  CSV z mailami osób, które zgodziły się na kontakt
 */

import { sameSecret } from "./crypto";
import { telegram } from "./telegram";

const COMMANDS = [
  { command: "lista", description: "Twoja lista zadań" },
  { command: "dodaj", description: "Dopisz do listy, np. /dodaj mleko, chleb" },
  { command: "przypomnij", description: "Przypomnienie, np. /przypomnij jutro o 9" },
  { command: "przypomnienia", description: "Zaplanowane przypomnienia" },
  { command: "pakiet", description: "Darmowe wiadomości AI za maila" },
  { command: "klucz", description: "Własny klucz AI, bez limitu" },
  { command: "strefa", description: "Strefa czasowa" },
  { command: "pomoc", description: "Co umiem" },
  { command: "zapomnij", description: "Usuń moje dane" },
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

  if (url.pathname === "/admin/contacts" && request.method === "GET") {
    const rows = await env.REGISTRY.get(env.REGISTRY.idFromName("main")).contacts();
    const csv = ["email,zgoda", ...rows.map((r) => `${r.email},${new Date(r.created_at).toISOString()}`)].join("\n");
    return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "cache-control": "no-store" } });
  }

  return new Response("Nie ma takiego polecenia.", { status: 404 });
}
