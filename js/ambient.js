// ambient.js: the night table behind a page: light pools, paint that flows slowly in two corners, dust with a few px of
// pointer parallax (load css/ambient.css; assets/ambient/ holds the still picture used where WebGL is not available).
//   import { ambient } from "./ambient.js?v=48c0827afa";
//   const amb = ambient({ root = document.body, depth = [0, 10], idleMs = 60000, fps = 30, res = .5, seed = 7, paint = true });
//   amb.pause(); amb.resume(); amb.still(true | false); amb.destroy();   // amb.el is the field's node
// The paint is painted every frame by a small fragment shader (washes with wet edges and dry-brush sweeps, made of noise
// that keeps flowing: the wash edges creep outward, the bristles slide along their sweep, the whole bends like wet paint).
// At most `fps` draws a second (the paint travels 3 to 8 px a second, so 30 draws move it a third of a px each: smooth,
// and each draw is a whole frame of work for the browser), on a canvas `res` times the CSS size (device pixels capped at 1). The flow eases to a
// stop (hidden tab: at once) when the page pauses it or after `idleMs` without input, and eases back in on the next input,
// so it never jumps. Reduced motion or still(): one frame, held. No WebGL (or only a software one): the baked picture.

const NS = "http://www.w3.org/2000/svg";

/** A small seeded random generator, so the motes sit in the same places on every visit. */
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
}

/** The dust of one layer: `n` dots (radius r0..r1, opacity o0..o1), drawn once. */
function motes(rand, { n, r0, r1, o0, o1 }) {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 1000 1000");
  svg.setAttribute("preserveAspectRatio", "xMidYMid slice");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  for (let i = 0; i < n; i++) {
    const c = document.createElementNS(NS, "circle");
    c.setAttribute("cx", (rand() * 1000).toFixed(1));
    c.setAttribute("cy", (rand() * 1000).toFixed(1));
    c.setAttribute("r", (r0 + rand() * (r1 - r0)).toFixed(2));
    c.setAttribute("fill", "currentColor");
    c.setAttribute("opacity", (o0 + rand() * (o1 - o0)).toFixed(3));
    svg.append(c);
  }
  return svg;
}

