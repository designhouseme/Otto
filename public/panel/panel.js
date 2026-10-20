const tg = window.Telegram?.WebApp;
const $ = (id) => document.getElementById(id);
let state;
let busy = false;
let movingId;
let settingsDirty = false;
/** Kalendarz: oglądany miesiąc („RRRR-MM”) i wybrany dzień („RRRR-MM-DD”) w strefie konta. */
let month;
let selectedDay = null;
/** Widok kalendarza: 0 to siatka miesiąca, 1, 2 albo 4 to tyle tygodni z dniami pod sobą od poniedziałku „week”. Wybór pamięta to urządzenie. */
let weeks = 0;
let week;
try { weeks = Number(localStorage.getItem("otto-calendar-weeks")) || 0; } catch { /* brak pamięci przeglądarki */ }
if (![0, 1, 2, 4].includes(weeks)) weeks = 0;
let currentView = "tasks";
const DAY_MS = 86_400_000;
// Natywny przycisk Telegrama i strzałka wstecz zastępują przyciski na stronie, gdy klient je ma.
const native = Boolean(tg?.initData && tg.MainButton && tg.BackButton && tg.isVersionAtLeast?.("6.1"));

function feedback(text, kind = "") {
  $("feedback").textContent = text;
  $("feedback").className = `feedback ${kind}`;
  $("move-feedback").textContent = kind === "error" && $("move-dialog").open ? text : "";
  $("reminder-feedback").textContent = kind === "error" && $("reminder-dialog").open ? text : "";
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
  for (const control of document.querySelectorAll("button,input,select")) control.disabled = value || control.dataset.off === "1";
  if (!value && state?.listAvailable === false) {
    $("task-text").disabled = true;
    $("task-form").querySelector("button").disabled = true;
  }
  syncButtons();
}

const openDialog = () => ["reminder-dialog", "move-dialog"].map($).find((dialog) => dialog.open);

/** Co robi natywny przycisk teraz: zapis w otwartym oknie, nowe przypomnienie w kalendarzu albo zapis zmienionych ustawień. */
function mainButton() {
  const dialog = openDialog();
  if (dialog?.id === "reminder-dialog") return { text: "Ustaw przypomnienie", run: () => $("reminder-form").requestSubmit() };
  if (dialog) return { text: "Zapisz termin", run: () => $("move-form").requestSubmit() };
  if (state && currentView === "reminders") return { text: "Nowe przypomnienie", run: openReminderDialog };
  if (state && currentView === "settings" && settingsDirty) return { text: "Zapisz ustawienia", run: () => $("settings-form").requestSubmit() };
  return null;
}

function syncButtons() {
  if (!native) return;
  const main = mainButton();
  if (openDialog()) tg.BackButton.show(); else tg.BackButton.hide();
  if (!main) { tg.MainButton.hide(); return; }
  tg.MainButton.setParams({ text: main.text, color: "#ffd21f", text_color: "#151515", is_active: !busy, is_visible: true });
  if (busy) tg.MainButton.showProgress(false); else tg.MainButton.hideProgress();
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

const pad = (value) => String(value).padStart(2, "0");
const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);
const utcDay = (key) => { const [y, m, d] = key.split("-").map(Number); return Date.UTC(y, m - 1, d); };
const addDays = (key, days) => new Date(utcDay(key) + days * DAY_MS).toISOString().slice(0, 10);
const weekday = (key) => (new Date(utcDay(key)).getUTCDay() + 6) % 7;
const monday = (key) => addDays(key, -weekday(key));
const WEEKDAYS = ["pn", "wt", "śr", "cz", "pt", "sb", "nd"];
// Daty kalendarza to dni w strefie konta, więc formatujemy je jako UTC: bez przesunięć strefy przeglądarki.
const dayFormat = (options) => new Intl.DateTimeFormat("pl-PL", { ...options, timeZone: "UTC" });
const today = () => localValue(Date.now(), state.tz).slice(0, 10);
const reminderWord = (n) => n === 1 ? "przypomnienie" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? "przypomnienia" : "przypomnień";

