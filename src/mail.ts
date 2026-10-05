/**
 * Mail z kodem (Resend). Bez RESEND_API_KEY w trybie DEV_DRY_RUN treść ląduje w konsoli,
 * a na produkcji brak klucza to błąd, nie ciche gubienie maili.
 * Szablon na tabelach i stylach inline, grafika w PNG: tak wygląda dobrze w Gmailu i Outlooku.
 */

export async function sendCodeMail(env: Env, to: string, code: string, origin: string) {
  const subject = `${code} to Twój kod do Otta`;
  const text = `Cześć!\n\nTwój kod do Otta: ${code}\n\nWpisz go w czacie z Ottem w Telegramie. Kod działa 15 minut.\nJeśli to nie Ty, zignoruj tę wiadomość.\n\nOtto\n${origin}`;

  if (!env.RESEND_API_KEY || !env.MAIL_FROM) {
    if (env.DEV_DRY_RUN === "1") {
      console.log(`[mail] do: ${to}\nTemat: ${subject}\n\n${text}`);
      return;
    }
    throw new Error("Brak RESEND_API_KEY albo MAIL_FROM: maile nie mogą wyjść.");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: `"${env.MAIL_FROM_NAME.replace(/"/g, "")}" <${env.MAIL_FROM}>`,
      to: [to],
      subject,
      text,
      html: codeHtml(code, origin),
      tags: [{ name: "type", value: "code" }],
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Resend ${response.status}`);
}

function codeHtml(code: string, origin: string) {
  const digits = code
    .split("")
    .map(
      (d) =>
        `<td style="width:44px;height:56px;background:#FBF7EC;border-radius:12px;text-align:center;font:700 30px/56px Urbanist,Arial,sans-serif;color:#151515">${d}</td><td style="width:6px"></td>`,
    )
    .join("");
  return `<!doctype html>
<html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Kod do Otta</title>
<style>
@font-face{font-family:Urbanist;font-weight:100 900;src:url(${origin}/fonts/urbanist-latin.woff2) format("woff2");unicode-range:U+0000-00FF,U+2000-206F,U+20AC}
@font-face{font-family:Urbanist;font-weight:100 900;src:url(${origin}/fonts/urbanist-latin-ext.woff2) format("woff2");unicode-range:U+0100-024F,U+1E00-1EFF}
</style>
</head>
<body style="margin:0;background:#FBF7EC">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FBF7EC;padding:32px 12px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:460px;background:#FFFFFF;border:2px solid #151515;border-radius:28px">
<tr><td style="padding:32px 32px 8px">
<img src="${origin}/mail/otto.png" width="72" height="72" alt="Otto" style="display:block;border:0">
</td></tr>
<tr><td style="padding:8px 32px 0;font:800 26px/1.2 Urbanist,Arial,sans-serif;color:#151515">Twój kod do Otta</td></tr>
<tr><td style="padding:10px 32px 20px;font:500 16px/1.5 Urbanist,Arial,sans-serif;color:#4A463F">Wpisz go w czacie z Ottem w Telegramie. Kod działa 15 minut.</td></tr>
<tr><td style="padding:0 32px 24px"><table role="presentation" cellpadding="0" cellspacing="0"><tr>${digits}</tr></table></td></tr>
<tr><td style="padding:0 32px 32px;font:500 14px/1.5 Urbanist,Arial,sans-serif;color:#6B665C">Jeśli to nie Ty, zignoruj tę wiadomość. Nikt nie dostanie dostępu do Twojego Telegrama.</td></tr>
</table>
<p style="margin:20px 0 0;font:500 13px/1.5 Urbanist,Arial,sans-serif;color:#6B665C"><a href="${origin}" style="color:#151515">Otto</a>, osobisty asystent na Telegramie</p>
</td></tr>
</table>
</body></html>`;
}