// ---------------------------------------------------------------------------------------------------- the flowing paint
// The same painting tools/make_ambient.py bakes for the still picture (washes, rims, bristles, one dry sweep, the same
// palette and the same contrast cap), but sampled from noise that moves: nothing loops, so there is no seam to hide.
// Corner space: 0 at the anchored corner, 1 at the side of the paint's square (min(64vmax, 110vw, 1100px), as the picture).
const VERT = `attribute vec2 a;varying vec2 v;void main(){v=vec2(a.x*.5+.5,.5-a.y*.5);gl_Position=vec4(a,0.,1.);}`;
const FRAG = `
precision highp float;
varying vec2 v;
uniform vec2 uRes;     // canvas size, px
uniform float uSide;   // the paint's square, px
uniform vec2 uIn;      // where the screen's corners sit in the canvas (it overhangs the screen), px
uniform float uT;      // flow time, s
const vec3 BODY = vec3(42., 36., 82.) / 255.;     // Panel Lifted
const vec3 LIT = vec3(59., 52., 112.) / 255.;     // Line Indigo
const vec3 SHADE = vec3(13., 10., 26.) / 255.;    // Card edge
const vec3 WARM = vec3(240., 202., 155.) / 255.;  // S+ apricot
const float L_NIGHT = .00668;                     // luminance of Night Indigo
const float L_MAX = .032;                         // composite cap: Dusk Lavender keeps 5:1 on the brightest paint

float hash(vec2 p) { vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float vnoise(vec2 x) {
  vec2 i = floor(x), f = fract(x), u = f * f * f * (f * (f * 6. - 15.) + 10.);
  return mix(mix(hash(i), hash(i + vec2(1., 0.)), u.x), mix(hash(i + vec2(0., 1.)), hash(i + vec2(1., 1.)), u.x), u.y);
}
// fractal noise, stretched to fill 0..1 as the bake's percentile stretch does; octaves finer than ~2px fade out
float fbm(vec2 x, int oct, float pers, float cellPx) {
  float acc = 0., amp = 1., tot = 0.;
  for (int i = 0; i < 5; i++) {
    if (i >= oct) break;
    float k = amp * smoothstep(1.5, 3., cellPx);
    acc += k * vnoise(x); tot += k;
    x = mat2(1.6, 1.2, -1.2, 1.6) * x + 3.7; amp *= pers; cellPx *= .5;
  }
  return clamp((acc / max(tot, 1e-4) - .5) * 1.7 + .5, 0., 1.);
}
void over(inout vec3 rgb, inout float a, vec3 col, float la) {
  float oa = la + a * (1. - la);
  rgb = mix(rgb, col, oa > 1e-5 ? la / oa : 0.); a = oa;
}
void wash(inout vec3 rgb, inout float a, vec2 q, float px, float dist, float br, float grain, float reach, float alpha, vec3 col) {
  float e = fbm(q, 4, .55, px);
  float d = dist + .14 * (e - .5) + .05 * (br - .5);
  float inside = 1. - smoothstep(reach - .035, reach + .035, d);
  float rim = exp(-pow((d - reach) / .03, 2.)) * inside;           // a little more pigment where the wash dries
  over(rgb, a, col, clamp(alpha * (inside * (.8 + .2 * br * (.7 + .3 * grain)) + .35 * rim), 0., 1.));
}
float lum(vec3 c) {
  vec3 l = mix(c / 12.92, pow((c + .055) / 1.055, vec3(2.4)), step(.03928, c));
  return dot(l, vec3(.2126, .7152, .0722));
}
// one corner's paint, straight alpha. s: the corner's seed; flow: where its wash edges creep (corner space)
vec4 corner(vec2 p, vec2 s, vec2 flow) {
  if (dot(p, p) > .9) return vec4(0.);
  float t = uT;
  vec2 w = vec2(fbm(p * 3. + s + vec2(t * .011, -t * .007), 3, .5, uSide / 4.),
                fbm(p * 3. + s + vec2(5.2, 1.3) + vec2(-t * .009, t * .012), 3, .5, uSide / 4.));
  vec2 pw = p + .16 * (w - .5);                                    // wet paint bends, slowly
  vec2 dv = pw + .55;                                              // the sweeps turn around a point outside the corner
  float rad = length(dv), ang = atan(dv.y, dv.x);
  // bristles: fine along the radius, long along the arc, sliding along the sweep
  float br = fbm(vec2((ang - .2) * 6.7 - t * .07 + s.x, rad * 72.), 3, .5, uSide / 80.);
  float grain = fbm(p * 42. + s, 2, .55, uSide / 42.);
  float dist = length(vec2(pw.x, pw.y * 1.08));
  vec2 q = pw * 6. + s - flow * t * .055;                          // the wash edges creep along the flow
  vec3 rgb = vec3(0.); float a = 0.;
  wash(rgb, a, q, uSide / 7., dist, br, grain, .62, .55, BODY);
  wash(rgb, a, q + vec2(7.3, 3.1), uSide / 7., dist, br, grain, .44, .45, LIT);
  wash(rgb, a, q + vec2(2.9, 9.4), uSide / 7., dist, br, grain, .30, .55, SHADE);
  float band = exp(-pow((rad - 1.2177) / .07, 2.));                // one dry sweep past the corner
  float taper = smoothstep(0., .25, ang - .25) * (1. - smoothstep(1.05, 1.32, ang));
  float wk = .10 * smoothstep(.8, 1., br);
  over(rgb, a, mix(LIT, WARM, wk), clamp(.55 * band * taper * smoothstep(.35, .8, br), 0., 1.));
  a *= 1. - smoothstep(.429, .78, length(p));                      // gone well before the middle of the screen
  float lc = lum(rgb);
  if (lc > L_NIGHT) a = min(a, clamp((L_MAX - L_NIGHT) / max(lc - L_NIGHT, 1e-6), 0., 1.) * .995);
  return vec4(rgb, a);
}
void main() {
  vec2 px = v * uRes;
  vec4 A = corner((px - uIn) / uSide, vec2(0.), vec2(.55, .8));                    // top left: outward and down
  vec4 B = corner((uRes - uIn - px) / uSide, vec2(17.3, 41.7), vec2(.95, .2));   // bottom right: spreading along the bottom
  float oa = B.a + A.a * (1. - B.a);
  vec3 c = B.rgb * B.a + A.rgb * A.a * (1. - B.a);                         // premultiplied
  gl_FragColor = vec4(c + (hash(gl_FragCoord.xy) - .5) / 255. * oa, oa);   // a static dither against banding
}`;

