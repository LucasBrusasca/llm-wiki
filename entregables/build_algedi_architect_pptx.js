const pptxgen = require('pptxgenjs');
// El runtime incluido no exporta los helpers de QA que usan otros bundles.
// Se mantienen aquí verificaciones equivalentes y livianas para el generador.
function warnIfSlideHasOverlaps(slide) {
  const elements = slide._slideObjects || [];
  for (let i = 0; i < elements.length; i += 1) {
    const a = elements[i]?.options;
    if (!a || [a.x, a.y, a.w, a.h].some((v) => typeof v !== 'number')) continue;
    for (let j = i + 1; j < elements.length; j += 1) {
      const b = elements[j]?.options;
      if (!b || [b.x, b.y, b.w, b.h].some((v) => typeof v !== 'number')) continue;
      const interW = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const interH = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (interW <= 0 || interH <= 0) continue;
      // Texto contenido en una card/nodo y badges sobre cards son intencionales.
      const contained = (a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h)
        || (b.x >= a.x && b.y >= a.y && b.x + b.w <= a.x + a.w && b.y + b.h <= a.y + a.h);
      if (!contained && interW * interH > 0.15) {
        console.warn(`QA overlap slide ${slide._slideNum}: objetos ${i} y ${j}`);
      }
    }
  }
}

function warnIfSlideElementsOutOfBounds(slide) {
  const elements = slide._slideObjects || [];
  elements.forEach((el, i) => {
    const o = el?.options;
    if (!o || [o.x, o.y, o.w, o.h].some((v) => typeof v !== 'number')) return;
    if (o.x < 0 || o.y < 0 || o.x + o.w > 13.3335 || o.y + o.h > 7.5005) {
      console.warn(`QA bounds slide ${slide._slideNum}: objeto ${i}`);
    }
  });
}

const pptx = new pptxgen();
pptx.layout = 'LAYOUT_WIDE';
pptx.author = 'Lucas Brusasca';
pptx.company = 'Algedi';
pptx.subject = 'Trabajo Final — AI Agents: de la idea a la implementación';
pptx.title = 'Algedi Architect — Decidir antes de construir';
pptx.lang = 'es-AR';
pptx.theme = {
  headFontFace: 'Cambria',
  bodyFontFace: 'Calibri',
  lang: 'es-AR',
};
pptx.defineSlideMaster({
  title: 'DARK',
  background: { color: '0B1020' },
  objects: [],
});
pptx.defineSlideMaster({
  title: 'LIGHT',
  background: { color: 'F5F7FB' },
  objects: [],
});

const C = {
  navy: '0B1020', panel: '151B2E', panel2: '20283D', white: 'F7F9FD',
  light: 'F5F7FB', ink: '162033', muted: 'A8B2C7', mutedInk: '657089',
  cyan: '4DD8FF', cyanSoft: 'DDF7FF', gold: 'FFB84D', goldSoft: 'FFF1D9',
  mint: '4FE0A1', mintSoft: 'DDF9EE', red: 'FF647C', redSoft: 'FFE4E9',
  purple: '9B8CFF', purpleSoft: 'EDEAFF', border: 'D9DFEA',
};
const ST = pptx.ShapeType;
const W = 13.333;
const H = 7.5;

function tx(slide, text, x, y, w, h, opts = {}) {
  slide.addText(text, {
    x, y, w, h,
    fontFace: opts.fontFace || 'Calibri',
    fontSize: opts.fontSize || 18,
    color: opts.color || C.ink,
    bold: opts.bold || false,
    align: opts.align || 'left',
    valign: opts.valign || 'mid',
    margin: opts.margin === undefined ? 0 : opts.margin,
    breakLine: false,
    fit: 'shrink',
    isTextBox: true,
    ...opts,
  });
}

function rect(slide, x, y, w, h, fill, radius = true, line = null) {
  slide.addShape(radius ? ST.roundRect : ST.rect, {
    x, y, w, h,
    rectRadius: radius ? 0.08 : 0,
    fill: { color: fill },
    line: line ? { color: line, width: 1 } : { color: fill, transparency: 100 },
  });
}

