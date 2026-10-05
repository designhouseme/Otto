// Otto na stronie, w pełni animowany. Geometria jak w scripts/otto-svg.mjs i na designhouse.me:
// głowa to kula, mimika to dwie kapsuły oczu (dwa „O” w imieniu).
//
// Jedna pętla klatek dla wszystkich Ottów na stronie. Każdy ma:
// - kształt oczu według miny (płynne przejście) i mruganie w nieregularnym rytmie,
// - sprężyny: spojrzenie, pochylenie głowy, odblask na kuli (przesuwa się odwrotnie, więc kula wygląda na 3D),
// - fizykę skoku: przysiad, wybicie z rozciągnięciem, lądowanie ze spłaszczeniem i drgnięciem,
// - oddech, unoszenie, mówienie, wodzenie oczami przy myśleniu i drzemkę z „z”.
// Przy prefers-reduced-motion zostają tylko miny i mruganie.

export const MOODS = {
  neutral: [
    { x: 38, y: 41, w: 16, h: 38, r: 8 },
    { x: 66, y: 41, w: 16, h: 38, r: 8 },
  ],
  happy: [
    { x: 37, y: 53, w: 18, h: 16, r: 9 },
    { x: 65, y: 53, w: 18, h: 16, r: 9 },
  ],
  look: [
    { x: 46, y: 43, w: 15, h: 34, r: 7.5 },
    { x: 72, y: 43, w: 15, h: 34, r: 7.5 },
  ],
  wink: [
    { x: 38, y: 41, w: 16, h: 38, r: 8 },
    { x: 65, y: 57, w: 18, h: 7, r: 3.5 },
  ],
  wow: [
    { x: 34, y: 35, w: 24, h: 48, r: 12 },
    { x: 62, y: 35, w: 24, h: 48, r: 12 },
  ],
  think: [
    { x: 40, y: 33, w: 15, h: 26, r: 7.5 },
    { x: 68, y: 31, w: 15, h: 26, r: 7.5 },
  ],
  // Tylko na stronie: drzemka, gdy nikt nic nie robi.
  sleepy: [
    { x: 37, y: 61, w: 18, h: 5, r: 2.5 },
    { x: 65, y: 61, w: 18, h: 5, r: 2.5 },
  ],
};

const BLINK = [
  { x: 38, y: 57, w: 16, h: 6, r: 3 },
  { x: 66, y: 57, w: 16, h: 6, r: 3 },
];

const GROUND = 111; // dół kuli: stąd liczymy spłaszczenie i przechył
const GRAVITY = 1100;
const reduce = matchMedia("(prefers-reduced-motion: reduce)");
const SVG = "http://www.w3.org/2000/svg";

/** Wspólny stan wskaźnika: wszystkie Otty patrzą na ten sam kursor. */
const pointer = { x: 0, y: 0, active: false };
addEventListener(
  "pointermove",
  (event) => {
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    pointer.active = true;
  },
  { passive: true },
);
document.addEventListener("pointerleave", () => (pointer.active = false));

class Spring {
  constructor(value = 0, stiffness = 170, damping = 26) {
    this.v = value;
    this.target = value;
    this.u = 0;
    this.k = stiffness;
    this.c = damping;
  }
  step(dt) {
    const a = this.k * (this.target - this.v) - this.c * this.u;
    this.u += a * dt;
    this.v += this.u * dt;
  }
}

const all = new Set();
let uid = 0;
let last = performance.now();

