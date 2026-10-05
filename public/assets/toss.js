// Rzucanie Ottem w hero: złap, przeciągnij i puść. Leci z prędkością ręki, spada z grawitacją,
// odbija się od ścian i podłogi sekcji jak piłka, toczy się, a po chwili podskokiem wraca na miejsce.
// Przy okazji woła, co czuje. Klawiatura: Enter albo spacja rzuca nim w losową stronę.

const reduce = matchMedia("(prefers-reduced-motion: reduce)");

const LINES = {
  hint: ["Złap mnie i rzuć!"],
  grab: ["Hej!", "Złapany!", "Ooo!"],
  soft: ["Hop!", "Łiii!"],
  hard: ["Juhuuu!", "Jupiii!", "Lecęęę!"],
  bounce: ["Boing!", "Hop!", "Jeszcze!"],
  wall: ["Ups!", "Bum!"],
  rest: ["Jeszcze raz!", "Ale jazda!", "To było super!"],
  dizzy: ["Kręci mi się w głowie…", "Dobra, chwila przerwy"],
  back: ["Wracam!", "Już lecę na miejsce"],
};
const pick = (list) => list[Math.floor(Math.random() * list.length)];

const GRAVITY = 2600; // px/s²
const BOUNCE_FLOOR = 0.62;
const BOUNCE_WALL = 0.7;
const MAX_SPEED = 3400;

