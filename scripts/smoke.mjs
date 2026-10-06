// Test dymny na lokalnym `wrangler dev` z DEV_DRY_RUN=1: udaje Telegrama i sprawdza odpowiedzi w logu.
// Uruchomienie: npm run dev (w drugim oknie), potem: node scripts/smoke.mjs ścieżka/do/logu
// Log to wyjście `wrangler dev` zapisane do pliku (np. npm run dev > dev.log 2>&1).
import { readFileSync } from "node:fs";

const BASE = process.env.BASE ?? "http://127.0.0.1:8787";
const SECRET = process.env.SECRET ?? "dev-secret";
const ADMIN = process.env.ADMIN ?? "dev-admin";
const BOT = process.env.BOT ?? "otto_dev_bot";
const LOG = process.argv[2];
// Nowy czat przy każdym przebiegu: konto dostaje darmowe wiadomości AI tylko raz, także po /zapomnij.
const CHAT = 100_000 + Math.floor(Math.random() * 900_000);
let updateId = Math.floor(Date.now() / 1000);
let userMsgId = 1;
let failures = 0;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const logText = () => readFileSync(LOG, "utf8");

async function send(update, ms = 700) {
  const response = await fetch(`${BASE}/tg/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": SECRET },
    body: JSON.stringify(update),
  });
  if (!response.ok) throw new Error(`webhook ${response.status}`);
  await wait(ms);
}

function message(text, extra = {}, chat = CHAT) {
  return {
    update_id: ++updateId,
    message: { message_id: userMsgId++, date: Math.floor(Date.now() / 1000), chat: { id: chat, type: "private" }, from: { id: chat, first_name: "Test" }, text, ...extra },
  };
}
// Admin z .dev.vars (ADMIN_CHAT_IDS=777000)
const ADMIN_CHAT = Number(process.env.ADMIN_CHAT ?? 777000);

function callback(data, msg) {
  return { update_id: ++updateId, callback_query: { id: String(updateId), from: { id: CHAT, first_name: "Test" }, data, message: { chat: { id: CHAT, type: "private" }, date: 0, ...msg } } };
}

/** Wysyła i zwraca nowe linie logu z wywołaniami Telegrama. */
async function step(name, update, expect, ms) {
  const before = logText().length;
  await send(update, ms);
  const out = logText().slice(before);
  const calls = out.split("\n").filter((l) => /\[tg\]|failed/.test(l));
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
  const a = await fetch(`${BASE}/admin/setup`, { method: "POST" });
  console.log(`${a.status === 401 ? "✓" : "✗"} admin bez tokenu: ${a.status}`);
  if (a.status !== 401) failures++;
  const q = await fetch(`${BASE}/api/ask`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: [{ role: "user", text: "co umiesz?" }] }) });
  const body = await q.json();
  console.log(`${body.fallback ? "✓" : "✗"} /api/ask bez działającego klucza → odpowiedzi zapasowe`);
  if (!body.fallback) failures++;
}

// --- rozmowa ---
// Testowy klucz Gemini nie działa, więc każda wiadomość AI kończy się zwykłą odpowiedzią „nie dogadałem się”, a licznik wraca.
await step("/start proponuje personalizację", message("/start"), [/sendMessage.*Cześć, jestem Otto/, /Zanim zaczniemy/, /"p:go"/, /"p:skip"/]);
await step("personalizacja: imię", callback("p:go", { message_id: 1, text: "Zanim zaczniemy" }), [/Jak mam się do Ciebie zwracać/]);
await step("imię → wybór stylu (cztery)", message("Ola"), [/W jakim stylu mam z Tobą rozmawiać\?/, /"p:tone:warm"/, /"p:tone:technical"/, /"p:tone:neutral"/, /"p:tone:casual"/]);
await step("styl → do czego", callback("p:tone:technical", { message_id: 2, text: "W jakim stylu mam z Tobą rozmawiać?" }), [/rozmawiać\? Rzeczowo, konkretnie/, /Do czego głównie mnie użyjesz/]);
await step("do czego → gotowe, strefa polska bez pytania", callback("p:use:praca", { message_id: 3, text: "Do czego głównie mnie użyjesz?" }), [/Gotowe, Ola! Masz 10 wiadomości AI/, /w strefie: Polska \(Europe\/Warsaw\)/, /\/ustawienia/, /^(?![\s\S]*Gdzie jesteś)/]);
await step("/pomoc pokazuje licznik i strefę", message("/pomoc"), [/Darmowe wiadomości AI: 10/, /Strefa: Polska \(Europe\/Warsaw\)/, /\/osobowosc/]);
await step("/osobowosc: cztery style, obecny z ptaszkiem", message("/osobowosc"), [/Jak mam z Tobą rozmawiać\? Teraz: Rzeczowo, konkretnie\./, /✓ Rzeczowo, konkretnie/, /"o:casual"/, /"o:warm"/]);
await step("zmiana stylu jednym kliknięciem, potwierdzenie w nowym stylu", callback("o:casual", { message_id: 5, text: "Jak mam z Tobą rozmawiać?" }), [/editMessageText.*gadamy na luzie/]);
await step("nowy styl widać od razu w /osobowosc", message("/osobowosc"), [/Teraz: Na luzie, z humorem\./, /✓ Na luzie, z humorem/]);
await step("AI nie działa → zwykła odpowiedź, bez cytatu", message("kupić mleko"), [/Nie dogadałem się teraz z modelem/, /^(?![\s\S]*reply_parameters)/]);

// --- głosówki i zdjęcia (udawany Telegram oddaje kilka bajtów, testowy klucz nie działa, więc licznik ma wrócić) ---
await step("głosówka: pobranie z Telegrama i model", message(undefined, { voice: { file_id: "voice-1", duration: 6, mime_type: "audio/ogg", file_size: 24000 } }), [/getFile \{"file_id":"voice-1"\}/, /Nie dogadałem się teraz z modelem/]);
await step("za długa głosówka: bez pobrania i bez zużycia", message(undefined, { voice: { file_id: "voice-2", duration: 400 } }), [/słucham najwyżej 3 minuty/, /^(?![\s\S]*getFile)/]);
await step("zdjęcie z podpisem: największe do 1600 px", message(undefined, { caption: "przypomnij dzień przed terminem", photo: [{ file_id: "p-small", width: 90, height: 60 }, { file_id: "p-big", width: 1280, height: 853, file_size: 90000 }, { file_id: "p-xl", width: 2560, height: 1706 }] }), [/getFile \{"file_id":"p-big"\}/, /Nie dogadałem się/]);

let out = await step("/dodaj zakłada listę i ją przypina", message("/dodaj kupić mleko"), [/sendMessage.*Twoja lista.*1\. kupić mleko/, /pinChatMessage/]);
const listId = Number([...out.matchAll(new RegExp(`pinChatMessage \\{"chat_id":${CHAT},"message_id":(\\d+)`, "g"))].at(-1)?.[1]);

await step("/dodaj czyta przypiętą listę i ją edytuje", message("/dodaj chleb, masło"), [/getChat/, /editMessageText.*1\. kupić mleko\\n2\. chleb\\n3\. masło/, /setMessageReaction/]);

const { shortHash } = await import("../src/tasks.ts").catch(() => ({ shortHash: null }));
if (shortHash && listId) {
  await step(
    "odhaczenie z listy",
    callback(`d:1:${shortHash("chleb")}`, { message_id: listId, text: "📋 Twoja lista\n\n1. kupić mleko\n2. chleb\n3. masło" }),
    [/editMessageText.*1\. kupić mleko\\n2\. masło/],
  );
}

await step("/przypomnij bez niczego podpowiada", message("/przypomnij"), [/Napisz, kiedy i o czym/]);
const soon = Math.floor(Date.now() / 1000) + 33;
await step("przypomnienie z przycisku za ~33 s", callback(`r:${userMsgId - 1}:a${soon}`, { message_id: 2 }), [/Przypomnę dziś o/]);
await step("/przypomnienia", message("/przypomnienia"), [/Zaplanowane przypomnienia/, /callback_data":"x:\d+"/]);

await step("licznik wrócił po nieudanych próbach AI", message("/pomoc"), [/Darmowe wiadomości AI: 10/]);

// --- klucz, strefa, dane ---
// Sprawdzenie klucza idzie do prawdziwego OpenAI: przy zimnym połączeniu trwa ponad 2 s.
await step("klucz wklejony bez komendy", message(`sk-proj-${"x1".repeat(20)}`), [/deleteMessage/, /(odrzucił ten klucz|Nie mogę teraz sprawdzić)/], 4000);
await step("/strefa", message("/strefa Europe/London"), [/Strefa ustawiona: Europe\/London/]);
await step("powtórzona aktualizacja jest ignorowana", { ...message("/pomoc"), update_id: updateId - 1 }, [/^(?![\s\S]*sendMessage)/]);

console.log("…czekam na alarm przypomnienia");
await wait(36_000);
const fired = /Przypominam o tym/.test(logText());
console.log(`${fired ? "✓" : "✗"} alarm wysłał przypomnienie jako odpowiedź na oryginał`);
if (!fired) failures++;

// --- numer konta i VIP ---
await step("/id podaje numer i przycisk kopiowania", message("/id"), [new RegExp(`Twój numer konta w Telegramie: ${CHAT}`), /copy_text/]);
await step("/vip bez uprawnień udaje nieznaną komendę", message(`/vip ${CHAT}`), [/Nie znam tej komendy/]);
await step("admin: /vip NUMER", message(`/vip ${CHAT}`, {}, ADMIN_CHAT), [new RegExp(`AI bez limitu dla ${CHAT}`), /Design House dał Ci AI bez limitu/]);
await step("VIP widzi status", message("/pomoc"), [/AI bez limitu \(VIP/]);
await step("admin: lista VIP-ów", message("/vip", {}, ADMIN_CHAT), [new RegExp(`VIP-y \\(AI bez limitu\\):[^"]*${CHAT}`)]);
await step("admin: /vip NUMER 5", message(`/vip ${CHAT} 5`, {}, ADMIN_CHAT), [/Dorzucone 5 wiadomości/, /dorzucił Ci 5 wiadomości AI/]);
await step("admin: /unvip NUMER", message(`/unvip ${CHAT}`, {}, ADMIN_CHAT), [/VIP cofnięty/, /Twój dostęp VIP się skończył/]);
await step("po /unvip zostają dorzucone wiadomości", message("/pomoc"), [/Darmowe wiadomości AI: 15/]);
await step("admin sam sobie, bez zakleszczenia", message(`/vip ${ADMIN_CHAT}`, {}, ADMIN_CHAT), [new RegExp(`AI bez limitu dla ${ADMIN_CHAT}`)]);

await step("/zapomnij", message("/zapomnij"), [/Usunę wszystko/]);
await step("potwierdzenie", callback("wipe", { message_id: 4 }), [/nic już o Tobie nie wiem/]);
await step("po /zapomnij darmowe wiadomości się nie odnawiają", message("/pomoc"), [/Darmowe wiadomości AI wykorzystane/]);
await step("tryb komend: termin → gotowa komenda do skopiowania", message("jutro o 9 faktura"), [/Wygląda na przypomnienie jutro o 9:00/, /copy_text":\{"text":"\/przypomnij jutro o 9 faktura"/]);
await step("tryb komend: zwykły tekst → podpowiedź i trzy drogi", message("cześć Otto"), [/Teraz działam na komendach/, /Abonament: napisz do nas/, /designhouse\.me\/kontakt/]);
await step("tryb komend: wiadomość bez tekstu → jak przypomnieć", message(undefined), [/odpowiedz na nią komendą/]);
await step("tryb komend: głosówka → potrzebne AI, droga dalej", message(undefined, { voice: { file_id: "voice-3", duration: 5 } }), [/Zdjęcia i głosówki rozumiem, gdy działa AI/, /callback_data":"key"/, /^(?![\s\S]*getFile)/]);
await step("admin: cofnięcie VIP-a samemu sobie", message(`/unvip ${ADMIN_CHAT}`, {}, ADMIN_CHAT), [/VIP cofnięty/]);

// Po /zapomnij obiekt żyje dalej: przypomnienie musi się dać ustawić od razu.
await step("przypomnienie zaraz po /zapomnij", message("/przypomnij jutro o 9"), [/Przypomnę jutro o 9:00/]);

console.log(failures ? `\n${failures} problem(ów)` : "\nWszystko działa.");
process.exit(failures ? 1 : 0);
