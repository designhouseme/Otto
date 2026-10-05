/**
 * Jeden wspólny obiekt dla całej instancji:
 * - kto już odebrał darmowy pakiet (hash maila i hash numeru czatu, bez jawnych danych),
 * - zgody na kontakt (jedyne miejsce z jawnym mailem, tylko gdy ktoś kliknął „Tak”),
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
      "CREATE TABLE IF NOT EXISTS contacts (email TEXT PRIMARY KEY, chat_hash TEXT NOT NULL, created_at INTEGER NOT NULL)",
    );
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS budget (day TEXT NOT NULL, kind TEXT NOT NULL, used INTEGER NOT NULL, PRIMARY KEY (day, kind))",
    );
    this.sql.exec("CREATE TABLE IF NOT EXISTS hits (key TEXT NOT NULL, at INTEGER NOT NULL)");
    this.sql.exec("CREATE INDEX IF NOT EXISTS hits_key ON hits (key, at)");
  }

  isEmailClaimed(emailHash: string) {
    return this.sql.exec("SELECT 1 FROM claims WHERE id = ?", `e:${emailHash}`).toArray().length > 0;
  }

  /** Jeden pakiet na mail i jeden na konto Telegrama. */
  claim(emailHash: string, chatHash: string): "ok" | "email" | "chat" {
    if (this.isEmailClaimed(emailHash)) return "email";
    if (this.sql.exec("SELECT 1 FROM claims WHERE id = ?", `c:${chatHash}`).toArray().length) return "chat";
    const now = Date.now();
    this.sql.exec("INSERT INTO claims (id, created_at) VALUES (?, ?), (?, ?)", `e:${emailHash}`, now, `c:${chatHash}`, now);
    return "ok";
  }

  addContact(email: string, chatHash: string) {
    this.sql.exec(
      "INSERT INTO contacts (email, chat_hash, created_at) VALUES (?, ?, ?) ON CONFLICT (email) DO UPDATE SET chat_hash = excluded.chat_hash",
      email,
      chatHash,
      Date.now(),
    );
  }

  forgetChat(chatHash: string) {
    this.sql.exec("DELETE FROM contacts WHERE chat_hash = ?", chatHash);
  }

  contacts() {
    return this.sql
      .exec<{ email: string; created_at: number }>("SELECT email, created_at FROM contacts ORDER BY created_at")
      .toArray();
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