export function makeThrowable({ area, body, ball, bubble, otto }) {
  let x = 0;
  let y = 0;
  let vx = 0;
  let vy = 0;
  let state = "home"; // home | held | flying | rolling | rest | back
  let grab = null;
  let restSince = 0;
  let lastLine = 0;
  let hideTimer = 0;
  let throws = [];
  let last = performance.now();

  // ---- mowa ----

  function say(text, ms = 1500, force = false) {
    const now = performance.now();
    if (!force && now - lastLine < 450) return;
    lastLine = now;
    bubble.textContent = text;
    bubble.hidden = false;
    const Motion = window.Motion;
    if (Motion && !reduce.matches) Motion.animate(bubble, { opacity: [0, 1], scale: [0.7, 1] }, { type: "spring", bounce: 0.5, duration: 0.45 });
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => (bubble.hidden = true), ms);
  }

  // ---- granice: sekcja hero, liczone w każdej klatce (przewijanie i zmiana rozmiaru) ----

  function bounds() {
    const a = area.getBoundingClientRect();
    const r = body.getBoundingClientRect();
    const homeLeft = r.left - x;
    const homeTop = r.top - y;
    const pad = 6;
    return {
      minX: a.left - homeLeft + pad,
      maxX: a.right - (homeLeft + r.width) - pad,
      minY: a.top - homeTop,
      maxY: a.bottom - (homeTop + r.height) - pad,
      radius: r.width * 0.425,
    };
  }

  function place() {
    body.style.transform = x || y ? `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)` : "";
    if (body.dataset.state !== state) body.dataset.state = state;
  }

  // ---- łapanie i rzucanie ----

  ball.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    ball.setPointerCapture(event.pointerId);
    grab = { px: event.clientX, py: event.clientY, x0: x, y0: y, t0: performance.now(), moved: false, samples: [] };
    state = "held";
    vx = vy = 0;
    place();
    otto.squish(true);
    otto.setMood("wow");
    ball.classList.add("is-held");
  });

  ball.addEventListener("pointermove", (event) => {
    if (state !== "held" || !grab) return;
    const dx = event.clientX - grab.px;
    const dy = event.clientY - grab.py;
    if (!grab.moved && Math.hypot(dx, dy) > 6) {
      grab.moved = true;
      otto.squish(false);
      say(pick(LINES.grab), 900);
    }
    if (!grab.moved) return;
    const b = bounds();
    x = Math.max(b.minX, Math.min(b.maxX, grab.x0 + dx));
    y = Math.max(b.minY, Math.min(b.maxY, grab.y0 + dy));
    const now = performance.now();
    grab.samples.push({ x, y, t: now });
    grab.samples = grab.samples.filter((s) => now - s.t < 90);
    place();
  });

  function release(event) {
    if (state !== "held" || !grab) return;
    ball.classList.remove("is-held");
    otto.squish(false);
    if (event?.pointerId !== undefined && ball.hasPointerCapture(event.pointerId)) ball.releasePointerCapture(event.pointerId);
    const { samples, moved } = grab;
    grab = null;
    if (!moved) {
      // Krótkie kliknięcie: podskok i zachęta.
      state = x || y ? "flying" : "home";
      otto.setMood("happy");
      otto.hop();
      say(pick(LINES.hint), 1600, true);
      return;
    }
    if (samples.length >= 2) {
      const first = samples[0];
      const lastSample = samples[samples.length - 1];
      const dt = Math.max(0.016, (lastSample.t - first.t) / 1000);
      vx = (lastSample.x - first.x) / dt;
      vy = (lastSample.y - first.y) / dt;
    }
    launch();
  }
  ball.addEventListener("pointerup", release);
  ball.addEventListener("pointercancel", release);

  function launch() {
    const speed = Math.hypot(vx, vy);
    if (speed > MAX_SPEED) {
      vx *= MAX_SPEED / speed;
      vy *= MAX_SPEED / speed;
    }
    state = "flying";
    const now = performance.now();
    throws = [...throws.filter((t) => now - t < 20_000), now];
    otto.setMood(speed > 1400 ? "wow" : "happy");
    say(pick(speed > 1400 ? LINES.hard : LINES.soft), 1200, true);
  }

  // Klawiatura: rzut w losową stronę.
  ball.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    if (reduce.matches) return say(pick(LINES.hint), 1600, true);
    vx = (Math.random() < 0.5 ? -1 : 1) * (700 + Math.random() * 900);
    vy = -(1100 + Math.random() * 700);
    launch();
  });

  // ---- fizyka ----

  function step(now) {
    const dt = Math.min(1 / 30, (now - last) / 1000);
    last = now;
    if (reduce.matches || state === "home" || state === "held") {
      requestAnimationFrame(step);
      return;
    }
    const b = bounds();

    if (state === "flying" || state === "rolling") {
      if (state === "flying") {
        vy += GRAVITY * dt;
        vx *= 1 - 0.1 * dt;
      } else {
        vx *= 1 - 2.6 * dt; // toczenie się po podłodze
      }
      x += vx * dt;
      y += vy * dt;

      if (x < b.minX || x > b.maxX) {
        const hit = Math.abs(vx);
        x = Math.max(b.minX, Math.min(b.maxX, x));
        vx = -vx * BOUNCE_WALL;
        if (hit > 300) {
          otto.impact(-Math.min(3, hit / 700));
          if (hit > 900) say(pick(LINES.wall), 900);
        }
      }
      if (y < b.minY) {
        y = b.minY;
        vy = Math.abs(vy) * BOUNCE_WALL;
      }
      if (y >= b.maxY && state === "flying") {
        y = b.maxY;
        const hit = vy;
        if (hit > 0) {
          otto.impact(Math.min(3.2, hit / 600));
          vy = -vy * BOUNCE_FLOOR;
          vx *= 0.88;
          if (hit > 1300) {
            otto.setMood("happy");
            say(pick(LINES.bounce), 800);
          }
          if (Math.abs(vy) < 170) {
            vy = 0;
            state = "rolling";
          }
        }
      }
      if (state === "rolling") {
        y = b.maxY;
        if (Math.abs(vx) < 16) {
          vx = 0;
          state = "rest";
          restSince = now;
          const dizzy = throws.length >= 5;
          otto.setMood(dizzy ? "think" : "wink");
          say(pick(dizzy ? LINES.dizzy : LINES.rest), 1600, true);
          if (dizzy) throws = [];
        }
      }
      // Oczy toczą się razem z kulą (kąt = droga / promień).
      otto.roll = (otto.roll + ((vx * dt) / b.radius) * (180 / Math.PI)) % 360;
    } else if (state === "rest" && now - restSince > 1700) {
      state = "back";
      otto.setMood("happy");
      otto.hop(0.8);
      say(pick(LINES.back), 1000);
    } else if (state === "back") {
      // Sprężyna krytycznie tłumiona: płynny powrót bez przestrzelenia.
      const k = 70;
      const c = 2 * Math.sqrt(k);
      vx += (-k * x - c * vx) * dt;
      vy += (-k * y - c * vy) * dt;
      x += vx * dt;
      y += vy * dt;
      otto.roll += (-otto.roll * 6) * dt;
      if (Math.hypot(x, y) < 1 && Math.hypot(vx, vy) < 10) {
        x = y = vx = vy = 0;
        otto.roll = 0;
        state = "home";
        otto.setMood("neutral");
      }
    }
    place();
    requestAnimationFrame(step);
  }
  requestAnimationFrame(step);

  return { say };
}
