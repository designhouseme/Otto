<img src="public/og.png" alt="Otto pamięta za Ciebie. Przypomnienia i lista zadań w Telegramie." width="100%">

# Otto

Osobisty asystent na Telegramie. Piszesz do niego jak do znajomego, a Otto przypomina o czasie i prowadzi Twoją listę zadań. Każdy ma własnego Otta, to nie jest bot dla grupy.

Otto robi tyle, ile się da, narzędziami samego Telegrama. Lista zadań to przypięta wiadomość w czacie, a przypomnienie to odpowiedź na Twoją oryginalną wiadomość. Dzięki temu treść zostaje w Telegramie, a po naszej stronie jest tylko to, co niezbędne.

## Co umie

- **Przypomnienia o każdej wiadomości**, także o zdjęciu czy notatce głosowej. Przyciski „Za godzinę”, „Jutro 9:00”, drzemka „+15 min”, „Zrobione”.
- **Polskie terminy bez AI:** „jutro o 9”, „w piątek 15:30”, „za 2 h”, „12.10 o 8”, „za tydzień”.
- **Lista zadań** przypięta u góry czatu. Odhaczasz jednym kliknięciem.
- **Zwykłe zdania z AI**, np. „po pracy przypomnij mi o oponach”: 10 wiadomości za darmo po potwierdzeniu maila, a bez limitu z własnym kluczem (Gemini, OpenAI, Anthropic albo OpenRouter).
- **Strona z Ottem**, którym można rzucać jak piłką i z którym można porozmawiać. Odpowiada przez Gemini Flash, a bez sieci gotowymi odpowiedziami.

| Poziom | Co daje |
|---|---|
| Za darmo, zawsze | przyciski, komendy, terminy typu „jutro o 9”, przypomnienia i lista bez limitu |
| 10 wiadomości AI | po podaniu maila i wpisaniu kodu z maila |
| Własny klucz | AI bez limitu; za użycie płacisz dostawcy klucza |
| Bot dla firmy | wspólny asystent zespołu z integracjami: [Design House](https://designhouse.me/automatyzacje) |

## Prywatność

| Zapisujemy | Nie zapisujemy |
|---|---|
| numer czatu i strefę czasową | treści wiadomości ani historii rozmów |
| licznik darmowych wiadomości AI | listy zadań (to przypięta wiadomość w Telegramie) |
| przypomnienia jako numer wiadomości i godzinę, do chwili wysłania | imienia, nazwy użytkownika, zdjęć |
| klucz API, zaszyfrowany (AES-GCM), jeśli go podasz | |
| mail jako hash; jawnie tylko przy zgodzie na kontakt | |

Gdy Otto używa AI, treść wiadomości trafia do dostawcy modelu. Telegram nie szyfruje rozmów z botami end-to-end. `/zapomnij` usuwa wszystko, co mamy. Wiadomość z kluczem albo mailem Otto kasuje z czatu od razu.

## Komendy

`/lista` · `/dodaj mleko, chleb` · `/przypomnij jutro o 9` (także w odpowiedzi na dowolną wiadomość) · `/przypomnienia` · `/pakiet` · `/klucz` · `/model` · `/strefa` · `/pomoc` · `/zapomnij`

## Własna instancja

Potrzebujesz konta Cloudflare (Workers i Durable Objects działają w planie darmowym), Node.js 22+ i bota od [@BotFather](https://t.me/BotFather). Klucz Gemini (darmowe wiadomości i rozmowa na stronie) oraz Resend (maile z kodem) są opcjonalne: bez nich działa tryb ręczny i własne klucze użytkowników.

### Lokalnie

```bash
npm install
cp .dev.vars.example .dev.vars    # DEV_DRY_RUN=1: nic nie wychodzi do Telegrama ani na maila
npm run dev                       # http://localhost:8787
```

W trybie `DEV_DRY_RUN` wywołania Telegrama i maile lądują w konsoli. Test dymny przechodzi całego bota (tryb ręczny, lista, przypomnienie z alarmem, kod z maila, klucz, `/zapomnij`) zmyślonymi aktualizacjami z Telegrama. Uzupełnij w `.dev.vars` wartości testowe (`TELEGRAM_WEBHOOK_SECRET=dev-secret`, `ADMIN_TOKEN=dev-admin`, `BOT_USERNAME=otto_dev_bot`, `KEY_SECRET`, `HASH_PEPPER`, dowolny `GEMINI_API_KEY`), a potem:

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
npx wrangler secret put RESEND_API_KEY           # opcjonalnie, razem z MAIL_FROM
npx wrangler secret put MAIL_FROM                # opcjonalnie, adres z domeny zweryfikowanej w Resend

curl -X POST https://TWOJ-ADRES/admin/setup -H "Authorization: Bearer ADMIN_TOKEN"
```

`/admin/setup` ustawia webhook, komendy, opisy i zdjęcie profilowe bota. Naklejki z sześcioma minami Otta zakłada `POST /admin/stickers`, a do tego potrzeba `STICKER_OWNER_ID`, czyli numeru konta Telegram właściciela zestawu. Maile osób, które zgodziły się na kontakt, zwraca `GET /admin/contacts` (CSV).

Ustawienia bez tajemnic (model Gemini, liczba darmowych wiadomości, dzienne bezpieczniki kosztów, strefa domyślna) są w `wrangler.jsonc`.

### Przed startem

1. **`KEY_SECRET` i `HASH_PEPPER` ustaw raz.** Zmiana `KEY_SECRET` unieważnia zapisane klucze użytkowników, a zmiana `HASH_PEPPER` zeruje pamięć o odebranych pakietach.
2. **Maile:** zweryfikuj domenę nadawcy w Resend (SPF, DKIM) i sprawdź na Gmailu i Outlooku, że kod dochodzi i nie trafia do spamu. Bez tego `/pakiet` nie zadziała.
3. **Polityka prywatności:** strona ma sekcję „Co Otto o Tobie wie”, ale publiczny bot potrzebuje też pełnej polityki (administrator danych, podstawa prawna, okresy przechowywania).
4. **Własna domena** w Cloudflare zamiast adresu `workers.dev`.
5. **Koszty:** `DAILY_FREE_LIMIT` i `SITE_DAILY_LIMIT` to dzienne bezpieczniki darmowych wiadomości w bocie i na stronie.

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
