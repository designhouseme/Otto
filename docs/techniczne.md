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
| `titles` | tytuły przypomnień włączone w panelu (domyślnie brak) |

Tabela `reminders (id, msg_id, at, title)`: numer wiadomości i godzina. `title` jest pusty, chyba że ktoś włączył tytuły w panelu: wtedy to krótki tytuł (do 60 znaków) zaszyfrowany AES-GCM kluczem `KEY_SECRET`, z kontekstem `tytul:NUMER_CZATU`, więc nie odszyfruje się jako klucz API ani w innej rozmowie. Wyłączenie tytułów czyści kolumnę. Kolumnę dodaje `schema()` w starszych obiektach (sprawdza `columnNames`, potem `ALTER TABLE`). Obiekt ma jeden alarm, ustawiony na najbliższe przypomnienie albo plan dnia. Po wysłaniu wiersz znika.

**`Registry`**: `claims` (hash numeru czatu `c:…`: darmowe wiadomości raz na konto, także po `/zapomnij`), `budget` (dzienne pule `bot` i `site`), `hits` (limity zapytań ze strony po hashu IP, sprzątane po dobie), `vips` (numery czatów z VIP-em, do listy u admina). Maili ani numerów telefonów nie zbieramy.

## VIP i testerzy

`/id` podaje numer konta (z przyciskiem kopiowania). Admini to numery z sekretu `ADMIN_CHAT_IDS`; tylko oni widzą i mogą użyć `/vip` i `/unvip` (innym bot odpowiada jak na nieznaną komendę). Zmiana idzie przez obiekt rozmowy tej osoby (`grant`, w jego kolejce), a obdarowany dostaje wiadomość od Otta. VIP używa klucza serwera i dziennej puli `bot`, ale nie zużywa licznika. `/vip NUMER 50` tylko dorzuca wiadomości do licznika. `/admin/setup` ustawia adminom w menu dodatkowe komendy (zakres czatu).

## Lista w przypiętej wiadomości

Lista ma dwa limity: do 40 wpisów i do 4096 znaków całej wiadomości. Jeśli kolejne wpisy się nie mieszczą, Otto informuje o pełnej liście. Panel odrzuca taką operację w całości, żeby nie zgubić części wpisanych zadań.

Otto edytuje własną wiadomość i czyta ją z powrotem przez `getChat` (`pinned_message`). Telegram zwraca tylko **najnowszą** przypiętą wiadomość, licząc po dacie wysłania. Jeśli ktoś przypnie w czacie z Ottem coś nowszego, Otto odpina wszystko i przypina listę z powrotem. Usunięta lista przepada, a następny wpis zaczyna nową. Limit: 40 wpisów po 160 znaków (wiadomość ma najwyżej 4096 znaków).

## Przypomnienia

„Inny termin” (`c:ID_WIADOMOŚCI`) wysyła pytanie z `ForceReply`. Stan `pendingReminder` zawiera wyłącznie `target`, `promptId` i czas wygaśnięcia (15 minut). Tylko odpowiedź na aktualne pytanie trafia do parsera terminu, bez AI i bez zużywania wiadomości. Termin musi być w przyszłości, do 400 dni. Komenda, w tym `/anuluj`, kasuje ten wybór. Przypomnienie wskazuje oryginalną wiadomość, nie pytanie bota.

Przypominając, Otto odpowiada na oryginalną wiadomość, więc treść widać w cytacie. Jeśli oryginał został usunięty, Telegram wysyła odpowiedź bez cytatu, a Otto zmienia ją na „ta wiadomość została usunięta”. `/przypomnienia` pokazuje godziny, a tytuły tylko po ich włączeniu.

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

`CHANGELOG.md` jest jedynym źródłem historii zmian. `scripts/changelog.mjs` generuje z niego `public/nowosci/index.html`, bez JavaScriptu w przeglądarce. `build.command` w `wrangler.jsonc` uruchamia generator przed `wrangler dev` i `wrangler deploy`, także gdy polecenie wywołujesz bezpośrednio, bez npm. Wynik jest pomijany w Git: na GitHubie edytujesz Markdown, a kolejne wdrożenie aktualizuje stronę. Sam push do repozytorium nie wdraża Workera; automatyczny deploy po pushu wymaga podłączenia repozytorium w Cloudflare Workers Builds.

Wpisy mają nagłówki `## Niewydane` (opcjonalnie, na początku) albo `## YYYY-MM-DD`, od najnowszych do najstarszych. Pod nimi są sekcje `### Nowości`, `### Ulepszenia`, `### Poprawki` i punkty `- opis`. Komendy można wyróżnić backtickami. Przy wydaniu zamień „Niewydane” na datę i dopiero wtedy dopisuj następne zapowiedzi. Nieobsługiwany zapis i błędne daty zatrzymują build, a HTML w treści jest escapowany. Lokalny podgląd wygenerujesz przez `npm run changelog`.

