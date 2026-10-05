// Strona Otta: Otto reaguje na to, co robisz, a w okienku czatu odpowiada na pytania.
// Treść i przyciski działają bez JavaScriptu; tu jest tylko życie i rozmowa.
import { Otto } from "./otto.js";
import qrcode from "./vendor/qrcode.mjs";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const Motion = window.Motion;
const COMPANY_URL = "https://designhouse.me/automatyzacje";
const telegramUrl = new URL("/telegram", location.href).href;

// ---------- Otto ----------

const ottos = $$("[data-otto]").map((el) => new Otto(el));
const followers = ottos.filter((o) => "ottoFollow" in o.host.dataset);
const chatOtto = ottos.find((o) => "ottoChat" in o.host.dataset);
let sectionMood = "neutral";
let lockedMood = null; // mina z rozmowy ma pierwszeństwo przed przewijaniem

function setMood(mood) {
  for (const o of followers) o.setMood(lockedMood ?? mood);
}

// Drzemka: po 25 s bez ruchu Otto przysypia, a każdy ruch go budzi (ze zdziwieniem i podskokiem).
let idleSince = performance.now();
let asleep = false;
function wake() {
  idleSince = performance.now();
  if (!asleep) return;
  asleep = false;
  for (const o of followers) {
    o.setMood("wow");
    setTimeout(() => o.setMood(lockedMood ?? sectionMood), 650);
  }
}
for (const type of ["pointermove", "pointerdown", "keydown", "scroll", "touchstart"]) addEventListener(type, wake, { passive: true });
setInterval(() => {
  if (asleep || !chat.hidden || performance.now() - idleSince < 25_000) return;
  asleep = true;
  for (const o of followers) o.setMood("sleepy");
}, 1000);

// Reakcje na przyciski i karty
for (const el of $$("[data-mood]")) {
  const enter = () => {
    setMood(el.dataset.mood);
    if (el.classList.contains("cta")) for (const o of followers) o.hop(0.5);
  };
  const leave = () => setMood(sectionMood);
  el.addEventListener("pointerenter", enter);
  el.addEventListener("pointerleave", leave);
  el.addEventListener("focusin", enter);
  el.addEventListener("focusout", leave);
}

// Mina zależna od sekcji (cennik cieszy, prywatność skłania do myślenia)
if (Motion?.inView) {
  for (const section of $$("[data-section-mood]")) {
    Motion.inView(
      section,
      () => {
        sectionMood = section.dataset.sectionMood;
        setMood(sectionMood);
        return () => {
          sectionMood = "neutral";
          setMood("neutral");
        };
      },
      { amount: 0.35 },
    );
  }
}

// ---------- Wejście hero: jedna zaplanowana chwila ruchu ----------

ottos.find((o) => $(".hero-otto").contains(o.host))?.drop(130);
if (!reduce && Motion) {
  $$(".card").forEach((card, i) => {
    const tilt = parseFloat(getComputedStyle(card).getPropertyValue("--tilt")) || 0;
    Motion.animate(
      card,
      { opacity: [0, 1], transform: [`translateY(36px) rotate(0deg)`, `translateY(0px) rotate(${tilt}deg)`] },
      { type: "spring", bounce: 0.35, duration: 0.8, delay: 0.35 + i * 0.08 },
    );
  });
  Motion.animate(".hero-bubble", { opacity: [0, 1], scale: [0.8, 1] }, { type: "spring", bounce: 0.5, duration: 0.6, delay: 1.1 });
}

// ---------- Kod QR i polecanie ----------

function qrSvg(text) {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  let d = "";
  for (let row = 0; row < n; row++) for (let col = 0; col < n; col++) if (qr.isDark(row, col)) d += `M${col} ${row}h1v1h-1z`;
  return `<svg viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" aria-hidden="true"><path d="${d}" fill="#151515"/></svg>`;
}
for (const box of $$("[data-qr]")) box.innerHTML = qrSvg(telegramUrl);

