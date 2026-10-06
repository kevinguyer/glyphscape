import type { StyledFrame } from './compositor';
import type { Atlas } from './glyphs';
import type { FrameUniforms, Layout, Renderer } from './renderer';

const VS = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

// Pass 1: the character grid. Two ticks are drawn and blended so motion interpolates smoothly.
const GRID_FS = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uAtlas;
uniform sampler2D uG0, uF0, uB0, uG1, uF1, uB1;
uniform float uAlpha;
uniform ivec2 uCell, uGrid, uOffset;
uniform int uAtlasCols;
uniform float uH;
uniform vec3 uEdge;
out vec4 o;
float glyphA(sampler2D g, ivec2 c, ivec2 l) {
  vec2 rg = texelFetch(g, c, 0).rg;
  int gi = int(rg.r * 255.0 + 0.5) + int(rg.g * 255.0 + 0.5) * 256;
  ivec2 at = ivec2(gi % uAtlasCols, gi / uAtlasCols) * uCell + l;
  return texelFetch(uAtlas, at, 0).a;
}
void main() {
  ivec2 p = ivec2(int(gl_FragCoord.x), int(uH - gl_FragCoord.y)) - uOffset;
  if (p.x < 0 || p.y < 0) { o = vec4(uEdge, 1.0); return; }
  ivec2 c = p / uCell;
  if (c.x >= uGrid.x || c.y >= uGrid.y) { o = vec4(uEdge, 1.0); return; }
  ivec2 l = p - c * uCell;
  vec4 f0 = texelFetch(uF0, c, 0);
  vec4 f1 = texelFetch(uF1, c, 0);
  vec3 b0 = texelFetch(uB0, c, 0).rgb;
  vec3 b1 = texelFetch(uB1, c, 0).rgb;
  vec3 c0 = mix(b0, f0.rgb, glyphA(uG0, c, l) * f0.a);
  vec3 c1 = mix(b1, f1.rgb, glyphA(uG1, c, l) * f1.a);
  o = vec4(mix(c0, c1, uAlpha), 1.0);
}`;

// Pass 2: phosphor persistence (feedback, keeps the brighter of now and a decayed past).
const PERSIST_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSrc, uPrev;
uniform float uDecay;
out vec4 o;
void main() {
  vec3 now = texture(uSrc, vUv).rgb;
  vec3 past = texture(uPrev, vUv).rgb * uDecay;
  o = vec4(max(now, past), 1.0);
}`;