function frame(now) {
  const dt = Math.min(1 / 30, (now - last) / 1000);
  last = now;
  for (const otto of all) if (otto.visible) otto.update(now / 1000, dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

export class Otto {
  constructor(host) {
    this.host = host;
    this.still = "ottoStill" in host.dataset;
    this.mood = MOODS[host.dataset.otto] ? host.dataset.otto : "neutral";
    this.visible = true;
    this.blinking = false;
    this.talkUntil = 0;
    this.zs = [];
    this.nextZ = 0;
    this.jumpY = 0;
    this.vy = 0;
    this.roll = 0; // obrót oczu przy toczeniu się (ustawia go public/assets/toss.js)
    this.hopAt = 0;
    this.hopPower = 0;

    // sprężyny
    this.glanceX = new Spring(0, 220, 24);
    this.glanceY = new Spring(0, 220, 24);
    this.faceX = new Spring(0, 140, 20);
    this.faceY = new Spring(0, 140, 20);
    this.lean = new Spring(0, 120, 18);
    this.press = new Spring(0, 520, 30);
    this.land = new Spring(0, 380, 9); // słabo tłumiona: galaretowate drgnięcie po lądowaniu
    this.spin = new Spring(0, 90, 15);

    const id = `otto${++uid}`;
    host.innerHTML = `<svg viewBox="0 0 120 120" role="img" aria-label="Otto" overflow="visible">
      <defs>
        <radialGradient id="${id}h" cx="34%" cy="24%" r="88%"><stop offset="0%" stop-color="#33383e"/><stop offset="55%" stop-color="#15171a"/><stop offset="100%" stop-color="#090a0c"/></radialGradient>
        <radialGradient id="${id}s" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#fff" stop-opacity=".22"/><stop offset="100%" stop-color="#fff" stop-opacity="0"/></radialGradient>
      </defs>
      ${this.still ? "" : `<ellipse class="o-shadow" cx="60" cy="116" rx="34" ry="4" fill="#151515" opacity=".12"/>`}
      <g class="o-pos"><g class="o-squash">
        <circle cx="60" cy="60" r="51" fill="url(#${id}h)"/>
        <ellipse class="o-spec" cx="44" cy="30" rx="18" ry="11" fill="url(#${id}s)"/>
        <g class="o-face"><rect fill="#fff"/><rect fill="#fff"/></g>
      </g></g>
      <g class="o-z" fill="#151515" font-family="Urbanist, system-ui, sans-serif" font-weight="800"></g>
    </svg>`;
    const q = (selector) => host.querySelector(selector);
    this.el = { pos: q(".o-pos"), squash: q(".o-squash"), spec: q(".o-spec"), face: q(".o-face"), shadow: q(".o-shadow"), z: q(".o-z") };
    this.eyes = [...host.querySelectorAll(".o-face rect")];

    this.shape = this.shapeTarget();
    this.applyEyes(this.shape, 1);
    this.scheduleBlink();

    new IntersectionObserver(([entry]) => (this.visible = entry.isIntersecting)).observe(host);
    all.add(this);
  }

  // ---- API dla strony ----

  setMood(mood) {
    if (!MOODS[mood] || mood === this.mood) return;
    const waking = this.mood === "sleepy";
    this.mood = mood;
    this.tweenShape(260);
    if (waking) this.hop(0.6);
  }

  /** Skok: krótki przysiad, wybicie, lot z rozciągnięciem i lądowanie ze spłaszczeniem. */
  hop(power = 1) {
    if (reduce.matches || this.still || this.jumpY < 0 || this.hopAt) return;
    this.press.target = 0.14 * power;
    this.hopAt = performance.now() + 90;
    this.hopPower = power;
  }

  /** Wejście: Otto spada z góry i ląduje. */
  drop(height = 110) {
    this.host.style.visibility = "visible";
    if (reduce.matches || this.still) return;
    this.jumpY = -height;
    this.vy = 0;
  }

  /** Przytrzymanie: przysiada, dopóki ktoś trzyma przycisk. */
  squish(on) {
    if (reduce.matches || this.still) return;
    this.press.target = on ? 0.16 : 0;
  }

  /** Obrót dookoła osi. Na zawrót głowy. */
  twirl() {
    if (reduce.matches || this.still) return;
    this.spin.target += 360;
    this.hop(1.2);
  }

  /**
   * Uderzenie przy rzucaniu: dodatnie spłaszcza od podłogi, ujemne ściska z boków (ściana).
   * Siła to prędkość zmiany kształtu, rozsądnie od -3 do 3.
   */
  impact(power) {
    if (reduce.matches || this.still) return;
    this.land.u += Math.max(-3.2, Math.min(3.2, power));
  }

  /** Mówienie: oczy pulsują, głowa lekko kiwa. Czas zależy od długości wypowiedzi. */
  talk(ms) {
    this.talkUntil = performance.now() + ms;
  }

  // ---- kształt oczu ----

  shapeTarget() {
    return this.blinking && this.mood !== "sleepy" ? BLINK : MOODS[this.mood];
  }

  tweenShape(ms) {
    const from = this.shape.map((e) => ({ ...e }));
    const to = this.shapeTarget();
    this.tween = reduce.matches ? null : { from, to, start: performance.now(), ms };
    if (!this.tween) this.shape = to;
    this.dirty = true;
  }

  stepShape(now) {
    if (!this.tween) return;
    this.dirty = true;
    const { from, to, start, ms } = this.tween;
    const t = Math.min(1, (now - start) / ms);
    const k = 1 - Math.pow(1 - t, 5);
    this.shape = from.map((f, i) => ({
      x: f.x + (to[i].x - f.x) * k,
      y: f.y + (to[i].y - f.y) * k,
      w: f.w + (to[i].w - f.w) * k,
      h: f.h + (to[i].h - f.h) * k,
      r: f.r + (to[i].r - f.r) * k,
    }));
    if (t >= 1) this.tween = null;
  }

  applyEyes(shape, talkScale, gx = 0, gy = 0) {
    shape.forEach((e, i) => {
      const h = e.h * talkScale;
      const rect = this.eyes[i];
      rect.setAttribute("x", (e.x + gx).toFixed(2));
      rect.setAttribute("y", (e.y + gy + (e.h - h) / 2).toFixed(2));
      rect.setAttribute("width", e.w.toFixed(2));
      rect.setAttribute("height", h.toFixed(2));
      rect.setAttribute("rx", Math.min(e.r, h / 2).toFixed(2));
    });
  }

  scheduleBlink() {
    setTimeout(() => {
      this.blink();
      if (Math.random() < 0.25) setTimeout(() => this.blink(), 240);
      this.scheduleBlink();
    }, 2400 + Math.random() * 3400);
  }

  blink() {
    if (document.hidden || this.mood === "wink" || this.mood === "sleepy") return;
    this.blinking = true;
    this.tweenShape(70);
    setTimeout(() => {
      this.blinking = false;
      this.tweenShape(110);
    }, 120);
  }

  // ---- pętla ----

  update(t, dt) {
    const now = performance.now();
    this.stepShape(now);

    // Mały Otto w logo i na kartach: tylko oczy (mruganie, miny).
    if (this.still || reduce.matches) {
      if (this.dirty) this.applyEyes(this.shape, 1);
      this.dirty = false;
      return;
    }

    // Dokąd patrzy: kursor, a bez niego powolne rozglądanie się.
    const rect = this.host.getBoundingClientRect();
    let lookX = 0;
    let lookY = 0;
    if (pointer.active) {
      const dx = pointer.x - (rect.left + rect.width / 2);
      const dy = pointer.y - (rect.top + rect.height / 2);
      const distance = Math.hypot(dx, dy) || 1;
      const reach = Math.min(1, distance / 320);
      lookX = (dx / distance) * reach;
      lookY = (dy / distance) * reach;
    } else {
      lookX = Math.sin(t * 0.7) * 0.5;
      lookY = Math.sin(t * 0.43) * 0.25;
    }
    const eyesFree = this.mood === "neutral" || this.mood === "look" ? 1 : this.mood === "sleepy" ? 0 : 0.5;
    if (this.mood === "think") {
      // Myślenie: oczy wodzą na boki i w górę.
      this.glanceX.target = Math.sin(t * 2.4) * 4;
      this.glanceY.target = -2;
    } else {
      this.glanceX.target = lookX * 6 * eyesFree;
      this.glanceY.target = lookY * 5 * eyesFree;
    }
    this.faceX.target = lookX * 3.2;
    this.faceY.target = lookY * 2.6;
    this.lean.target = lookX * 6;

    // Skok: przysiad się skończył, więc wybicie.
    if (this.hopAt && now >= this.hopAt) {
      this.hopAt = 0;
      this.press.target = 0;
      this.vy = -230 * this.hopPower;
      this.jumpY = -0.01;
    }
    if (this.jumpY < 0) {
      this.vy += GRAVITY * dt;
      this.jumpY += this.vy * dt;
      if (this.jumpY >= 0) {
        this.jumpY = 0;
        this.land.u += Math.min(3.2, this.vy / 90); // uderzenie o ziemię
        this.vy = 0;
      }
    }

    for (const spring of [this.glanceX, this.glanceY, this.faceX, this.faceY, this.lean, this.press, this.land, this.spin]) spring.step(dt);
    if (Math.abs(this.spin.target - this.spin.v) < 0.5 && this.spin.target >= 360) {
      this.spin.target -= 360;
      this.spin.v -= 360;
    }

    // Ciało
    const sleepy = this.mood === "sleepy";
    const breath = Math.sin(t * ((2 * Math.PI) / (sleepy ? 4.6 : 3.4))) * (sleepy ? 0.022 : 0.011);
    const float = Math.sin(t * ((2 * Math.PI) / 5.2)) * (sleepy ? 1.2 : 3);
    const stretch = Math.max(-0.14, Math.min(0.14, -this.vy / 1500));
    const squash = Math.max(-0.16, Math.min(0.24, this.press.v + this.land.v));
    const talking = now < this.talkUntil;
    const sy = (1 + breath + stretch) * (1 - squash);
    const sx = (1 - breath * 0.5 - stretch * 0.6) * (1 + squash * 0.8);
    const bob = talking ? Math.sin(t * 17) * 0.9 : 0;
    const y = this.jumpY + float + bob;
    this.el.pos.setAttribute("transform", `translate(0 ${y.toFixed(2)}) rotate(${(this.lean.v + this.spin.v).toFixed(2)} 60 ${GROUND})`);
    this.el.squash.setAttribute("transform", `translate(60 ${GROUND}) scale(${sx.toFixed(4)} ${sy.toFixed(4)}) translate(-60 -${GROUND})`);

    // Odblask i twarz
    this.el.spec.setAttribute("transform", `translate(${(-this.faceX.v * 0.9).toFixed(2)} ${(-this.faceY.v * 0.9).toFixed(2)})`);
    // Toczenie obraca tylko oczy wokół środka kuli; odblask zostaje, bo światło się nie przesuwa.
    this.el.face.setAttribute(
      "transform",
      `rotate(${this.roll.toFixed(2)} 60 60) translate(${this.faceX.v.toFixed(2)} ${this.faceY.v.toFixed(2)})`,
    );
    const talkScale = talking ? 0.78 + 0.22 * Math.abs(Math.cos(t * 17)) : 1;
    this.applyEyes(this.shape, talkScale, this.glanceX.v, this.glanceY.v);

    // Cień: mniejszy i jaśniejszy, gdy Otto jest w powietrzu
    if (this.el.shadow) {
      const lift = Math.min(1, -Math.min(0, y) / 70);
      this.el.shadow.setAttribute("rx", (34 * (1 - lift * 0.45) * sx).toFixed(2));
      this.el.shadow.setAttribute("opacity", (0.12 * (1 - lift * 0.6)).toFixed(3));
    }

    this.updateZs(t, sleepy);
  }

  /** Drzemka: z głowy ulatują litery „z”. */
  updateZs(t, sleepy) {
    if (sleepy && t >= this.nextZ) {
      this.nextZ = t + 1.3;
      const text = document.createElementNS(SVG, "text");
      text.textContent = "z";
      this.el.z.append(text);
      this.zs.push({ el: text, born: t });
    }
    this.zs = this.zs.filter((z) => {
      const age = (t - z.born) / 2;
      if (age >= 1) {
        z.el.remove();
        return false;
      }
      z.el.setAttribute("x", (92 + age * 18 + Math.sin(age * 9) * 3).toFixed(1));
      z.el.setAttribute("y", (30 - age * 34).toFixed(1));
      z.el.setAttribute("font-size", (12 + age * 10).toFixed(1));
      z.el.setAttribute("opacity", (age < 0.2 ? age / 0.2 : 1 - (age - 0.2) / 0.8).toFixed(2));
      return true;
    });
  }
}
