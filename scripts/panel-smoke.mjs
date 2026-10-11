// Lokalny test panelu, bez wywoływania AI i bez połączeń z zewnętrznymi API.
// Worker musi działać z DEV_DRY_RUN=1 oraz TELEGRAM_BOT_TOKEN=123456:test-token.
// BASE=http://127.0.0.1:8791 node scripts/panel-smoke.mjs
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

const base = process.env.BASE ?? "http://127.0.0.1:8787";
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(base).hostname)) throw new Error("Ten test wolno uruchamiać wyłącznie na localhost z DEV_DRY_RUN=1.");
const user = { id: 800_000_000 + Math.floor(Math.random() * 1_000_000), first_name: "Panel Test" };
const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify(user), query_id: "panel-smoke" });
const data = [...params].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join("\n");
const secret = createHmac("sha256", "WebAppData").update("123456:test-token").digest();
params.set("hash", createHmac("sha256", secret).update(data).digest("hex"));
const auth = `tma ${params}`;
let updateId = Math.floor(Date.now() / 1000);
let messageId = 10;

async function panel(action, expected = 200, authorization = auth) {
  const response = await fetch(`${base}/api/panel`, { method: "POST", headers: { "content-type": "application/json", authorization }, body: JSON.stringify(action) });
  const result = await response.json();
  assert.equal(response.status, expected, JSON.stringify(result));
  return result.data ?? result;
}
async function command(text) {
  const response = await fetch(`${base}/tg/webhook`, {
    method: "POST", headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": process.env.SECRET ?? "dev-secret" },
    body: JSON.stringify({ update_id: ++updateId, message: { message_id: messageId++, date: Math.floor(Date.now() / 1000), chat: { id: user.id, type: "private" }, from: user, text } }),
  });
  assert.equal(response.status, 200);
  await new Promise((resolve) => setTimeout(resolve, 150));
}

await panel({ action: "view" }, 401, "tma forged");
await panel({ action: "view" }, 409);
await command("/start");
let state = await panel({ action: "view" });
assert.deepEqual(state.tasks, []);
assert.deepEqual(state.reminders, []);
console.log("✓ podpis Telegrama i inicjalizacja konta");

state = await panel({ action: "taskAdd", text: "odebrać paczkę, zamówić kawę" });
assert.equal(state.tasks.length, 2);
const oldListId = state.listId;
const task = state.tasks[0];
state = await panel({ action: "taskDone", listId: state.listId, index: task.index, hash: task.hash });
assert.deepEqual(state.tasks.map((t) => t.text), ["zamówić kawę"]);
await panel({ action: "taskDone", listId: oldListId, index: task.index, hash: task.hash }, 409);
console.log("✓ zadania współdzielone z czatem i odrzucenie starego kliknięcia");

const local = new Date(Date.now() + 3 * 86400_000).toISOString().slice(0, 10) + "T09:00";
state = await panel({ action: "reminderCreate", text: "Przegląd auta", local });
assert.equal(state.reminders.length, 1);
const reminder = state.reminders[0];
assert.equal(JSON.stringify(state).includes("Przegląd auta"), false);
state = await panel({ action: "reminderMove", id: reminder.id, local: local.slice(0, 11) + "10:30" });
const moved = state.reminders[0].at;
assert.equal(moved - reminder.at, 90 * 60000);
console.log("✓ tworzenie i zmiana terminu bez przechowywania treści w odpowiedzi panelu");

state = await panel({ action: "settings", name: "Ola", tone: "technical", tz: "America/New_York" });
assert.equal(state.name, "Ola");
assert.equal(state.tone, "technical");
assert.equal(state.tz, "America/New_York");
assert.equal(state.reminders[0].at, moved);
assert.equal("key" in state, false);
console.log("✓ personalizacja i zmiana strefy bez przesuwania przypomnienia");

await panel({ action: "reminderMove", id: reminder.id, local: "2020-01-01T09:00" }, 400);
state = await panel({ action: "reminderDelete", id: reminder.id });
assert.deepEqual(state.reminders, []);
await panel({ action: "reminderMove", id: reminder.id, local }, 409);
console.log("✓ usuwanie, przeszłe daty i konflikt po usunięciu");

await command("/dodaj kupić mleko");
state = await panel({ action: "view" });
assert.deepEqual(state.tasks.map((t) => t.text), ["zamówić kawę", "kupić mleko"]);
await command("/panel");
const page = await fetch(`${base}/panel/`);
assert.equal(page.status, 200);
assert.match(await page.text(), /telegram-web-app\.js/);
console.log("✓ komendy czatu widoczne w panelu i trasa Mini App");
console.log("Lokalny test panelu zakończony powodzeniem.");