`/api/ask` przyjmuje ostatnie 8 wypowiedzi (po 500 znaków), limit to 12 pytań na 10 minut i 60 na dobę z jednego adresu (hash IP) plus `SITE_DAILY_LIMIT` na całą stronę. Bez klucza, po limicie albo przy błędzie odpowiada `{ "fallback": true }`, a przeglądarka bierze gotowe odpowiedzi z `assets/app.js`. Kafelki w czacie zawsze używają gotowych odpowiedzi.

Otto na stronie to jedna pętla klatek (`assets/otto.js`): miny i mruganie, sprężyny spojrzenia i pochylenia, fizyka skoku (przysiad, rozciągnięcie, lądowanie z drgnięciem), oddech, mówienie, myślenie i drzemka po 25 s bezczynności. W hero `assets/toss.js` pozwala nim rzucać: prędkość z ostatnich 90 ms ruchu ręki, grawitacja, odbicia od ścian i podłogi sekcji (współczynniki 0,7 i 0,62), toczenie z obrotem oczu (kąt = droga / promień), powrót na miejsce sprężyną krytycznie tłumioną. Enter albo spacja rzuca w losową stronę. Porozmawiać można z Ottem w rogu ekranu (na telefonie pojawia się za hero). `prefers-reduced-motion` zostawia tylko miny i mruganie.

## Panel Telegram Mini App

Testy bezpieczeństwa i obsługi dat: `npm test`. Lokalny test pełnego przepływu panelu: `BASE=http://127.0.0.1:8791 node scripts/panel-smoke.mjs`, przy Workerze na tym porcie z `DEV_DRY_RUN=1`, `TELEGRAM_BOT_TOKEN=123456:test-token` i `TELEGRAM_WEBHOOK_SECRET=dev-secret`. Ten skrypt nie uruchamia AI, nie podaje kluczy dostawców i akceptuje tylko adres lokalny.

`public/panel/` zawiera interfejs bez frameworka: lista zadań, kalendarz przypomnień i ustawienia. `/panel` wysyła przycisk `web_app`, a `/admin/setup` ustawia domyślny przycisk menu „Panel” na adres HTTPS `/panel/`. Po wdrożeniu trzeba ponownie wywołać `/admin/setup`; do działania przycisku z `/panel` nie jest potrzebny dodatkowy sekret. Opcjonalnie można ustawić ten sam adres jako Main Mini App w BotFather.

`POST /api/panel` przyjmuje JSON i nagłówek `Authorization: tma <Telegram.WebApp.initData>`. `src/panel.ts` weryfikuje HMAC-SHA-256 tokenem bota, obejmując wszystkie pola poza `hash`, także nowe `signature`. Sesja jest ważna godzinę, a duplikaty pól, obcy Origin, brak podpisu i zbyt duże body są odrzucane. Numer konta pochodzi wyłącznie z podpisanego `user.id`. Tryb dry-run nie wyłącza uwierzytelniania. Odpowiedzi mają `Cache-Control: no-store`.

RPC `Chat.panel` używa tej samej kolejki co webhook i alarm. Panel ma limit 30 żądań na minutę na aktywny obiekt rozmowy. Nie otrzymuje zapisanych kluczy AI. Daty z formularzy są interpretowane w strefie konta; nieistniejące daty i godziny przy zmianie czasu są odrzucane. Zmiana strefy nie przesuwa już ustawionych przypomnień.

Kalendarz liczy się w przeglądarce z tych samych danych co lista terminów, bez dodatkowych zapytań. Dni to daty w strefie konta (jak `localValue`), nie w strefie urządzenia, a siatkę i nagłówki liczy arytmetyka UTC, więc zmiana czasu ani strefa telefonu nie przesuwają przypomnień na sąsiedni dzień. Zakres kończy się po 400 dniach, tak jak walidacja terminu. Nowe przypomnienie dodaje się w oknie (`<dialog>`) otwieranym przyciskiem pod kalendarzem. Termin startowy to wybrany dzień o 9:00 (dziś: najbliższa pełna godzina), a bez wybranego dnia za godzinę. Szybkie terminy („Za godzinę”, „Dziś/Jutro 18:00”, „Jutro 9:00”, „Za tydzień”) tylko wypełniają pole daty, a zapis przechodzi przez zwykłe `reminderCreate`.

Obok siatki miesiąca są widoki 1, 2 i 4 tygodni: wiersz na dzień od poniedziałku, z godzinami (i tytułami, gdy są włączone) z tych samych danych co siatka. Karta ma wtedy wysokość okna Telegrama (`--tg-viewport-stable-height`, poza Telegramem `100dvh`), a wiersze dzielą ją po równo. `contain: size` na wierszu nie pozwala, żeby dzień z wieloma przypomnieniami rozpychał pozostałe. Gdy ekran jest za niski na minimalne wiersze (w 4 tygodniach 20 px), karta rośnie i strona się przewija. Wybrany widok trzyma `localStorage` urządzenia (`otto-calendar-weeks`), nie konto, więc nie zmienia API panelu.