/** „Dziś”, „Jutro”, „Pojutrze” albo „Piątek, 16 października”. W nagłówku dnia także data przy dniach względnych. */
function dayLabel(key, heading = false) {
  const diff = Math.round((utcDay(key) - utcDay(today())) / DAY_MS);
  const date = dayFormat({ day: "numeric", month: "long", ...(key.slice(0, 4) !== today().slice(0, 4) ? { year: "numeric" } : {}) }).format(utcDay(key));
  const near = ["Dziś", "Jutro", "Pojutrze"][diff];
  if (near) return heading ? `${near}, ${date}` : near;
  return capitalize(`${dayFormat({ weekday: "long" }).format(utcDay(key))}, ${date}`);
}

/** Blokada, która przetrwa setBusy(false): np. dzień z przeszłości albo koniec zakresu. */
function lock(control, off) {
  control.dataset.off = off ? "1" : "";
  control.disabled = busy || off;
}

/** Szybkie terminy jak przyciski w czacie, liczone w strefie konta w chwili kliknięcia. */
function presetValue(preset) {
  const now = localValue(Date.now(), state.tz);
  const day = now.slice(0, 10);
  const time = now.slice(11);
  if (preset === "h1") return localValue(Date.now() + 3_600_000, state.tz);
  if (preset === "e18") return `${time < "17:59" ? day : addDays(day, 1)}T18:00`;
  if (preset === "j9") return `${addDays(day, 1)}T09:00`;
  return `${addDays(day, 7)}T${time}`;
}

/** „19–25 października” albo „26 paź–22 lis”, z rokiem, gdy zakres sięga innego roku. */
function rangeLabel(from, to) {
  const format = dayFormat({ day: "numeric", month: from.slice(0, 7) === to.slice(0, 7) ? "long" : "short", ...(to.slice(0, 4) !== today().slice(0, 4) ? { year: "numeric" } : {}) });
  return format.formatRange ? format.formatRange(utcDay(from), utcDay(to)) : `${format.format(utcDay(from))} – ${format.format(utcDay(to))}`;
}

function renderCalendar() {
  const now = Date.now();
  const first = today();
  const limit = localValue(now + 400 * DAY_MS, state.tz).slice(0, 10);
  const holidays = new Map(state.holidays.map((holiday) => [holiday.date, holiday.name]));
  const byDay = new Map();
  for (const reminder of state.reminders) {
    const local = localValue(reminder.at, state.tz);
    const key = local.slice(0, 10);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push({ time: `${Number(local.slice(11, 13))}:${local.slice(14, 16)}`, title: reminder.title });
  }
  const dayButton = (key) => {
    const count = byDay.get(key)?.length ?? 0;
    const day = document.createElement("button");
    day.type = "button";
    const holiday = holidays.get(key);
    day.className = `day${key === first ? " today" : ""}${count ? " has" : ""}${holiday ? " holiday" : ""}`;
    day.setAttribute("aria-pressed", String(key === selectedDay));
    day.setAttribute("aria-label", `${dayLabel(key, true)}${holiday ? `, ${holiday}` : ""}: ${count ? `${count} ${reminderWord(count)}` : "bez przypomnień"}`);
    if (holiday) day.title = holiday;
    if (key === first) day.setAttribute("aria-current", "date");
    lock(day, key < first || key > limit);
    day.addEventListener("click", () => pickDay(key));
    return day;
  };
  $("calendar").classList.toggle("weeks", weeks > 0);
  $("month-grid").hidden = $("calendar").querySelector(".weekdays").hidden = weeks > 0;
  $("week-list").hidden = !weeks;
  document.querySelectorAll(".spans button").forEach((choice) => choice.setAttribute("aria-pressed", String(Number(choice.dataset.weeks) === weeks)));
  const unit = weeks === 1 ? ["Poprzedni tydzień", "Następny tydzień"] : weeks ? ["Poprzednie tygodnie", "Następne tygodnie"] : ["Poprzedni miesiąc", "Następny miesiąc"];
  for (const [id, label] of [["month-prev", unit[0]], ["month-next", unit[1]]]) { $(id).setAttribute("aria-label", label); $(id).title = label; }
  if (weeks) {
    // Dni pod sobą: wiersz na dzień, z godzinami (i tytułami) zamiast kropki, bo jest na nie miejsce.
    if (!week || week < monday(first)) week = monday(first);
    if (week > monday(limit)) week = monday(limit);
    $("month-label").textContent = rangeLabel(week, addDays(week, weeks * 7 - 1));
    lock($("month-prev"), week <= monday(first));
    lock($("month-next"), addDays(week, weeks * 7) > limit);
    $("week-list").dataset.weeks = weeks;
    $("week-list").replaceChildren(...Array.from({ length: weeks * 7 }, (_, index) => {
      const key = addDays(week, index);
      const day = dayButton(key);
      const holiday = holidays.get(key);
      day.className += `${weekday(key) > 4 ? " weekend" : ""} row`;
      const date = Object.assign(document.createElement("span"), { className: "date" });
      date.append(Object.assign(document.createElement("small"), { textContent: WEEKDAYS[weekday(key)] }), Object.assign(document.createElement("b"), { textContent: Number(key.slice(8)) }));
      if (key.endsWith("-01")) date.append(Object.assign(document.createElement("small"), { textContent: dayFormat({ month: "short" }).format(utcDay(key)) }));
      const events = Object.assign(document.createElement("span"), { className: "events" });
      for (const item of byDay.get(key) ?? []) {
        const event = Object.assign(document.createElement("span"), { className: "event" });
        event.append(Object.assign(document.createElement("b"), { textContent: item.time }), item.title ? ` ${item.title}` : "");
        events.append(event);
      }
      // Święto na końcu, żeby w wąskim wierszu nie zasłoniło godzin. W widoku tygodnia CSS przenosi je na górę.
      if (holiday) events.append(Object.assign(document.createElement("span"), { className: "holiday-name", textContent: holiday }));
      day.append(date, events);
      return day;
    }));
    return;
  }
  if (!month || month < first.slice(0, 7)) month = first.slice(0, 7);
  if (month > limit.slice(0, 7)) month = limit.slice(0, 7);
  const [y, m] = month.split("-").map(Number);
  $("month-label").textContent = capitalize(dayFormat({ month: "long", year: "numeric" }).format(Date.UTC(y, m - 1, 1)));
  lock($("month-prev"), month <= first.slice(0, 7));
  lock($("month-next"), month >= limit.slice(0, 7));
  const blanks = weekday(`${month}-01`);
  const cells = Array.from({ length: blanks }, () => Object.assign(document.createElement("span"), { className: "blank" }));
  for (let d = 1; d <= new Date(Date.UTC(y, m, 0)).getUTCDate(); d++) {
    const day = dayButton(`${month}-${pad(d)}`);
    day.textContent = d;
    cells.push(day);
  }
  $("month-grid").replaceChildren(...cells);
}

