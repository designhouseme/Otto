<img src="public/og.png" alt="Otto pamięta za Ciebie. Przypomnienia i lista zadań w Telegramie." width="100%">

# Otto

Osobisty asystent na Telegramie. Piszesz do niego jak do znajomego, a Otto przypomina o czasie i prowadzi Twoją listę zadań. Każdy ma własnego Otta, to nie jest bot dla grupy.

Otto robi tyle, ile się da, narzędziami samego Telegrama. Lista zadań to przypięta wiadomość w czacie, a przypomnienie to odpowiedź na Twoją oryginalną wiadomość. Dzięki temu treść zostaje w Telegramie, a po naszej stronie jest tylko to, co niezbędne.

## Co umie

- **Przypomnienia o każdej wiadomości**, także o zdjęciu czy notatce głosowej. Przyciski „Za godzinę”, „Jutro 9:00”, drzemka „+15 min”, „Zrobione”.
- **Polskie terminy bez AI:** „jutro o 9”, „w piątek 15:30”, „za 2 h”, „12.10 o 8”, „za tydzień”.
- **Lista zadań** przypięta u góry czatu. Odhaczasz jednym kliknięciem.
- **Zwykłe zdania z AI**, np. „po pracy przypomnij mi o oponach”: 10 wiadomości za darmo na start, bez maila i rejestracji, a bez limitu z własnym kluczem (Gemini, OpenAI, Anthropic albo OpenRouter).
- **Strona z Ottem**, którym można rzucać jak piłką i z którym można porozmawiać. Odpowiada przez Gemini Flash, a bez sieci gotowymi odpowiedziami.

| Poziom | Co daje |
|---|---|
| Za darmo, zawsze | przyciski, komendy, terminy typu „jutro o 9”, przypomnienia i lista bez limitu |
| 10 wiadomości AI | na start, raz na konto Telegrama, bez maila i rejestracji |
| Własny klucz | AI bez limitu; za użycie płacisz dostawcy klucza |
| Bot dla firmy | wspólny asystent zespołu z integracjami: [Design House](https://designhouse.me/automatyzacje) |

## Prywatność

| Zapisujemy | Nie zapisujemy |
|---|---|
| numer czatu i strefę czasową | treści wiadomości ani historii rozmów |
| licznik darmowych wiadomości AI | listy zadań (to przypięta wiadomość w Telegramie) |
| przypomnienia jako numer wiadomości i godzinę, do chwili wysłania | imienia, nazwy użytkownika, zdjęć |
| klucz API, zaszyfrowany (AES-GCM), jeśli go podasz | |
| hash numeru czatu, żeby darmowe wiadomości były raz na konto | maili ani numerów telefonów |

Gdy Otto używa AI, treść wiadomości trafia do dostawcy modelu. Telegram nie szyfruje rozmów z botami end-to-end. `/zapomnij` usuwa wszystko, co mamy, poza hashem numeru czatu (bez niego darmowe wiadomości dałoby się odnawiać). Wiadomość z kluczem Otto kasuje z czatu od razu.

## Komendy

`/lista` · `/dodaj mleko, chleb` · `/przypomnij jutro o 9` (także w odpowiedzi na dowolną wiadomość) · `/przypomnienia` · `/klucz` · `/model` · `/strefa` · `/pomoc` · `/zapomnij`

## Własna instancja

Potrzebujesz konta Cloudflare (Workers i Durable Objects działają w planie darmowym), Node.js 22+ i bota od [@BotFather](https://t.me/BotFather). Klucz Gemini (darmowe wiadomości i rozmowa na stronie) jest opcjonalny: bez niego działa tryb ręczny i własne klucze użytkowników.

### Lokalnie

```bash
npm install
cp .dev.vars.example .dev.vars    # DEV_DRY_RUN=1: nic nie wychodzi do Telegrama
npm run dev                       # http://localhost:8787
```

W trybie `DEV_DRY_RUN` wywołania Telegrama lądują w konsoli. Test dymny przechodzi całego bota (darmowe wiadomości, tryb ręczny, lista, przypomnienie z alarmem, klucz, `/zapomnij`) zmyślonymi aktualizacjami z Telegrama. Uzupełnij w `.dev.vars` wartości testowe (`TELEGRAM_WEBHOOK_SECRET=dev-secret`, `ADMIN_TOKEN=dev-admin`, `BOT_USERNAME=otto_dev_bot`, `KEY_SECRET`, `HASH_PEPPER`, dowolny `GEMINI_API_KEY`), a potem:

```bash
npm run dev > dev.log 2>&1 &
npm run smoke -- dev.log
```

### Na Cloudflare

```bash
npx wrangler deploy
npx wrangler secret put TELEGRAM_BOT_TOKEN       # od @BotFather
npx wrangler secret put BOT_USERNAME             # nazwa bota bez @
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET  # długi losowy ciąg
npx wrangler secret put KEY_SECRET               # długi losowy ciąg, raz na zawsze
npx wrangler secret put HASH_PEPPER              # długi losowy ciąg, raz na zawsze
npx wrangler secret put ADMIN_TOKEN              # długi losowy ciąg
npx wrangler secret put GEMINI_API_KEY           # opcjonalnie

curl -X POST https://TWOJ-ADRES/admin/setup -H "Authorization: Bearer ADMIN_TOKEN"
```

`/admin/setup` ustawia webhook, komendy, opisy i zdjęcie profilowe bota. Naklejki z sześcioma minami Otta zakłada `POST /admin/stickers`, a do tego potrzeba `STICKER_OWNER_ID`, czyli numeru konta Telegram właściciela zestawu.

Ustawienia bez tajemnic (model Gemini, liczba darmowych wiadomości, dzienne bezpieczniki kosztów, strefa domyślna) są w `wrangler.jsonc`. Tam jest też własna domena (`routes`): u siebie wpisz swoją, ze strefy na tym samym koncie Cloudflare, albo usuń wpis, a Otto będzie działał pod adresem `workers.dev`.

### Przed startem

1. **`KEY_SECRET` i `HASH_PEPPER` ustaw raz.** Zmiana `KEY_SECRET` unieważnia zapisane klucze użytkowników, a zmiana `HASH_PEPPER` zeruje pamięć o tym, które konta odebrały darmowe wiadomości.
2. **Polityka prywatności:** strona ma sekcję „Co Otto o Tobie wie”, ale publiczny bot potrzebuje też pełnej polityki (administrator danych, podstawa prawna, okresy przechowywania).
3. **Koszty:** `DAILY_FREE_LIMIT` i `SITE_DAILY_LIMIT` to dzienne bezpieczniki darmowych wiadomości w bocie i na stronie.

## Rozwój

```bash
npm test           # parser terminów, lista, klucze, szyfrowanie, odpowiedzi modelu
npm run typecheck
npm run assets     # naklejki, avatar, ikony i ilustracje WebP
```

Jak to jest zbudowane: [docs/techniczne.md](docs/techniczne.md). Decyzje projektowe strony: [docs/strona.md](docs/strona.md). Ilustracje generuje Codex według [design/codex-ilustracje.md](design/codex-ilustracje.md).

## Licencja

Kod: [Apache-2.0](LICENSE). Wyjątki i elementy cudze są w [NOTICE](NOTICE): font Urbanist (SIL OFL 1.1), Motion (MIT), generator kodów QR (MIT). Postać Otta oraz nazwa i znak Design House nie są objęte licencją.

<p align="center"><a href="https://designhouse.me">Design House</a></p>
