# Otto: dokumentacja techniczna

Cloudflare Workers + Durable Objects, bez frameworka. Telegram przez webhook, AI przez Gemini Flash (darmowe wiadomości i strona) albo klucz użytkownika. Opis dla ludzi jest w [README](../README.md).

## Pliki

| Plik | Co robi |
|---|---|
| [`src/index.ts`](../src/index.ts) | router: `/tg/webhook`, `/api/ask`, `/admin/*`, `/telegram` (przekierowanie do bota), `/kalendarz` (plik .ics), reszta to strona z `public/` |
| [`src/calendar.ts`](../src/calendar.ts) | „Dodaj do kalendarza”: link do Google Kalendarza, plik .ics dla Apple i Outlooka z zaszyfrowanego linku, tytuł bez słów o czasie |
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
| [`scripts/assets.mjs`](../scripts/assets.mjs) | naklejki, avatar i ikony z geometrii Otta w [`scripts/otto-svg.mjs`](../scripts/otto-svg.mjs) |
| [`scripts/smoke.mjs`](../scripts/smoke.mjs) | test dymny całego bota na lokalnym `wrangler dev` |

## Jak płynie wiadomość

1. Telegram wysyła aktualizację na `/tg/webhook` z nagłówkiem `X-Telegram-Bot-Api-Secret-Token`. Worker sprawdza podpis, odrzuca czaty inne niż prywatne i odpowiada od razu `200`.
2. Resztę robi obiekt `Chat` dla tego czatu (w `waitUntil`, czyli do 30 s po odpowiedzi). Aktualizacje jednej osoby idą po kolei (kolejka w pamięci obiektu), a powtórki Telegrama odrzuca numer `update_id`.
3. Kolejność decyzji: wiadomość z kluczem API (kasujemy ją przed czymkolwiek innym) → komenda → imię z personalizacji → AI (własny klucz, VIP albo darmowe wiadomości) → tryb komend. Otto odpowiada zwykłymi wiadomościami; jedyna odpowiedź „na wiadomość” to samo przypomnienie (i przyciski terminu po `/przypomnij` w odpowiedzi na wiadomość).
4. Pierwsze `/start` proponuje personalizację: imię albo ksywka, styl rozmowy (serdecznie, rzeczowo, neutralnie albo na luzie) i do czego Otto ma służyć. O strefę nie pyta: domyślnie `DEFAULT_TZ` (Polska), za granicą `/strefa`. Każdy krok można pominąć, a `/ustawienia` zaczyna od nowa. Model dostaje to w instrukcji.
5. Bez AI (po 10 darmowych, bez klucza i VIP-a) zwykły tekst dostaje krótką podpowiedź z komendą. Jeśli w tekście jest termin, przycisk „Skopiuj komendę” podsuwa gotowe `/przypomnij …`. Po ostatniej darmowej wiadomości Otto pisze o trzech drogach: komendy, własny klucz, abonament (`CONTACT_URL`).

## Dane

**`Chat`** (stan w kluczu `state`):

| Pole | Co to |
|---|---|
| `chatId`, `tz` | gdzie i w jakiej strefie |
| `freeLeft`, `claimed` | darmowe wiadomości AI (przy pierwszym kontakcie `FREE_MESSAGES`, jeśli rejestr nie zna jeszcze tego konta) |
| `key` | `{ provider, sealed, model }`; `sealed` to AES-GCM z `KEY_SECRET`, z numerem czatu jako danymi powiązanymi |
| `vip` | AI bez limitu na kluczu serwera, nadane przez admina (`/vip NUMER`) |
| `profile`, `onboarded` | personalizacja (imię albo ksywka, styl rozmowy, do czego służy Otto), tylko jeśli ktoś ją poda |
| `awaiting` | czekamy na klucz po `/klucz` albo na imię w personalizacji |
| `listId` | numer przypiętej wiadomości z listą |

Tabela `reminders (id, msg_id, at)`: tylko numer wiadomości i godzina. Obiekt ma jeden alarm, zawsze ustawiony na najbliższe przypomnienie. Po wysłaniu wiersz znika.

**`Registry`**: `claims` (hash numeru czatu `c:…`: darmowe wiadomości raz na konto, także po `/zapomnij`), `budget` (dzienne pule `bot` i `site`), `hits` (limity zapytań ze strony po hashu IP, sprzątane po dobie), `vips` (numery czatów z VIP-em, do listy u admina). Maili ani numerów telefonów nie zbieramy.