function line(slide, x, y, w, h, color, width = 1.5, beginArrowType, endArrowType) {
  const flipH = w < 0;
  const flipV = h < 0;
  if (flipH) { x += w; w = Math.abs(w); }
  if (flipV) { y += h; h = Math.abs(h); }
  slide.addShape(ST.line, {
    x, y, w, h,
    flipH,
    flipV,
    line: { color, width, beginArrowType, endArrowType },
  });
}

function circle(slide, x, y, d, fill, stroke = fill, sw = 1) {
  slide.addShape(ST.ellipse, { x, y, w: d, h: d, fill: { color: fill }, line: { color: stroke, width: sw } });
}

function pill(slide, text, x, y, w, fill, color, border = fill, fontSize = 11) {
  rect(slide, x, y, w, 0.34, fill, true, border);
  tx(slide, text, x + 0.08, y + 0.02, w - 0.16, 0.28, { fontSize, color, bold: true, align: 'center' });
}

function title(slide, kicker, heading, dark = false) {
  tx(slide, kicker.toUpperCase(), 0.6, 0.38, 4.8, 0.24, { fontSize: 10, color: dark ? C.cyan : '2187A7', bold: true, charSpacing: 1.8 });
  tx(slide, heading, 0.6, 0.72, 12.0, 0.68, { fontFace: 'Cambria', fontSize: 27, color: dark ? C.white : C.ink, bold: true, margin: 0 });
}

function footer(slide, dark = false) {
  tx(slide, 'Lucas Brusasca  ·  AI Agents 2026  ·  Algedi / Architect', 0.6, 7.05, 6.2, 0.18, { fontSize: 8, color: dark ? '76839C' : '8792A6' });
}

function card(slide, x, y, w, h, fill, border = null) {
  rect(slide, x, y, w, h, fill, true, border || fill);
}

function node(slide, x, y, label, sub, accent, dark = true, w = 1.75) {
  card(slide, x, y, w, 0.86, dark ? C.panel2 : C.white, dark ? '303A55' : C.border);
  circle(slide, x + 0.18, y + 0.22, 0.42, accent, accent);
  tx(slide, label, x + 0.72, y + 0.13, w - 0.84, 0.28, { fontSize: 13, bold: true, color: dark ? C.white : C.ink });
  tx(slide, sub, x + 0.72, y + 0.42, w - 0.84, 0.25, { fontSize: 9, color: dark ? C.muted : C.mutedInk });
}

