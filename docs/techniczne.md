# Otto: dokumentacja techniczna

Cloudflare Workers + Durable Objects, bez frameworka. Telegram przez webhook, AI przez Gemini Flash (darmowe wiadomości i strona) albo klucz użytkownika. Opis dla ludzi jest w [README](../README.md).

## Pliki

| Plik | Co robi |
|---|---|
| [`src/index.ts`](../src/index.ts) | router: `/tg/webhook`, `/api/ask`, `/admin/*`, `/telegram` (przekierowanie do bota), reszta to strona z `public/` |
| [`src/chat.ts`](../src/chat.ts) | `Chat`: jeden obiekt na jedną rozmowę prywatną. Wiadomości, przyciski, lista, przypomnienia (alarm), darmowe wiadomości na start, własny klucz |
| [`src/registry.ts`](../src/registry.ts) | `Registry`: jeden wspólny obiekt. Konta, które odebrały darmowe wiadomości (hash numeru czatu), dzienne pule, limity zapytań ze strony |
| [`src/telegram.ts`](../src/telegram.ts) | cienki klient Bot API i udawany Telegram dla `DEV_DRY_RUN` |
| [`src/time.ts`](../src/time.ts) | strefy czasowe i parser polskich terminów („jutro o 9”, „za 2 h”, „w piątek 15:30”) |
| [`src/tasks.ts`](../src/tasks.ts) | format listy w przypiętej wiadomości |
| [`src/ai.ts`](../src/ai.ts) | Gemini, OpenAI, Anthropic, OpenRouter: odpowiedź w JSON, sprawdzanie klucza, rozpoznawanie klucza w tekście |
| [`src/prompts.ts`](../src/prompts.ts) | instrukcje dla modelu i walidacja jego odpowiedzi (bot i strona) |
| [`src/site.ts`](../src/site.ts) | rozmowa z Ottem na stronie, z limitami |
| [`src/crypto.ts`](../src/crypto.ts) | hashe z `HASH_PEPPER`, AES-GCM dla kluczy |
| [`src/texts.ts`](../src/texts.ts) | wszystko, co Otto mówi w Telegramie |
| [`public/`](../public/) | strona: `index.html`, `assets/otto.js` (animowany Otto), `assets/app.js` (reakcje i czat), naklejki, ilustracje, fonty |
| [`scripts/assets.mjs`](../scripts/assets.mjs) | naklejki, avatar, ikony i WebP z [`scripts/otto-svg.mjs`](../scripts/otto-svg.mjs) i `design/zrodla/` |
| [`scripts/smoke.mjs`](../scripts/smoke.mjs) | test dymny całego bota na lokalnym `wrangler dev` |

## Jak płynie wiadomość

1. Telegram wysyła aktualizację na `/tg/webhook` z nagłówkiem `X-Telegram-Bot-Api-Secret-Token`. Worker sprawdza podpis, odrzuca czaty inne niż prywatne i odpowiada od razu `200`.
2. Resztę robi obiekt `Chat` dla tego czatu (w `waitUntil`, czyli do 30 s po odpowiedzi). Aktualizacje jednej osoby idą po kolei (kolejka w pamięci obiektu), a powtórki Telegrama odrzuca numer `update_id`.
3. Kolejność decyzji: wiadomość z kluczem API (kasujemy ją przed czymkolwiek innym) → komenda → AI (własny klucz albo darmowa pula) → tryb ręczny z przyciskami.

## Dane

**`Chat`** (stan w kluczu `state`):

| Pole | Co to |
|---|---|
| `chatId`, `tz` | gdzie i w jakiej strefie |
| `freeLeft`, `claimed` | darmowe wiadomości AI (przy pierwszym kontakcie `FREE_MESSAGES`, jeśli rejestr nie zna jeszcze tego konta) |
| `key` | `{ provider, sealed, model }`; `sealed` to AES-GCM z `KEY_SECRET`, z numerem czatu jako danymi powiązanymi |
| `awaiting` | czekamy na klucz po `/klucz` |
| `listId` | numer przypiętej wiadomości z listą |

