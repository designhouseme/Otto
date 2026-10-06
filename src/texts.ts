/**
 * Wszystko, co Otto mówi w Telegramie, w jednym miejscu.
 * Ton: konkretnie, ciepło, krótko. Bez długich myślników.
 */

import { PROVIDER_NAMES, type Provider } from "./ai";
import { MAX_AUDIO_SECONDS, MAX_MEDIA_BYTES } from "./media";
import type { Tone } from "./prompts";

export const USES: Record<string, string> = { praca: "Praca", dom: "Dom", nauka: "Nauka", wszystko: "Wszystko po trochu" };
/** Charakter Otta: przyciski w personalizacji (dwa rzędy po dwa). */
export const TONES: [Tone, string][] = [
  ["warm", "Serdecznie i ciepło"],
  ["technical", "Rzeczowo, konkretnie"],
  ["neutral", "Neutralnie"],
  ["casual", "Na luzie, z humorem"],
];
export const ZONES: [string, string][] = [
  ["Polska", "Europe/Warsaw"],
  ["Wielka Brytania", "Europe/London"],
  ["Niemcy", "Europe/Berlin"],
  ["Irlandia", "Europe/Dublin"],
];

/** Strefa po ludzku: „Polska (Europe/Warsaw)” dla znanych, sama nazwa IANA dla pozostałych. */
export const zoneName = (tz: string) => {
  const label = ZONES.find(([, z]) => z === tz)?.[0];
  return label ? `${label} (${tz})` : tz;
};