// Slide 1 — Hook
{
  const s = pptx.addSlide('DARK');
  const slide1Level = Number(process.env.PPTX_SLIDE1_LEVEL || 5);
  tx(s, 'ALGEDI / ARCHITECT', 0.62, 0.42, 3.6, 0.25, { fontSize: 10, bold: true, color: C.cyan, charSpacing: 2 });
  tx(s, 'El primer error de un proyecto de IA\nocurre antes de escribir código.', 0.62, 0.88, 7.2, 1.42, {
    fontFace: 'Cambria', fontSize: 31, bold: true, color: C.white, breakLine: true, valign: 'top',
  });
  tx(s, 'Architect convierte una necesidad difusa en una decisión trazable: qué resolver, con qué enfoque y bajo qué evidencia.', 0.65, 2.50, 6.6, 0.72, {
    fontSize: 17, color: C.muted, valign: 'top',
  });

  if (slide1Level >= 2) {
    card(s, 0.65, 4.14, 2.15, 1.22, C.panel, '2A3550');
    pill(s, 'PROBLEMA', 0.92, 4.37, 0.95, C.redSoft, '9A2942', C.redSoft, 10);
    tx(s, '"Necesitamos IA"', 0.92, 4.81, 1.58, 0.30, { fontSize: 16, color: C.white, bold: true, align: 'center' });
  }

  if (slide1Level >= 3) {
    line(s, 2.83, 4.75, 1.02, 0, '61708F', 2, undefined, 'triangle');
    s.addShape(ST.hexagon, { x: 3.90, y: 3.90, w: 1.92, h: 1.72, fill: { color: '17334A' }, line: { color: C.cyan, width: 1.8 } });
    tx(s, 'ARCHITECT', 4.10, 4.33, 1.52, 0.32, { fontSize: 15, color: C.white, bold: true, align: 'center' });
    tx(s, 'decide antes\nde construir', 4.16, 4.72, 1.40, 0.44, { fontSize: 10, color: C.cyan, align: 'center', breakLine: true });
  }

  const outcomes = [
    ['Rediseño', 'proceso'], ['Reglas', 'automatización'], ['Datos / BI', 'visibilidad'],
    ['IA asistiva', 'copiloto'], ['Agente', 'autonomía'], ['No implementar', 'decisión válida'],
  ];
  const accents = [C.gold, C.mint, C.cyan, C.purple, C.red, '92A0B8'];
  if (slide1Level >= 4) {
    const outcomesCount = Number(process.env.PPTX_OUTCOMES_COUNT || outcomes.length);
    const visibleOutcomes = outcomes.slice(0, outcomesCount);
    visibleOutcomes.forEach((o, i) => {
      const col = i % 3;
      const row = Math.floor(i / 3);
      const x = 6.55 + col * 2.05;
      const y = 3.67 + row * 1.23;
      line(s, 5.78, 4.76, x - 5.78, y + 0.42 - 4.76, '394663', 1.1);
    });
    visibleOutcomes.forEach((o, i) => {
      const col = i % 3;
      const row = Math.floor(i / 3);
      const x = 6.55 + col * 2.05;
      const y = 3.67 + row * 1.23;
      node(s, x, y, o[0], o[1], accents[i], true, 1.82);
    });
  }
  if (slide1Level >= 5) {
    pill(s, 'EXPEDIENTE PERSISTENTE', 8.13, 6.20, 2.53, '17334A', C.cyan, '2E637D', 10);
    tx(s, 'No reemplaza la decisión humana: la vuelve explícita, comparable y auditable.', 6.55, 6.62, 5.85, 0.32, { fontSize: 12, color: C.muted, align: 'center' });
    footer(s, true);
    s.addNotes('0:00–0:25. Abrir con la idea central: el problema no es generar una solución, sino elegir correctamente qué clase de solución merece construirse. Algedi es la plataforma; Architect es la iniciativa focal. No presentar el grafo como protagonista: el protagonista es el expediente que puede cerrarse y reabrirse con evidencia, objeciones y aprobación humana.');
  }
}

