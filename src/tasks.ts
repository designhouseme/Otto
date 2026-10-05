/**
 * Lista zadań żyje w przypiętej wiadomości Otta, nie w naszej bazie.
 * Otto ją edytuje, a czyta z powrotem przez getChat (pinned_message).
 * Format jest stały, bo użytkownik nie może edytować wiadomości bota.
 */

import type { Keyboard } from "./telegram";

export const MAX_TASKS = 40;
export const MAX_TASK_LENGTH = 160;
const TITLE = "📋 Twoja lista";

export function parseList(text: string): string[] {
  const tasks: string[] = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^\d+\.\s(.+)$/);
    if (m) tasks.push(m[1]);
  }
  return tasks;
}

export function renderList(tasks: string[]): { text: string; reply_markup: Keyboard } {
  const text = tasks.length
    ? `${TITLE}\n\n${tasks.map((task, i) => `${i + 1}. ${task}`).join("\n")}\n\nZrobione? Kliknij numer.`
    : `${TITLE}\n\nNa razie pusto. Dopisz coś: /dodaj kupić mleko`;
  const buttons = tasks.map((task, i) => ({ text: `✓ ${i + 1}`, callback_data: `d:${i}:${shortHash(task)}` }));
  const rows = [];
  for (let i = 0; i < buttons.length; i += 5) rows.push(buttons.slice(i, i + 5));
  return { text, reply_markup: { inline_keyboard: rows } };
}

/** Czyści wpis: jedna linia, bez numeracji i myślnika na początku, z limitem długości. */
export function cleanTask(raw: string) {
  return raw
    .replace(/\s+/g, " ")
    .replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "")
    .trim()
    .slice(0, MAX_TASK_LENGTH);
}

/** „mleko, chleb; masło” albo kilka linii → osobne wpisy. */
export function splitTasks(raw: string) {
  return raw
    .split(/[\n,;]+/)
    .map(cleanTask)
    .filter(Boolean);
}

/** Krótki odcisk treści do przycisku: odhaczamy ten wpis, nawet jeśli numeracja się przesunęła. */
export function shortHash(text: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** Indeks wpisu do odhaczenia: najpierw pod numerem z przycisku, potem po odcisku. */
export function findTask(tasks: string[], index: number, hash: string) {
  if (tasks[index] !== undefined && shortHash(tasks[index]) === hash) return index;
  return tasks.findIndex((task) => shortHash(task) === hash);
}