const share = $("[data-share]");
if (share) {
  share.href = `https://t.me/share/url?url=${encodeURIComponent(location.origin)}&text=${encodeURIComponent(
    "Otto przypomina o rzeczach i trzyma listę zadań w Telegramie. Polecam!",
  )}`;
  share.target = "_blank";
  share.rel = "noopener";
}

// ---------- Kopiuj i otwórz ----------

const toastBox = $(".toast");
let toastTimer;
function toast(text) {
  toastBox.textContent = text;
  toastBox.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastBox.hidden = true), 2800);
}

for (const link of $$("[data-copy]")) {
  link.addEventListener("click", () => {
    navigator.clipboard
      ?.writeText(link.dataset.copy)
      .then(() => {
        toast("Skopiowane. Wklej w czacie z Ottem.");
        for (const o of followers) o.hop(0.8);
      })
      .catch(() => {});
  });
}

// ---------- Rozmowa w sekcji „Tak wygląda rozmowa” ----------

const demo = $("[data-demo]");
if (demo && !reduce && Motion?.inView) {
  const steps = $$("[data-step]", demo);
  const pressed = $("[data-press]", demo);
  for (const step of steps) step.style.opacity = "0";
  Motion.inView(
    demo,
    () => {
      const at = [0, 0.9, 2.5, 3.5, 4.1];
      steps.forEach((step, i) => {
        Motion.animate(
          step,
          { opacity: [0, 1], transform: ["translateY(10px) scale(0.97)", "translateY(0px) scale(1)"] },
          { type: "spring", bounce: 0.3, duration: 0.55, delay: at[i] ?? i },
        );
      });
      setTimeout(() => pressed?.classList.add("is-pressed"), 1900);
    },
    { amount: 0.45 },
  );
}

// ---------- Otto w rogu ----------

const fab = $(".fab");
const heroOtto = $(".hero-otto");
fab.hidden = false;
fab.style.opacity = "0";
fab.style.pointerEvents = "none";
new IntersectionObserver(([entry]) => {
  const show = !entry.isIntersecting;
  fab.style.pointerEvents = show ? "auto" : "none";
  if (reduce || !Motion) fab.style.opacity = show ? "1" : "0";
  else Motion.animate(fab, { opacity: show ? 1 : 0, transform: show ? "translateY(0px)" : "translateY(16px)" }, { duration: 0.3 });
}).observe(heroOtto);

// ---------- Czat z Ottem ----------

const chat = $("#chat");
const log = $(".chat-log", chat);
const tiles = $(".chat-tiles", chat);
const form = $(".chat-form", chat);
const input = $("#chat-input");
const history = [];
let opener = null;
let greeted = false;
let busy = false;

const TILES = [
  ["jak", "Jak Cię dodać?"],
  ["umiesz", "Co umiesz?"],
  ["koszt", "Ile kosztujesz?"],
  ["dane", "Co o mnie wiesz?"],
  ["klucz", "Jak podpiąć klucz?"],
  ["firma", "Masz coś dla firmy?"],
];

// Gotowe odpowiedzi: kafelki działają zawsze, a przy braku sieci albo limitu ratują rozmowę.
const ANSWERS = {
  hej: { mood: "happy", text: "Cześć! Jestem Otto. Pomagam pamiętać o rzeczach w Telegramie. O co chcesz zapytać?" },
  jak: {
    mood: "happy",
    text: "To proste: kliknij „Dodaj Otto na Telegramie”, otworzy się Telegram, a tam klikasz Start. Na komputerze możesz zeskanować kod telefonem.",
    action: "telegram",
  },
  umiesz: {
    mood: "think",
    text: "Przypominam o czymkolwiek w wybranej chwili i trzymam Twoją listę zadań przypiętą w czacie. Rozumiem „jutro o 9” czy „za 2 h”, a z AI także zwykłe zdania.",
    action: "jak",
  },
  koszt: {
    mood: "happy",
    text: "Przypomnienia, lista i przyciski są za darmo, zawsze. Do tego 10 wiadomości AI za maila, a bez limitu z własnym kluczem, na przykład darmowym od Google.",
    action: "cennik",
  },
  dane: {
    mood: "think",
    text: "Nie zapisuję treści Twoich wiadomości. Przypomnienie to dla mnie numer wiadomości i godzina, a lista jest przypięta w Twoim Telegramie.",
    action: "prywatnosc",
  },
  klucz: {
    mood: "wink",
    text: "W Telegramie wysyłasz /klucz i wklejasz klucz. Najprościej darmowy klucz Gemini z Google AI Studio. Wiadomość z kluczem usuwam od razu, a klucz trzymam zaszyfrowany.",
    action: "cennik",
  },
  firma: {
    mood: "wow",
    text: "Ja jestem osobisty, jeden na osobę. Dla całego zespołu, z projektami i integracjami, bota robi Design House.",
    action: "firma",
  },
  nie_wiem: {
    mood: "think",
    text: "Tego nie wiem na pewno. Mogę opowiedzieć, jak mnie dodać, co umiem, ile kosztuję albo co o Tobie wiem.",
  },
  dalej: {
    mood: "wink",
    text: "Sporo już pogadaliśmy! Resztę najlepiej sprawdzić w praktyce, w Telegramie.",
    action: "telegram",
  },
};