// Slide 2 — Problem
{
  const s = pptx.addSlide('LIGHT');
  title(s, '01 · Problema', 'Hoy se salta de la necesidad a la herramienta', false);

  const stages = [
    ['1', 'Necesidad', 'difusa'], ['2', 'Demo', 'rápida'], ['3', 'Arquitectura', 'prematura'], ['4', 'Costo', 'oculto'], ['5', 'Decisión', 'sin memoria'],
  ];
  stages.forEach((st, i) => {
    const x = 0.72 + i * 1.62;
    card(s, x, 2.04, 1.35, 1.18, i === 4 ? C.redSoft : C.white, i === 4 ? 'F1A3B1' : C.border);
    circle(s, x + 0.10, 2.17, 0.36, i === 4 ? C.red : C.cyan, i === 4 ? C.red : C.cyan);
    tx(s, st[0], x + 0.10, 2.17, 0.36, 0.36, { fontSize: 11, color: i === 4 ? C.white : C.navy, bold: true, align: 'center' });
    tx(s, st[1], x + 0.12, 2.61, 1.11, 0.25, { fontSize: 13, bold: true, color: C.ink, align: 'center' });
    tx(s, st[2], x + 0.12, 2.88, 1.11, 0.20, { fontSize: 10, color: C.mutedInk, align: 'center' });
    if (i < stages.length - 1) line(s, x + 1.37, 2.63, 0.22, 0, 'AAB3C4', 1.4, undefined, 'triangle');
  });

  card(s, 0.72, 3.62, 7.82, 2.35, C.white, C.border);
  tx(s, 'USUARIO DEL PILOTO', 1.02, 3.92, 2.1, 0.22, { fontSize: 10, color: '2187A7', bold: true, charSpacing: 1 });
  tx(s, 'Líder de innovación o datos en una PyME', 1.02, 4.23, 4.42, 0.45, { fontFace: 'Cambria', fontSize: 22, color: C.ink, bold: true });
  tx(s, 'Sin arquitecto dedicado · ~6 iniciativas por trimestre · 8 h de preparación por caso', 1.02, 4.82, 6.85, 0.34, { fontSize: 15, color: C.mutedInk });
  pill(s, 'POR QUÉ AHORA', 1.02, 5.35, 1.38, C.cyanSoft, '16617A', C.cyanSoft, 10);
  tx(s, 'Prototipar es cada vez más fácil. El cuello de botella pasó a ser decidir qué merece construirse.', 2.58, 5.35, 5.26, 0.42, { fontSize: 13, color: C.ink, bold: true });

  card(s, 8.88, 1.78, 3.75, 4.55, C.navy, C.navy);
  pill(s, 'ESCENARIO A VALIDAR', 9.28, 2.18, 1.68, '26304A', C.gold, '3B4766', 9);
  tx(s, 'USD 3.200', 9.24, 2.78, 3.02, 0.72, { fontFace: 'Cambria', fontSize: 32, bold: true, color: C.white, align: 'center' });
  tx(s, 'costo trimestral del problema', 9.38, 3.47, 2.74, 0.28, { fontSize: 12, color: C.muted, align: 'center' });
  line(s, 9.36, 4.03, 2.75, 0, '394663', 1);
  tx(s, 'USD 1.200', 9.36, 4.25, 1.26, 0.34, { fontSize: 17, bold: true, color: C.cyan, align: 'center' });
  tx(s, 'preparación', 9.36, 4.62, 1.26, 0.20, { fontSize: 10, color: C.muted, align: 'center' });
  tx(s, '+', 10.68, 4.33, 0.28, 0.24, { fontSize: 17, bold: true, color: C.muted, align: 'center' });
  tx(s, 'USD 2.000', 10.98, 4.25, 1.26, 0.34, { fontSize: 17, bold: true, color: C.red, align: 'center' });
  tx(s, 'si se construye mal', 10.90, 4.62, 1.42, 0.34, { fontSize: 10, color: C.muted, align: 'center' });
  tx(s, 'Supuesto explícito, no resultado medido.', 9.35, 5.55, 2.82, 0.27, { fontSize: 10, color: C.gold, italic: true, align: 'center' });
  footer(s, false);
  s.addNotes('0:25–1:20. Describir el usuario del piloto: una persona que recibe iniciativas, debe traducirlas y no cuenta con un arquitecto dedicado. El costo se presenta como escenario, no como evidencia observada: seis casos por trimestre, ocho horas por caso y un desarrollo incorrecto de USD 2.000. La hipótesis es que hoy se pierde tiempo preparando y, peor, se puede elegir una clase de solución equivocada.');
}

