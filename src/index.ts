/**
 * Router Workera. Strona idzie prosto z `public/`, tu trafiają tylko:
 * /tg/webhook (Telegram), /api/ask (Otto na stronie), /admin/* i /telegram (przekierowanie do bota).
 */

import { admin } from "./admin";
import { ask } from "./site";
import { sameSecret } from "./crypto";
import type { Update } from "./telegram";

export { Chat } from "./chat";
export { Registry } from "./registry";

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/tg/webhook" && request.method === "POST") {
      const secret = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
      if (!env.TELEGRAM_WEBHOOK_SECRET || !sameSecret(secret, env.TELEGRAM_WEBHOOK_SECRET)) {
        return new Response("Brak dostępu.", { status: 401 });
      }
      const update = await request.json<Update>().catch(() => null);
      const chat = update?.message?.chat ?? update?.callback_query?.message?.chat;
      // Otto jest osobisty: rozmawia tylko w czatach prywatnych.
      if (update && chat?.type === "private") {
        const stub = env.CHAT.get(env.CHAT.idFromName(String(chat.id)));
        // Telegramowi odpowiadamy od razu, a resztę robi obiekt rozmowy.
        ctx.waitUntil(
          stub.handle(update, url.origin).catch((error: unknown) => {
            console.error("handle failed", error instanceof Error ? error.message : "unknown");
          }),
        );
      }
      return new Response("ok");
    }

    if (url.pathname === "/api/ask") return ask(request, env);
    if (url.pathname.startsWith("/admin/")) return admin(request, env, url);

    if (url.pathname === "/telegram") {
      if (!env.BOT_USERNAME) return Response.redirect(`${url.origin}/#jak`, 302);
      return Response.redirect(`https://t.me/${env.BOT_USERNAME}?start=strona`, 302);
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