/** Zmiana widoku zostaje przy wybranym dniu albo oglądanym okresie. Tygodnie przewijają się na górę ekranu, żeby było widać cały zakres. */
function setWeeks(value) {
  if (value) week = monday(selectedDay ?? (weeks ? week : month > today().slice(0, 7) ? `${month}-01` : today()));
  else month = (selectedDay ?? week ?? today()).slice(0, 7);
  weeks = value;
  try { localStorage.setItem("otto-calendar-weeks", String(value)); } catch { /* brak pamięci przeglądarki */ }
  tg.HapticFeedback?.selectionChanged();
  renderCalendar();
  if (value) $("calendar").scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
}

/** Dzień z kalendarza filtruje listę. Drugie kliknięcie wraca do wszystkich. */
function pickDay(key) {
  selectedDay = selectedDay === key ? null : key;
  tg.HapticFeedback?.selectionChanged();
  renderCalendar();
  renderAgenda();
}

/** Termin na start nowego przypomnienia: wybrany dzień o 9:00 (dziś: najbliższa pełna godzina), bez wyboru za godzinę. */
function suggestedLocal() {
  const now = localValue(Date.now(), state.tz);
  const hour = Number(now.slice(11, 13)) + 1;
  if (selectedDay && selectedDay > now.slice(0, 10)) return `${selectedDay}T09:00`;
  if (selectedDay && hour <= 23) return `${selectedDay}T${pad(hour)}:00`;
  return localValue(Date.now() + 3_600_000, state.tz);
}