// Slide 3 — Solution
{
  const s = pptx.addSlide('DARK');
  title(s, '02 · Solución', 'Un protocolo de decisión, no otro chat', true);

  const flow = [
    ['1', 'RECUPERAR', 'Pasajes y citas válidas'],
    ['2', 'CLASIFICAR', '¿Qué clase de solución?'],
    ['3', 'COMPARAR', 'Impacto · datos · costo · riesgo'],
    ['4', 'VERIFICAR', 'Objeción independiente'],
    ['5', 'DECIDIR', 'Aprobar · cambiar · descartar'],
  ];
  flow.forEach((f, i) => {
    const x = 0.62 + i * 2.50;
    card(s, x, 1.82, 2.12, 1.44, i === 4 ? '17334A' : C.panel, i === 4 ? C.cyan : '2A3550');
    circle(s, x + 0.16, 2.02, 0.39, i === 4 ? C.cyan : C.panel2, i === 4 ? C.cyan : '43506E');
    tx(s, f[0], x + 0.16, 2.02, 0.39, 0.39, { fontSize: 11, color: i === 4 ? C.navy : C.cyan, bold: true, align: 'center' });
    tx(s, f[1], x + 0.64, 1.98, 1.30, 0.25, { fontSize: 11, color: C.white, bold: true });
    tx(s, f[2], x + 0.16, 2.54, 1.80, 0.38, { fontSize: 9.5, color: C.muted, align: 'center' });
    if (i < 4) line(s, x + 2.16, 2.52, 0.28, 0, '52617F', 1.5, undefined, 'triangle');
  });

  tx(s, 'SEIS SALIDAS POSIBLES', 0.74, 3.76, 2.6, 0.22, { fontSize: 10, color: C.cyan, bold: true, charSpacing: 1 });
  const classes = [
    ['Rediseño', C.goldSoft, '754A05'], ['Reglas', C.mintSoft, '176647'], ['Datos / BI', C.cyanSoft, '16617A'],
    ['IA asistiva', C.purpleSoft, '5745A3'], ['Agente', C.redSoft, '9A2942'], ['No implementar', 'E9EDF4', '4F5B73'],
  ];
  classes.forEach((c, i) => pill(s, c[0], 0.74 + i * 1.68, 4.14, 1.48, c[1], c[2], c[1], 10));

  card(s, 0.74, 4.88, 7.45, 1.34, C.panel, '2A3550');
  tx(s, 'CASO DEMO', 1.02, 5.11, 1.20, 0.20, { fontSize: 9, color: C.gold, bold: true, charSpacing: 1 });
  tx(s, '"Necesito automatizar el reporte mensual de planillas"', 1.02, 5.42, 4.78, 0.35, { fontFace: 'Cambria', fontSize: 17, color: C.white, bold: true });
  tx(s, 'Architect puede concluir Datos / BI, no agente.', 1.02, 5.84, 4.90, 0.25, { fontSize: 12, color: C.cyan, bold: true });
  line(s, 6.10, 5.54, 0.42, 0, '52617F', 1.6, undefined, 'triangle');
  pill(s, 'DECISIÓN HUMANA', 6.56, 5.37, 1.62, '17334A', C.cyan, '2E637D', 8);

  card(s, 8.56, 4.88, 3.85, 1.34, '1B2338', '35415D');
  tx(s, 'EXPEDIENTE', 8.88, 5.09, 1.34, 0.20, { fontSize: 9, color: C.purple, bold: true, charSpacing: 1 });
  tx(s, 'propuesta  ·  objeción  ·  evidencia', 8.88, 5.43, 3.00, 0.24, { fontSize: 12, color: C.white, bold: true });
  tx(s, 'decisión  ·  comentario  ·  fecha', 8.88, 5.78, 3.00, 0.24, { fontSize: 12, color: C.muted });
  footer(s, true);
  s.addNotes('1:20–2:20. Explicar el flujo completo. Primero recupera evidencia de Algedi con marcadores válidos; luego clasifica entre seis salidas y compara alternativas con la misma matriz. Un segundo agente formula objeciones y finalmente la persona responsable decide. La interfaz HTML no contiene el criterio: visualiza la respuesta del backend. La diferencia frente a un chat aislado es el protocolo repetible, la trazabilidad, la persistencia y la aprobación explícita.');
}