Tabela `reminders (id, msg_id, at)`: tylko numer wiadomości i godzina. Obiekt ma jeden alarm, zawsze ustawiony na najbliższe przypomnienie. Po wysłaniu wiersz znika.

**`Registry`**: `claims` (hash numeru czatu `c:…`: darmowe wiadomości raz na konto, także po `/zapomnij`), `budget` (dzienne pule `bot` i `site`), `hits` (limity zapytań ze strony po hashu IP, sprzątane po dobie). Maili ani numerów telefonów nie zbieramy.

## Lista w przypiętej wiadomości

Otto edytuje własną wiadomość i czyta ją z powrotem przez `getChat` (`pinned_message`). Telegram zwraca tylko **najnowszą** przypiętą wiadomość, licząc po dacie wysłania. Jeśli ktoś przypnie w czacie z Ottem coś nowszego, Otto odpina wszystko i przypina listę z powrotem. Usunięta lista przepada, a następny wpis zaczyna nową. Limit: 40 wpisów po 160 znaków (wiadomość ma najwyżej 4096 znaków).

## Przypomnienia

Przypominając, Otto odpowiada na oryginalną wiadomość, więc treść widać w cytacie. Jeśli oryginał został usunięty, Telegram wysyła odpowiedź bez cytatu, a Otto zmienia ją na „ta wiadomość została usunięta”. `/przypomnienia` pokazuje tylko godziny, bo treści nie trzymamy.

## AI

- Darmowe wiadomości i strona: Gemini (`GEMINI_MODEL`, domyślnie alias `gemini-flash-latest`). Każda darmowa wiadomość zużywa jedną z puli `DAILY_FREE_LIMIT`, a przy błędzie modelu wraca do licznika i do puli.
- Własny klucz: dostawca rozpoznany po początku klucza (`AIza…`, `sk-ant-…`, `sk-or-…`, `sk-…`), sprawdzony bezpłatnym zapytaniem (lista modeli albo opis klucza). Model domyślny dostawcy zmienia `/model`.
- Model zwraca JSON z odpowiedzią, przypomnieniami (czas lokalny), wpisami do dopisania i numerami do odhaczenia. Kod sprawdza każde pole: przypomnienie w przeszłości albo za ponad rok przepada, najwyżej 3 na wiadomość.
- Model nie ma żadnych narzędzi poza tym planem, więc wstrzyknięte polecenia w treści wiadomości nie mają czego nadużyć. Tak ma zostać.

## Strona

`/api/ask` przyjmuje ostatnie 8 wypowiedzi (po 500 znaków), limit to 12 pytań na 10 minut i 60 na dobę z jednego adresu (hash IP) plus `SITE_DAILY_LIMIT` na całą stronę. Bez klucza, po limicie albo przy błędzie odpowiada `{ "fallback": true }`, a przeglądarka bierze gotowe odpowiedzi z `assets/app.js`. Kafelki w czacie zawsze używają gotowych odpowiedzi.

Otto na stronie to jedna pętla klatek (`assets/otto.js`): miny i mruganie, sprężyny spojrzenia i pochylenia, fizyka skoku (przysiad, rozciągnięcie, lądowanie z drgnięciem), oddech, mówienie, myślenie i drzemka po 25 s bezczynności. W hero `assets/toss.js` pozwala nim rzucać: prędkość z ostatnich 90 ms ruchu ręki, grawitacja, odbicia od ścian i podłogi sekcji (współczynniki 0,7 i 0,62), toczenie z obrotem oczu (kąt = droga / promień), powrót na miejsce sprężyną krytycznie tłumioną. Enter albo spacja rzuca w losową stronę. Porozmawiać można z Ottem w rogu ekranu (na telefonie pojawia się za hero). `prefers-reduced-motion` zostawia tylko miny i mruganie.

## Znane ograniczenia

- Checklisty Telegrama (`sendChecklist`) są dostępne tylko dla kont biznesowych, dlatego lista to zwykła przypięta wiadomość.
- Odpowiedzi AI nie są jeszcze strumieniowane (`sendMessageDraft`): Otto pokazuje „pisze…” i wysyła całość.
- Naklejki są statyczne (WebP). Animowane wymagałyby WebM VP9 z przezroczystością.
