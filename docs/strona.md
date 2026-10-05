# Strona Otta: decyzje projektowe

Strona ma jedno zadanie: przekonać, że Otto się przyda, i doprowadzić do kliknięcia Start w Telegramie. Kierunek wizualny to ciepłe, kremowe aplikacje czatowe z rysunkowymi znaczkami i pastelowymi kartami. Ten wybór jest świadomy, a nie domyślny.

## Odrzucone domyślne rozwiązania

1. **Makieta telefonu z divów i dwa równorzędne przyciski w hero.** Zamiast tego jest jeden przycisk „Dodaj Otto na Telegramie”, kod QR tylko na komputerze, a obok karty z prawdziwymi komunikatami bota.
2. **Trzy identyczne karty z ikoną w kolorowym kwadracie.** Funkcje opisuje zwykła lista obok żywej rozmowy, a cennik to wiersze z ilustracjami, nie kafelki.
3. **Inter, Lucide, emoji jako ikony i fade-up na każdej sekcji.** Jest jeden krój, żadnego zestawu ikon (tylko strzałka w przycisku, wysyłka i zamknięcie w czacie), a ruch ma jedno główne miejsce: samego Otta.

## Sygnatura

**Otto żyje na stronie.** Patrzy za kursorem, mruga, zmienia minę, gdy najedziesz na przycisk albo przewiniesz do prywatności, i można z nim porozmawiać. Odpowiada przez Gemini Flash, a bez sieci gotowymi odpowiedziami. Tło hero to delikatny wzór kół: dwa „O” w imieniu to jego oczy.

## Kolory

| Nazwa | Wartość | Rola |
|---|---|---|
| cream | `#FBF7EC` | tło strony |
| ink | `#151515` | tekst, ciemne panele czatu |
| sun | `#FFD21F` | główny przycisk, wiadomości użytkownika (około 10% powierzchni) |
| rose | `#F5B5D3` | karty i ilustracje |
| mint | `#4FD18B` | karty i ilustracje |
| lilac | `#C8C5FF` | karty i ilustracje |
| muted | `#5E594F` | tekst drugiego planu (kontrast 6,6:1 na cream) |

Obwódka Otta na tej stronie i w Telegramie jest w kolorze sun, a nie volt z designhouse.me. Dzięki temu pasuje do ilustracji. Zmiana to jedna wartość (`--sun` i `ring` w `scripts/otto-svg.mjs`).

## Krój

**Urbanist** (SIL OFL 1.1, `public/fonts/`), font zmienny 100–900 z pliku latin-ext, więc ma ą, ę, ł, ś, ź, ż. To krój narzędzi Design House (ReviewLink), geometryczny jak w referencjach. Nagłówki 800, tekst 500, hierarchia przez skoki rozmiaru i grubości naraz. Pliki są hostowane u siebie, bez Google Fonts.

## Kształty i ruch

- Promienie według roli: przycisk to pigułka, karty mają 28 px, dymki 20 px, a ilustracje nie mają ramek, bo same są znaczkami.
- Ruch: biblioteka Motion (`public/assets/vendor/motion.js`, MIT). Sprężyny tylko na małych obiektach (karty w hero, dymki czatu), oczy Otta przez własną animację geometrii. `prefers-reduced-motion` wyłącza unoszenie, podskoki i animacje wejścia.
- Grafiki: Codex według `design/codex-ilustracje.md`, źródła w `design/zrodla/`. Postacie są rysunkowe i podpisane jako przykład, więc nie udają opinii prawdziwych klientów.