Święta (`src/holidays.ts`): polskie dni wolne od pracy, ruchome liczone od Wielkanocy (algorytm Meeusa/Jonesa/Butchera), Wigilia od 2025 r. Panel dostaje je w odpowiedzi na 400 dni naprzód i oznacza na czerwono; nazwa święta jest też pod nagłówkiem wybranego dnia i w planie dnia.

Plan dnia: w ustawieniach panelu godzina (0–23, w interfejsie 6:00–10:00) albo wyłączony. Obiekt rozmowy trzyma go pod osobnym kluczem `digest` (`hour`, najbliższe `next` i adres panelu do przycisku, bo alarm nie zna adresu z żądania). Obiekt ma jeden alarm, więc `rearm` ustawia go na wcześniejszy z terminów: najbliższe przypomnienie albo plan dnia. Zmiana strefy (panel, `/strefa`, przyciski strefy) przelicza `next`. Alarm wysyła plan przed przypomnieniami z tej samej minuty: godziny dzisiejszych przypomnień (z tytułami, jeśli ktoś je włączył), do trzech pierwszych pozycji listy i święto. Pusty dzień bez święta: nic nie wysyła. Plan spóźniony o ponad 3 godziny przepada, a następny jest liczony od nowa. `/zapomnij` usuwa go razem z resztą danych.

Natywne przyciski: gdy klient ma `MainButton` i `BackButton` (Bot API 6.1+), główna akcja widoku jest na przycisku Telegrama („Nowe przypomnienie” w kalendarzu, „Ustaw przypomnienie” albo „Zapisz termin” w oknie, „Zapisz ustawienia” po zmianie ustawień), a strzałka wstecz zamyka okno. Odpowiedniki na stronie są wtedy ukryte (`.native .native-hide`). Akcja jest ustalana w chwili kliknięcia, bo zdarzenie `close` okna przychodzi z opóźnieniem. Starsze klienty i podgląd poza Telegramem używają przycisków na stronie.

Panel nie zna treści przypomnień, a tytuły dostaje tylko po ich włączeniu. Skąd tytuł: z panelu (wpisany tekst), z planu modelu (`title`), z `/przypomnij` (`cleanTitle`), a przy przyciskach (`r:`, `z:`, `s:`, `c:`) z oryginału, na który odpowiada wiadomość z przyciskami, albo z parametru `text` linku Google Kalendarza pod nią. „Inny termin” trzyma go zaszyfrowanego w `pendingReminder` do odpowiedzi. Akcja `reminderShow` wysyła w czacie odpowiedź na oryginalną wiadomość („O tym przypomnę Ci…”), więc treść widać w cytacie; gdy oryginał zniknął, Otto mówi to wprost. Termin się nie zmienia. Ustawienia przyjmują też `use` (praca, dom, nauka, wszystko); stare wersje panelu, które go nie wysyłają, zostawiają zapisaną wartość. Podpowiedź strefy z urządzenia (`Intl…resolvedOptions().timeZone`, bez UTC i `Etc/…`) tylko wypełnia pole: nic się nie zapisuje bez „Zapisz ustawienia”.

Treść nowych przypomnień trafia do zwykłej wiadomości bota w Telegramie; tabela zawiera jej numer i termin, a tytuł tylko po włączeniu tytułów. Lista jest czytana z przypiętej wiadomości i nie jest kopiowana do bazy ani localStorage. Jeśli najnowszą pinezką jest inna wiadomość, panel informuje o potrzebie `/lista`, zamiast odpinać wiadomości podczas odświeżania. Odhaczanie w panelu sprawdza numer aktualnej listy i odcisk zadania, żeby stary widok nie usuwał innego wpisu.

Gdy pracuje model, `Telegram.startTyping` pokazuje w nagłówku czatu „pisze…” (`sendChatAction`). Telegram trzyma ten status 5 sekund, więc odnawiamy go co 4 sekundy, aż `send` wyśle pierwszą wiadomość; `stopTyping` w `finally` zatrzymuje go także po błędzie. Przed wysłaniem wiadomości `send` czeka na trwające odświeżenie, bo status, który dotarłby po wiadomości, wróciłby na 5 sekund. Każde wywołanie ma krótki timeout, a awaria statusu nie blokuje odpowiedzi. Wcześniej był tu szkic `sendMessageDraft` z „Otto myśli…”, ale Telegram rysuje szkic z własnymi animowanymi kropkami (wychodziły podwójne), a dymek potrafił zostać w czacie po odpowiedzi. Szkic ma sens dopiero przy prawdziwym strumieniowaniu treści odpowiedzi.

## Znane ograniczenia

- Checklisty Telegrama (`sendChecklist`) są dostępne tylko dla kont biznesowych, dlatego lista to zwykła przypięta wiadomość.
- Odpowiedzi AI nie są strumieniowane (`sendMessageDraft`), bo model zwraca plan w JSON-ie, a nie gotowy tekst: Otto pokazuje „pisze…” i wysyła całość.
- Naklejki są statyczne (WebP). Animowane wymagałyby WebM VP9 z przezroczystością.