export const T = {
  // Powitanie i personalizacja
  hello: "Cześć, jestem Otto. Pamiętam za Ciebie: przypominam o czasie i prowadzę Twoją listę zadań. Treść zostaje tutaj, w Telegramie.",
  onboardAsk: "Zanim zaczniemy: trzy krótkie pytania, żebym pisał po Twojemu. Zajmie to pół minuty.",
  btnOnboardGo: "Dobra, pytaj",
  btnSkip: "Pomiń",
  askName: "Jak mam się do Ciebie zwracać? Napisz imię albo ksywkę.",
  badName: "Napisz samo imię albo ksywkę (do 30 znaków) albo kliknij „Pomiń”.",
  askTone: "W jakim stylu mam z Tobą rozmawiać?",
  personalityAsk: (current?: string) => `Jak mam z Tobą rozmawiać?${current ? ` Teraz: ${current}.` : ""}`,
  // Każde potwierdzenie już w wybranym stylu
  personalitySet: (tone: Tone) =>
    ({
      warm: "Od teraz piszę serdecznie i ciepło. Fajnie, że jesteś! 😊",
      technical: "Styl: rzeczowy. Konkrety, bez ozdobników.",
      neutral: "Dobrze. Od teraz piszę neutralnie.",
      casual: "Luzik, od teraz gadamy na luzie! 😎",
    })[tone],
  askUse: "Do czego głównie mnie użyjesz?",
  tzOther: "Inna strefa",
  tzOtherHint: "Wpisz swoją strefę, np. /strefa America/New_York",
  answered: (question: string, answer: string) => `${question} ${answer}`,
  onboardDone: (name: string | undefined, line: string, zone: string) =>
    `Gotowe${name ? `, ${name}` : ""}! ${line}\n\nGodziny liczę w strefie: ${zone}. Za granicą zmienisz ją przez /strefa. Odpowiedzi zmienisz przez /ustawienia.`,
  welcomeBack: (name: string | undefined, line: string) => `Cześć${name ? `, ${name}` : ""}! ${line}`,
  lineFree: (left: number) => `Masz ${messages(left)} AI: pisz do mnie zwykłymi zdaniami, np. „jutro o 9 przypomnij mi o fakturze”.`,
  lineKey: "Masz podpięty własny klucz AI, więc piszesz do mnie zwykłymi zdaniami bez limitu.",
  lineVip: "Masz AI bez limitu od Design House. Pisz do mnie zwykłymi zdaniami.",
  lineCommands: "Działam teraz na komendach, np. /przypomnij jutro o 9 faktura albo /dodaj mleko. Wszystkie są w /pomoc.",

  help: (status: string) =>
    [
      "Co umiem:",
      "• pisz do mnie zwykłymi zdaniami (AI), np. „w piątek po pracy przypomnij mi o oponach”",
      "• wyślij głosówkę albo zdjęcie (AI), np. zdjęcie faktury z podpisem „przypomnij dzień przed terminem”",
      "• /przypomnij jutro o 9 faktura (albo odpowiedz tak na dowolną wiadomość, także zdjęcie)",
      "• /dodaj mleko, chleb: dopisuje do listy",
      "• /lista: Twoja lista, przypięta u góry czatu",
      "• /przypomnienia: co i kiedy przypomnę",
      "• /klucz: własny klucz AI, bez limitu",
      "• /osobowosc: mój styl (serdecznie, rzeczowo, neutralnie albo na luzie)",
      "• /ustawienia: jak mam się do Ciebie zwracać, mój styl i do czego mnie używasz",
      "• /strefa, /id, /zapomnij",
      "",
      status,
      "",
      "Nie zapisuję treści Twoich wiadomości. Przypomnienie to dla mnie tylko numer wiadomości i godzina.",
    ].join("\n"),
  statusKey: (provider: Provider) => `Klucz: ${PROVIDER_NAMES[provider]}, AI bez limitu.`,
  statusFree: (left: number) => `Darmowe wiadomości AI: ${left}.`,
  freeUsedStatus: "Darmowe wiadomości AI wykorzystane, działam na komendach. Bez limitu z własnym kluczem: /klucz",
  vipStatus: "AI bez limitu (VIP od Design House).",

  // Tryb komend (bez AI)
  commandMode: "Teraz działam na komendach, zwykłych zdań bez AI nie rozumiem. Na przykład:\n/przypomnij jutro o 9 faktura\n/dodaj mleko, chleb\n/lista",
  commandModeTime: (when: string) => `Wygląda na przypomnienie ${when}. Ustawisz je komendą /przypomnij, gotową masz pod przyciskiem.`,
  commandMedia: "Żeby przypomnieć o tej wiadomości, odpowiedz na nią komendą, np. /przypomnij jutro o 9",
  commandMediaAi:
    "Zdjęcia i głosówki rozumiem, gdy działa AI, a teraz działam na komendach. Żeby przypomnieć o tej wiadomości, odpowiedz na nią komendą, np. /przypomnij jutro o 9.",

  // Głosówki i zdjęcia
  voiceTooLong: `Ta głosówka jest dla mnie za długa: słucham najwyżej ${MAX_AUDIO_SECONDS / 60} ${plural(MAX_AUDIO_SECONDS / 60, "minutę", "minuty", "minut")}. Nagraj krótszą albo napisz tekstem.`,
  voiceAnthropic: "Z kluczem Anthropic nie zrozumiem głosówki, bo Claude nie przyjmuje dźwięku. Napisz to tekstem albo podepnij klucz Gemini lub OpenAI: /klucz",
  voiceEmpty: "Nic nie usłyszałem w tej głosówce. Nagraj ją jeszcze raz albo napisz tekstem.",
  fileTooBig: `Ten plik jest dla mnie za duży (do ${MAX_MEDIA_BYTES / 1024 / 1024} MB). Wyślij mniejszy albo napisz tekstem.`,
  mediaFailed: "Nie udało mi się pobrać tego pliku z Telegrama, ta wiadomość się nie liczy. Spróbuj jeszcze raz.",
  mediaModel: "Ten model nie przyjmuje zdjęć albo głosówek. Wybierz przez /model taki, który je rozumie, albo napisz tekstem.",
  btnCopyCommand: "📋 Skopiuj komendę",
  lastFree: [
    "To była ostatnia z Twoich 10 darmowych wiadomości AI. Co dalej? Masz trzy drogi:",
    "• Komendy, zawsze za darmo: /przypomnij jutro o 9 faktura, /dodaj mleko, /lista",
    "• Własny klucz AI, bez limitu: /klucz (najprościej darmowy klucz Gemini)",
    "• Abonament Design House: wiadomości bez limitu, bez klucza i bez konfiguracji. Napisz do nas, ustalimy szczegóły.",
  ].join("\n"),
  fewLeft: (left: number) => `(${remaining(left)} ${left} ${plural(left, "darmowa wiadomość", "darmowe wiadomości", "darmowych wiadomości")} AI)`,
  poolEmpty: "Darmowa pula AI na dziś się skończyła. Do jutra działam na komendach: /pomoc",
  aiFailed: "Nie dogadałem się teraz z modelem, ta wiadomość się nie liczy. Spróbuj za chwilę albo użyj komendy, np. /przypomnij jutro o 9 faktura",

  // Przypomnienia
  reminderSet: (when: string) => `⏰ Przypomnę ${when}.`,
  reminder: "⏰ Przypominam o tym ↑",
  reminderOrphan: "⏰ Miałem Ci o czymś przypomnieć, ale ta wiadomość została usunięta.",
  remindUsage: "Napisz, kiedy i o czym, np. /przypomnij jutro o 9 faktura. Możesz też odpowiedzieć tak na dowolną wiadomość, także na zdjęcie.",
  remindWhen: "Kiedy mam Ci o tym przypomnieć?",
  notUnderstoodTime: "Nie rozumiem tego terminu. Wybierz:",
  done: "✓ Zrobione",
  timePassed: "Ta godzina już minęła",
  noReminders: "Nie masz zaplanowanych przypomnień.",
  remindersHeader: "Zaplanowane przypomnienia (kliknij ✕, żeby usunąć):",
  remindersNote: "Treść jest w wiadomościach, na które odpowiem.",

  // Lista
  addUsage: "Napisz, co dopisać, np. /dodaj kupić mleko, odebrać paczkę",
  staleList: "To stara wersja listy. Aktualna jest przypięta u góry.",
  oldListNote: "Ta lista jest nieaktualna. Aktualna jest przypięta u góry.",

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

  // Numer konta i VIP
  yourId: (id: number) => `Twój numer konta w Telegramie: ${id}\n\nPodaj go Design House, jeśli masz dostać więcej wiadomości AI do testów.`,
  btnCopyId: "Kopiuj numer",
  vipGranted: "🎉 Design House dał Ci AI bez limitu. Pisz do mnie zwykłymi zdaniami, ile chcesz.",
  vipRemoved: "Twój dostęp VIP się skończył. Dalej działają komendy, a bez limitu z własnym kluczem: /klucz",
  messagesAdded: (n: number) => `🎉 Design House dorzucił Ci ${messages(n)} AI. Pisz do mnie zwykłymi zdaniami.`,
  adminHelp:
    "Komendy admina:\n/vip NUMER: AI bez limitu\n/vip NUMER 50: dorzuca 50 wiadomości\n/unvip NUMER: cofa VIP\n/vip: lista VIP-ów\n\nNumer konta ktoś sprawdza u siebie komendą /id.",
  adminBadId: "Podaj numer konta, np. /vip 123456789. Ktoś sprawdza go u siebie komendą /id.",
  adminBadAmount: "Liczba wiadomości od 1 do 1000, np. /vip 123456789 50.",
  adminDone: (what: string, id: number, notified: boolean) =>
    `✓ ${what} dla ${id}.${notified ? " Dałem mu znać." : " Nie mogłem do niego napisać: niech kliknie Start u Otta, a zmiana i tak już działa."}`,
  adminVipList: (ids: number[]) => (ids.length ? `VIP-y (AI bez limitu):\n${ids.join("\n")}` : "Na razie nie ma VIP-ów."),

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
  btnSubscription: "Abonament: napisz do nas",
  btnCommands: "Jak działają komendy",
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