// Slide 4 — Viability
{
  const s = pptx.addSlide('LIGHT');
  title(s, '03 · Viabilidad', 'MVP del piloto: base disponible, prototipo conectado, prueba bloqueada', false);

  const cols = [
    { x: 0.72, w: 3.72, title: 'BASE DISPONIBLE', accent: C.mint, bg: C.mintSoft, items: ['Ingesta y recuperación', 'Issue + alternativas', 'Verificador + interfaz'] },
    { x: 4.80, w: 3.72, title: 'PROTOTIPO CONECTADO', accent: C.cyan, bg: C.cyanSoft, items: ['Endpoint de 6 salidas', 'Matriz + segundo agente', 'Interfaz sin reglas de decisión'] },
    { x: 8.88, w: 3.72, title: 'GATE DE ÉXITO', accent: C.gold, bg: C.goldSoft, items: ['10 de 12 casos correctos', '0 referencias inexistentes', '100% decisiones humanas registradas'] },
  ];
  cols.forEach((c, ci) => {
    card(s, c.x, 1.80, c.w, 3.72, C.white, C.border);
    circle(s, c.x + 0.28, 2.10, 0.48, c.bg, c.accent, 1.2);
    tx(s, String(ci + 1), c.x + 0.28, 2.10, 0.48, 0.48, { fontSize: 13, bold: true, color: C.ink, align: 'center' });
    tx(s, c.title, c.x + 0.92, 2.12, 2.42, 0.26, { fontSize: 11, bold: true, color: C.ink, charSpacing: 0.8 });
    c.items.forEach((it, i) => {
      circle(s, c.x + 0.32, 2.90 + i * 0.72, 0.23, c.accent, c.accent);
      tx(s, '✓', c.x + 0.32, 2.90 + i * 0.72, 0.23, 0.23, { fontSize: 9, bold: true, color: ci === 2 ? C.ink : C.white, align: 'center' });
      tx(s, it, c.x + 0.72, 2.80 + i * 0.72, 2.60, 0.43, { fontSize: 13, color: C.ink, bold: i === 0 && ci === 2 });
    });
    if (ci < 2) line(s, c.x + c.w + 0.08, 3.65, 0.27, 0, 'AAB3C4', 1.4, undefined, 'triangle');
  });

  card(s, 0.72, 5.88, 11.88, 0.74, C.navy, C.navy);
  pill(s, 'DATOS DEL PILOTO', 1.02, 6.08, 1.62, '26304A', C.cyan, '3B4766', 9);
  tx(s, 'Propios, ficticios o públicos. Sin documentos confidenciales de clientes, empleadores ni terceros.', 2.88, 6.04, 8.98, 0.34, { fontSize: 13, color: C.white, bold: true, align: 'center' });
  pill(s, 'SE EVALÚA AL CIERRE DE LAS 2 SEMANAS', 8.93, 5.52, 3.55, C.goldSoft, '754A05', C.goldSoft, 9);
  footer(s, false);
  s.addNotes('2:20–3:15. Separar con honestidad tres estados. Algedi aporta ingesta, recuperación, persistencia y revisión humana. El prototipo Architect ya conecta la interfaz con un endpoint de seis salidas, matriz y verificador. Todavía no está validado: el banco de doce casos y el gate se evalúan recién al cierre de las dos semanas. Los datos del piloto son propios, ficticios o públicos.');
}

