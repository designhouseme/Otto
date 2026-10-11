import { describe, expect, it } from "vitest";
import { appendTasks, cleanTask, findTask, parseList, renderList, shortHash, splitTasks } from "../src/tasks";

describe("lista", () => {
  it("nie dopisuje ponad limit wiadomości i zachowuje istniejące wpisy", () => {
    const first = Array(20).fill("x".repeat(160));
    const result = appendTasks(first, Array(20).fill("y".repeat(160)));
    expect(result.tasks.slice(0, first.length)).toEqual(first);
    expect(renderList(result.tasks).text.length).toBeLessThanOrEqual(4096);
    expect(result.rejected).toBeGreaterThan(0);
    expect(renderList([...result.tasks, "y".repeat(160)]).text.length).toBeGreaterThan(4096);
    expect(appendTasks(Array(40).fill("x"), ["y"]).rejected).toBe(1);
  });
  it("zapis i odczyt z treści wiadomości", () => {
    const tasks = ["kupić mleko", "faktura 12/2026 dla Kowalskiego"];
    const { text, reply_markup } = renderList(tasks);
    expect(parseList(text)).toEqual(tasks);
    expect(reply_markup.inline_keyboard.flat().map((b) => b.callback_data)).toEqual([
      `d:0:${shortHash(tasks[0])}`,
      `d:1:${shortHash(tasks[1])}`,
    ]);
  });

  it("pusta lista nie udaje wpisów", () => {
    expect(parseList(renderList([]).text)).toEqual([]);
  });

  it("odhacza właściwy wpis, nawet gdy numeracja się przesunęła", () => {
    const tasks = ["a", "b", "c"];
    expect(findTask(tasks, 1, shortHash("b"))).toBe(1);
    expect(findTask(["b", "c"], 1, shortHash("b"))).toBe(0);
    expect(findTask(["c"], 0, shortHash("b"))).toBe(-1);
  });

  it("czyści i dzieli wpisy", () => {
    expect(splitTasks("mleko, chleb;\n- masło")).toEqual(["mleko", "chleb", "masło"]);
    expect(cleanTask("  2. odebrać   paczkę ")).toBe("odebrać paczkę");
    expect(cleanTask("x".repeat(300))).toHaveLength(160);
  });
});