/** The flowing paint on `canvas`, or null where WebGL is missing, software-only or fails to build. */
function flowPaint(canvas, res) {
  const opts = { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false,
    preserveDrawingBuffer: false, powerPreference: "low-power", failIfMajorPerformanceCaveat: true };
  let gl;
  try { gl = canvas.getContext("webgl", opts); } catch { gl = null; }
  if (!gl) return null;
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);   // one triangle covers it
  const loc = gl.getAttribLocation(prog, "a");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const uRes = gl.getUniformLocation(prog, "uRes"), uSide = gl.getUniformLocation(prog, "uSide"), uT = gl.getUniformLocation(prog, "uT"), uIn = gl.getUniformLocation(prog, "uIn");
  let side = 0, ix = 0, iy = 0;
  const size = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const k = Math.min(devicePixelRatio || 1, 1) * res;
    const bw = Math.max(1, Math.round(w * k)), bh = Math.max(1, Math.round(h * k));
    if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
    gl.viewport(0, 0, bw, bh);
    side = Math.min(.64 * Math.max(innerWidth, innerHeight), 1.1 * innerWidth, 1100) * k;
    ix = Math.max(0, (w - innerWidth) / 2) * k; iy = Math.max(0, (h - innerHeight) / 2) * k;
  };
  return {
    gl,
    size,
    draw(t) {
      if (gl.isContextLost()) return;
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uSide, side);
      gl.uniform2f(uIn, ix, iy);
      gl.uniform1f(uT, t);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    destroy() { const x = gl.getExtension("WEBGL_lose_context"); if (x) x.loseContext(); },
  };
}