// Rdzenie słów, bo po polsku „dane” to też „danych”, „danymi”, „danych osobowych”.
const MATCHERS = [
  ["klucz", /klucz|\bapi\b|gemini|openai|anthropic|openrouter|chatgpt|\bgpt/],
  ["firma", /firm|zespol|team|biznes|pracowni|integrac|sprzedaz/],
  ["dane", /\bdan(e|ych|ymi|ym)\b|prywat|bezpiecz|rodo|zapisuj|przechow|wiesz o mnie|szyfr|wyciek|usun/],
  ["koszt", /koszt|\bcen|plac|darmo|\bfree\b|ile to|ile kosztuj|abonament|limit|subskryp/],
  ["jak", /doda|zapros|instal|zaczac|\bstart|wlacz|uruchom|telegram|pobrac|gdzie cie/],
  ["umiesz", /umiesz|potrafisz|funkc|co robisz|przypom|\blist|zadan|kim jestes|co to|do czego/],
  ["hej", /^(czesc|hej|siema|witaj|dzien dobry|hello|hi|elo)\b/],
];

function fold(text) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ł/g, "l");
}

function localAnswer(text) {
  const t = fold(text);
  const hit = MATCHERS.find(([, re]) => re.test(t));
  return ANSWERS[hit ? hit[0] : "nie_wiem"];
}

function popIn(el) {
  if (reduce || !Motion) return;
  Motion.animate(el, { opacity: [0, 1], transform: ["translateY(8px) scale(0.98)", "translateY(0px) scale(1)"] }, { type: "spring", bounce: 0.3, duration: 0.45 });
}

function scrollLog() {
  log.scrollTop = log.scrollHeight;
}

function addUser(text) {
  const li = document.createElement("li");
  li.className = "msg msg-user";
  li.textContent = text;
  log.append(li);
  popIn(li);
  scrollLog();
  history.push({ role: "user", text });
}

function addOtto({ text, mood = "neutral", action = null }) {
  const li = document.createElement("li");
  li.className = "msg msg-otto";
  li.textContent = text;
  const actions = renderAction(action);
  if (actions) li.append(actions);
  log.append(li);
  popIn(li);
  scrollLog();
  history.push({ role: "otto", text });
  const speaking = Math.min(2600, 500 + text.length * 22);
  for (const o of [chatOtto, ...followers]) o?.talk(speaking);
  chatOtto?.setMood(mood);
  chatOtto?.hop(0.7);
  lockedMood = mood === "neutral" ? null : mood;
  setMood(sectionMood);
}