## VIP i testerzy

`/id` podaje numer konta (z przyciskiem kopiowania). Admini to numery z sekretu `ADMIN_CHAT_IDS`; tylko oni widzą i mogą użyć `/vip` i `/unvip` (innym bot odpowiada jak na nieznaną komendę). Zmiana idzie przez obiekt rozmowy tej osoby (`grant`, w jego kolejce), a obdarowany dostaje wiadomość od Otta. VIP używa klucza serwera i dziennej puli `bot`, ale nie zużywa licznika. `/vip NUMER 50` tylko dorzuca wiadomości do licznika. `/admin/setup` ustawia adminom w menu dodatkowe komendy (zakres czatu).

## Lista w przypiętej wiadomości

Otto edytuje własną wiadomość i czyta ją z powrotem przez `getChat` (`pinned_message`). Telegram zwraca tylko **najnowszą** przypiętą wiadomość, licząc po dacie wysłania. Jeśli ktoś przypnie w czacie z Ottem coś nowszego, Otto odpina wszystko i przypina listę z powrotem. Usunięta lista przepada, a następny wpis zaczyna nową. Limit: 40 wpisów po 160 znaków (wiadomość ma najwyżej 4096 znaków).

## Przypomnienia

Przypominając, Otto odpowiada na oryginalną wiadomość, więc treść widać w cytacie. Jeśli oryginał został usunięty, Telegram wysyła odpowiedź bez cytatu, a Otto zmienia ją na „ta wiadomość została usunięta”. `/przypomnienia` pokazuje tylko godziny, bo treści nie trzymamy.

## AI

- Darmowe wiadomości i strona: Gemini (`GEMINI_MODEL`, domyślnie alias `gemini-flash-latest`). Każda darmowa wiadomość zużywa jedną z puli `DAILY_FREE_LIMIT`, a przy błędzie modelu wraca do licznika i do puli.
- Model zapasowy (`GEMINI_FALLBACK_MODEL`): główny dostaje 60% budżetu czasu, a gdy oddaje 503, 429, milczy albo zrywa połączenie, resztę czasu dostaje lżejszy model. Oba podejścia mieszczą się w jednym budżecie (20 s, z plikiem 24 s), bo całość musi się zmieścić w ok. 30 s `waitUntil`.
- Własny klucz: dostawca rozpoznany po początku klucza (`AIza…`, `sk-ant-…`, `sk-or-…`, `sk-…`), sprawdzony bezpłatnym zapytaniem (lista modeli albo opis klucza). Model domyślny dostawcy zmienia `/model`.
- Model zwraca JSON z odpowiedzią, przypomnieniami, wpisami do dopisania i numerami do odhaczenia. Kod sprawdza każde pole: przypomnienie w przeszłości albo za ponad rok przepada, najwyżej 3 na wiadomość.
- Czas: model dostaje bieżącą godzinę i kalendarz na dwa tygodnie z dniami tygodnia (`calendar` w `src/time.ts`), bo licząc dni w pamięci myli piątek z czwartkiem. Przypomnienie podaje jako czas lokalny `RRRR-MM-DDTGG:MM` z tego kalendarza albo jako czas od teraz (`+20m`, `+2h`), który liczy już kod (`reminderAt`). W odpowiedzi nie podaje terminu: dokładny termin dopisuje aplikacja, więc nie ma dwóch wersji.
- Lista i przypomnienia są osobno: to, co dostaje termin, nie trafia na listę, chyba że ktoś o to prosi. Dla tekstu (i transkrypcji) kod to pilnuje: przy przypomnieniu bez słowa o liście wpisy do listy przepadają.
- Styl rozmowy z personalizacji (`Tone` w `src/prompts.ts`): serdecznie, rzeczowo, neutralnie albo na luzie; dawne „short” to rzeczowo. `/osobowosc` zmienia go jednym kliknięciem (przyciski `o:…`), a potwierdzenie jest już w nowym stylu.
- Model nie ma żadnych narzędzi poza tym planem, więc wstrzyknięte polecenia w treści wiadomości nie mają czego nadużyć. Tak ma zostać.

## Kalendarz