// Slide 5 — Risk
{
  const s = pptx.addSlide('DARK');
  title(s, '04 · Riesgo principal', 'Que suene bien y esté mal', true);
  pill(s, 'NIVEL 4 · MULTIAGENTES + HITL', 9.48, 0.46, 2.82, '26304A', C.cyan, '3B4766', 9);

  card(s, 0.78, 1.92, 3.14, 1.40, C.panel, '2A3550');
  circle(s, 1.02, 2.18, 0.48, C.cyanSoft, C.cyan);
  tx(s, 'P', 1.02, 2.18, 0.48, 0.48, { fontSize: 14, bold: true, color: C.navy, align: 'center' });
  tx(s, 'PLANNER', 1.70, 2.08, 1.48, 0.25, { fontSize: 13, bold: true, color: C.white });
  tx(s, 'propone una clase\ny una arquitectura', 1.70, 2.44, 1.62, 0.46, { fontSize: 11, color: C.muted, breakLine: true });

  card(s, 0.78, 3.88, 3.14, 1.40, C.panel, '2A3550');
  circle(s, 1.02, 4.14, 0.48, C.redSoft, C.red);
  tx(s, 'V', 1.02, 4.14, 0.48, 0.48, { fontSize: 14, bold: true, color: '8D2038', align: 'center' });
  tx(s, 'VERIFIER', 1.70, 4.04, 1.48, 0.25, { fontSize: 13, bold: true, color: C.white });
  tx(s, 'objeta supuestos\ny exige evidencia', 1.70, 4.40, 1.62, 0.46, { fontSize: 11, color: C.muted, breakLine: true });

  line(s, 3.96, 2.63, 1.22, 1.22, '52617F', 1.8, undefined, 'triangle');
  line(s, 3.96, 4.57, 1.22, -0.72, '52617F', 1.8, undefined, 'triangle');
  s.addShape(ST.hexagon, { x: 5.18, y: 2.94, w: 2.14, h: 1.70, fill: { color: '2A2135' }, line: { color: C.red, width: 1.6 } });
  tx(s, 'RECOMENDACIÓN', 5.40, 3.28, 1.70, 0.25, { fontSize: 12, color: C.white, bold: true, align: 'center' });
  tx(s, 'plausible ≠ correcta', 5.42, 3.70, 1.66, 0.26, { fontSize: 12, color: C.red, bold: true, align: 'center' });

  line(s, 7.36, 3.79, 1.08, 0, '52617F', 1.8, undefined, 'triangle');
  card(s, 8.50, 2.77, 3.76, 2.08, '17334A', C.cyan);
  s.addShape(ST.diamond, { x: 8.87, y: 3.16, w: 0.82, h: 0.82, fill: { color: C.cyan }, line: { color: C.cyan } });
  tx(s, 'H', 9.06, 3.36, 0.44, 0.38, { fontSize: 14, color: C.navy, bold: true, align: 'center' });
  tx(s, 'CONTROL HUMANO', 9.91, 3.12, 1.92, 0.25, { fontSize: 13, color: C.white, bold: true });
  tx(s, 'aprueba · pide cambio · descarta', 9.91, 3.53, 1.96, 0.40, { fontSize: 12, color: C.cyan, bold: true });
  tx(s, 'con comentario y fecha', 9.91, 4.05, 1.96, 0.25, { fontSize: 11, color: C.muted });

  const mitig = [
    ['SEPARACIÓN', 'roles y pasos distintos', C.purple],
    ['CONTROLES', 'reglas determinísticas', C.gold],
    ['PRUEBA', 'casos con respuesta esperada', C.mint],
  ];
  mitig.forEach((m, i) => {
    const x = 2.00 + i * 3.10;
    card(s, x, 5.72, 2.72, 0.72, C.panel, '2A3550');
    circle(s, x + 0.18, 5.93, 0.28, m[2], m[2]);
    tx(s, m[0], x + 0.58, 5.82, 0.95, 0.18, { fontSize: 9, color: m[2], bold: true });
    tx(s, m[1], x + 0.58, 6.06, 1.86, 0.18, { fontSize: 10, color: C.white, bold: true });
  });
  tx(s, 'La separación reduce correlación; no garantiza independencia.', 3.72, 6.63, 5.92, 0.23, { fontSize: 10, color: C.gold, italic: true, align: 'center' });
  footer(s, true);
  s.addNotes('3:15–4:00. En el espectro del curso, Architect es Nivel 4 porque coordina planner, verifier y HITL. Eso no significa autoridad operacional: sólo recomienda. Nombrar el riesgo sin maquillaje: ambos modelos pueden compartir sesgos; dos agentes no garantizan independencia. La mitigación combina separación de roles, controles determinísticos, benchmark y decisión humana registrada.');
}

