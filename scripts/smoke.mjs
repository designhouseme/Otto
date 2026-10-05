// Test dymny na lokalnym `wrangler dev` z DEV_DRY_RUN=1: udaje Telegrama i sprawdza odpowiedzi w logu.
// Uruchomienie: npm run dev (w drugim oknie), potem: node scripts/smoke.mjs ścieżka/do/logu
// Log to wyjście `wrangler dev` zapisane do pliku (np. npm run dev > dev.log 2>&1).
import { readFileSync } from "node:fs";

const BASE = process.env.BASE ?? "http://127.0.0.1:8787";
const SECRET = process.env.SECRET ?? "dev-secret";
const ADMIN = process.env.ADMIN ?? "dev-admin";
const BOT = process.env.BOT ?? "otto_dev_bot";
const LOG = process.argv[2];
// Nowy czat i mail przy każdym przebiegu: jeden mail i jedno konto dostają pakiet tylko raz, także po /zapomnij.
const CHAT = 100_000 + Math.floor(Math.random() * 900_000);
const EMAIL = `test+${CHAT}@example.com`;
let updateId = Math.floor(Date.now() / 1000);
let userMsgId = 1;
let failures = 0;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const logText = () => readFileSync(LOG, "utf8");

async function send(update) {
  const response = await fetch(`${BASE}/tg/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": SECRET },
    body: JSON.stringify(update),
  });
  if (!response.ok) throw new Error(`webhook ${response.status}`);
  await wait(700);
}

function message(text, extra = {}) {
  return {
    update_id: ++updateId,
    message: { message_id: userMsgId++, date: Math.floor(Date.now() / 1000), chat: { id: CHAT, type: "private" }, from: { id: CHAT, first_name: "Test" }, text, ...extra },
  };
}

function callback(data, msg) {
  return { update_id: ++updateId, callback_query: { id: String(updateId), from: { id: CHAT, first_name: "Test" }, data, message: { chat: { id: CHAT, type: "private" }, date: 0, ...msg } } };
}

/** Wysyła i zwraca nowe linie logu z wywołaniami Telegrama i maila. */
async function step(name, update, expect) {
  const before = logText().length;
  await send(update);
  const out = logText().slice(before);
  const calls = out.split("\n").filter((l) => /\[(tg|mail)\]|failed/.test(l));
  const ok = expect.every((re) => re.test(out));
  if (!ok) failures++;
  console.log(`${ok ? "✓" : "✗"} ${name}`);
  if (!ok) console.log(calls.map((c) => `    ${c.slice(0, 260)}`).join("\n"));
  return out;
}

const lastSentId = (out) => {
  const ids = [...out.matchAll(/"message_id":(\d+)/g)].map((m) => Number(m[1]));
  return ids.at(-1);
};

// --- zabezpieczenia i trasy ---
{
  const r = await fetch(`${BASE}/tg/webhook`, { method: "POST", body: "{}" });
  console.log(`${r.status === 401 ? "✓" : "✗"} webhook bez podpisu: ${r.status}`);
  if (r.status !== 401) failures++;
  const t = await fetch(`${BASE}/telegram`, { redirect: "manual" });
  const ok = t.status === 302 && (t.headers.get("location") ?? "").includes(`t.me/${BOT}?start=strona`);
  console.log(`${ok ? "✓" : "✗"} /telegram → ${t.headers.get("location")}`);
  if (!ok) failures++;
  const a = await fetch(`${BASE}/admin/contacts`);
  console.log(`${a.status === 401 ? "✓" : "✗"} admin bez tokenu: ${a.status}`);
  if (a.status !== 401) failures++;
  const q = await fetch(`${BASE}/api/ask`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: [{ role: "user", text: "co umiesz?" }] }) });
  const body = await q.json();
  console.log(`${body.fallback ? "✓" : "✗"} /api/ask bez działającego klucza → odpowiedzi zapasowe`);
  if (!body.fallback) failures++;
}

// --- rozmowa ---
await step("/start", message("/start"), [/sendMessage.*Cześć, jestem Otto/, /callback_data":"pack"/]);
await step("tekst bez AI → przyciski", message("kupić mleko"), [/Kiedy mam przypomnieć\?/, /"l:\d+"/]);

let out = await step("dopisz do listy (przycisk)", callback(`l:${userMsgId - 1}`, { message_id: 1, reply_to_message: { message_id: userMsgId - 1, date: 0, chat: { id: CHAT, type: "private" }, text: "kupić mleko" } }), [
  /sendMessage.*Twoja lista.*1\. kupić mleko/,
  /pinChatMessage/,
]);
const listId = Number(out.match(/sendMessage[^\n]*Twoja lista/) && [...out.matchAll(new RegExp(`pinChatMessage \\{"chat_id":${CHAT},"message_id":(\\d+)`, "g"))].at(-1)?.[1]);

await step("/dodaj czyta przypiętą listę i ją edytuje", message("/dodaj chleb, masło"), [/getChat/, /editMessageText.*1\. kupić mleko\\n2\. chleb\\n3\. masło/, /setMessageReaction/]);

const { shortHash } = await import("../src/tasks.ts").catch(() => ({ shortHash: null }));
if (shortHash && listId) {
  await step(
    "odhaczenie z listy",
    callback(`d:1:${shortHash("chleb")}`, { message_id: listId, text: "📋 Twoja lista\n\n1. kupić mleko\n2. chleb\n3. masło" }),
    [/editMessageText.*1\. kupić mleko\\n2\. masło/],
  );
}

await step("termin bez AI", message("jutro o 9 faktura"), [/Ustawić tak\?/, /⏰ Jutro o 9:00/]);
const soon = Math.floor(Date.now() / 1000) + 33;
await step("przypomnienie za ~33 s", callback(`r:${userMsgId - 1}:a${soon}`, { message_id: 2 }), [/Przypomnę dziś o/]);
await step("/przypomnienia", message("/przypomnienia"), [/Zaplanowane przypomnienia/, /callback_data":"x:\d+"/]);

// --- darmowy pakiet ---
await step("/pakiet", message("/pakiet"), [/Podaj maila/]);
out = await step("mail → kod", message(EMAIL.replace("test", "Test")), [/deleteMessage/, new RegExp(`\\[mail\\] do: ${EMAIL.replace("+", "\\+")}`), /Wysłałem kod na te/]);
const code = out.match(/Twój kod do Otta: (\d{6})/)?.[1];
await step("zły kod", message("000000"), [/Ten kod się nie zgadza/]);
await step("dobry kod", message(code ?? "x"), [/Gotowe! Masz 10 wiadomości AI/, /consent:1/]);
await step("zgoda na kontakt", callback("consent:1", { message_id: 3 }), [/Zapisałem zgodę/]);
{
  const csv = await (await fetch(`${BASE}/admin/contacts`, { headers: { authorization: `Bearer ${ADMIN}` } })).text();
  const ok = csv.includes(EMAIL);
  console.log(`${ok ? "✓" : "✗"} /admin/contacts ma mail ze zgodą`);
  if (!ok) failures++;
}
await step("drugi pakiet na ten sam mail", message("/pakiet"), [/Zostało Ci 10/]);
await step("AI z zepsutym kluczem serwera → przyciski, licznik wraca", message("w piątek po pracy opony"), [/Nie dogadałem się teraz z modelem/]);
await step("/pomoc pokazuje licznik", message("/pomoc"), [/Darmowe wiadomości AI: 10/]);

// --- klucz, strefa, dane ---
await step("klucz wklejony bez komendy", message(`sk-proj-${"x1".repeat(20)}`), [/deleteMessage/, /(odrzucił ten klucz|Nie mogę teraz sprawdzić)/]);
await step("/strefa", message("/strefa Europe/London"), [/Strefa ustawiona: Europe\/London/]);
await step("powtórzona aktualizacja jest ignorowana", { ...message("/pomoc"), update_id: updateId - 1 }, [/^(?![\s\S]*sendMessage)/]);

console.log("…czekam na alarm przypomnienia");
await wait(36_000);
const fired = /Przypominam o tym/.test(logText());
console.log(`${fired ? "✓" : "✗"} alarm wysłał przypomnienie jako odpowiedź na oryginał`);
if (!fired) failures++;

await step("/zapomnij", message("/zapomnij"), [/Usunę wszystko/]);
await step("potwierdzenie", callback("wipe", { message_id: 4 }), [/nic już o Tobie nie wiem/]);
{
  const csv = await (await fetch(`${BASE}/admin/contacts`, { headers: { authorization: `Bearer ${ADMIN}` } })).text();
  const ok = !csv.includes(EMAIL);
  console.log(`${ok ? "✓" : "✗"} po /zapomnij zgoda na kontakt usunięta`);
  if (!ok) failures++;
}

// Po /zapomnij obiekt żyje dalej: przypomnienie musi się dać ustawić od razu.
await step("przypomnienie zaraz po /zapomnij", message("/przypomnij jutro o 9"), [/Przypomnę jutro o 9:00/]);

console.log(failures ? `\n${failures} problem(ów)` : "\nWszystko działa.");
process.exit(failures ? 1 : 0);
