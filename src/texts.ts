/**
 * Wszystko, co Otto mówi w Telegramie, w jednym miejscu.
 * Ton: konkretnie, ciepło, krótko. Bez długich myślników.
 */

import { PROVIDER_NAMES, type Provider } from "./ai";

export const T = {
  welcome: (line: string) =>
    [
      "Cześć, jestem Otto. Pamiętam za Ciebie.",
      "Napisz mi, o czym nie chcesz zapomnieć, a ustawię przypomnienie albo dopiszę to do Twojej listy. Treść zostaje tutaj, w Telegramie.",
      line,
    ].join("\n\n"),
  welcomeKey: "Masz podpięty własny klucz AI, więc piszesz do mnie zwykłymi zdaniami bez limitu.",
  welcomeFree: (left: number) =>
    `Na start masz ${messages(left)} AI: pisz do mnie zwykłymi zdaniami, np. „w piątek po pracy przypomnij mi o oponach”. Potem dalej działają przyciski i proste terminy, a bez limitu z własnym kluczem: /klucz`,
  welcomeManual:
    "Działają przyciski i proste terminy, np. „jutro o 9” albo „w piątek 15:30”. Zwykłe zdania zrozumiem z własnym kluczem AI: /klucz",
  freeUsedStatus: "Darmowe wiadomości AI wykorzystane. Bez limitu z własnym kluczem: /klucz",

  help: (status: string) =>
    [
      "Co umiem:",
      "• napisz cokolwiek, a zaproponuję przypomnienie albo dopisanie do listy",
      "• /przypomnij jutro o 9 (albo odpowiedz tak na dowolną wiadomość)",
      "• /dodaj mleko, chleb: dopisuje do listy",
      "• /lista: Twoja lista, przypięta u góry czatu",
      "• /przypomnienia: co i kiedy przypomnę",
      "• /klucz: własny klucz AI, bez limitu",
      "• /strefa: strefa czasowa",
      "• /zapomnij: usuwam Twoje dane",
      "",
      status,
      "",
      "Nie zapisuję treści Twoich wiadomości. Przypomnienie to dla mnie tylko numer wiadomości i godzina.",
    ].join("\n"),

  manualAsk: "Kiedy mam przypomnieć? Albo dopiszę to do listy.",
  manualParsed: "Ustawić tak?",
  manualNoText: "Kiedy mam Ci o tym przypomnieć?",
  reminderSet: (when: string) => `⏰ Przypomnę ${when}.`,
  reminder: "⏰ Przypominam o tym ↑",
  reminderOrphan: "⏰ Miałem Ci o czymś przypomnieć, ale ta wiadomość została usunięta.",
  done: "✓ Zrobione",
  timePassed: "Ta godzina już minęła",
  notUnderstoodTime: "Nie rozumiem tego terminu. Wybierz:",
  addedToList: (count: number) => `📋 Dopisane. Na liście: ${count}. Jest przypięta u góry.`,
  nothingToAdd: "Tu nie ma tekstu do dopisania",
  addUsage: "Napisz, co dopisać, np. /dodaj kupić mleko, odebrać paczkę",
  staleList: "To stara wersja listy. Aktualna jest przypięta u góry.",
  oldListNote: "Ta lista jest nieaktualna. Aktualna jest przypięta u góry.",
  noReminders: "Nie masz zaplanowanych przypomnień.",
  remindersHeader: "Zaplanowane przypomnienia (kliknij ✕, żeby usunąć):",
  remindersNote: "Treść jest w wiadomościach, na które odpowiem.",

  // Darmowe wiadomości AI
  poolEmpty: "Darmowa pula na dziś się skończyła. Ustaw to przyciskami, a jutro wracam do zdań.",
  lastFree: "To była Twoja ostatnia darmowa wiadomość AI. Dalej ustawisz wszystko przyciskami, a bez limitu z własnym kluczem.",
  fewLeft: (left: number) => `(${remaining(left)} ${left} ${plural(left, "darmowa wiadomość", "darmowe wiadomości", "darmowych wiadomości")} AI)`,

  // Własny klucz
  keyInfo: (has: string | null) =>
    [
      has ?? "Podepnij własny klucz AI, a będę rozumiał zwykłe zdania bez limitu. Za użycie płacisz bezpośrednio dostawcy.",
      "Najprościej: darmowy klucz Gemini z Google AI Studio, aistudio.google.com/apikey",
      "Wyślij go tutaj jako: /klucz TWÓJ_KLUCZ\nUsunę Twoją wiadomość od razu, a klucz zapiszę zaszyfrowany.",
      "Obsługuję Gemini, OpenAI, Anthropic i OpenRouter. Ustaw na kluczu limit wydatków, tak na wszelki wypadek.",
    ].join("\n\n"),
  keyHas: (provider: Provider, model: string) =>
    `Masz podpięty klucz ${PROVIDER_NAMES[provider]} (model: ${model}). Zmiana modelu: /model nazwa. Usunięcie: /klucz usun`,
  keyOk: (provider: Provider, model: string) =>
    `✓ Klucz ${PROVIDER_NAMES[provider]} działa. Twoją wiadomość z kluczem usunąłem.\n\nOd teraz piszesz bez limitu. Model: ${model}, zmienisz go przez /model nazwa.`,
  keyInvalid: (provider: Provider) => `${PROVIDER_NAMES[provider]} odrzucił ten klucz. Sprawdź, czy jest aktywny, i wyślij go jeszcze raz.`,
  keyCheckFailed: "Nie mogę teraz sprawdzić klucza. Spróbuj za chwilę.",
  keyUnknown: "Nie rozpoznaję tego klucza. Obsługuję klucze Gemini (AIza… albo AQ.…), OpenAI (sk-…), Anthropic (sk-ant-…) i OpenRouter (sk-or-…).",
  keyRemoved: "Usunąłem Twój klucz.",
  keyNone: "Nie masz podpiętego klucza.",
  keyOff: "Ta instancja Otta nie obsługuje własnych kluczy.",
  keyBroken: "Twój klucz przestał działać, sprawdź go w panelu dostawcy albo podepnij nowy: /klucz.",
  keyDeletedWarning: "Usunąłem wiadomość, bo wyglądała na klucz API.",
  modelSet: (model: string) => `Ustawione: ${model}. Jeśli taki model nie istnieje, zobaczysz błąd przy następnej wiadomości.`,
  modelNeedsKey: "Model zmienisz po podpięciu własnego klucza: /klucz",
  modelBad: "Nazwa modelu może mieć litery, cyfry i znaki . - _ / :",
  aiFailed: "Nie dogadałem się teraz z modelem. Ustaw to przyciskami:",

  // Strefa i dane
  tzCurrent: (tz: string) => `Twoja strefa: ${tz}. Wybierz inną albo wpisz np. /strefa Europe/London`,
  tzSet: (tz: string) => `Strefa ustawiona: ${tz}.`,
  tzBad: "Nie znam takiej strefy. Przykłady: Europe/Warsaw, Europe/London, America/New_York.",
  cancelled: "Anulowane.",
  forgetAsk:
    "Usunę wszystko, co o Tobie wiem: ustawienia, klucz i zaplanowane przypomnienia. Wiadomości i lista zostają w Telegramie, możesz je usunąć sam. Darmowe wiadomości AI się nie odnowią.",
  forgotten: "Gotowe, nic już o Tobie nie wiem. Jeśli wrócisz, kliknij /start.",
  notForgotten: "Nic nie usuwam.",
  unknownCommand: "Nie znam tej komendy. Zobacz /pomoc",
  error: "Coś mi się wysypało. Spróbuj jeszcze raz za chwilę.",

  // Przyciski
  btnKey: "🔑 Własny klucz AI",
  btnCompany: "Bot dla firmy",
  btnHow: "Jak to działa?",
  btnManual: "Jak ustawiać ręcznie?",
  btnList: "📋 Dopisz do listy",
};

/** Polska odmiana: 1 wiadomość, 2–4 wiadomości, 5+ wiadomości (12–14 jak 5+). */
export function plural(n: number, one: string, few: string, many: string) {
  if (n === 1) return one;
  const units = n % 10;
  const tens = n % 100;
  return units >= 2 && units <= 4 && (tens < 12 || tens > 14) ? few : many;
}

const messages = (n: number) => `${n} ${plural(n, "wiadomość", "wiadomości", "wiadomości")}`;
const remaining = (n: number) => plural(n, "została", "zostały", "zostało");