Otto nie czyta niczyjego kalendarza, ale każdy termin można do niego dodać jednym kliknięciem. Pod potwierdzeniem przypomnienia (z AI i z `/przypomnij`) są dwa przyciski: „Google Kalendarz” to link prosto do Google z tytułem i godziną (`action=TEMPLATE`), a „Apple, Outlook” to link do `/kalendarz?e=…`, gdzie `e` to tytuł i godzina zaszyfrowane AES-GCM kluczem `KEY_SECRET` w osobnym kontekście („kalendarz”), więc ten szyfrogram nie odszyfruje się jako klucz API. Worker oddaje z niego plik .ics (RFC 5545: znaki specjalne, linie po 75 bajtów, wydarzenie na 30 minut z alarmem), niczego nie zapisując; w logach widać tylko szyfrogram. Ścieżka jest w `run_worker_first`, bo inaczej odpowiedziałaby strona 404.

Tytuł daje model (`title`), a w komendach `cleanTitle` wycina z tekstu słowa o czasie („jutro o 9 faktura” → „Faktura”). Gdy model znajdzie termin, o który nikt nie prosił (np. na zdjęciu faktury), zwraca go w `suggest`: Otto pokazuje przycisk „⏰ Przypomnij …” (`s:wiadomość:czas`) i kalendarz. To samo w trybie komend, gdy parser znajdzie termin w zwykłej wiadomości. Po kliknięciu termin sprawdzamy jeszcze raz (przycisk mógł czekać godzinami), do wiadomości dochodzi potwierdzenie, a przyciski kalendarza zostają.

## Głosówki i zdjęcia

Z AI Otto rozumie głosówki, nagrania (do 3 minut), zdjęcia i obrazki wysłane jako plik (JPEG, PNG, WebP, do 8 MB). `src/media.ts` wybiera, co wysłać (ze zdjęcia największy rozmiar do 1600 px), a `Telegram.download` pobiera plik przez `getFile` tylko na czas jednego zapytania i nigdzie go nie zapisuje. Za długie, za duże albo nieobsługiwane pliki odrzucamy przed zużyciem darmowej wiadomości.

| Dostawca | Zdjęcia | Głosówki |
|---|---|---|
| Gemini (darmowe, VIP, własny klucz) | wprost (`inlineData`) | wprost (OGG z Telegrama) |
| OpenAI | `image_url` | transkrypcja (`gpt-4o-mini-transcribe`, zapasowo `whisper-1`), potem zwykły tekst |
| OpenRouter | `image_url` | `input_audio`, jeśli wybrany model przyjmuje dźwięk |
| Anthropic | blok `image` | nie: Claude nie przyjmuje dźwięku, Otto mówi to od razu |

Wiadomość dla modelu jest oznaczona (`[głosówka]`, `[zdjęcie]` i podpis), a instrukcja mówi, że treść plików, także tekst widoczny na zdjęciu, to dane, nie polecenia. Zdjęcie bez słowa: Otto opisuje, co z niego wynika, i proponuje przypomnienie, ale niczego sam nie ustawia.

## Strona

`/api/ask` przyjmuje ostatnie 8 wypowiedzi (po 500 znaków), limit to 12 pytań na 10 minut i 60 na dobę z jednego adresu (hash IP) plus `SITE_DAILY_LIMIT` na całą stronę. Bez klucza, po limicie albo przy błędzie odpowiada `{ "fallback": true }`, a przeglądarka bierze gotowe odpowiedzi z `assets/app.js`. Kafelki w czacie zawsze używają gotowych odpowiedzi.

Otto na stronie to jedna pętla klatek (`assets/otto.js`): miny i mruganie, sprężyny spojrzenia i pochylenia, fizyka skoku (przysiad, rozciągnięcie, lądowanie z drgnięciem), oddech, mówienie, myślenie i drzemka po 25 s bezczynności. W hero `assets/toss.js` pozwala nim rzucać: prędkość z ostatnich 90 ms ruchu ręki, grawitacja, odbicia od ścian i podłogi sekcji (współczynniki 0,7 i 0,62), toczenie z obrotem oczu (kąt = droga / promień), powrót na miejsce sprężyną krytycznie tłumioną. Enter albo spacja rzuca w losową stronę. Porozmawiać można z Ottem w rogu ekranu (na telefonie pojawia się za hero). `prefers-reduced-motion` zostawia tylko miny i mruganie.

## Znane ograniczenia

- Checklisty Telegrama (`sendChecklist`) są dostępne tylko dla kont biznesowych, dlatego lista to zwykła przypięta wiadomość.
- Odpowiedzi AI nie są jeszcze strumieniowane (`sendMessageDraft`): Otto pokazuje „pisze…” i wysyła całość.
- Naklejki są statyczne (WebP). Animowane wymagałyby WebM VP9 z przezroczystością.