function renderAgenda() {
  if (selectedDay && selectedDay < today()) selectedDay = null;
  const items = state.reminders.map((reminder) => ({ ...reminder, local: localValue(reminder.at, state.tz) })).filter((reminder) => !selectedDay || reminder.local.startsWith(selectedDay));
  $("agenda-title").textContent = selectedDay ? dayLabel(selectedDay, true) : "Wszystkie terminy";
  $("agenda-all").hidden = !selectedDay;
  const holiday = selectedDay && state.holidays.find((item) => item.date === selectedDay);
  $("agenda-holiday").hidden = !holiday;
  $("agenda-holiday").textContent = holiday ? holiday.name : "";
  $("reminders-empty").hidden = items.length > 0;
  $("reminders-empty-title").textContent = selectedDay ? "Wolny dzień." : "Żaden termin nie goni.";
  $("reminders-note").firstElementChild.textContent = state.titles
    ? "Tytuły widzisz tylko Ty. Pełna treść zostaje w czacie, a „Pokaż” wyśle ją tam jako cytat."
    : "Tu widać tylko godziny, treść zostaje w czacie. „Pokaż” wyśle ją tam jako cytat.";
  $("titles-enable").hidden = state.titles;
  $("reminders-empty-text").textContent = selectedDay ? "Nic tu nie mam. Dodasz przypomnienie przyciskiem wyżej." : "Ustaw przypomnienie, a odezwę się o czasie.";
  $("reminder-list").replaceChildren(...items.map((reminder) => {
    const day = reminder.local.slice(0, 10);
    const time = `${Number(reminder.local.slice(11, 13))}:${reminder.local.slice(14, 16)}`;
    const when = `${reminder.title ? `„${reminder.title}”, ` : ""}${dayLabel(day).toLowerCase()}, ${time}`;
    const li = document.createElement("li"); li.className = "item reminder-item";
    const info = document.createElement("div"); info.className = "info";
    const label = document.createElement("span");
    const text = document.createElement("p");
    if (state.titles) {
      // Z tytułami najważniejsze jest „co”, a dzień i godzina idą nad nim.
      label.className = "when"; label.textContent = selectedDay ? time : `${dayLabel(day)}, ${time}`;
      text.className = reminder.title ? "title" : "untitled"; text.textContent = reminder.title ?? "Bez tytułu, treść jest w czacie";
      info.append(label, text);
    } else {
      text.className = "time"; text.textContent = time;
      label.textContent = dayLabel(day);
      if (!selectedDay) info.append(label);
      info.append(text);
    }
    const actions = document.createElement("div"); actions.className = "actions";
    actions.append(
      button("Pokaż", "secondary", () => request({ action: "reminderShow", id: reminder.id }, "Wysłałem do czatu. Treść zobaczysz w cytacie."), `Pokaż w czacie przypomnienie: ${when}`),
      button("Zmień", "secondary", () => {
        movingId = reminder.id;
        $("move-feedback").textContent = "";
        $("move-local").value = reminder.local;
        $("move-dialog").showModal();
        syncButtons();
      }, `Zmień termin przypomnienia: ${when}`),
      button("Usuń", "delete-button", async () => {
        const approved = await new Promise((resolve) => {
          if (tg.showConfirm && tg.isVersionAtLeast?.("6.2")) tg.showConfirm("Usunąć to przypomnienie?", resolve);
          else resolve(window.confirm("Usunąć to przypomnienie?"));
        });
        if (approved) await request({ action: "reminderDelete", id: reminder.id }, "Przypomnienie usunięte.");
      }, `Usuń przypomnienie: ${when}`),
    );
    li.append(info, actions); return li;
  }));
}

/** Strefa urządzenia: podpowiedź w podróży. UTC z WebView zwykle nie jest prawdziwą strefą, więc go pomijamy. */
function renderZoneHint() {
  let zone = "";
  try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch { /* brak Intl */ }
  const show = !!zone && zone !== "UTC" && !zone.startsWith("Etc/") && zone !== $("profile-tz").value;
  $("tz-device").hidden = !show;
  $("tz-device").dataset.zone = zone;
  if (show) $("tz-device").firstElementChild.textContent = `Telefon pokazuje strefę ${zone}.`;
}

