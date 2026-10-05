/**
 * Jeden wspólny obiekt dla całej instancji:
 * - które konta Telegrama odebrały już darmowe wiadomości AI (tylko hash numeru czatu),
 * - lista VIP-ów z AI bez limitu (numery czatów nadane przez admina),
 * - dzienne bezpieczniki kosztów i limity zapytań ze strony.
 */

import { DurableObject } from "cloudflare:workers";
import { DAY } from "./time";

export type BudgetKind = "bot" | "site";

export class Registry extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec("CREATE TABLE IF NOT EXISTS claims (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL)");
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS budget (day TEXT NOT NULL, kind TEXT NOT NULL, used INTEGER NOT NULL, PRIMARY KEY (day, kind))",
    );
    this.sql.exec("CREATE TABLE IF NOT EXISTS hits (key TEXT NOT NULL, at INTEGER NOT NULL)");
    this.sql.exec("CREATE INDEX IF NOT EXISTS hits_key ON hits (key, at)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS vips (chat_id INTEGER PRIMARY KEY, created_at INTEGER NOT NULL)");
    // Pozostałość po wersji z mailem i zgodami na kontakt: tych danych już nie zbieramy.
    this.sql.exec("DROP TABLE IF EXISTS contacts");
  }

  /** Darmowe wiadomości raz na konto, także po /zapomnij. true = to konto dostaje je pierwszy raz. */
  claimChat(chatHash: string) {
    const id = `c:${chatHash}`;
    if (this.sql.exec("SELECT 1 FROM claims WHERE id = ?", id).toArray().length) return false;
    this.sql.exec("INSERT INTO claims (id, created_at) VALUES (?, ?)", id, Date.now());
    return true;
  }

  setVip(chatId: number, on: boolean) {
    if (on) this.sql.exec("INSERT INTO vips (chat_id, created_at) VALUES (?, ?) ON CONFLICT (chat_id) DO NOTHING", chatId, Date.now());
    else this.sql.exec("DELETE FROM vips WHERE chat_id = ?", chatId);
  }

  vips() {
    return this.sql.exec<{ chat_id: number; created_at: number }>("SELECT chat_id, created_at FROM vips ORDER BY created_at").toArray();
  }

  /** Zużywa jedną wiadomość z dziennej puli. false = pula na dziś się skończyła. */
  spend(kind: BudgetKind, limit: number) {
    const day = new Date().toISOString().slice(0, 10);
    const row = this.sql.exec<{ used: number }>("SELECT used FROM budget WHERE day = ? AND kind = ?", day, kind).toArray()[0];
    if ((row?.used ?? 0) >= limit) return false;
    this.sql.exec(
      "INSERT INTO budget (day, kind, used) VALUES (?, ?, 1) ON CONFLICT (day, kind) DO UPDATE SET used = used + 1",
      day,
      kind,
    );
    this.sql.exec("DELETE FROM budget WHERE day < ?", new Date(Date.now() - 30 * DAY).toISOString().slice(0, 10));
    return true;
  }

  refund(kind: BudgetKind) {
    const day = new Date().toISOString().slice(0, 10);
    this.sql.exec("UPDATE budget SET used = MAX(0, used - 1) WHERE day = ? AND kind = ?", day, kind);
  }

  /** Limit zapytań w oknie czasu, np. 12 pytań na 10 minut z jednego adresu. */
  hit(key: string, windowMs: number, max: number) {
    const now = Date.now();
    this.sql.exec("DELETE FROM hits WHERE at < ?", now - DAY);
    const [{ n }] = this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM hits WHERE key = ? AND at > ?", key, now - windowMs).toArray();
    if (n >= max) return false;
    this.sql.exec("INSERT INTO hits (key, at) VALUES (?, ?)", key, now);
    return true;
  }
}