// Pass 3: bright-pass downsample, then separable blur.
const DOWN_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSrc;
uniform vec2 uTexel;
out vec4 o;
void main() {
  vec3 c = texture(uSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb
         + texture(uSrc, vUv + uTexel * vec2( 1.0, -1.0)).rgb
         + texture(uSrc, vUv + uTexel * vec2(-1.0,  1.0)).rgb
         + texture(uSrc, vUv + uTexel * vec2( 1.0,  1.0)).rgb;
  c *= 0.25;
  o = vec4(max(c - 0.04, 0.0), 1.0);
}`;

const BLUR_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSrc;
uniform vec2 uDir;
out vec4 o;
void main() {
  vec3 c = texture(uSrc, vUv).rgb * 0.227027;
  c += texture(uSrc, vUv + uDir * 1.3846).rgb * 0.316216;
  c += texture(uSrc, vUv - uDir * 1.3846).rgb * 0.316216;
  c += texture(uSrc, vUv + uDir * 3.2308).rgb * 0.070270;
  c += texture(uSrc, vUv - uDir * 3.2308).rgb * 0.070270;
  o = vec4(c, 1.0);
}`;

// Pass 4: CRT-ish finish and display care (brightness, warmth, peak cap).
const FINAL_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSrc, uGlow;
uniform vec2 uRes;
uniform float uGlowAmt, uScan, uScanPeriod, uCurve, uChroma, uGrain, uVignette;
uniform float uBright, uWarm, uPeak, uTime;
uniform vec3 uEdge;
out vec4 o;
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
void main() {
  vec2 uv = vUv;
  vec2 cc = uv * 2.0 - 1.0;
  if (uCurve > 0.0) {
    cc *= 1.0 + uCurve * 0.07 * dot(cc, cc);
    uv = cc * 0.5 + 0.5;
    if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) { o = vec4(0.0, 0.0, 0.0, 1.0); return; }
  }
  vec3 col;
  if (uChroma > 0.0) {
    vec2 d = cc * uChroma * 2.5 / uRes;
    col = vec3(texture(uSrc, uv + d).r, texture(uSrc, uv).g, texture(uSrc, uv - d).b);
  } else {
    col = texture(uSrc, uv).rgb;
  }
  if (uGlowAmt > 0.0) col += texture(uGlow, uv).rgb * uGlowAmt * 1.6;
  if (uScan > 0.0) {
    float s = 0.5 + 0.5 * cos(gl_FragCoord.y * 6.2831853 / uScanPeriod);
    col *= 1.0 - uScan * 0.4 * (1.0 - s);
  }
  if (uVignette > 0.0) {
    float v = 1.0 - smoothstep(0.55, 1.45, length(cc * vec2(0.9, 1.0)));
    col *= mix(1.0, v, uVignette);
  }
  if (uGrain > 0.0) col += (hash(gl_FragCoord.xy + fract(uTime) * 97.0) - 0.5) * uGrain * 0.09;
  col *= uBright;
  col *= mix(vec3(1.0), vec3(1.0, 0.74, 0.5), uWarm);
  float m = max(col.r, max(col.g, col.b));
  if (m > uPeak) col *= uPeak / m;
  o = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

interface Target { fb: WebGLFramebuffer; tex: WebGLTexture; w: number; h: number }

type Prog = { p: WebGLProgram; u: Record<string, WebGLUniformLocation | null> };

export class GLRenderer implements Renderer {
  readonly kind = 'webgl2' as const;
  lost = false;
  private gl!: WebGL2RenderingContext;
  private vao!: WebGLVertexArrayObject;
  private progs!: Record<'grid' | 'persist' | 'down' | 'blur' | 'final', Prog>;
  private atlasTex: WebGLTexture | null = null;
  private atlas: Atlas | null = null;
  private data: { g: WebGLTexture; f: WebGLTexture; b: WebGLTexture }[] = [];
  private cur = 0;
  private layout: Layout | null = null;
  private scene: Target | null = null;
  private persist: Target[] = [];
  private pi = 0;
  private glowA: Target | null = null;
  private glowB: Target | null = null;
  private persistValid = false;
  private uploads = 0;

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      alpha: false, antialias: false, depth: false, stencil: false,
      premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'low-power',
    });
    if (!gl) throw new Error('WebGL2 unavailable');
    this.gl = gl;
    canvas.addEventListener('webglcontextlost', this.onLost);
    canvas.addEventListener('webglcontextrestored', this.onRestored);
    this.init();
  }

  private onLost = (e: Event) => {
    e.preventDefault();
    this.lost = true;
  };

  private onRestored = () => {
    this.init();
    if (this.atlas) this.setAtlas(this.atlas);
    if (this.layout) this.resize(this.layout);
    this.lost = false;
  };

  private init() {
    const gl = this.gl;
    const compile = (fs: string): Prog => {
      const mk = (type: number, src: string) => {
        const s = gl.createShader(type)!;
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) {
          throw new Error(gl.getShaderInfoLog(s) ?? 'shader error');
        }
        return s;
      };
      const p = gl.createProgram()!;
      gl.attachShader(p, mk(gl.VERTEX_SHADER, VS));
      gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
      gl.bindAttribLocation(p, 0, 'aPos');
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) {
        throw new Error(gl.getProgramInfoLog(p) ?? 'link error');
      }
      const u: Prog['u'] = {};
      const count = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS) as number;
      for (let i = 0; i < count; i++) {
        const info = gl.getActiveUniform(p, i)!;
        u[info.name] = gl.getUniformLocation(p, info.name);
      }
      return { p, u };
    };
    this.progs = {
      grid: compile(GRID_FS),
      persist: compile(PERSIST_FS),
      down: compile(DOWN_FS),
      blur: compile(BLUR_FS),
      final: compile(FINAL_FS),
    };
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    this.data = [];
    this.atlasTex = null;
    this.scene = null;
    this.persist = [];
    this.glowA = this.glowB = null;
  }

  private tex(w: number, h: number, internal: number, filter: number): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texStorage2D(gl.TEXTURE_2D, 1, internal, w, h);
    return t;
  }

  private target(w: number, h: number): Target {
    const gl = this.gl;
    const tex = this.tex(w, h, gl.RGBA8, gl.LINEAR);
    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fb, tex, w, h };
  }

  private freeTarget(t: Target | null) {
    if (!t) return;
    this.gl.deleteFramebuffer(t.fb);
    this.gl.deleteTexture(t.tex);
  }

  setAtlas(atlas: Atlas) {
    this.atlas = atlas;
    const gl = this.gl;
    if (this.atlasTex) gl.deleteTexture(this.atlasTex);
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, atlas.canvas);
    this.atlasTex = t;
  }

  resize(layout: Layout) {
    this.layout = layout;
    const gl = this.gl;
    this.canvas.width = layout.width;
    this.canvas.height = layout.height;
    for (const d of this.data) {
      gl.deleteTexture(d.g); gl.deleteTexture(d.f); gl.deleteTexture(d.b);
    }
    this.data = [0, 1].map(() => ({
      g: this.tex(layout.cols, layout.rows, gl.RG8, gl.NEAREST),
      f: this.tex(layout.cols, layout.rows, gl.RGBA8, gl.NEAREST),
      b: this.tex(layout.cols, layout.rows, gl.RGBA8, gl.NEAREST),
    }));
    this.uploads = 0;
    this.freeTarget(this.scene);
    this.persist.forEach((t) => this.freeTarget(t));
    this.freeTarget(this.glowA);
    this.freeTarget(this.glowB);
    this.scene = this.target(layout.width, layout.height);
    this.persist = [this.target(layout.width, layout.height), this.target(layout.width, layout.height)];
    const gw = Math.max(1, Math.ceil(layout.width / 4));
    const gh = Math.max(1, Math.ceil(layout.height / 4));
    this.glowA = this.target(gw, gh);
    this.glowB = this.target(gw, gh);
    this.persistValid = false;
  }

  upload(frame: StyledFrame) {
    if (this.lost || !this.layout) return;
    const gl = this.gl;
    const { cols, rows } = this.layout;
    if (frame.cols !== cols || frame.rows !== rows) return;
    this.cur ^= 1;
    const d = this.data[this.cur];
    gl.bindTexture(gl.TEXTURE_2D, d.g);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, cols, rows, gl.RG, gl.UNSIGNED_BYTE,
      new Uint8Array(frame.glyph.buffer, frame.glyph.byteOffset, frame.n * 2));
    gl.bindTexture(gl.TEXTURE_2D, d.f);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, cols, rows, gl.RGBA, gl.UNSIGNED_BYTE, frame.fg);
    gl.bindTexture(gl.TEXTURE_2D, d.b);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, cols, rows, gl.RGBA, gl.UNSIGNED_BYTE, frame.bg);
    this.uploads++;
  }

  private bindTex(unit: number, tex: WebGLTexture, loc: WebGLUniformLocation | null) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(loc, unit);
  }

  private pass(target: Target | null) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fb : null);
    gl.viewport(0, 0, target ? target.w : this.canvas.width, target ? target.h : this.canvas.height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  draw(u: FrameUniforms) {
    if (this.lost || !this.layout || !this.atlas || !this.atlasTex || this.uploads === 0) return;
    const gl = this.gl;
    const L = this.layout;
    gl.bindVertexArray(this.vao);

    // 1. grid
    const P = this.progs.grid;
    gl.useProgram(P.p);
    const prev = this.data[this.uploads > 1 ? this.cur ^ 1 : this.cur];
    const cur = this.data[this.cur];
    this.bindTex(0, this.atlasTex, P.u.uAtlas);
    this.bindTex(1, prev.g, P.u.uG0);
    this.bindTex(2, prev.f, P.u.uF0);
    this.bindTex(3, prev.b, P.u.uB0);
    this.bindTex(4, cur.g, P.u.uG1);
    this.bindTex(5, cur.f, P.u.uF1);
    this.bindTex(6, cur.b, P.u.uB1);
    gl.uniform1f(P.u.uAlpha, u.alpha);
    gl.uniform2i(P.u.uCell, L.cellW, L.cellH);
    gl.uniform2i(P.u.uGrid, L.cols, L.rows);
    gl.uniform2i(P.u.uOffset, Math.round(L.originX + u.driftX), Math.round(L.originY + u.driftY));
    gl.uniform1i(P.u.uAtlasCols, this.atlas.cols);
    gl.uniform1f(P.u.uH, L.height);
    gl.uniform3f(P.u.uEdge, u.edge[0], u.edge[1], u.edge[2]);
    this.pass(this.scene);

    // 2. persistence
    let src = this.scene!;
    if (u.post.persistence > 0.01) {
      const Pp = this.progs.persist;
      gl.useProgram(Pp.p);
      const out = this.persist[this.pi];
      const past = this.persist[this.pi ^ 1];
      this.bindTex(0, this.scene!.tex, Pp.u.uSrc);
      this.bindTex(1, past.tex, Pp.u.uPrev);
      gl.uniform1f(Pp.u.uDecay, this.persistValid ? Math.pow(u.post.persistence, u.dt * 60) : 0);
      this.pass(out);
      this.pi ^= 1;
      this.persistValid = true;
      src = out;
    } else {
      this.persistValid = false;
    }

    // 3. glow
    const glowAmt = u.post.glow;
    if (glowAmt > 0.01) {
      const D = this.progs.down;
      gl.useProgram(D.p);
      this.bindTex(0, src.tex, D.u.uSrc);
      gl.uniform2f(D.u.uTexel, 1 / L.width, 1 / L.height);
      this.pass(this.glowA);
      const B = this.progs.blur;
      gl.useProgram(B.p);
      for (let k = 0; k < 2; k++) {
        this.bindTex(0, this.glowA!.tex, B.u.uSrc);
        gl.uniform2f(B.u.uDir, (1 + k) / this.glowA!.w, 0);
        this.pass(this.glowB);
        this.bindTex(0, this.glowB!.tex, B.u.uSrc);
        gl.uniform2f(B.u.uDir, 0, (1 + k) / this.glowA!.h);
        this.pass(this.glowA);
      }
    }

    // 4. final
    const F = this.progs.final;
    gl.useProgram(F.p);
    this.bindTex(0, src.tex, F.u.uSrc);
    this.bindTex(1, this.glowA!.tex, F.u.uGlow);
    gl.uniform2f(F.u.uRes, L.width, L.height);
    gl.uniform1f(F.u.uGlowAmt, glowAmt);
    gl.uniform1f(F.u.uScan, u.post.scanlines);
    gl.uniform1f(F.u.uScanPeriod, Math.max(3, Math.round(L.cellH / 5)));
    gl.uniform1f(F.u.uCurve, u.post.curvature);
    gl.uniform1f(F.u.uChroma, u.post.chroma);
    gl.uniform1f(F.u.uGrain, u.post.grain);
    gl.uniform1f(F.u.uVignette, u.post.vignette);
    gl.uniform1f(F.u.uBright, u.brightness);
    gl.uniform1f(F.u.uWarm, u.warmth);
    gl.uniform1f(F.u.uPeak, u.peak);
    gl.uniform1f(F.u.uTime, u.time);
    gl.uniform3f(F.u.uEdge, u.edge[0], u.edge[1], u.edge[2]);
    this.pass(null);
  }

  dispose() {
    this.canvas.removeEventListener('webglcontextlost', this.onLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored);
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