function render() {
  $("workspace").hidden = false;
  $("welcome").hidden = true;
  $("greeting").textContent = state.name ? `Cześć, ${state.name}.` : "Cześć, tu Otto.";
  $("task-count").textContent = state.tasks.length;
  $("reminder-count").textContent = state.reminders.length;
  $("tasks-empty").hidden = state.tasks.length > 0 || !state.listAvailable;
  $("list-unavailable").hidden = state.listAvailable;
  document.querySelectorAll(".timezone-note").forEach((element) => { element.textContent = `Godziny w strefie ${state.tz}.`; });
  $("task-list").replaceChildren(...state.tasks.map((task) => {
    const li = document.createElement("li");
    li.className = "item";
    const text = document.createElement("p"); text.textContent = task.text;
    li.append(button("✓", "done-button", () => request({ action: "taskDone", listId: state.listId, index: task.index, hash: task.hash }, "Odhaczone. Jedna rzecz mniej!"), `Odhacz: ${task.text}`), text);
    return li;
  }));
  renderCalendar();
  renderAgenda();
  document.querySelector('[data-preset="e18"]').textContent = presetValue("e18").startsWith(today()) ? "Dziś 18:00" : "Jutro 18:00";
  if (!settingsDirty) {
    $("profile-name").value = state.name;
    $("profile-tone").value = state.tone;
    $("profile-use").value = state.use ?? "";
    $("profile-digest").value = state.digest === null || state.digest === undefined ? "" : String(state.digest);
    $("profile-titles").checked = !!state.titles;
    $("profile-tz").value = state.tz;
  }
  renderZoneHint();
  $("account-status").textContent = state.status;
  syncButtons();
}

function view(name, focus = false) {
  document.querySelectorAll("[data-view]").forEach((tab) => {
    const selected = tab.dataset.view === name;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
    $(`${tab.dataset.view}-view`).hidden = !selected;
    if (selected && focus) tab.focus();
  });
  currentView = name;
  // Widok tygodni ma zająć cały ekran, więc po kliknięciu zakładki kalendarz staje na górze.
  if (name === "reminders" && weeks && state && !focus) $("calendar").scrollIntoView({ block: "start" });
  syncButtons();
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
  if (await request({ action: "reminderCreate", text: $("reminder-text").value, local: $("reminder-local").value }, "Ustawione. Odezwę się o czasie.")) {
    $("reminder-text").value = "";
    $("reminder-dialog").close();
  }
});
$("month-prev").addEventListener("click", () => { if (weeks) week = addDays(week, -7 * weeks); else month = addDays(`${month}-01`, -1).slice(0, 7); renderCalendar(); });
$("month-next").addEventListener("click", () => { if (weeks) week = addDays(week, 7 * weeks); else month = addDays(`${month}-28`, 7).slice(0, 7); renderCalendar(); });
document.querySelectorAll(".spans button").forEach((choice) => choice.addEventListener("click", () => setWeeks(Number(choice.dataset.weeks))));
$("agenda-all").addEventListener("click", () => pickDay(selectedDay));
// Tytuły włącza się w ustawieniach, gdzie jest napisane, co dokładnie zapisuję.
$("titles-enable").addEventListener("click", () => {
  view("settings");
  $("profile-titles").scrollIntoView({ block: "center" });
  $("profile-titles").focus();
});
document.querySelectorAll("[data-preset]").forEach((chip) => chip.addEventListener("click", () => {
  $("reminder-local").value = presetValue(chip.dataset.preset);
  tg.HapticFeedback?.selectionChanged();
}));
$("tz-device-use").addEventListener("click", () => {
  $("profile-tz").value = $("tz-device").dataset.zone;
  settingsDirty = true;
  renderZoneHint();
  syncButtons();
});
$("settings-form").addEventListener("input", () => { settingsDirty = true; renderZoneHint(); syncButtons(); });
$("settings-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (await request({ action: "settings", name: $("profile-name").value, tone: $("profile-tone").value, use: $("profile-use").value, digest: $("profile-digest").value === "" ? null : Number($("profile-digest").value), titles: $("profile-titles").checked, tz: $("profile-tz").value }, "Ustawienia zapisane.")) {
    settingsDirty = false;
    render();
    syncButtons();
  }
});
function openReminderDialog() {
  $("reminder-feedback").textContent = "";
  $("reminder-local").value = suggestedLocal();
  $("reminder-dialog").showModal();
  syncButtons();
}
$("reminder-new").addEventListener("click", openReminderDialog);
for (const dialog of ["reminder-dialog", "move-dialog"]) $(dialog).addEventListener("close", syncButtons);
$("reminder-cancel").addEventListener("click", () => $("reminder-dialog").close());
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
  if (native) {
    document.documentElement.classList.add("native");
    // Akcję ustalamy w chwili kliknięcia: zdarzenie „close” okna przychodzi z opóźnieniem.
    tg.MainButton.onClick(() => { if (!busy) mainButton()?.run(); });
    tg.BackButton.onClick(() => { openDialog()?.close(); syncButtons(); });
  }
  theme(); tg.onEvent("themeChanged", theme);
  request({ action: "view" });
}