export function ambient({ root = document.body, depth = [0, 10], idleMs = 60000, fps = 30, res = .5, seed = 7, paint = true } = {}) {
  const rand = rng(seed);
  const el = document.createElement("div");
  el.className = "amb";
  el.setAttribute("aria-hidden", "true");
  let canvas = null, flow = null, ro = null;
  const layers = ["far", "mid"].map((name) => {
    const l = document.createElement("div"), s = document.createElement("div");
    l.className = "amb-l amb-" + name; s.className = "amb-s";
    if (name === "far" && paint) { canvas = document.createElement("canvas"); canvas.className = "amb-flow"; s.append(canvas); }
    if (name === "mid") s.append(motes(rand, { n: 56, r0: .9, r1: 1.7, o0: .1, o1: .32 }));
    l.append(s); el.append(l);
    return l;
  });
  root.prepend(el);
  document.documentElement.classList.add("amb-on");

  // the still picture, where the paint cannot be drawn live (no WebGL, a software one, a lost context)
  const fallback = () => {
    flow = null;
    if (ro) { ro.disconnect(); ro = null; }
    if (!canvas) return;
    const s = canvas.parentNode;
    canvas.remove(); canvas = null;
    for (const cls of ["amb-paint-tl", "amb-paint-br"]) { const d = document.createElement("div"); d.className = "amb-paint " + cls; s.append(d); }
  };
  if (canvas) {
    flow = flowPaint(canvas, res);
    if (!flow) fallback();
    else canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); stopFlow(); fallback(); });
  }

  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  let reduced = reduce.matches, forcedStill = false, paused = false, manual = false;
  let tx = 0, ty = 0, cx = 0, cy = 0, raf = 0, last = 0;
  let lastInput = performance.now(), idleT = 0;
  const still = () => reduced || forcedStill;
  const running = () => !still() && !paused && !manual && !document.hidden;

  // ---- the flow clock: flow time advances by the frame's time times a rate that eases between 0 and 1 over EASE ms
  // (smoothstep), so a pause, the idle stop and the return slow down and pick up instead of cutting; never a jump.
  // Between two draws the loop sleeps on a timer and asks for a frame only when the next draw is due: a frame asked for
  // and skipped still costs the page a whole frame of work.
  const EASE = 1600, frameMs = 1000 / fps;
  let ft = 40 + rand() * 200, ramp = 0, fraf = 0, fto = 0, flast = 0;
  const drawFlow = () => { if (flow) flow.draw(ft); };
  const tick = (now) => {
    fraf = 0;
    if (!flow) return;
    const dt = flast ? Math.min(64, now - flast) : 0;
    flast = now;
    ramp = Math.min(1, Math.max(0, ramp + (running() ? dt : -dt) / EASE));
    const rate = ramp * ramp * (3 - 2 * ramp);
    ft += (dt / 1000) * rate;
    drawFlow();
    if (ramp > 0 || running()) fto = setTimeout(() => { fto = 0; fraf = requestAnimationFrame(tick); }, Math.max(0, frameMs - 10));
    else flast = 0;
  };
  const startFlow = () => { if (flow && !fraf && !fto && !document.hidden && !still()) fraf = requestAnimationFrame(tick); };
  const stopFlow = () => { cancelAnimationFrame(fraf); clearTimeout(fto); fraf = 0; fto = 0; flast = 0; };
  if (flow) {
    ro = new ResizeObserver(() => { if (!flow) return; flow.size(); drawFlow(); });
    ro.observe(canvas);
    flow.size();
    drawFlow();
  }

  // ---- the pointer parallax: the dust follows the pointer by a few px, eased (about 160 ms), then the loop stops. A
  // write at most every 1000/24 ms: the moves are a few px. A depth of 0 keeps a layer out of it.
  const pgap = 1000 / 24 - 2;
  const write = () => layers.forEach((l, i) => {
    if (!depth[i]) return;
    l.style.transform = `translate3d(${(-cx * depth[i]).toFixed(2)}px, ${(-cy * depth[i]).toFixed(2)}px, 0)`;
  });
  const frame = (now) => {
    if (last && now - last < pgap) { raf = requestAnimationFrame(frame); return; }
    const dt = Math.min(64, now - (last || now));
    last = now;
    const k = 1 - Math.exp(-dt / 160);
    cx += (tx - cx) * k; cy += (ty - cy) * k;
    write();
    if (Math.abs(tx - cx) * depth[1] > .05 || Math.abs(ty - cy) * depth[1] > .05) raf = requestAnimationFrame(frame);
    else { raf = 0; last = 0; }
  };
  const kick = () => { if (!raf && !still() && !document.hidden) raf = requestAnimationFrame(frame); };

  const sync = () => {
    el.classList.toggle("amb-still", still());
    if (still()) {
      stopFlow(); ramp = 0; drawFlow();                                  // one frame, held where it is
      cancelAnimationFrame(raf); raf = 0; last = 0; cx = cy = tx = ty = 0;
      layers.forEach((l) => { l.style.transform = ""; });
      return;
    }
    if (document.hidden) { stopFlow(); ramp = 0; return; }              // nothing is seen: stop at once
    if (running() || ramp > 0) startFlow();                              // the clock eases in, or out to a stop
  };

  // idle: after idleMs without input the flow eases to a stop (nothing is drawn); the next input eases it back in
  const checkIdle = () => {
    idleT = 0;
    const left = idleMs - (performance.now() - lastInput);
    if (left > 0) { idleT = setTimeout(checkIdle, left); return; }
    paused = true; sync();
  };
  const active = () => {
    lastInput = performance.now();
    if (paused && !document.hidden) { paused = false; sync(); }
    if (!idleT) idleT = setTimeout(checkIdle, idleMs);
  };
  const onMove = (e) => {
    active();
    if (e.pointerType === "touch" || still()) return;
    tx = (e.clientX / innerWidth) * 2 - 1;
    ty = (e.clientY / innerHeight) * 2 - 1;
    kick();
  };
  const onVis = () => { if (document.hidden) { cancelAnimationFrame(raf); raf = 0; last = 0; } else active(); sync(); };
  const onReduce = () => { reduced = reduce.matches; sync(); };

  const opts = { passive: true };
  const inputs = ["pointerdown", "keydown", "wheel", "scroll", "touchstart"];
  addEventListener("pointermove", onMove, opts);
  for (const ev of inputs) addEventListener(ev, active, opts);
  document.addEventListener("visibilitychange", onVis);
  reduce.addEventListener("change", onReduce);
  idleT = setTimeout(checkIdle, idleMs);
  sync();

  return {
    el,
    pause() { manual = true; sync(); },
    resume() { manual = false; active(); sync(); },
    still(v = true) { forcedStill = !!v; sync(); },
    destroy() {
      stopFlow(); cancelAnimationFrame(raf); clearTimeout(idleT);
      if (ro) ro.disconnect();
      if (flow) flow.destroy();
      removeEventListener("pointermove", onMove, opts);
      for (const ev of inputs) removeEventListener(ev, active, opts);
      document.removeEventListener("visibilitychange", onVis);
      reduce.removeEventListener("change", onReduce);
      el.remove();
      document.documentElement.classList.remove("amb-on");
    },
  };
}