function renderAction(action) {
  if (!action) return null;
  const box = document.createElement("div");
  box.className = "chat-actions";
  const link = (label, href) => {
    const a = document.createElement("a");
    a.textContent = label;
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener";
    box.append(a);
  };
  const jump = (label, id) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "secondary";
    b.textContent = label;
    b.addEventListener("click", () => {
      if (matchMedia("(max-width: 619px)").matches) closeChat();
      document.getElementById(id)?.scrollIntoView({ behavior: reduce ? "auto" : "smooth" });
    });
    box.append(b);
  };
  const desktop = matchMedia("(min-width: 960px) and (hover: hover)").matches;
  switch (action) {
    case "telegram":
      link("Dodaj Otto na Telegramie", "/telegram");
      break;
    case "qr":
      if (desktop) {
        const qr = document.createElement("div");
        qr.className = "chat-qr";
        qr.innerHTML = qrSvg(telegramUrl);
        box.append(qr);
      } else link("Dodaj Otto na Telegramie", "/telegram");
      break;
    case "jak":
      jump("Pokaż, jak dodać", "jak");
      break;
    case "cennik":
      jump("Pokaż cennik", "cennik");
      break;
    case "prywatnosc":
      jump("Pokaż szczegóły", "prywatnosc");
      break;
    case "firma":
      link("Bot dla firmy", COMPANY_URL);
      break;
    default:
      return null;
  }
  return box;
}

function thinking() {
  const li = document.createElement("li");
  li.className = "msg msg-otto is-thinking";
  li.textContent = "Otto myśli…";
  log.append(li);
  scrollLog();
  chatOtto?.setMood("think");
  lockedMood = "think";
  setMood("think");
  return li;
}

async function askOtto(text) {
  if (busy) return;
  busy = true;
  addUser(text);
  const wait = thinking();
  let reply = null;
  if (history.filter((m) => m.role === "user").length > 20) reply = ANSWERS.dalej;
  else {
    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: history.slice(-8) }),
        signal: AbortSignal.timeout(16000),
      });
      const data = await response.json();
      if (response.ok && data.reply) reply = data;
    } catch {
      // brak sieci albo limitu: niżej gotowa odpowiedź
    }
  }
  wait.remove();
  addOtto(reply ?? localAnswer(text));
  busy = false;
}

function tileAnswer(id, label) {
  if (busy) return;
  addUser(label);
  const wait = thinking();
  setTimeout(() => {
    wait.remove();
    addOtto(ANSWERS[id]);
  }, reduce ? 0 : 500);
}

for (const [id, label] of TILES) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  b.addEventListener("click", () => tileAnswer(id, label));
  tiles.append(b);
}

function openChat(trigger) {
  opener = trigger ?? null;
  if (!chat.hidden) return input.focus();
  chat.hidden = false;
  fab.setAttribute("aria-expanded", "true");
  if (!reduce && Motion) Motion.animate(chat, { opacity: [0, 1], transform: ["translateY(24px) scale(0.96)", "translateY(0px) scale(1)"] }, { type: "spring", bounce: 0.25, duration: 0.5 });
  if (!greeted) {
    greeted = true;
    addOtto({ ...ANSWERS.hej, action: null });
  }
  if (matchMedia("(hover: hover)").matches) input.focus();
}

function closeChat() {
  chat.hidden = true;
  fab.setAttribute("aria-expanded", "false");
  lockedMood = null;
  setMood(sectionMood);
  (opener && document.contains(opener) ? opener : fab).focus?.();
}

for (const trigger of $$("[data-open-chat]")) {
  const o = ottos.find((x) => trigger.contains(x.host));
  let clicks = [];
  trigger.addEventListener("pointerenter", () => o?.setMood("happy"));
  trigger.addEventListener("pointerleave", () => {
    o?.squish(false);
    o?.setMood(lockedMood ?? sectionMood);
  });
  trigger.addEventListener("pointerdown", () => o?.squish(true));
  trigger.addEventListener("pointerup", () => o?.squish(false));
  trigger.addEventListener("click", () => {
    const now = performance.now();
    clicks = [...clicks.filter((t) => now - t < 2500), now];
    if (clicks.length >= 5) {
      clicks = [];
      o?.setMood("wow");
      o?.twirl();
      setTimeout(() => o?.setMood("happy"), 900);
      return;
    }
    o?.setMood("wink");
    o?.hop();
    setTimeout(() => o?.setMood(lockedMood ?? sectionMood), 800);
    openChat(trigger);
  });
}
$("[data-close-chat]").addEventListener("click", closeChat);
addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !chat.hidden) closeChat();
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  askOtto(text.slice(0, 500));
});