// Slide 6 — Impact and ask
{
  const s = pptx.addSlide('LIGHT');
  title(s, '05 · Impacto y pedido', 'Piloto de dos semanas, con una salida explícita', false);
  pill(s, 'ESCENARIO A VALIDAR', 10.42, 0.46, 1.72, C.goldSoft, '754A05', C.goldSoft, 9);

  const metrics = [
    { x: 0.72, n: 'USD 1.900', label: 'beneficio esperado / trimestre', note: 'horas + menor error esperado', color: C.mint, bg: C.mintSoft },
    { x: 4.49, n: 'USD 1.040', label: 'inversión incremental', note: '40 h + inferencia', color: C.cyan, bg: C.cyanSoft },
    { x: 8.26, n: '1,6 meses', label: 'payback estimado', note: 'solo para este escenario', color: C.gold, bg: C.goldSoft },
  ];
  metrics.forEach((m) => {
    card(s, m.x, 1.72, 3.35, 1.72, C.white, C.border);
    circle(s, m.x + 0.24, 1.98, 0.42, m.bg, m.color, 1.2);
    tx(s, m.n, m.x + 0.78, 1.88, 2.25, 0.48, { fontFace: 'Cambria', fontSize: 24, color: C.ink, bold: true, align: 'center' });
    tx(s, m.label, m.x + 0.32, 2.48, 2.71, 0.27, { fontSize: 11, color: C.ink, bold: true, align: 'center' });
    tx(s, m.note, m.x + 0.32, 2.84, 2.71, 0.22, { fontSize: 9, color: C.mutedInk, align: 'center' });
  });
  pill(s, 'SIN ERROR EVITADO: PAYBACK 3,5 MESES', 4.65, 3.53, 4.02, C.goldSoft, '754A05', C.goldSoft, 9);

  card(s, 0.72, 3.86, 11.88, 2.28, C.navy, C.navy);
  tx(s, 'PEDIDO', 1.04, 4.16, 1.20, 0.23, { fontSize: 10, color: C.cyan, bold: true, charSpacing: 1.2 });
  tx(s, 'Aprobar un piloto acotado', 1.04, 4.48, 4.30, 0.48, { fontFace: 'Cambria', fontSize: 24, color: C.white, bold: true });
  tx(s, 'La continuidad no se presume: se gana contra el gate.', 1.04, 5.05, 4.72, 0.30, { fontSize: 13, color: C.muted });

  const asks = [
    ['2 SEMANAS', 'tiempo'], ['12 CASOS', 'banco sintético'], ['1 CASO', 'punta a punta'],
  ];
  asks.forEach((a, i) => {
    const x = 6.28 + i * 1.88;
    card(s, x, 4.27, 1.60, 1.22, i === 0 ? '17334A' : C.panel2, i === 0 ? C.cyan : '35415D');
    tx(s, a[0], x + 0.12, 4.55, 1.36, 0.30, { fontSize: 14, color: i === 0 ? C.cyan : C.white, bold: true, align: 'center' });
    tx(s, a[1], x + 0.12, 4.94, 1.36, 0.24, { fontSize: 10, color: C.muted, align: 'center' });
  });
  tx(s, 'Continuar solo si: 10/12 correctos  ·  0 referencias inexistentes  ·  100% decisión humana registrada', 6.18, 5.69, 5.50, 0.36, { fontSize: 10, color: C.gold, bold: true, align: 'center' });

  tx(s, 'No construimos IA porque podemos. Construimos después de demostrar que corresponde.', 1.56, 6.55, 10.25, 0.36, { fontFace: 'Cambria', fontSize: 18, color: C.ink, bold: true, italic: true, align: 'center' });
  footer(s, false);
  s.addNotes('4:00–4:40. Cerrar con un pedido concreto: dos semanas, doce casos sintéticos y un caso completo. El beneficio, la inversión y el payback son supuestos, no resultados. La sensibilidad más conservadora elimina por completo el ahorro por error evitado y lleva el payback a 3,5 meses. Continuar únicamente si supera los tres umbrales.');
}

const requestedMaxSlides = Number(process.env.PPTX_MAX_SLIDES || 0);
if (requestedMaxSlides > 0 && requestedMaxSlides < pptx._slides.length) {
  pptx._slides = pptx._slides.slice(0, requestedMaxSlides);
}

for (const slide of pptx._slides) {
  warnIfSlideHasOverlaps(slide, pptx); // algunos solapamientos son intencionales: texto sobre cards/nodos
  warnIfSlideElementsOutOfBounds(slide, pptx);
}

async function writeDeck() {
  await pptx.writeFile({ fileName: process.env.PPTX_OUTPUT || 'ALGEDI_ARCHITECT_TP_FINAL.pptx' });
}

writeDeck().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
