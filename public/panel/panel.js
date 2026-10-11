const tg = window.Telegram?.WebApp;
const $ = (id) => document.getElementById(id);
let state;
let busy = false;
let movingId;
let settingsDirty = false;

function feedback(text, kind = "") {
  $("feedback").textContent = text;
  $("feedback").className = `feedback ${kind}`;
  $("move-feedback").textContent = kind === "error" && $("move-dialog").open ? text : "";
}

function theme() {
  if (!tg?.initData) return;
  const colors = tg.themeParams;
  const mappings = { bg: colors.secondary_bg_color || colors.bg_color, paper: colors.section_bg_color || colors.bg_color, ink: colors.text_color, muted: colors.hint_color, danger: colors.destructive_text_color };
  for (const [name, value] of Object.entries(mappings)) if (value) document.documentElement.style.setProperty(`--${name}`, value);
  document.documentElement.style.colorScheme = tg.colorScheme || "light";
  document.documentElement.style.setProperty("--line", tg.colorScheme === "dark" ? "#464646" : "#e6e0d1");
  document.documentElement.style.setProperty("--success", tg.colorScheme === "dark" ? "#73db91" : "#287943");
}

function setBusy(value) {
  busy = value;
  $("workspace").setAttribute("aria-busy", String(value));
  for (const control of document.querySelectorAll("button,input,select")) control.disabled = value;
  if (!value && state?.listAvailable === false) {
    $("task-text").disabled = true;
    $("task-form").querySelector("button").disabled = true;
  }
}

async function request(action, notice = "") {
  if (busy) return false;
  setBusy(true);
  feedback(action.action === "view" ? "Odświeżam…" : "Chwilka…");
  try {
    const response = await fetch("/api/panel", {
      method: "POST", headers: { "content-type": "application/json", authorization: `tma ${tg.initData}` },
      body: JSON.stringify(action), cache: "no-store", signal: AbortSignal.timeout(20_000),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Nie udało się zapisać. Spróbuj ponownie.");
    state = result.data;
    render();
    feedback(notice || "Wszystko na swoim miejscu.", notice ? "success" : "");
    if (notice) tg.HapticFeedback?.notificationOccurred("success");
    return true;
  } catch (error) {
    feedback(error.name === "TimeoutError" || error.name === "AbortError" ? "Połączenie trwa za długo. Odśwież panel, aby sprawdzić, czy zmiana została zapisana." : error.message || "Brak połączenia. Spróbuj ponownie.", "error");
    tg.HapticFeedback?.notificationOccurred("error");
    return false;
  } finally { setBusy(false); }
}

function button(text, className, action, label = text) {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = text;
  element.className = className;
  element.setAttribute("aria-label", label);
  element.addEventListener("click", action);
  return element;
}

function localValue(at, tz) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(at);
  const p = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

function render() {
  $("workspace").hidden = false;
  $("welcome").hidden = true;
  $("greeting").textContent = state.name ? `Cześć, ${state.name}.` : "Cześć, tu Otto.";
  $("task-count").textContent = state.tasks.length;
  $("reminder-count").textContent = state.reminders.length;
  $("tasks-empty").hidden = state.tasks.length > 0 || !state.listAvailable;
  $("list-unavailable").hidden = state.listAvailable;
  $("reminders-empty").hidden = state.reminders.length > 0;
  document.querySelectorAll(".timezone-note").forEach((element) => { element.textContent = `Godziny w strefie ${state.tz}.`; });
  $("task-list").replaceChildren(...state.tasks.map((task) => {
    const li = document.createElement("li");
    li.className = "item";
    const text = document.createElement("p"); text.textContent = task.text;
    li.append(button("✓", "done-button", () => request({ action: "taskDone", listId: state.listId, index: task.index, hash: task.hash }, "Odhaczone. Jedna rzecz mniej!"), `Odhacz: ${task.text}`), text);
    return li;
  }));
  $("reminder-list").replaceChildren(...state.reminders.map((reminder, index) => {
    const li = document.createElement("li"); li.className = "item reminder-item";
    const info = document.createElement("div"); info.className = "info";
    const label = document.createElement("span"); label.textContent = `Przypomnienie ${index + 1}`;
    const text = document.createElement("p");
    text.textContent = new Intl.DateTimeFormat("pl-PL", { timeZone: state.tz, dateStyle: "medium", timeStyle: "short" }).format(reminder.at);
    info.append(label, text);
    const actions = document.createElement("div"); actions.className = "actions";
    actions.append(
      button("Zmień", "secondary", () => {
        movingId = reminder.id;
        $("move-feedback").textContent = "";
        $("move-local").value = localValue(reminder.at, state.tz);
        $("move-dialog").showModal();
      }, `Zmień termin przypomnienia ${index + 1}`),
      button("Usuń", "delete-button", async () => {
        const approved = await new Promise((resolve) => {
          if (tg.showConfirm && tg.isVersionAtLeast?.("6.2")) tg.showConfirm("Usunąć to przypomnienie?", resolve);
          else resolve(window.confirm("Usunąć to przypomnienie?"));
        });
        if (approved) await request({ action: "reminderDelete", id: reminder.id }, "Przypomnienie usunięte.");
      }, `Usuń przypomnienie ${index + 1}`),
    );
    li.append(info, actions); return li;
  }));
  if (!settingsDirty) {
    $("profile-name").value = state.name;
    $("profile-tone").value = state.tone;
    $("profile-tz").value = state.tz;
  }
  $("account-status").textContent = state.status;
  if (!$("reminder-local").value) $("reminder-local").value = localValue(Date.now() + 3600_000, state.tz);
}

function view(name, focus = false) {
  document.querySelectorAll("[data-view]").forEach((tab) => {
    const selected = tab.dataset.view === name;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
    $(`${tab.dataset.view}-view`).hidden = !selected;
    if (selected && focus) tab.focus();
  });
}

document.querySelectorAll("[data-view]").forEach((tab, index, tabs) => {
  tab.addEventListener("click", () => view(tab.dataset.view));
  tab.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const target = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    view(tabs[target].dataset.view, true);
  });
});
$("task-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (await request({ action: "taskAdd", text: $("task-text").value }, "Dopisane do Twojej listy.")) $("task-text").value = "";
});
$("reminder-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (await request({ action: "reminderCreate", text: $("reminder-text").value, local: $("reminder-local").value }, "Ustawione. Odezwę się o czasie.")) $("reminder-text").value = "";
});
$("settings-form").addEventListener("input", () => { settingsDirty = true; });
$("settings-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (await request({ action: "settings", name: $("profile-name").value, tone: $("profile-tone").value, tz: $("profile-tz").value }, "Ustawienia zapisane.")) {
    settingsDirty = false;
    render();
  }
});
$("move-cancel").addEventListener("click", () => $("move-dialog").close());
$("move-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (await request({ action: "reminderMove", id: movingId, local: $("move-local").value }, "Termin zmieniony.")) $("move-dialog").close();
});
$("refresh").addEventListener("click", () => request({ action: "view" }));

if (!tg?.initData) {
  $("welcome").hidden = false;
  $("refresh").hidden = true;
  feedback("Ten panel otworzysz z czatu z Ottem.");
} else {
  tg.ready(); tg.expand();
  theme(); tg.onEvent("themeChanged", theme);
  request({ action: "view" });
}
