/* =====================================================================
   ODC · Gobernanza de Inteligencia Artificial Responsable
   Universidad de Cundinamarca

   ÍNDICE
     0.  Configuración
     1.  Utilidades
     2.  Estado y progreso (localStorage)
     3.  Ayudantes de interfaz (devuelven HTML)
     4.  Componentes de actividad
     5.  Datos y contenido del curso          (textos, referencias, preguntas)
     6.  Pantallas                            (addScreen, en orden de aparición)
     7.  Navegación y dibujo de pantallas
     8.  Eventos: modal, pestañas, teclado y tamaño de texto
     9.  Sof-IA: voz y avatar (Web Speech API)
     10. Arranque

   CÓMO AGREGAR UNA PANTALLA
     addScreen({
       id: 'mNuevo',          // único; se usa en data-go="mNuevo"
       block: 2,              // 0 portada/menú · 1..4 bloques · 5 cierre
       module: 'Módulo X',    // etiqueta de la barra superior
       title: '...',          // documentación interna
       narration: '...',      // lo que lee Sof-IA y la transcripción
       render: () => `${header('Módulo X', 'Título')}<p>...</p>`,
       init: root => { ... }, // opcional: eventos y actividades
       requires: () => isDone('clave'), // opcional: bloquea "Continuar"
       free: true,            // opcional: accesible siempre
       avatar: false          // opcional: oculta el panel de Sof-IA
     });
   Se muestra en el orden en que se llama addScreen. Para agregar un botón
   al menú, edita MENU_BLOCKS en la sección 5.

   CÓMO AGREGAR UNA ACTIVIDAD
     Usa un componente de la sección 4 dentro de init() y, si debe bloquear
     el avance, pon requires() en la pantalla.

   CONTRATO CON EL HTML (ids y clases que este script espera)
     #screen #main #avatarPane #avwrap #avImg #avSvg #trans
     #bPrev #bNext #bMenu #bHelp #bFa #bFm #lockmsg #pgno #pbar .prog
     #aPlay #aPause #aStop #aAuto  #modal (.x, #mt, #mb)
   ===================================================================== */


/* =====================================================================
   0. CONFIGURACIÓN
   ===================================================================== */

const CONFIG = {
    storageKey: 'odc_gia_v2', // cambia el nombre para reiniciar el progreso
    passPercent: 80, // % mínimo para aprobar la evaluación final
    zoom: {
        min: 0.5,
        max: 1.6,
        step: 0.1,
        default: 0.9
    }, // escala del texto (A+ / A−)
    voice: {
        rate: 1,
        startDelayMs: 0
    },
    wordsearch: {
        size: 15,
        seed: 20261024
    }, // misma semilla = misma sopa
    drift: {
        threshold: 85,
        floor: 55,
        start: 95,
        lossPerMonth: 0.95,
        recalibrateEvery: 6,
        months: 24
    },
    toastMs: 3200,
    avatar: {
        rest: 'img/Avatar.png',
        talking: 'img/avatar_hablando.gif'
    }
};


/* =====================================================================
   1. UTILIDADES
   ===================================================================== */

/** Atajos de querySelector: $ devuelve uno, $$ devuelve un arreglo. */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Escapa texto para usarlo dentro de atributos HTML. */
const esc = s => String(s)
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Mezcla un arreglo de forma reproducible (misma semilla = mismo orden). */
const shuffle = (arr, seed = 5) => {
    const a = [...arr];
    let s = seed;
    for (let i = a.length - 1; i > 0; i--) {
        s = (s * 9301 + 49297) % 233280;
        const j = Math.floor((s / 233280) * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
};

/** Generador pseudoaleatorio con semilla (mulberry32), para la sopa de letras. */
const seededRandom = seed => () => {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** Notificación temporal abajo de la pantalla. */
const toast = msg => {
    const el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'alert');
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), CONFIG.toastMs);
};


/* =====================================================================
   2. ESTADO Y PROGRESO (se guarda en localStorage)
   ===================================================================== */
const state = {
    done: {}, // actividades completadas: { a1a: 1, a2c1: 1, ... }
    vis: {}, // pantallas visitadas:     { cover: 1, menu: 1, ... }
    zoom: CONFIG.zoom.default, // escala del texto
    auto: true // audio automático de Sof-IA
};
try {
    Object.assign(state, JSON.parse(localStorage.getItem(CONFIG.storageKey) || '{}'));
} catch (e) {
    /* sin almacenamiento: se usan los valores por defecto */ }

const saveState = () => {
    try {
        localStorage.setItem(CONFIG.storageKey, JSON.stringify(state));
    } catch (e) {
        /* sin persistencia */ }
};
const isDone = key => !!state.done[key];

/** Marca una actividad como completada y actualiza los botones. */
const markDone = key => {
    if (!state.done[key]) {
        state.done[key] = 1;
        saveState();
    }
    refreshNav();
};


/* =====================================================================
   3. AYUDANTES DE INTERFAZ (devuelven strings HTML)
   ===================================================================== */

/* --- 3.1 Ventanas emergentes (+info) ---------------------------------
   pop() guarda narración, título y cuerpo en POP y devuelve un botón con
   data-pop=<índice>. El listener de clic (sección 8) abre el modal.
   POP se vacía en cada pantalla, así no crece sin límite. */
let POP = [];

function pop(narration, label, title, body, cls = 'info', track = '') {
    POP.push({
        narration,
        title,
        body
    });
    const trackAttr = track ? ` data-track="${track}"` : '';
    return `<button class="${cls}" data-pop="${POP.length - 1}"${trackAttr} aria-haspopup="dialog">${label}</button>`;
}

/** Fila de botones +info a partir de [[etiqueta, texto], ...]. */
function popChips(items, citeText = '') {
    return `<div class="chips">${items.map(([name, text]) =>
    pop(name, name, name, `<p>${text}</p>${citeText ? `<p class="cite">${citeText}</p>` : ''}`)).join('')}</div>`;
}

/** Rejilla de tarjetas clicables [[icono, nombre, texto], ...] que cuentan como "vistas". */
function popCards(items, citeText = '') {
    return `<div class="grid">${items.map(([icon, name, text]) =>
    pop('', `<b>${icon ? icon + ' ' : ''}${name}</b><span>Descubrir · +info</span>`, name,
      `<p>${text}</p>${citeText ? `<p class="cite">${citeText}</p>` : ''}`, 'cardbtn', 'g')).join('')}</div>`;
}

/* --- 3.2 Estructura de texto ------------------------------------------ */

/** Encabezado estándar: antetítulo + título de sección. */
const header = (kicker, title) => `<p class="kick">${kicker}</p><h2>${title}</h2>`;

/** Tarjetas simples: [[título, texto], ...] */
const cards = items => `<div class="grid">${items.map(([t, p]) =>
  `<div class="card"><h3>${t}</h3><p>${p}</p></div>`).join('')}</div>`;

/** Diagrama de flujo horizontal: ['Paso 1', 'Paso 2'] (o {t, color} para un color propio). */
const flow = (steps, loop = false) => `<div class="flow">${steps.map((s, i) => {
  const t = typeof s === 'string' ? s : s.t;
  const style = s.color ? ` style="background:${s.color}"` : '';
  return `${i ? '<span class="ar">→</span>' : ''}<span class="st"${style}>${t}</span>`;
}).join('')}${loop ? '<span class="ar">↻</span>' : ''}</div>`;

/** Pestañas accesibles: items = [{n: narración, t: título, h: html}, ...] */
const tabs = items => `<div class="tabs" data-tabs>
  <div class="tablist" role="tablist">${items.map((x, i) =>
    `<button role="tab" class="tab" aria-selected="${i === 0}" tabindex="${i ? -1 : 0}" data-narration="${esc(x.n)}" data-i="${i}">${x.t}</button>`).join('')}</div>
  ${items.map((x, i) => `<div role="tabpanel" class="panel" ${i ? 'hidden' : ''}>${x.h}</div>`).join('')}
</div>`;

/** Espacio para una imagen opcional en assets/<archivo>.png (si no existe, muestra un marcador). */
const imageSlot = (file, label) =>
    `<div class="slot"><img src="assets/${file}.png" alt="${esc(label)}" data-slot-img>` +
    `<span>🖼 Espacio para imagen<small>${label} · assets/${file}.png</small></span></div>`;

/** Línea de tiempo de botones numerados + caja de detalle (ver bindTimeline). */
const timeline = (id, items) =>
    `<div class="tl" id="${id}">${items.map(([name], i) =>
    `<button aria-pressed="${i === 0}" data-i="${i}"><b>${i + 1}</b>${name}</button>`).join('')}</div>` +
    `<div class="box" id="${id}d" role="status"><b>${items[0][0]}:</b> ${items[0][1]}</div>`;

/** Conecta los botones de timeline(id, items) para mostrar el detalle de cada etapa. */
function bindTimeline(root, id, items) {
    $$(`#${id} button`, root).forEach(btn => btn.onclick = () => {
        $$(`#${id} button`, root).forEach(x => x.setAttribute('aria-pressed', 'false'));
        btn.setAttribute('aria-pressed', 'true');
        const [name, text] = items[+btn.dataset.i];
        $(`#${id}d`, root).innerHTML = `<b>${name}:</b> ${text}`;
    });
}


/* =====================================================================
   4. COMPONENTES DE ACTIVIDAD
   Todos reciben (root, opciones). `restore` = clave en state.done: si ya
   se completó, la actividad se muestra resuelta SIN volver a disparar
   onOk (ni la narración de retroalimentación).
   ===================================================================== */

/**
 * mcq · opción múltiple con retroalimentación por opción.
 * o = { id, q, opts:[{t, fb, ok?, l?}], restore, onOk }
 *   l = etiqueta de la opción (por defecto A, B, C…)
 */
function mcq(root, o) {
    root.innerHTML = `<div class="q"><p class="qt" id="${o.id}t">${o.q}</p>
    <div role="group" aria-labelledby="${o.id}t">${o.opts.map((x, i) =>
      `<button class="opt" data-i="${i}"><b>${x.l || String.fromCharCode(65 + i)}.</b> ${x.t}</button>`).join('')}</div>
    <div class="fb in" role="status" hidden></div></div>`;

    const fb = $('.fb', root);
    const options = $$('.opt', root);

    options.forEach(btn => btn.onclick = () => {
        const choice = o.opts[+btn.dataset.i];
        fb.hidden = false;
        if (choice.ok) {
            btn.classList.add('ok');
            fb.className = 'fb ok';
            fb.innerHTML = '<b>¡Correcto!</b> ' + choice.fb;
            options.forEach(b => b.disabled = true);
            if (o.onOk) o.onOk();
        } else {
            btn.classList.add('no');
            fb.className = 'fb no';
            fb.innerHTML = '<b>Respuesta incorrecta.</b> ' + choice.fb + ' <button class="btn sec rt">🔁 Reintentar</button>';
            $('.rt', fb).onclick = () => {
                options.forEach(b => b.classList.remove('no'));
                fb.hidden = true;
                fb.innerHTML = '';
            };
        }
    });

    if (o.restore && isDone(o.restore)) {
        options.forEach((b, i) => {
            b.disabled = true;
            if (o.opts[i].ok) b.classList.add('ok');
        });
        fb.hidden = false;
        fb.className = 'fb ok';
        fb.innerHTML = '<b>Actividad completada.</b> ' + o.opts.find(x => x.ok).fb;
    }
}

/** Tabla de dimensiones que aparece al fallar la matriz de principios. */
const DIM_TABLE = `<div class="table-wrap"><table class="dim-table">
  <thead><tr><th>Dimensión</th><th>¿Qué busca?</th></tr></thead>
  <tbody>
    <tr><td><strong>Beneficencia</strong></td><td>Generar beneficios y contribuir al bienestar.</td></tr>
    <tr><td><strong>No maleficencia</strong></td><td>Prevenir o reducir posibles daños.</td></tr>
    <tr><td><strong>Autonomía</strong></td><td>Preservar la capacidad de decisión y el control humano.</td></tr>
    <tr><td><strong>Justicia</strong></td><td>Promover resultados equitativos y evitar discriminaciones.</td></tr>
    <tr><td><strong>Explicabilidad</strong></td><td>Hacer comprensibles las decisiones y los resultados de la IA.</td></tr>
  </tbody>
</table></div>`;

/**
 * match · arrastrar opciones a casillas (también por clic o teclado).
 * o = { rows:[{k, t, a}], opts:[{k, t}], okMsg, restore, onOk }
 *   rows[].a = k de la opción correcta para esa fila.
 */
function match(root, o) {
    let placed = {}; // { filaK: opcionK }
    let selected = null; // opción elegida para colocar con clic
    const restored = !!(o.restore && isDone(o.restore));

    const verify = quiet => {
        const fb = $('.fb', root);
        fb.hidden = false;
        let hits = 0;
        $$('.drop', root).forEach(drop => {
            const row = o.rows.find(x => x.k === drop.dataset.k);
            drop.classList.remove('ok', 'no');
            if (placed[row.k] === row.a) {
                drop.classList.add('ok');
                hits++;
            } else {
                drop.classList.add('no');
            }
        });

        if (hits === o.rows.length) {
            fb.className = 'fb ok';
            fb.innerHTML = '<b>¡Excelente!</b> ' + o.okMsg;
            if (!quiet && o.onOk) o.onOk();
        } else {
            fb.className = 'fb no';
            fb.innerHTML = `<b>Aciertos: ${hits} de ${o.rows.length}.</b> Revisa las casillas en rojo y pulsa «Reintentar» para volver a empezar, o corrige las casillas marcadas. ${DIM_TABLE}`;
        }
    };

    const draw = () => {
        const free = o.opts.filter(x => !Object.values(placed).includes(x.k));

        root.innerHTML = `<p class="fig">Arrastra cada opción a su casilla, o toca una opción y luego la casilla (también funciona con teclado: Enter sobre la opción y Enter sobre la casilla).</p>
      ${o.rows.map(r => {
        const opt = o.opts.find(y => y.k === placed[r.k]);
        return `<div class="mrow"><b>${r.t}</b><div class="drop" tabindex="0" role="button" aria-label="Casilla de ${r.t}" data-k="${r.k}">${
          opt ? `<button class="chip" draggable="true" data-k="${opt.k}" data-in="1">${opt.t}</button>` : '<span class="cite">Suelta aquí</span>'
        }</div></div>`;
      }).join('')}
      <h3>Opciones</h3>
      <div class="chips" id="bank">${
        free.map(x => `<button class="chip ${selected === x.k ? 'sel' : ''}" draggable="true" data-k="${x.k}">${x.t}</button>`).join('')
        || '<span class="cite">Todas colocadas</span>'
      }</div>
      <p><button class="btn" id="chk">Verificar respuestas</button> <button class="btn sec" id="rst">🔁 Reintentar</button></p>
      <div class="fb in" role="status" hidden></div>`;

        // Fichas: arrastrar o seleccionar. Clic en una ya colocada = devolverla al banco.
        $$('.chip', root).forEach(chip => {
            chip.ondragstart = e => e.dataTransfer.setData('text/plain', chip.dataset.k);
            chip.onclick = e => {
                e.stopPropagation();
                if (chip.dataset.in) {
                    delete placed[Object.keys(placed).find(k => placed[k] === chip.dataset.k)];
                    selected = null;
                } else {
                    selected = selected === chip.dataset.k ? null : chip.dataset.k;
                }
                draw();
            };
        });

        // Casillas: reciben soltar, clic o Enter/Espacio.
        $$('.drop', root).forEach(drop => {
            const put = optK => {
                Object.keys(placed).forEach(r => {
                    if (placed[r] === optK) delete placed[r];
                });
                placed[drop.dataset.k] = optK;
                selected = null;
                draw();
            };
            drop.ondragover = e => e.preventDefault();
            drop.ondrop = e => {
                e.preventDefault();
                put(e.dataTransfer.getData('text/plain'));
            };
            drop.onclick = () => {
                if (selected) put(selected);
            };
            drop.onkeydown = e => {
                if ((e.key === 'Enter' || e.key === ' ') && selected) {
                    e.preventDefault();
                    put(selected);
                }
            };
        });

        $('#rst', root).onclick = () => {
            placed = {};
            selected = null;
            draw();
        };
        $('#chk', root).onclick = () => verify(false);
    };

    if (restored) placed = Object.fromEntries(o.rows.map(r => [r.k, r.a]));
    draw();
    if (restored) verify(true);
}

/**
 * order · ordenar elementos con botones ↑ ↓.
 * o = { items:[en orden correcto], okMsg, seed, restore, onOk }
 */
function order(root, o) {
    const restored = !!(o.restore && isDone(o.restore));
    let list = restored ? [...o.items] : shuffle(o.items, o.seed || 3);

    const draw = showResult => {
        root.innerHTML = `<ol class="ord">${list.map((x, i) =>
      `<li class="${showResult ? (x === o.items[i] ? 'ok' : 'no') : ''}"><b>${i + 1}.</b><span>${x}</span>
        <button aria-label="Subir ${x}" data-d="-1" data-i="${i}">↑</button>
        <button aria-label="Bajar ${x}" data-d="1" data-i="${i}">↓</button></li>`).join('')}</ol>
      <p><button class="btn" id="chk">Verificar orden</button></p>
      <div class="fb in" role="status" hidden></div>`;

        $$('.ord button', root).forEach(btn => btn.onclick = () => {
            const i = +btn.dataset.i;
            const j = i + +btn.dataset.d;
            if (j < 0 || j >= list.length) return;
            [list[i], list[j]] = [list[j], list[i]];
            draw(false);
            // Devuelve el foco al botón que se movió junto con el elemento.
            $$('.ord button', root).find(z => z.dataset.i == j && z.dataset.d === btn.dataset.d)?.focus();
        });

        $('#chk', root).onclick = () => verify(false);
    };

    const verify = quiet => {
        const ok = list.every((x, i) => x === o.items[i]);
        draw(true);
        const fb = $('.fb', root);
        fb.hidden = false;
        if (ok) {
            fb.className = 'fb ok';
            fb.innerHTML = '<b>¡Correcto!</b> ' + o.okMsg;
            if (!quiet && o.onOk) o.onOk();
        } else {
            fb.className = 'fb no';
            fb.innerHTML = '<b>Aún no.</b> Recuerda la explicación del módulo 6: cada elemento se apoya en el anterior. Reorganiza e inténtalo otra vez. <button class="btn sec rt">🔁 Reintentar</button>';
            $('.rt', fb).onclick = () => {
                list = shuffle(o.items, Math.floor(Math.random() * 900) + 1);
                draw(false);
            };
        }
    };

    draw(false);
    if (restored) verify(true);
}

/**
 * tf · verdadero/falso. Completa la actividad cuando TODAS están bien.
 * o = { items:[{q, a:boolean, fb}], restore, onOk }
 */
function tf(root, o) {
    const answers = {}; // { índice: acertó? }
    const restored = !!(o.restore && isDone(o.restore));

    root.innerHTML = o.items.map((x, i) => `<div class="q"><p class="qt">${i + 1}. ${x.q}</p>
    <button class="btn sec" data-i="${i}" data-v="1">✅ Verdadero</button> <button class="btn sec" data-i="${i}" data-v="0">❌ Falso</button>
    <div class="fb in" role="status" hidden></div></div>`).join('') +
        `<div class="fb in" id="tfall" hidden></div>`;

    const checkAll = () => {
        if (Object.keys(answers).length === o.items.length && Object.values(answers).every(Boolean)) {
            const f = $('#tfall', root);
            f.hidden = false;
            f.className = 'fb ok';
            f.innerHTML = '<b>¡Muy bien!</b> Has respondido correctamente todas las afirmaciones.';
            if (o.onOk) o.onOk();
        }
    };

    $$('.q button[data-v]', root).forEach(btn => btn.onclick = () => {
        const i = +btn.dataset.i;
        const item = o.items[i];
        const fb = $('.fb', btn.closest('.q'));
        const ok = (btn.dataset.v === '1') === item.a;
        answers[i] = ok;
        fb.hidden = false;
        fb.className = 'fb ' + (ok ? 'ok' : 'no');
        fb.innerHTML = (ok ? '<b>Correcto.</b> ' : '<b>Incorrecto.</b> ') + item.fb + (ok ? '' : ' <button class="btn sec rt">🔁 Reintentar</button>');
        if (!ok) {
            $('.rt', fb).onclick = () => {
                delete answers[i];
                fb.hidden = true;
                fb.innerHTML = '';
            };
        }
        checkAll();
    });

    if (restored) {
        o.items.forEach((x, i) => {
            const fb = $('.fb', $$('.q', root)[i]);
            fb.hidden = false;
            fb.className = 'fb ok';
            fb.innerHTML = '<b>Correcto.</b> ' + x.fb;
        });
        const all = $('#tfall', root);
        all.hidden = false;
        all.className = 'fb ok';
        all.innerHTML = '<b>Actividad completada.</b>';
    }
}

/* --- Sopa de letras ------------------------------------------------------
   genGrid() ubica las palabras en una cuadrícula n×n probando posiciones y
   direcciones al azar (con semilla fija: siempre sale igual) y rellena el
   resto con letras aleatorias. */
const WORDS = ['DATOS', 'SESGOS', 'CALIDAD', 'IA', 'JUICIO', 'CONOCIMIENTO', 'BARRERAS', 'APRENDIZAJE', 'GOBERNANZA', 'ALFABETIZACION'];
// 8 direcciones [filas, columnas]: →, ↓, ↘, ←, ↑, ↖, ↗, ↙
const DIRS = [
    [0, 1],
    [1, 0],
    [1, 1],
    [0, -1],
    [-1, 0],
    [-1, -1],
    [1, -1],
    [-1, 1]
];

function genGrid(words, n) {
    for (let attempt = 0; attempt < 200; attempt++) {
        const rnd = seededRandom(CONFIG.wordsearch.seed + attempt);
        const grid = Array.from({
            length: n
        }, () => Array(n).fill(''));
        const placedWords = [];
        let allPlaced = true;

        for (const w of [...words].sort((a, b) => b.length - a.length)) { // primero las largas
            let placed = false;
            for (let k = 0; k < 500 && !placed; k++) {
                const d = DIRS[Math.floor(rnd() * 8)];
                const r = Math.floor(rnd() * n);
                const c = Math.floor(rnd() * n);
                const endR = r + d[0] * (w.length - 1);
                const endC = c + d[1] * (w.length - 1);
                if (endR < 0 || endR >= n || endC < 0 || endC >= n) continue; // se sale del tablero

                let fits = true;
                for (let i = 0; i < w.length; i++) {
                    const ch = grid[r + d[0] * i][c + d[1] * i];
                    if (ch && ch !== w[i]) {
                        fits = false;
                        break;
                    } // choca con otra palabra
                }
                if (!fits) continue;

                for (let i = 0; i < w.length; i++) grid[r + d[0] * i][c + d[1] * i] = w[i];
                placedWords.push({
                    w,
                    r,
                    c,
                    d
                });
                placed = true;
            }
            if (!placed) {
                allPlaced = false;
                break;
            }
        }

        if (allPlaced) {
            const ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
            for (let r = 0; r < n; r++)
                for (let c = 0; c < n; c++)
                    if (!grid[r][c]) grid[r][c] = ABC[Math.floor(rnd() * 26)];
            return {
                g: grid,
                pl: placedWords
            };
        }
    }
    return null;
}

/** wordsearch · o = { restore, onOk } */
function wordsearch(root, o) {
    const n = CONFIG.wordsearch.size;
    const {
        g,
        pl
    } = genGrid(WORDS, n);
    const found = new Set();
    const restored = !!(o.restore && isDone(o.restore));

    root.innerHTML = `<p class="fig">Arrastra sobre las letras (o toca la primera y luego la última letra de la palabra). Puede estar en horizontal, vertical o diagonal, y también al revés. No se usan tildes.</p>
    <div class="ws" id="ws" style="grid-template-columns:repeat(${n},1fr)" role="grid" aria-label="Sopa de letras de ${n} por ${n}">${
      g.map((row, r) => row.map((ch, c) => `<div data-r="${r}" data-c="${c}" role="gridcell">${ch}</div>`).join('')).join('')
    }</div>
    <h3>Lista de palabras</h3>
    <ul class="wl" id="wl">${WORDS.map(w => `<li data-w="${w}">${w}</li>`).join('')}</ul>
    <p id="cnt" role="status"><b>0</b> de ${WORDS.length} palabras encontradas</p>
    <p><button class="btn sec" id="hint">💡 Pista</button> <button class="btn sec" id="rs">🔁 Reintentar</button></p>
    <div class="fb in" id="wsfb" hidden></div>`;

    const cell = (r, c) => $(`[data-r="${r}"][data-c="${c}"]`, root);

    /** Celdas en línea recta entre a y b ([fila, col]); null si no es horizontal, vertical o diagonal. */
    const lineBetween = (a, b) => {
        const dr = b[0] - a[0];
        const dc = b[1] - a[1];
        if (!(dr === 0 || dc === 0 || Math.abs(dr) === Math.abs(dc))) return null;
        const len = Math.max(Math.abs(dr), Math.abs(dc)) + 1;
        const sr = Math.sign(dr);
        const sc = Math.sign(dc);
        return Array.from({
            length: len
        }, (_, i) => [a[0] + sr * i, a[1] + sc * i]);
    };

    const clearPreview = () => $$('.pre', root).forEach(x => x.classList.remove('pre'));
    const preview = cells => {
        clearPreview();
        if (cells) cells.forEach(p => cell(...p).classList.add('pre'));
    };

    /** Si las letras de la línea forman una palabra pendiente (en cualquier sentido), la marca. */
    const tryWord = cells => {
        if (!cells) return;
        const text = cells.map(p => g[p[0]][p[1]]).join('');
        const reversed = [...text].reverse().join('');
        const word = WORDS.find(x => !found.has(x) && (x === text || x === reversed));
        if (!word) return;
        found.add(word);
        cells.forEach(p => cell(...p).classList.add('fnd'));
        $(`[data-w="${word}"]`, root).classList.add('f');
        $('#cnt', root).innerHTML = `<b>${found.size}</b> de ${WORDS.length} palabras encontradas`;
        if (found.size === WORDS.length) {
            const f = $('#wsfb', root);
            f.hidden = false;
            f.className = 'fb ok';
            f.innerHTML = '<b>¡Las encontraste todas!</b> Excelente trabajo.';
            if (o.onOk) o.onOk();
        }
    };

    // Puntero: arrastrar, o tocar inicio y luego fin.
    const cellAt = e => {
        const el = document.elementFromPoint(e.clientX, e.clientY);
        return el && el.dataset && el.dataset.r !== undefined ? [+el.dataset.r, +el.dataset.c] : null;
    };
    let start = null;
    let dragging = false;
    let pending = null; // primer toque en modo "dos toques"
    const board = $('#ws', root);

    board.onpointerdown = e => {
        const p = cellAt(e);
        if (!p) return;
        e.preventDefault();
        dragging = true;
        start = p;
        if (pending) { // segundo toque: cerrar la línea
            const l = lineBetween(pending, p);
            preview(l);
            tryWord(l);
            pending = null;
            dragging = false;
            setTimeout(clearPreview, 250);
        } else {
            preview([p]);
        }
    };

    board.onpointermove = e => {
        if (!dragging) return;
        const p = cellAt(e);
        if (p) preview(lineBetween(start, p) || [start]);
    };

    board.onpointerup = e => {
        if (!dragging) return;
        dragging = false;
        const p = cellAt(e) || start;
        if (p[0] === start[0] && p[1] === start[1]) { // fue un toque
            pending = start;
            preview([start]);
            return;
        }
        tryWord(lineBetween(start, p));
        setTimeout(clearPreview, 250);
        pending = null;
    };

    $('#hint', root).onclick = () => {
        const w = pl.find(x => !found.has(x.w));
        if (!w) return;
        const c = cell(w.r, w.c);
        c.classList.add('hint');
        setTimeout(() => c.classList.remove('hint'), 2500);
        const f = $('#wsfb', root);
        f.hidden = false;
        f.className = 'fb in';
        f.innerHTML = `Pista: busca una palabra de <b>${w.w.length} letras</b> que empieza con la letra resaltada.`;
    };
    $('#rs', root).onclick = () => wordsearch(root, o);

    if (restored) {
        WORDS.forEach(w => {
            const p = pl.find(x => x.w === w);
            found.add(w);
            for (let i = 0; i < w.length; i++) cell(p.r + p.d[0] * i, p.c + p.d[1] * i).classList.add('fnd');
            $(`[data-w="${w}"]`, root).classList.add('f');
        });
        $('#cnt', root).innerHTML = `<b>${WORDS.length}</b> de ${WORDS.length} palabras encontradas`;
    }
}

/* =====================================================================
   5. DATOS DE CONTENIDO (edita aquí textos reutilizados)
   ===================================================================== */

/** Referencias APA 7: [texto, url]. Se ordenan alfabéticamente al escribirlas aquí. */
const REFS = [
    ['Adobor, H. (2026). Navigating the AI adoption trap: A framework for organizational practice. <i>Organizational Dynamics, 55</i>, 101232.', 'https://doi.org/10.1016/j.orgdyn.2026.101232'],
    ['Alon-Barkat, S., Busuioc, M., Schwoerer, K., & Weimueller, K. S. (2025). Algorithmic discrimination in public service provision: Understanding citizens\' attribution of responsibility for human versus algorithmic discriminatory outcomes. <i>Journal of Public Administration Research and Theory, 35</i>(4), 469-488.', 'https://doi.org/10.1093/jopart/muaf024'],
    ['Calzada, I., & Eizaguirre, I. (2026). Anticipatory AI governance in the age of supercomputing: A mixed-methods multistakeholder approach in the Basque Country. <i>Big Data and Cognitive Computing, 10</i>(7), 229.', 'https://doi.org/10.3390/bdcc10070229'],
    ['Casamassa, J., Wang, W., & Masialeti, M. (2025). Generative AI governance for cybersecurity: An integrated approach. <i>Issues in Information Systems, 26</i>(3), 484-493.', 'https://doi.org/10.48009/3_iis_2025_139'],
    ['De Luna, C. (2025, 1 de septiembre). <i>La supervisión humana en el uso de la IA</i> [Video]. YouTube.', 'https://www.youtube.com/watch?v=5yjmQs06PeA'],
    ['Di Chiacchio, L., Al-Khateeb, H., Butt, U., & Yussof, S. (2026). AI legitimacy in energy: A model to improve corporate narratives on sustainability and responsibility. <i>Technological Forecasting and Social Change, 222</i>, 124378.', 'https://doi.org/10.1016/j.techfore.2025.124378'],
    ['Fatorachian, H., & Ashima, A. (2026). Unveiling the impact of artificial intelligence on automotive supply chain operations. <i>IET Collaborative Intelligent Manufacturing, 8</i>, e70065.', 'https://doi.org/10.1049/cim2.70065'],
    ['Herrera, F., & Calderón, R. (2026). Opacity as a feature, not a flaw: Role-sensitive explainability, institutional trust, and the LoBOX ethics governance framework for AI. <i>Technology in Society, 86</i>, 103302.', 'https://doi.org/10.1016/j.techsoc.2026.103302'],
    ['Huang, X., Kou, T., & Zhou, Q. (2026). Embedding AI ethics in the data lifecycle: A framework for enterprise AI governance. <i>Technology in Society, 86</i>, 103261.', 'https://doi.org/10.1016/j.techsoc.2026.103261'],
    ['Kramer, J., et al. (2026). Leveraging stakeholder engagement to develop and evaluate a responsible artificial intelligence framework at a large, multi-state health system. <i>Health Policy and Technology, 15</i>, 101243.', 'https://doi.org/10.1016/j.hlpt.2026.101243'],
    ['Leon, M. (2025). AI-driven transformation: Methodologies, governance, and strategic imperatives. <i>WSEAS Transactions on Business and Economics, 22</i>, 2789-2799.', 'https://doi.org/10.37394/23207.2025.22.219'],
    ['Leon, M. (2026). Lifecycle-based governance to build reliable ethical AI systems. <i>Systems Research and Behavioral Science, 43</i>, 1116-1132.', 'https://doi.org/10.1002/sres.70014'],
    ['Mussie, K. M. (2026). Beyond the algorithm: Artificial intelligence, clinical decision-making, and the moral ecology of care in Africa. <i>Science and Engineering Ethics, 32</i>, 39.', 'https://doi.org/10.1007/s11948-026-00616-w'],
    ['Raina, K., Sharma, G. D., Taheri, B., Dev, D., & Chavriya, S. (2026). Artificial intelligence-driven management: Bridging innovation, knowledge creation, and sustainable business practices. <i>Journal of Innovation & Knowledge, 11</i>, 100860.', 'https://doi.org/10.1016/j.jik.2025.100860'],
    ['Reuel, A., & Undheim, T. A. (2024). <i>Generative AI needs adaptive governance</i>. arXiv.', 'https://arxiv.org/abs/2406.04554'],
    ['Salgado-Criado, J. (2025). Human oversight of artificial intelligence: An operations management perspective. <i>Journal of Industrial Engineering and Management, 18</i>(2), 285-304.', 'https://doi.org/10.3926/jiem.8567'],
    ['Schafer, B. (2026). Internal audit professionals and generative artificial intelligence: Implications for public policy, research, and practice. <i>Journal of Accounting and Public Policy, 59</i>, 107464.', 'https://doi.org/10.1016/j.jaccpubpol.2026.107464'],
    ['Urrutia-Onate, D., Bollain, J., Onieva, E., & Perallos, A. (2026). Beyond transparency: Governance tensions and a typology of accountability gaps in artificial intelligence for high-stakes service sectors. <i>Journal of Governance and Regulation, 15</i>(3), 75-90.', 'https://doi.org/10.22495/jgrv15i3art7'],
    ['Xia, H., Chen, H., Zhang, J. Z., & Kamal, M. M. (2026). Exploring the impact of responsible AI governance on corporate performance: A quasi-natural experiment. <i>Technological Forecasting and Social Change, 223</i>, 124425.', 'https://doi.org/10.1016/j.techfore.2025.124425'],
    ['Xiong, M., Xu, H., Ji, J., Zuo, R., Wang, Y., & Olya, H. (2026). Responsible artificial intelligence attention and firm innovation: An attention-based view. <i>Journal of Product Innovation Management, 43</i>(1), 186-214.', 'https://doi.org/10.1111/jpim.70015'],
    ['Yigitcanlar, T., Liu, K., Senadheera, S., Marasinghe, R., David, A., Cheong, P. H., & Corchado, J. (2026). Configurational pathways to smart city AI adoption: Evidence from local governments in Australia, Hong Kong, Saudi Arabia, Spain, and the United States. <i>Cities, 175</i>, 107117.', 'https://doi.org/10.1016/j.cities.2026.107117']
];

/** Menú principal: cada bloque con sus botones [texto, id de pantalla destino]. */
const MENU_BLOCKS = [{
        name: 'Bloque I: Fundamentos',
        firstScreen: 'b1',
        modules: [
            ['M1: Arquitecturas Integradas', 'm1a'],
            ['M2: Principios Éticos', 'm2'],
            ['M3: Gestión de Riesgos', 'm3']
        ]
    },
    {
        name: 'Bloque II: Salvaguardas técnicas',
        firstScreen: 'b2',
        modules: [
            ['M4: Transparencia & LoBOX', 'm4a'],
            ['M5: Supervisión Humana (HOTL)', 'm5a'],
            ['M6: Accountability & Brechas', 'm6a']
        ]
    },
    {
        name: 'Bloque III: Ciclo de datos & barreras',
        firstScreen: 'b3',
        modules: [
            ['M7: Gobernanza de Datos (FAHP)', 'm7a'],
            ['M8: Solucionismo & Barreras', 'm8a'],
            ['M9: Capacidades & AI Literacy', 'm9a']
        ]
    },
    {
        name: 'Bloque IV: Facilitadores & ejecución',
        firstScreen: 'b4',
        modules: [
            ['M10: Liderazgo & Paradoja PC', 'm10a'],
            ['M11: Auditoría & Model Drift', 'm11a'],
            ['M12: Hoja de Ruta (7 etapas)', 'm12a']
        ]
    }
];

/** Módulo 12 · hoja de ruta de 7 etapas [nombre, descripción]. */
const ROADMAP_STAGES = [
    ['Definición del problema', 'Qué problema se quiere resolver y con qué impacto y riesgos.'],
    ['Recolección y preparación de datos', 'Obtener, depurar y preparar datos de calidad, representativos y legales.'],
    ['Desarrollo y entrenamiento del modelo', 'Construir el modelo con explicabilidad, privacidad y equidad.'],
    ['Validación y pruebas', 'Verificar desempeño y robustez antes de usarlo.'],
    ['Despliegue e integración', 'Poner el sistema en operación con supervisión humana.'],
    ['Monitoreo y mantenimiento', 'Detectar deriva y fallos; mantener el sistema.'],
    ['Retiro y preservación del conocimiento', 'Cerrar el ciclo preservando evidencia y lecciones aprendidas.']
];

/** Evaluación final: [módulo, pregunta, [opciones], índice de la correcta (desde 0)]. */
const FINAL_QUESTIONS = [
    ['Módulo 1', '¿Cuál es la definición más acertada de gobernanza de IA?', ['Un conjunto de políticas internas de la organización.', 'La capacidad de una organización para orientar, controlar y supervisar el uso de la IA.', 'La compra de herramientas de IA de última generación.', 'Una estrategia para llevar internet a todo el país.'], 1],
    ['Módulo 2', '¿Qué busca el principio de no maleficencia?', ['Generar beneficios y contribuir al bienestar.', 'Hacer comprensibles las decisiones del sistema.', 'Prevenir o reducir posibles daños.', 'Promover resultados equitativos.'], 2],
    ['Módulo 3', '¿Cuál es la lógica continua de gestión de riesgos propuesta?', ['Responder → recuperar → identificar → proteger → detectar.', 'Detectar → identificar → documentar → archivar.', 'Identificar → proteger → detectar → responder → recuperar y corregir.', 'Proteger → ignorar → recuperar.'], 2],
    ['Módulo 4', 'Las tres etapas de LoBOX son:', ['Reducir la opacidad accidental, gestionar la opacidad per se y delegar la confianza mediante supervisión institucional.', 'Eliminar toda opacidad, publicar el código y cerrar el sistema.', 'Entrenar, validar y desplegar el modelo.', 'Medir, comparar y sancionar.'], 0],
    ['Módulo 5', 'Human-over-the-Loop (HOTL) significa que la persona:', ['Participa en cada decisión individual del sistema.', 'Supervisa el funcionamiento general y conserva autoridad para modificar o retirar el control.', 'Se limita a leer el informe anual.', 'Es reemplazada por el algoritmo.'], 1],
    ['Módulo 6', 'Para que exista accountability completa, además de transparencia se necesita:', ['Más publicidad del sistema.', 'Responsabilidad clara, evidencia verificable y vía de impugnación y corrección.', 'Solo una explicación técnica.', 'Un comité sin funciones definidas.'], 1],
    ['Módulo 7', 'En el modelo FAHP de Huang et al. (2026), ¿qué dimensión obtuvo mayor peso (41,66 %)?', ['Gestión del hardware.', 'Diseño visual de las interfaces.', 'Gobernanza organizacional y rendición de cuentas.', 'Velocidad de procesamiento.'], 2],
    ['Módulo 8', 'El «solucionismo de IA» consiste en:', ['Resolver con IA solo problemas ya diagnosticados.', 'Asumir que un algoritmo puede resolver problemas de cultura, estructura o estrategia sin entenderlos primero.', 'Usar IA únicamente en tareas simples.', 'Rechazar toda tecnología nueva.'], 1],
    ['Módulo 9', '«Valor = IA + juicio humano» significa que:', ['La IA aporta análisis de grandes volúmenes de datos y las personas aportan contexto, pensamiento crítico y criterio ético.', 'Las personas deben dejar de decidir.', 'La IA aporta el criterio ético.', 'El conocimiento organizacional ya no es relevante.'], 0],
    ['Módulos 10–12', 'En la hoja de ruta de 7 etapas, la puerta de calidad de la etapa de despliegue es:', ['Preservar evidencia y lecciones aprendidas.', 'Revisar sesgos en los datos.', 'Detectar deriva y fallos.', 'Confirmar supervisión humana.'], 3]
];


/* =====================================================================
   6. PANTALLAS (en el orden en que aparecen en el curso)
   ===================================================================== */
const SCREENS = [];
const addScreen = screen => SCREENS.push(screen);

/* ---------- PORTADA, REA Y MENÚ (block 0) ---------- */
addScreen({
    id: 'cover',
    block: 0,
    module: 'Portada',
    title: 'Portada',
    narration: '​Bienvenido a este Moodle de aprendizaje.​ Mi nombre es SofIA​. A lo largo de este curso vamos a conocer cómo la inteligencia artificial está transformando la manera en que trabajamos, tomamos decisiones y gestionamos nuestras organizaciones, pero también vamos a reflexionar sobre los retos y riesgos que aparecen cuando empezamos a utilizar estas tecnologías.​',
    render: () => `
      <div class="cover">
        <div class="uni">Universidad de Cundinamarca</div>
        <p class="kick">Objeto Digital de Conocimiento (ODC)</p>
        <h1>Gobernanza de Inteligencia Artificial Responsable</h1>
        <p class="sub">La IA con propósito construye un mejor mañana.</p>
        <div class="pills">${['Modelos', 'Principios', 'Estructuras', 'Prácticas', 'Barreras', 'Facilitadores'].map(x => `<span class="pill">${x}</span>`).join('')}</div>
        <p class="programa"><b>Gerencia para la Transformación Digital</b></p>
        <div class="autores">
            <b>Presentado por: </b><br>
            <b>Karol Natalia Pardo Cortes<br>
                <b>José Ricardo Pedraza Ballén</b><br>
        </div>

        <div class="acciones">
            <button class="btn" id="goStart" type="button">▶ Iniciar recorrido</button>
            <button class="btn sec" id="goHelp" type="button">❓ Ayuda</button>
        </div>

        <div class="box"><b>¿De qué trata este recurso?</b> Este objeto digital te acompaña a través de 12 módulos organizados en 4 bloques para comprender cómo orientar, controlar y supervisar la adopción responsable de la inteligencia artificial en las organizaciones.</div>
    </div>
 `,
    init: r => {
        $('#goStart', r).onclick = goNext;
        $('#goHelp', r).onclick = openHelp;
    }
});

addScreen({
    id: 'rea',
    block: 0,
    module: 'Primera entrada',
    title: 'Resultado esperado y población objetivo',
    narration: 'Te invito a recorrer este espacio con curiosidad, a cuestionar, participar y relacionar cada tema con tu propia experiencia. Primero conoce el resultado esperado de aprendizaje: analizarás los componentes de una gobernanza responsable de la inteligencia artificial. Después revisa a quién está dirigido este objeto. ¿Listo? Entonces comencemos juntos este recorrido.',
    render: () => `${header('Primera entrada', 'Resultado Esperado de Aprendizaje (REA)')}
      <div class="box">
          <h3 style="margin-top:0">🎯 REA</h3>
          <p>Al finalizar este Objeto Digital de Conocimiento, el estudiante <b>analizará</b> los componentes fundamentales para implementar una gobernanza responsable de la inteligencia artificial, identificando riesgos, brechas y buenas prácticas organizacionales por medio de mecanismos de supervisión, principios éticos y liderazgo; para lo cual se utilizarán conceptos, modelos y herramientas que se abordarán a lo largo del curso, evidenciando su aprendizaje mediante la participación satisfactoria en cada actividad, con la obtención del 100 % de desempeño.</p>
      </div>
      <div class="box warn">
          <h3 style="margin-top:10px">👥 Población objetivo</h3>
          <p>Creadores de oportunidades en formación posgradual interesados en el uso responsable de la inteligencia artificial, especialmente líderes corporativos, jefes de oficina, profesionales y colaboradores relacionados con transformación digital, gestión de riesgos, auditoría y tecnología.</p>
      </div> `
});

addScreen({
    id: 'menu',
    block: 0,
    module: 'Menú',
    title: 'Menú principal',
    narration: 'Haremos un recorrido que va desde entender la gobernanza de la IA, pasando por cómo proteger y supervisar su uso, hasta llegar a cómo implementarla y hacerle seguimiento dentro de una organización.​ Así que te invito a que avancemos paso a paso por cada uno de estos bloques en la gobernanza responsable de la inteligencia artificial.​',
    render: () => {
        const isLocked = id => !canGo(screenIndex(id));
        const closing = [
            ['📝 Evaluación final', 'final'],
            ['🏁 Conclusión', 'concl'],
            ['📚 Referencias', 'refs'],
            ['👥 Créditos y licencia', 'cred']
        ];
        return `${header('Menú principal', 'Estructura del curso: 4 bloques de aprendizaje')}
    <p>Este ODC está estructurado en cuatro grandes bloques, que nos van a llevar desde los fundamentos de la gobernanza de la inteligencia artificial hasta su aplicación dentro de las organizaciones.</p>
    <div class="menu">${MENU_BLOCKS.map(b => {
      const locked = isLocked(b.firstScreen);
      return `<div class="blk ${locked ? 'lk' : ''}"><h3>${locked ? '🔒' : '✅'} ${b.name}</h3>${locked ? '<p class="lkb">Contenido bloqueado</p>' : ''}${
        b.modules.map(([label, target]) => `<button class="mb" data-go="${target}" ${locked ? 'disabled' : ''}>${label}</button>`).join('')}</div>`;
    }).join('')}</div>
    <h3>Cierre del recorrido</h3><div class="chips">${closing.map(([label, target]) => {
      const ok = canGo(screenIndex(target));
      const lockIcon = (target === 'final' || target === 'concl') && !ok ? '🔒 ' : '';
      return `<button class="btn sec" data-go="${target}" ${ok ? '' : 'disabled'}>${lockIcon}${label}</button>`;
    }).join('')}</div>
    </p>`;
    }
});

/* ---------- BLOQUE I · Fundamentos (block 1) ---------- */
addScreen({
    id: 'b1',
    block: 1,
    module: 'Bloque I',
    title: 'Bloque I: Fundamentos',
    narration: 'En el primer bloque, Fundamentos, comenzaremos desde lo esencial. Aquí entenderemos que es la gobernanza de IA, sus principales principios éticos y como podemos identificar y gestionar los riesgos asociados al uso de estas tecnologías.​',
    render: () => `${header('Bloque I', 'Fundamentos')}${cards([
    ['M1 · Arquitecturas integradas', 'Qué es la gobernanza de IA, cómo combinar marcos y por qué adaptarla.'],
    ['M2 · Principios éticos', 'Cinco dimensiones de una IA responsable.'],
    ['M3 · Gestión de riesgos', 'Una lógica continua para prevenir y responder.']])}
  <div class="box">🔓 Al terminar este bloque realizarás la <b>Actividad 1</b>, que desbloquea el Bloque II.</div>`
});

addScreen({
    id: 'm1a',
    block: 1,
    module: 'Módulo 1',
    title: 'Gobernanza de IA: conceptos',
    narration: 'Según (Calzada y Eizaguirre, 2026)A La gobernanza de inteligencia artificial (IA), no tenemos que limitarla al cumplimiento de requisitos y controles éticos, sino que la articulemos en las organizaciones para tomar decisiones razonables, responsables y que responder la necesidad del cliente objetivo Dá click en el botón de gobernanza de inteligencia artificial para conocer más.',
    render: () => `${header('Módulo 1', 'Gobernanza de inteligencia artificial')}
   <div class="grid">
   ${pop('La gobernanza de IA se entiende como la capacidad de una organización para orientar, controlar y supervisar el uso de la inteligencia artificial, aprovechando sus beneficios sin perder de vista los riesgos, la seguridad, la ética, la transparencia y la responsabilidad.','<b>Gobernanza de inteligencia artificial</b><span>¿Qué es? · +info</span>', 'Gobernanza de IA: ¿qué es?', `<p>Según <b>Casamassa, Wang y Masialeti (2025)</b>, la gobernanza de IA es una <b>capacidad para orientar, controlar y supervisar el uso de la inteligencia artificial</b> en las organizaciones, buscando aprovechar sus beneficios sin descuidar los riesgos, la seguridad, la ética, la transparencia y la responsabilidad.</p><p>Casamassa, Wang y Masialeti también aportan que la gobernanza de IA debe responder a una realidad importante: la IA genera oportunidades, pero también nuevos riesgos, especialmente de ciberseguridad. Por eso, proponen incluir mecanismos de gobernanza existentes en lugar de crear estructuras completamente nuevas.</p><p><b>Involucra:</b> tecnología, gestión, controles, auditoría, toma de decisiones y objetivos organizacionales.</p>`, 'cardbtn', 'g')}
   ${pop('Arquitecturas integradas: ¿por qué integrar varios marcos? . Un solo marco difícilmente cubre todas las necesidades de gobernanza de la IA. Por eso, los autores proponen combinar diferentes marcos, aprovechando lo que cada uno aporta.','<b>Arquitecturas integradas de gobernanza</b><span>Concepto · +info</span>', 'Arquitecturas integradas de gobernanza', `<p>Uno de los principales aportes de <b>Casamassa et al. (2025)</b> es la integración de diferentes marcos de gobernanza. Los autores consideran que, mientras la IA generativa continúa evolucionando, las organizaciones pueden aprovechar las estructuras de gobernanza que ya conocen y complementarlas con herramientas específicas para gestionar los riesgos de esta tecnología.</p><p><b>La propuesta integra tres marcos:</b></p><p><b>1. COBIT 2019.</b> Proporciona una visión general para gobernar y gestionar la tecnología de la información, alineándola con los objetivos organizacionales y facilitando su integración en la gestión de la IA.</p><p><b>2. NIST CSF 2.0.</b> Ofrece un marco de ciberseguridad para ayudar a las organizaciones a gestionar y reducir los riesgos relacionados con la seguridad de sus sistemas y datos. Sus funciones son: gobernar, identificar, proteger, detectar, responder y recuperar.</p><p><b>3. NIST AI RMF y el perfil para IA generativa.</b> Proporcionan orientaciones para identificar, evaluar y gestionar los riesgos asociados con la inteligencia artificial, incluidos los relacionados con la generación de información falsa o engañosa. Estos recursos contribuyen a promover un uso más responsable, seguro y confiable de la IA.</p>`, 'cardbtn', 'g')}
   ${pop('La idea clave es que no tenemos que empezar desde cero, sino que podemos integrar marcos existentes y adaptarlos a las necesidades de la IA.”(Casamassa et al., 2025). ','<b>Gobernanza adaptativa</b><span>Concepto · +info</span>', 'Gobernanza adaptativa', `<p>La gobernanza adaptativa, planteada por <b>Reuel y Undheim (2024)</b>, parte de la necesidad de contar con reglas y mecanismos capaces de adaptarse a la velocidad con la que evoluciona la IA generativa.</p>Aunque, Casamassa et al. (2025) señalan que, para las organizaciones, una transformación completa hacia nuevos modelos de gobernanza también puede generar dificultades. Por esta razón, proponen aprovechar los marcos tradicionales y realizar adaptaciones progresivas para incorporar las necesidades específicas de la IA generativa. Regresar<p></p></div>`, 'cardbtn', 'g')}  </div>`,

});

addScreen({
    id: 'm2',
    block: 1,
    module: 'Módulo 2',
    title: 'Principios éticos',
    narration: 'Conoce estas cinco  dimensiones de IA responsable: beneficencia, no maleficencia, autonomía, justicia y explicabilidad. Estas dimensiones permiten orientar el diseño y uso de sistemas de IA considerando tanto sus beneficios como los posibles riesgos para las personas y la sociedad (Xiong et al., 2026).',
    render: () => {
        const principles = [ // [icono, nombre, significado]
            ['🌱', 'Beneficencia', 'Busca que la IA genere beneficios y contribuya al bienestar.'],
            ['🛡️', 'No maleficencia', 'Se pregunta qué daños podrían producirse y qué podemos hacer para prevenirlos o reducirlos.'],
            ['🧭', 'Autonomía', 'Mantener la capacidad de las personas para participar, decidir y conservar el control sobre decisiones importantes.'],
            ['⚖️', 'Justicia', 'Se relaciona con la equidad y con la necesidad de identificar y evitar posibles discriminaciones o sesgos.'],
            ['🔍', 'Explicabilidad', 'Comprender, en la medida de lo posible, cómo se generan las decisiones o resultados de un sistema de IA.']
        ];
        return `${header('Módulo 2', 'Principios éticos: cinco dimensiones')}
    <p>Se relacionan cinco dimensiones que ayudan a entender qué significa hablar de una inteligencia artificial responsable.</p><p>Como señalan Xiong y sus colaboradores, estas dimensiones pueden incorporarse a la gestión organizacional de la inteligencia artificial y ayudarnos a pasar de los principios éticos a prácticas concretas de gobernanza (Xiong et al., 2026).</p>
    ${popCards(principles, 'Xiong et al. (2026)')}
    `;
    }
});

addScreen({
    id: 'm3',
    block: 1,
    module: 'Módulo 3',
    title: 'Gestión de riesgos',
    narration: 'Identificar los activos y posibles amenazas, proteger nuestros datos y aplicar acciones para la mejora continua Casamassa et al. (2025), propone una lógica que permita prevenir el riesgo de manera continua: Identificar riesgos, proteger activos, detectar problemas, responder a incidentes, recuperar y aplicar medidas correctivas.',
    render: () => `${header('Módulo 3', 'Gestión de riesgos')}
  <p>La gestión de riesgos en inteligencia artificial requiere identificar los activos y las posibles amenazas, establecer medidas de protección, detectar anomalías y otros problemas, responder ante incidentes y aplicar acciones de recuperación y mejora.</p><p>La gestión de riesgos de IA requiere combinar controles técnicos de ciberseguridad con mecanismos de gobernanza y responsabilidad organizacional. Casamassa et al. (2025) plantean una integración de COBIT 2019, NIST CSF 2.0 y NIST AI RMF para identificar, proteger, detectar, responder y recuperar frente a riesgos asociados con la IA generativa. Por su parte, Xiong et al. (2026) destacan la evaluación y mitigación de riesgos como parte de las prácticas de IA responsable, junto con la explicabilidad, la autonomía, la equidad y la participación de diferentes áreas de la organización.</p>
  <h3>Lógica de gestión de riesgos</h3>
  ${flow(['Identificar riesgos', 'Proteger activos', 'Detectar problemas', 'Responder', 'Recuperar y corregir'])}
  <p class="cite">Lógica propuesta por Casamassa et al. (2025).</p>`
});

/* ---- Actividad 1 (desbloquea el Bloque II) ---- */
addScreen({
    id: 'a1a',
    block: 1,
    module: 'Actividad 1',
    title: 'Actividad 1 · Ayuda a Sof-IA',
    requires: () => isDone('a1a'),
    narration: 'Muy bien, apreciado participante, hemos avanzado en la construcción y generación de conocimiento sobre gobernanza IA Juntos somos imparables, Es momento de realizar la actividad 1. ¿Te apuntas?',
    render: () => `${header('Actividad 1 · Parte A', 'Ayuda a Sof-IA con la siguiente misión')}<div id="mc1"></div>`,
    init: r => mcq($('#mc1', r), {
        id: 'a1',
        restore: 'a1a',
        onOk: () => markDone('a1a'),
        q: 'Gobernanza IA ES: (única opción correcta, elige la definición más acertada)',
        opts: [{
                t: 'Una serie de políticas que se rigen en una organización.',
                fb: '. Las políticas hace parte en solo un pequeño pedazo a lo que se refiere la gobernanza de la inteligencia artificial, también es necesario aclarar quienes son responsables, supervisar su uso, identificar riesgos, entre otros. '
            },
            {
                t: 'Una estrategia que permite a la tecnología llegar a cada rincón de Colombia y el mundo.',
                fb: 'este contexto se relaciona más a el acceso a la tecnología y la promoción de la inclusión digital en las empresas.'
            },
            {
                t: 'La capacidad de una organización para orientar, controlar y supervisar el uso de la IA.',
                ok: 1,
                fb: 'Esta respuesta es la acertada ya que comenta los componentes que se reúnen para hacer una gobernanza responsable en las organizaciones'
            }
        ]
    })
});

addScreen({
    id: 'a1b',
    block: 1,
    module: 'Actividad 1',
    title: 'Actividad 1 · Matriz de principios',
    requires: () => isDone('a1b'),
    narration: 'Arrastra la opción correcta al titulo que pertenece. Recuerda que para que este moodle te permita avanzar al Bloque II, Debes realizar la Actividad # 1',
    render: () => `${header('Actividad 1 · Parte B', 'Construye la matriz de principios éticos')}<p>Arrastra la opción correcta a la dimensión que le corresponde. <b>Tabla 1.</b> Actividad de gobernanza de IA (elaboración propia).</p><div id="mt1"></div>
  <div id="a1ret" class="box" ${isDone('a1b') ? '' : 'hidden'}><b>Retroalimentación:</b> la beneficencia busca que la IA aporte cosas positivas y ayude al bienestar; la no maleficencia pretende evitar posibles daños; la autonomía resalta mantener el control y la capacidad de decisión humana; la justicia busca un trato equitativo, sin discriminación; y la explicabilidad permite comprender cómo y por qué la IA llega a ciertos resultados.</div>`,
    init: r => match($('#mt1', r), {
        restore: 'a1b',
        okMsg: 'La matriz está completa. ¡Bloque II desbloqueado!',
        onOk: () => {
            play_now("​Con esta actividad puedes entender mejor la importancia de aplicar principios éticos al usar la inteligencia artificial. La beneficencia busca que la IA aporte cosas positivas y ayude al bienestar de las personas; la no maleficencia pretende evitar posibles daños; la autonomía resalta la importancia de mantener el control y la capacidad de decisión humana; la justicia busca que todos reciban un trato equitativo, sin discriminación; y la explicabilidad permite comprender cómo y por qué la IA llega a ciertos resultados.");
            markDone('a1b');
            $('#a1ret', r).hidden = false;
        },
        rows: [{
                k: 'be',
                t: 'Beneficencia',
                a: 'o5'
            }, {
                k: 'nm',
                t: 'No maleficencia',
                a: 'o3'
            },
            {
                k: 'au',
                t: 'Autonomía',
                a: 'o2'
            }, {
                k: 'ju',
                t: 'Justicia',
                a: 'o4'
            }, {
                k: 'ex',
                t: 'Explicabilidad',
                a: 'o1'
            }
        ],
        opts: [{
                k: 'o1',
                t: 'Hacer comprensibles las decisiones y resultados de la IA'
            },
            {
                k: 'o2',
                t: 'Preservar la capacidad de decisión y control humano'
            },
            {
                k: 'o3',
                t: 'Prevenir o reducir posibles daños'
            },
            {
                k: 'o4',
                t: 'Promover resultados equitativos y evitar discriminaciones'
            },
            {
                k: 'o5',
                t: 'Generar beneficios y contribuir al bienestar'
            }
        ]
    })
});

/* ---------- BLOQUE II · Salvaguardas técnicas (block 2) ---------- */
addScreen({
    id: 'b2',
    block: 2,
    module: 'Bloque II',
    title: 'Bloque II: Salvaguardas técnicas',
    narration: 'En este bloque hablaremos de temas muy importantes como la transparencia, la supervisión humana y la rendición de cuentas. La idea es que debemos contar con mecanismos que permitan supervisar la inteligencia artificial y responder cuando se presenten problemas.',
    render: () => `${header('Bloque II', 'Salvaguardas técnicas')}${cards([
    ['M4 · Transparencia & LoBOX', 'Opacidad y cómo gestionarla éticamente.'],
    ['M5 · Supervisión humana', 'Control, supervisión y formas HITL / HOTL.'],
    ['M6 · Accountability & brechas', 'De la transparencia a la rendición de cuentas.']])}
  <div class="box">🔓 Completa la <b>Actividad 2 «Detective de la IA Responsable»</b> para desbloquear el Bloque III.</div>`
});

addScreen({
    id: 'm4a',
    block: 2,
    module: 'Módulo 4',
    title: 'La opacidad',
    narration: 'según (Herrera & Calderón, 2026). La transparencia es un elemento importante de la inteligencia artificial responsable, pero no siempre es posible alcanzar una comprensión completa del funcionamiento interno de sistemas complejos de IA.​ Por tanto, LoBOX propone pasar de una búsqueda de transparencia absoluta hacia una transparencia y explicabilidad contextualizadas, acompañadas de mecanismos de auditoría, supervisión, accountability y contestabilidad.​',
    render: () => `${header('Módulo 4', 'Transparencia y LoBOX​  "Lack of Belief: Opacity & eXplainability" (Falta de creencia: Opacidad y Explicabilidad)')}
    <div style="font-family: Arial, sans-serif; line-height: 1.7; color: #243247; max-width: 900px; margin: auto">
    <!-- Definición de opacidad -->
    <div
        style="
            background: #f1f5f9;
            border-left: 5px solid #4776a8;
            padding: 18px 22px;
            border-radius: 8px;
            margin-bottom: 18px;
        "
    >
        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px">
            <span style="font-size: 24px">🔍</span>
            <strong style="font-size: 19px; color: #31577c">La opacidad</strong>
        </div>
        <p style="margin: 0">
            Esta se refiere a la dificultad que resulta comprender porque y como se llego a la toma de una determinación
            o decisión de una inteligencia artificial. <em>(Herrera &amp; Calderón, 2026).</em>
        </p>
    </div>

    <!-- Explicación complementaria -->
    <div
        style="background: #ffffff; border: 1px solid #dbe4ee; border-radius: 10px; padding: 20px; margin-bottom: 24px"
    >
        <p style="margin: 0">
            En otras palabras, ocurre opacidad cuando observamos el producto que entrega la inteligencia pero no es
            posible determinar acerca de qué ocurrió detrás de ese resultado. . <em>(Herrera &amp; Calderón, 2026).</em>
        </p>
    </div>

    <!-- Tipos de opacidad -->
    <div style="margin-bottom: 14px">
        <h3
            style="
                font-size: 20px;
                color: #31577c;
                margin-bottom: 14px;
                border-bottom: 2px solid #dbe4ee;
                padding-bottom: 8px;
            "
        >
            📚 Tipos de opacidad.
        </h3>
    </div>

    <div style="display: flex; flex-direction: column; gap: 14px">
        <!-- Opacidad accidental -->
        <div style="background: #edf5ff; border: 1px solid #d3e5f8; border-radius: 10px; padding: 18px">
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px">
                <span style="font-size: 22px">🛠️</span>
                <strong style="font-size: 17px; color: #31577c">Opacidad accidental:</strong>
            </div>
            <p style="margin: 0">
                Surge por condiciones que <strong>podrían evitarse o corregirse.</strong> .
                <em>(Herrera &amp; Calderón, 2026).</em>
            </p>
        </div>

        <!-- Opacidad per se -->
        <div style="background: #f5f0ff; border: 1px solid #e2d8f5; border-radius: 10px; padding: 18px">
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px">
                <span style="font-size: 22px">🧠</span>
                <strong style="font-size: 17px; color: #634b91">Opacidad per se:</strong>
            </div>
            <p style="margin: 0">
                Es una opacidad <strong>inherente a la complejidad del modelo</strong>. El funcionamiento puede ser
                formalmente accesible, pero difícil de comprender incluso para expertos.
                <em>(Herrera &amp; Calderón, 2026).</em>
            </p>
        </div>
    </div>
</div>
    
    `
});

addScreen({
    id: 'm4b',
    block: 2,
    module: 'Módulo 4',
    title: 'El marco LoBOX',
    narration: 'Siempre es posible hacer que un sistema sea completamente transparente, por lo que el enfoque consiste en reducir aquello que sí podemos corregir, gestionar aquello que es difícil de eliminar y establecer mecanismos institucionales que permitan supervisar y cuestionar las decisiones. Además, la explicación debe adaptarse a quién la necesita y para qué la necesita.” (Herrera & Calderón, 2026).​',
    render: () => `${header('Módulo 4', 'LoBOX: Lack of Belief, Opacity & eXplainability')}
 <div style="font-family: Arial, sans-serif; line-height: 1.7; color: #243247; max-width: 900px; margin: auto;">

  <!-- Contexto sobre la opacidad -->
  <div style="background: #f1f5f9; border-left: 5px solid #4776a8; padding: 18px 22px; border-radius: 8px; margin-bottom: 20px;">
    <p style="margin: 0; font-size: 17px;">
      <strong>Herrera y Calderón (2026) señalan que la opacidad puede surgir tanto de condiciones evitables, como una documentación deficiente o una comunicación poco clara, como de la complejidad inherente de determinados modelos.</strong>
    </p>
  </div>

  <!-- Propuesta de gobernanza -->
  <div style="background: #ffffff; border: 1px solid #dbe4ee; border-radius: 10px; padding: 20px; margin-bottom: 20px;">
    <p style="margin-top: 0;">
      <strong>Ante esta situación, los autores proponen LoBOX (Lack of Belief: Opacity &amp; eXplainability), un marco de gobernanza que busca gestionar éticamente la opacidad en lugar de asumir que toda opacidad debe eliminarse.</strong>
    </p>

    <p style="margin-bottom: 0;">
      <strong>El modelo plantea tres etapas:</strong>
    </p>
  </div>

  <!-- Etapas del modelo LoBOX -->
  <div style="display: flex; flex-direction: column; gap: 12px; margin-bottom: 24px;">

    <div style="display: flex; align-items: flex-start; gap: 14px; background: #edf5ff; border-radius: 8px; padding: 16px;">
      <div style="background: #4776a8; color: white; min-width: 34px; height: 34px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold;">
        1
      </div>
      <div style="padding-top: 5px;">
        <strong>Reducir la opacidad accidental</strong>
      </div>
    </div>

    <div style="display: flex; align-items: flex-start; gap: 14px; background: #edf5ff; border-radius: 8px; padding: 16px;">
      <div style="background: #4776a8; color: white; min-width: 34px; height: 34px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold;">
        2
      </div>
      <div style="padding-top: 5px;">
        <strong>Gestionar la opacidad irreducible  o per se.</strong>
      </div>
    </div>

    <div style="display: flex; align-items: flex-start; gap: 14px; background: #edf5ff; border-radius: 8px; padding: 16px;">
      <div style="background: #4776a8; color: white; min-width: 34px; height: 34px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold;">
        3
      </div>
      <div style="padding-top: 5px;">
        <strong>Delegar la confianza mediante mecanismos de supervisión institucional.</strong>
      </div>
    </div>

  </div>

  <!-- Aplicación de la explicabilidad -->
  <div style="background: #f8fafc; border: 1px solid #dbe4ee; border-radius: 10px; padding: 20px;">
    <p style="margin: 0;">
      <strong>Desde esta perspectiva, la explicabilidad debe adaptarse al rol, las necesidades y el nivel de responsabilidad de cada actor. Un desarrollador puede necesitar información técnica detallada, mientras que una persona afectada por una decisión automatizada puede necesitar una explicación más contextual que le permita comprender y, cuando corresponda, cuestionar la decisión.</strong>
    </p>
  </div>

</div>`
});

addScreen({
    id: 'm5a',
    block: 2,
    module: 'Módulo 5',
    title: 'Control vs. supervisión',
    narration: 'En este modulo serás capaz de distinguir entre control humano y la supervisión humana. ​Mussie, K. M. (2026)Postula que la supervisión humana no es solo un requisito formal sino una herramienta capaz de interpretar, cuestionar, validar o anular los resultados algorítmicos generados por los sistemas de inteligencia artificial. ​ ¡VAMOS!​',
    render: () => `${header('Módulo 5', 'Supervisión humana')}
    
    <div style="font-family: Arial, sans-serif; line-height: 1.8; color: #243247; max-width: 900px; margin: auto;">

  <div style="background: #f1f5f9; border-left: 5px solid #4776a8; border-radius: 8px; padding: 22px 24px; margin-bottom: 20px;">

    <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 14px;">
      <div style="background: #dceafb; border-radius: 8px; padding: 9px; font-size: 23px;">
        👥
      </div>
      <h3 style="margin: 0; font-size: 20px; color: #31577c;">
        Supervisión humana en la inteligencia artificial
      </h3>
    </div>

    <p style="margin: 0; text-align: justify;">
      a supervisión humana en la inteligencia artificial, se expone como la manera en que las personas “humanos” mantienen el control y funcionamiento de los sistemas IA, especialmente cuando estos sistemas deben generar toma de decisiones que pudiera generar un impacto o consecuencias importantes.
    </p>

    <p style="margin: 16px 0 0; text-align: justify;">
      Desde la perspectiva cibernética, controlar y supervisar no son lo mismo. El control actúa directamente sobre el comportamiento del sistema, mientras que la supervisión revisa si ese mecanismo de control está funcionando adecuadamente.
    </p>

    <div style="background: #ffffff; border-left: 3px solid #7c9bb8; padding: 12px 16px; margin-top: 18px; border-radius: 4px;">
      <p style="margin: 0; text-align: justify;">
        Por eso, el autor entiende la supervisión como un <strong>“control del control”, o meta-control</strong> (Salgado-Criado, 2025).
      </p>
    </div>

  </div>

  <div style="display: flex; align-items: center; gap: 12px; background: #ffffff; border: 1px solid #dbe4ee; border-radius: 8px; padding: 16px 20px;">
    <span style="font-size: 22px;">📚</span>
    <p style="margin: 0;">
      <strong>De Luna (2025).</strong>
    </p>
  </div>

</div>
    <p>${pop('', '🎬 Recurso de apoyo', 'Video recomendado', '<p>De Luna, C. (2025). <i>La supervisión humana en el uso de la IA</i> [Video]. YouTube.</p><p><a href="https://www.youtube.com/watch?v=5yjmQs06PeA" target="_blank" rel="noopener">Ver video en YouTube</a> (incluye subtítulos).</p>', 'btn sec')}</p>
  <p class="cite">Mussie (2026) postula que la supervisión humana no es solo un requisito formal, sino una herramienta capaz de interpretar, cuestionar, validar o anular los resultados algorítmicos.</p>`
});

addScreen({
    id: 'm5b',
    block: 2,
    module: 'Módulo 5',
    title: 'HITL y HOTL',
    narration: ' (Di Chiacchio et al., 2026) Es otro autor que resalta que la IA es una herramienta que nos ayuda a realizar tareas con un soporte operativo rápido, pero no es un sustituto de la decision humana.​',
    render: () => `${header('Módulo 5', 'Formas de participación humana')}
  
  <div style="font-family: Arial, sans-serif; line-height: 1.8; color: #243247; max-width: 900px; margin: auto;">

  <div style="background: #f1f5f9; border-left: 5px solid #4776a8; border-radius: 8px; padding: 22px 24px; margin-bottom: 20px;">

    <p style="margin: 0 0 18px; font-size: 17px;">
      Por lo anterior se analizan <strong>dos formas de participación humana:</strong>
    </p>

    <div style="display: flex; gap: 14px; align-items: flex-start; background: #ffffff; border: 1px solid #dbe4ee; border-radius: 8px; padding: 16px; margin-bottom: 12px;">

      <div style="background: #dceafb; color: #31577c; min-width: 38px; height: 38px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 19px;">
        👤
      </div>

      <div>
        <div style="color: #31577c; margin-bottom: 5px;">
          <strong>Human-in-the-Loop (HITL)</strong>
        </div>
        <p style="margin: 0; text-align: justify;">
          la persona <strong>participa directamente</strong> dentro del proceso de decisión o control.
        </p>
      </div>

    </div>

    <div style="display: flex; gap: 14px; align-items: flex-start; background: #ffffff; border: 1px solid #dbe4ee; border-radius: 8px; padding: 16px;">

      <div style="background: #e2eee8; color: #356b55; min-width: 38px; height: 38px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 19px;">
        👁
      </div>

      <div>
        <div style="color: #356b55; margin-bottom: 5px;">
          <strong>Human-over-the-Loop (HOTL)</strong>
        </div>
        <p style="margin: 0; text-align: justify;">
          la persona <strong>supervisa el funcionamiento general del sistema</strong> y conserva la autoridad para <strong>modificar o retirar el control</strong> cuando sea necesario.
        </p>
      </div>

    </div>

  </div>

  <div style="background: #ffffff; border: 1px solid #dbe4ee; border-radius: 8px; padding: 20px 22px;">

    <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 12px;">
      <span style="font-size: 23px;">📋</span>
      <strong style="font-size: 17px; color: #31577c;">Dimensiones de la supervisión efectiva</strong>
    </div>

    <p style="margin: 0; text-align: justify;">
      Además, la <strong>supervisión efectiva</strong> depende de cinco dimensiones: <strong>la importancia de las decisiones, la perspectiva desde la que se supervisa, las condiciones del sistema, las competencias del supervisor y la cultura organizacional y de rendición de cuentas.</strong> (Salgado-Criado, 2025).
    </p>

  </div>

</div>
    `
});

addScreen({
    id: 'm6a',
    block: 2,
    module: 'Módulo 6',
    title: 'De la transparencia a la rendición de cuentas',
    narration: 'Llegamos al modulo 6 Aclararemos la rendición de cuentas y brechas identificadas. Las organizaciones son responsables de sus decisiones, explicar sus actuaciones y asumir las consecuencias cuando generan resultados inadecuados o discriminatorios. (Alon-Barkat, Busuioc et al., 2025).  Ahora te voy a explicar el concepto de rendición de cuentas (accountability), aplicado a sistemas de inteligencia artificial (IA), así como las principales brechas que pueden impedir que la transparencia se traduzca en responsabilidad efectiva. Ah! Por cierto, esta informacion esta basada como fuente central el artículo de Urrutia-Onate et al. (2026), que propone una tipología conceptual para diagnosticar tensiones entre los niveles de gobernanza y las condiciones de accountability. Como lo explican los autores Urrutia-Onate et al. (2026), La TRANSPARENCIA. Es aquella Información y registros sobre el sistema y sus decisiones. La RESPONSABILIDAD Es poder tener clara la Identificación de quién debe responder, supervisar o intervenir. En cuanto a la EVIDENCIA VERIFICABLE  los autores Urrutia-Onate et al. (2026),  sugieren que es importante contar con un soporte técnico y documental para examinar y justificar la decisión. Y finalmente para la IMPUGNACIÓN, REVISIÓN Y CORRECCIÓN los auntores Urrutia-Onate et al. (2026), plantean la posibilidad de cuestionar la decisión, solicitar su revisión y obtener una solución cuando corresponda.',
    render: () => `${header('Módulo 6', '¿Cuándo la transparencia se convierte en rendición de cuentas?')}
  
    <div style="font-family: Arial, sans-serif; line-height: 1.7; color: #243247; max-width: 900px; margin: auto;">

  <!-- Componentes de la rendición de cuentas -->
  <div style="display: flex; flex-direction: column; gap: 14px;">

    <!-- Transparencia -->
    
    <div style="display: flex; align-items: flex-start; gap: 15px; background: #ffffff; border: 1px solid #dbe4ee; border-radius: 8px; padding: 18px;">
      <div style="background: #e4eef9; color: #31577c; min-width: 42px; height: 42px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 21px;">
        <span>📄</span>
      </div>
      <div>
        <h4 style="margin: 0 0 6px; color: #31577c; font-size: 16px;">TRANSPARENCIA</h4>
        <p style="margin: 0; text-align: justify;">
          Información y registros sobre el sistema y sus decisiones.
        </p>
      </div>
    </div>

    <!-- Responsabilidad -->
    <div style="display: flex; align-items: flex-start; gap: 15px; background: #ffffff; border: 1px solid #dbe4ee; border-radius: 8px; padding: 18px;">
      <div style="background: #e2eee8; color: #356b55; min-width: 42px; height: 42px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 21px;">
        <span>👥</span>
      </div>
      <div>
        <h4 style="margin: 0 0 6px; color: #356b55; font-size: 16px;">RESPONSABILIDAD</h4>
        <p style="margin: 0; text-align: justify;">
          Identificación de quién debe responder, supervisar o intervenir.
        </p>
      </div>
    </div>

    <!-- Evidencia verificable -->
    <div style="display: flex; align-items: flex-start; gap: 15px; background: #ffffff; border: 1px solid #dbe4ee; border-radius: 8px; padding: 18px;">
      <div style="background: #f7edda; color: #87672d; min-width: 42px; height: 42px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 21px;">
        <span>🔎</span>
      </div>
      <div>
        <h4 style="margin: 0 0 6px; color: #87672d; font-size: 16px;">EVIDENCIA VERIFICABLE</h4>
        <p style="margin: 0; text-align: justify;">
          Soporte técnico y documental para examinar y justificar la decisión.
        </p>
      </div>
    </div>

    <!-- Impugnación, revisión y corrección -->
    <div style="display: flex; align-items: flex-start; gap: 15px; background: #ffffff; border: 1px solid #dbe4ee; border-radius: 8px; padding: 18px;">
      <div style="background: #eee7f8; color: #694a91; min-width: 42px; height: 42px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 21px;">
        <span>⚖️</span>
      </div>
      <div>
        <h4 style="margin: 0 0 6px; color: #694a91; font-size: 16px;">IMPUGNACIÓN, REVISIÓN Y CORRECCIÓN</h4>
        <p style="margin: 0; text-align: justify;">
          Posibilidad de cuestionar la decisión, solicitar su revisión y obtener una solución cuando corresponda.
        </p>
      </div>
    </div>

  </div>

  <!-- Pie de figura -->
  <div style="border-top: 1px solid #dbe4ee; margin-top: 24px; padding: 16px 4px 0; color: #526174; font-size: 14px;">
    <p style="margin: 0;">
      Urrutia-Onate et al. (2026),
    </p>
  </div>

</div>`
});


addScreen({
    id: 'm6b',
    block: 2,
    module: 'Módulo 6',
    title: 'Contestabilidad y brechas',

    narration: 'Selecciona el tab, para conocer el concepto relacionado.',

    render: () => `
        ${header(
            'Módulo 6',
            'Rendición de cuentas, brechas y tensiones'
        )}

        ${tabs([
            {
                n: 'El estudio de Xia et al. (2026) indica que la IA es como una caja negra, pues es difícil comprender cómo y bajo qué conceptos se producen los resultados generados. A esta situación se le conoce como opacidad.',
                t: 'Transparencia',
                h: `
                    <p style="line-height: 1.8; color: #344256;">
                        La <strong style="color: #245b87;">transparencia</strong>
                        consiste en poner a disposición información sobre el sistema,
                        sus resultados o sus criterios. La
                        <strong style="color: #245b87;">rendición de cuentas</strong>
                        va más allá: exige que se pueda identificar quién responde
                        por la decisión, con qué evidencia se justifica, quién puede
                        revisarla y qué mecanismo existe para cuestionarla o corregirla
                        cuando sea necesario. Por eso,
                        <strong style="color: #245b87;">
                            publicar información o entregar una explicación técnica
                            no garantiza, por sí solo, que exista accountability sustantiva
                        </strong>
                        (Urrutia-Onate et al., 2026).
                    </p>
                `
            },

            {
                n: 'Significa que las decisiones tomadas con apoyo de sistemas de IA deben poder explicarse y justificarse de manera clara. Además, debe existir claridad sobre quién responde por esas decisiones y qué acciones pueden tomarse si se identifica algún error o afectación.',
                t: 'Rendición de cuentas',
                h: `
                    <p>
                        En IA (<i>accountability</i>) significa que las decisiones
                        apoyadas por sistemas de IA deben poder
                        <b>explicarse y justificarse</b> con claridad, con claridad
                        sobre <b>quién responde</b> y <b>qué acciones</b> pueden
                        tomarse ante un error. Más que informar un resultado:
                        garantizar que las decisiones puedan ser
                        <b>revisadas, cuestionadas y corregidas</b>
                        (Urrutia-Onate et al., 2026).
                    </p>

                    <p>
                        La transparencia pone información a disposición; la rendición
                        de cuentas exige además responsable, evidencia, revisión y
                        mecanismo de corrección.
                    </p>
                `
            },

            {
                n: 'Formal, Distribuido, Contestable. Estas tres condiciones se complementan.',
                t: 'Contestabilidad',
                h: `
                    <table>
                        <caption>
                            Tabla 2. Principio de contestabilidad. Elaboración propia
                            con apoyo de IA, basada en Urrutia-Onate et al. (2026).
                        </caption>

                        <thead>
                            <tr>
                                <th>Componente</th>
                                <th>¿Qué implica?</th>
                                <th>Pregunta orientadora</th>
                            </tr>
                        </thead>

                        <tbody>
                            <tr>
                                <td><b>Formal</b></td>
                                <td>
                                    Documentar y divulgar la base de la decisión y
                                    conservar registros que permitan evaluar su conformidad.
                                </td>
                                <td>¿Existe evidencia documentada y verificable?</td>
                            </tr>

                            <tr>
                                <td><b>Distribuido</b></td>
                                <td>
                                    Asignar responsabilidades en cargos, funciones,
                                    flujos de trabajo y rutinas de revisión.
                                </td>
                                <td>¿Quién debe actuar, revisar o detener el proceso?</td>
                            </tr>

                            <tr>
                                <td><b>Contestable</b></td>
                                <td>
                                    Permitir que una persona identifique, examine y
                                    cuestione la decisión, y acceda a revisión o recurso.
                                </td>
                                <td>¿Cómo se puede apelar o corregir una decisión?</td>
                            </tr>
                        </tbody>
                    </table>
                `
            },

            {
                n: 'Revisemos juntos los niveles de gobernanza en donde suelen aparecer las brechas identificadas por los autores.',
                t: 'Brechas en la gobernanza',
                h: `
                    <p>
                        Niveles de gobernanza en los que puede aparecer una brecha:
                    </p>

                    <table>
                        <caption>
                            Tabla 3. Brechas de gobernanza. Elaboración propia con
                            apoyo de IA, basada en Urrutia-Onate et al. (2026).
                        </caption>

                        <thead>
                            <tr>
                                <th>Nivel</th>
                                <th>Descripción</th>
                                <th>Ejemplos</th>
                                <th>Riesgo si funciona aislado</th>
                            </tr>
                        </thead>

                        <tbody>
                            <tr>
                                <td>L1 Regulatorio</td>
                                <td>Obligaciones vinculantes de autoridades externas.</td>
                                <td>Normas, divulgación, protección de datos.</td>
                                <td>
                                    Cumplir con documentación sin aclarar cómo se
                                    cuestiona una decisión.
                                </td>
                            </tr>

                            <tr>
                                <td>L2 Organizacional</td>
                                <td>
                                    Mecanismos internos que convierten obligaciones
                                    en prácticas.
                                </td>
                                <td>Políticas, comités de ética, roles.</td>
                                <td>
                                    Principios declarados sin responsables ni pasos operativos.
                                </td>
                            </tr>

                            <tr>
                                <td>L3 Técnico</td>
                                <td>
                                    Artefactos y métodos para documentar o inspeccionar.
                                </td>
                                <td>Documentación del modelo, auditoría, XAI.</td>
                                <td>
                                    Explicación técnica que no conduce a revisión ni solución.
                                </td>
                            </tr>

                            <tr>
                                <td>L4 Integración</td>
                                <td>Coordinación entre niveles.</td>
                                <td>
                                    Conexión entre requisitos, responsables, registros
                                    y reclamación.
                                </td>
                                <td>
                                    Responsabilidad fragmentada entre actores.
                                </td>
                            </tr>
                        </tbody>
                    </table>
                `
            },

            {
                n: 'La tipología permite entender cómo cada mecanismo de gobernanza actúa en diferentes niveles de la organización y de qué manera contribuye a garantizar la rendición de cuentas.',
                t: 'Tipología de cuatro tensiones o brechas de accountability',
                h: `
                    <p>
                        Cada una refleja situaciones particulares en las que varían
                        aspectos como:
                    </p>

                    <table>
                        <caption>
                            Tabla 4. Tipología de tensiones. Elaboración propia,
                            basada en Urrutia-Onate et al. (2026). Los ejemplos son
                            pedagógicos y no son casos empíricos de los autores.
                        </caption>

                        <thead>
                            <tr>
                                <th>Brecha</th>
                                <th>¿En qué consiste?</th>
                                <th>Ejemplo práctico</th>
                            </tr>
                        </thead>

                        <tbody>
                            <tr>
                                <td>
                                    <b>T1</b> Transparencia como accountability formal
                                </td>
                                <td>
                                    Se divulga información, pero falta responsabilidad
                                    clara o vía para cuestionar.
                                </td>
                                <td>Informe público, pero nadie sabe a quién reclamar.</td>
                            </tr>

                            <tr>
                                <td>
                                    <b>T2</b> Accountability distribuida aspiracional
                                </td>
                                <td>
                                    Compromisos éticos que no se traducen en roles,
                                    flujos y rutinas.
                                </td>
                                <td>
                                    Política de supervisión humana sin quién revisa
                                    ni quién detiene.
                                </td>
                            </tr>

                            <tr>
                                <td>
                                    <b>T3</b> Inteligibilidad sin contestabilidad completa
                                </td>
                                <td>
                                    Hay explicación, pero no apelación, revisión o reparación.
                                </td>
                                <td>
                                    Se explica el rechazo de un crédito, pero no hay
                                    canal para cuestionarlo.
                                </td>
                            </tr>

                            <tr>
                                <td>
                                    <b>T4</b> Brecha de integración del sistema
                                </td>
                                <td>
                                    Requisitos, responsabilidades y evidencias desconectados.
                                </td>
                                <td>
                                    Proveedor, entidad y norma existen, pero nadie
                                    integra el procedimiento.
                                </td>
                            </tr>
                        </tbody>
                    </table>
                `
            }
        ])}
    `
});


addScreen({
    id: 'a2c1',
    block: 2,
    module: 'Actividad 2',
    title: 'Actividad 2 · Caso 1',

    requires: () => isDone('a2c1'),

    narration: 'Atención detective. Lee cada situación y marca la respuesta correcta. Caso uno: la entidad utiliza una IA para aprobar solicitudes de subsidio. El sistema entrega el resultado, pero nadie puede explicar claramente cómo llegó a esa conclusión debido a la complejidad del modelo. ¿Qué concepto representa mejor esta situación?',

    render: () => `
        ${header(
            'Actividad 2 · Detective de la IA Responsable',
            'Caso 1'
        )}

        <div class="box">
            <b>Atención, detective.</b>
            Lee cada situación y marca la respuesta correcta.
        </div>

        <div id="c1"></div>
    `,

    init: r => mcq($('#c1', r), {
        id: 'c1',
        restore: 'a2c1',

        onOk: () => markDone('a2c1'),

        q: 'La entidad utiliza una IA para aprobar solicitudes de subsidio. El sistema entrega el resultado, pero nadie puede explicar claramente cómo llegó a esa conclusión debido a la complejidad del modelo. ¿Qué concepto representa mejor esta situación?',

        opts: [
            {
                t: 'Opacidad per se',
                ok: 1,
                fb: 'La dificultad de explicar proviene de una complejidad propia del modelo de IA.'
            },
            {
                t: 'Opacidad accidental',
                fb: 'La falta de explicación no se debe a restricciones de acceso a la información ni a datos ocultos.'
            },
            {
                t: 'Human-in-the-Loop',
                fb: 'El caso no menciona supervisión humana.'
            },
            {
                t: 'Transparencia',
                fb: 'Implicaría que se pudieran explicar claramente las decisiones, lo que no ocurre en este caso.'
            }
        ]
    })
});


addScreen({
    id: 'a2c2',
    block: 2,
    module: 'Actividad 2',
    title: 'Actividad 2 · Caso 2',
    requires: () => isDone('a2c2'),
    narration: 'Caso dos. Una organización publica un informe detallado sobre su sistema de IA. Sin embargo, los ciudadanos no saben quién es responsable ni ante quién presentar una reclamación. ¿Qué brecha de accountability está presente?',
    render: () => `${header('Actividad 2 · Detective de la IA Responsable', 'Caso 2')}<div id="c2"></div>`,
    init: r => mcq($('#c2', r), {
        id: 'c2',
        restore: 'a2c2',
        onOk: () => markDone('a2c2'),
        q: 'Una organización publica un informe detallado sobre su sistema de IA. Sin embargo, los ciudadanos no saben quién es responsable ni ante quién presentar una reclamación. ¿Qué brecha de accountability está presente?',
        opts: [{
                t: 'Brecha de integración',
                fb: 'El problema no recae en la coordinación entre áreas y actores.'
            },
            {
                t: 'Transparencia como accountability formal',
                ok: 1,
                fb: 'Existe cierta información, pero no se tiene claridad sobre las responsabilidades: no es una rendición de cuentas efectiva.'
            },
            {
                t: 'Inteligibilidad sin contestabilidad',
                fb: 'El caso se enfoca en la falta de identificación de responsables, no en que no haya oportunidad de apelar una decisión.'
            },
            {
                t: 'Accountability distribuida aspiracional',
                fb: 'No se menciona en el caso un compromiso ético que no logre traducirse en roles y rutinas.'
            }
        ]
    })
});

addScreen({
    id: 'a2c3',
    block: 2,
    module: 'Actividad 2',
    title: 'Actividad 2 · Caso 3',
    requires: () => isDone('a2c3'),
    narration: 'Caso tres. Relaciona cada concepto con su definición: Human in the Loop y Human over the Loop. Arrastra cada definición a su concepto.',
    render: () => `${header('Actividad 2 · Detective de la IA Responsable', 'Caso 3: relaciona cada concepto con su definición')}<div id="c3"></div>`,
    init: r => match($('#c3', r), {
        restore: 'a2c3',
        onOk: () => markDone('a2c3'),
        okMsg: 'HITL participa directamente en la decisión; HOTL supervisa el sistema y puede intervenir.',
        rows: [{
            k: 'h1',
            t: 'Human-in-the-Loop',
            a: 'd2'
        }, {
            k: 'h2',
            t: 'Human-over-the-Loop',
            a: 'd1'
        }],
        opts: [{
            k: 'd1',
            t: 'Supervisa el sistema y puede intervenir'
        }, {
            k: 'd2',
            t: 'Participa directamente en la decisión'
        }]
    })
});

addScreen({
    id: 'a2c4',
    block: 2,
    module: 'Actividad 2',
    title: 'Actividad 2 · Caso 4',
    requires: () => isDone('a2c4'),
    narration: 'Caso 4. Para que exista accountability completa no basta con tener transparencia. Organiza correctamente los elementos:',
    render: () => `${header('Actividad 2 · Detective de la IA Responsable', 'Caso 4: organiza los elementos')}<p>Para que exista <i>accountability</i> completa no basta con tener transparencia. Ordena los elementos de principio a fin.</p><div id="c4"></div>`,
    init: r => order($('#c4', r), {
        restore: 'a2c4',
        seed: 9,
        onOk: () => {
            markDone('a2c4');
            play_now('Recuerda la explicación del modulo 6 y la organización para una rendición de cuentas; Estos son los pasos lógicos.') // Función que se ejecuta al finalizar

        },
        items: ['Transparencia', 'Responsabilidad', 'Evidencia verificable', 'Impugnación y corrección'],
        okMsg: 'Transparencia → Responsabilidad → Evidencia verificable → Impugnación y corrección. ¡Bloque III desbloqueado!'
    })
});


/* ---------- BLOQUE III · Ciclo de datos y barreras (block 3) ---------- */
addScreen({
    id: 'b3',
    block: 3,
    module: 'Bloque III',
    title: 'Bloque III: Ciclo de datos y barreras',
    narration: 'En el tercer bloque, Ciclo de datos y barreras, los datos y las personas. Veremos cómo podemos hacer una gobernanza adecuada de los datos, las barreras, capacidades y conocimientos necesitan las personas dentro de una organización.',
    render: () => `${header('Bloque III', 'Ciclo de datos y barreras')}${cards([
    ['M7 · Gobernanza de datos (FAHP)', 'Ciclo de vida de los datos y factores prioritarios.'],
    ['M8 · Solucionismo & barreras', 'Trampas de adopción y barreras de implementación.'],
    ['M9 · Capacidades & AI Literacy', 'Conocimiento, juicio humano y cultura de aprendizaje.']])}
  <div class="box">🔓 Completa la <b>Actividad 3</b> para desbloquear el Bloque IV.</div>`
});

addScreen({
    id: 'm7a',
    block: 3,
    module: 'Módulo 7',
    title: 'Ciclo de vida de los datos',
    narration: 'El estudio de Huang et al. (2026) plantea que los riesgos éticos pueden surgir en cualquiera de las etapas del ciclo de vida de los datos. Por ello, la gobernanza no debe limitarse al momento en que la IA ya está funcionando, sino que debe iniciar desde la planificación y mantenerse hasta la eliminación de los datos.',
    render: () => `${header('Módulo 7', 'Gobernanza de datos: enfoque de 7 etapas')}
  
<section class="ciclo-datos">
  <p class="intro">
    Huang et al. (2026) proponen que la gobernanza ética de la IA debe aplicarse durante todo el ciclo de vida de los datos, mediante un enfoque compuesto por siete etapas interrelacionadas:
  </p>
  <div class="etapas">
    <article class="etapa">
      <div class="icono" aria-hidden="true">🎯</div>
      <div>
        <h3>Diseño y planificación</h3>
        <p>Definición de objetivos, requisitos éticos y responsabilidades.</p>
      </div>
    </article>

    <article class="etapa">
      <div class="icono" aria-hidden="true">📥</div>
      <div>
        <h3>Adquisición de datos</h3>
        <p>Recopilación de información garantizando calidad, legalidad y consentimiento.</p>
      </div>
    </article>

    <article class="etapa">
      <div class="icono" aria-hidden="true">⚙️</div>
      <div>
        <h3>Procesamiento de datos</h3>
        <p>Limpieza, transformación y preparación de los datos.</p>
      </div>
    </article>

    <article class="etapa">
      <div class="icono" aria-hidden="true">🔎</div>
      <div>
        <h3>Evaluación de datos</h3>
        <p>Verificación de calidad, sesgos y cumplimiento de criterios éticos.</p>
      </div>
    </article>

    <article class="etapa">
      <div class="icono" aria-hidden="true">🤖</div>
      <div>
        <h3>Despliegue del modelo</h3>
        <p>Implementación y uso de los sistemas de IA.</p>
      </div>
    </article>

    <article class="etapa">
      <div class="icono" aria-hidden="true">🔄</div>
      <div>
        <h3>Circulación de datos</h3>
        <p>Intercambio, acceso y reutilización de la información.</p>
      </div>
    </article>

    <article class="etapa">
      <div class="icono" aria-hidden="true">🗄️</div>
      <div>
        <h3>Retiro o eliminación de datos</h3>
        <p>Gestión del cierre del ciclo de vida y disposición segura de los datos.</p>
      </div>
    </article>
  </div>
</section>

`
});

addScreen({
    id: 'm7b',
    block: 3,
    module: 'Módulo 7',
    title: 'Gobernanza de la IA y ética en el ciclo de vida de los datos',
    narration: 'Para este módulo, se analizará el estudio desarrollado por Huang, Kou y Zhou (2026), quienes proponen un marco de gobernanza ética de datos para la inteligencia artificial basado en el ciclo de vida de los datos.​ La gobernanza ética de la IA debe estar presente durante todo el ciclo de vida de los datos, desde su recopilación hasta su eliminación.​',
    render: () => `${header('Módulo 7', 'Gobernanza de datos')}

     <article class="fahp-card">
    <p>
      El modelo
      <span class="fahp-highlight">
        Fuzzy Analytic Hierarchy Process
      </span>
      (Proceso Analítico Jerárquico Difuso en español)
      FAHP . evidencia que la
      <span class="fahp-highlight">
        gobernanza organizacional y la rendición de cuentas
      </span>
      son los factores más importantes para garantizar un uso responsable
      de la inteligencia artificial
      <span class="fahp-citation">(Huang et al., 2026).</span>
    </p>
  </article>

  <article class="fahp-card">
    <p>
      <span class="fahp-highlight">FAHP</span>
      es una herramienta de análisis multicriterio que permite asignar
      pesos y priorizar factores de gobernanza ética cuando las
      valoraciones de los expertos son subjetivas o inciertas
      <span class="fahp-citation">(Huang et al., 2026).</span>
      Fue una metodología aplicada a
      <span class="fahp-highlight">19 expertos</span>
      para priorizar los factores más relevantes de la gobernanza ética
      de datos.
    </p>
  </article>



    `
});

addScreen({
    id: 'm7b',
    block: 3,
    module: 'Módulo 7',
    title: 'Gobernanza de la IA y ética en el ciclo de vida de los datos',
    narration: 'Con el propósito de identificar los factores más relevantes para una gobernanza ética efectiva, los autores Huang, Kou y Zhou (2026) desarrollaron un modelo de evaluación basado en el método FAHP (Fuzzy Analytic Hierarchy Process).​',
    render: () => `${header('Módulo 7', 'Gobernanza de datos')}
      
<section class="governance-content">

  <article class="governance-card">
    <p>
      Los resultados muestran que la dimensión denominada
      <span class="governance-highlight">Gobernanza Organizacional y Rendición de Cuentas</span>
      (Organizational Governance and Accountability) obtuvo la mayor
      importancia relativa, alcanzando un peso del
      <span class="governance-percentage">41,66 %</span>
      dentro del modelo
      <span class="governance-citation">(Huang et al., 2026).</span>
      Este resultado evidencia que la existencia de responsabilidades
      claramente definidas, mecanismos de supervisión y controles
      institucionales constituye la base para una gestión ética de
      los sistemas de inteligencia artificial.
    </p>
  </article>

  <article class="governance-card">
    <p>
      En cuanto a sus indicadores:
      <span class="governance-indicator">E5 - Feedback &amp; Evaluation</span>
      es el indicador con mayor peso del modelo. Destaca la importancia
      de monitorear continuamente los sistemas de IA, incorporar
      retroalimentación y aplicar mejoras para corregir riesgos y
      garantizar una IA responsable
      <span class="governance-citation">(Huang et al., 2026).</span>
    </p>
  </article>

</section>

    `
});

addScreen({
    id: 'm7d',
    block: 3,
    module: 'Módulo 7',
    title: 'Gobernanza de la IA y ética en el ciclo de vida de los datos',
    narration: 'el indicador Feedback & Evaluation (E5) obtuvo la mayor relevancia (17,55 %): , lo que demuestra la necesidad de realizar seguimiento continuo, evaluación de resultados y mejora permanente de los sistemas de IA (Huang et al., 2026). Así mismo, el indicador Feedback & Evaluation (E5) obtuvo la mayor relevancia, lo que demuestra la necesidad de realizar seguimiento continuo, evaluación de resultados y mejora permanente de los sistemas de IA (Huang et al., 2026).​',
    render: () => `${header('Módulo 7', 'Gobernanza de datos')}
    
<section class="infografia-huang">

  <div class="ih-tarjetas">
    <article class="ih-tarjeta ih-tarjeta--turquesa">
      <div class="ih-tarjeta-titulo">
        <span class="ih-numero ih-numero--turquesa">1</span>
        <span>Peso de la dimensión Gobernanza Organizacional y Accountability</span>
      </div>

      <div class="ih-centro">
        <div class="ih-donut">
          <strong>41,66 %</strong>
        </div>
      </div>

      <div class="ih-dato">
        <span class="ih-dato-nombre">
          <span class="ih-punto"></span>
          Gobernanza Organizacional y Accountability
        </span>
        <strong>41,66 %</strong>
      </div>

      <p class="ih-nota">Esta dimensión recibe el mayor peso dentro del modelo propuesto.</p>
    </article>

    <article class="ih-tarjeta ih-tarjeta--morado">
      <div class="ih-tarjeta-titulo">
        <span class="ih-numero ih-numero--morado">2</span>
        <span>Peso global del indicador Feedback &amp; Evaluation (E5)</span>
      </div>

      <div class="ih-centro">
        <div class="ih-icono-circulo" aria-hidden="true">☷</div>
        <p class="ih-valor">17,55 %</p>
        <span class="ih-etiqueta">Feedback &amp; Evaluation (E5)</span>
      </div>

      <p class="ih-nota" style="text-align:center">
        Es el indicador más importante dentro del modelo.
      </p>
    </article>

    <article class="ih-tarjeta ih-tarjeta--naranja">
      <div class="ih-tarjeta-titulo">
        <span class="ih-numero ih-numero--naranja">3</span>
        <span>Hallazgo principal</span>
      </div>

      <div class="ih-alerta-contenido">
        <div class="ih-alerta-icono" aria-hidden="true">⚠</div>
        <p class="ih-alerta-texto">
          Las organizaciones suelen concentrar los controles en las
          <strong>etapas finales de la IA (downstream-intensive)</strong>,
          descuidando las fases iniciales de <strong>gestión de datos</strong>,
          donde se originan muchos riesgos éticos.
        </p>
      </div>
    </article>
  </div>

  <section class="ih-ciclo">
    <h3>El ciclo de vida de los datos en la IA</h3>

    <div class="ih-controles">
      <div class="ih-control ih-control--menos">
        Menos controles<br>(según el estudio)
      </div>
      <div class="ih-control ih-control--mas">
        Más controles<br>(según el estudio)
      </div>
    </div>

    <div class="ih-etapas">
      <div class="ih-etapa">
        <span class="ih-etapa-icono" aria-hidden="true">▤</span>
        <div>
          <strong>Gestión de datos</strong>
          <small>(etapa inicial)</small>
        </div>
      </div>

      <div class="ih-etapa">
        <span class="ih-etapa-icono" aria-hidden="true">⚙</span>
        <div>
          <strong>Procesamiento y preparación</strong>
          <small>(etapa intermedia)</small>
        </div>
      </div>

      <div class="ih-etapa">
        <span class="ih-etapa-icono" aria-hidden="true">◉</span>
        <div>
          <strong>Desarrollo del modelo</strong>
          <small>(etapa intermedia)</small>
        </div>
      </div>

      <div class="ih-etapa">
        <span class="ih-etapa-icono" aria-hidden="true">♙</span>
        <div>
          <strong>Implementación y uso</strong>
          <small>(etapa final)</small>
        </div>
      </div>

      <div class="ih-etapa">
        <span class="ih-etapa-icono" aria-hidden="true">⌕</span>
        <div>
          <strong>Monitoreo y evaluación</strong>
          <small>(etapa final)</small>
        </div>
      </div>
    </div>
  </section>

  <footer class="ih-referencia">
    <span class="ih-referencia-icono" aria-hidden="true">▤</span>
     Nota. Infografía de elaboración propia con apoyo de inteligencia artificial, basada en (Huang et al., 2026).
  </footer>
</section>
    `
});

addScreen({
    id: 'm8a',
    block: 3,
    module: 'Módulo 8',
    title: 'La trampa del solucionismo de IA',
    narration: 'Adobor (2026) plantea que muchas organizaciones no fracasan con la IA porque la tecnología sea mala, sino porque intentan solucionar problemas complejos únicamente mediante algoritmos. En lugar de entender primero el problema, implementan herramientas de IA esperando que por sí solas generen resultados.',
    render: () => `${header('Módulo 8', 'Gobernanza de datos')}

    
<section class="trampa-fondo">

  <p class="texto subtitulo">
    Cuando la tecnología se convierte en la respuesta antes de entender la pregunta.
  </p>

  <p class="texto problema">
    Problema<br>Organizacional<br>Complejo
  </p>

  <p class="texto espejismo">El espejismo</p>

  <p class="texto adopcion">
    Adopción<br>Balística de IA
  </p>

  <p class="texto explicacion">
    Se asume erróneamente que un algoritmo puede resolver problemas de cultura, estructura o estrategia.
  </p>

  <p class="texto colapso">
    Colapso de<br>Gobernanza
  </p>

  <p class="texto realidad">La realidad</p>

  <p class="texto diagnostico">
    Diagnóstico y<br>Juicio Humano
  </p>

  <p class="texto herramienta">
    Herramienta<br>Tecnológica<br>Adecuada
  </p>

  <p class="texto valor">
    Valor Real<br>a Escala
  </p>
</section>

  <footer class="ih-referencia">
    <span class="ih-referencia-icono" aria-hidden="true">▤</span>
     Nota. Grafica de elaboración propia con apoyo de inteligencia artificial, basada Adobor (2026). 
  </footer>

    `
});

/* (Corregido: la segunda pestaña tenía el HTML dañado en el original.) */

addScreen({
    id: 'm8b',
    block: 3,
    module: 'Módulo 8',
    title: 'Mecanismos del solucionismo de IA',
    narration: 'El autor Urrutia-Onate et al., 2026). , identifica seis mecanismos que explican por qué las organizaciones terminan adoptando IA de forma inadecuada. Estos factores suelen actuar juntos y generan proyectos que avanzan rápidamente sin suficiente análisis, supervisión o revisión de riesgos.',
    render: () => `${header('Módulo 8', 'Mecanismos del solucionismo de IA')}

<section class="mecanismos-solucionismo">

  <h2><strong>Mecanismos del solucionismo de IA</strong></h2>

  <div class="lista">
    <article class="item">
      <div class="icono" aria-hidden="true">🔍</div>
      <div class="texto">Sobresimplificación.</div>
    </article>

    <article class="item">
      <div class="icono" aria-hidden="true">📈</div>
      <div class="texto">Sobreconfianza algorítmica.</div>
    </article>

    <article class="item">
      <div class="icono" aria-hidden="true">📢</div>
      <div class="texto">Hype o sobreexpectativas.</div>
    </article>

    <article class="item">
      <div class="icono" aria-hidden="true">🧠</div>
      <div class="texto">Desplazamiento del juicio humano.</div>
    </article>

    <article class="item">
      <div class="icono" aria-hidden="true">🚀</div>
      <div class="texto">Adopción balística.</div>
    </article>

    <article class="item">
      <div class="icono" aria-hidden="true">⚖️</div>
      <div class="texto">Amplificación de sesgos.</div>
    </article>
  </div>
</section>

  `
});


addScreen({
    id: 'm8b2',
    block: 3,
    module: 'Módulo 8',
    title: 'Barreras de adopción e implementación',
    narration: 'Según Fatorachian y Ashima (2026),  estas son las principales barreras identificadas en una organización que implementa IA responsable, podemos observar que no se tratan únicamente de barreras tecnológicas, sino que incluye problemas en la calidad de los datos, dificultades de integración, problemas culturales, baja capacitación del talento, sesgos entre otros.',
    render: () => `${header('Módulo 8', 'Barreras para la adopción e implementación de IA')}
    <div class="figura-completa">
  <img src="./img/m8b2.png" alt="Proyecto zombi y miopía de portafolio">
</div>
       <footer class="ih-referencia">
    <span class="ih-referencia-icono" aria-hidden="true">▤</span>
     Nota. Infografía de elaboración propia con apoyo de inteligencia artificial, basada en (Huang et al., 2026).
  </footer>
  `
});



addScreen({
    id: 'm8c',
    block: 3,
    module: 'Módulo 8',
    title: 'Proyectos zombi y miopía de portafolio',
    narration: '¿Qué son los proyectos zombi?Son iniciativas de IA que:Consumen recursos.Permanecen activas durante años.No generan beneficios significativos.Carecen de alineación estratégica."Technically functional prototypes that never deliver value at scale."Fuente: Adobor (2026). Portfolio MyopiaOcurre cuando:Cada área desarrolla IA de forma independiente.No existe visión institucional.Se duplican esfuerzos.Aumentan los riesgos acumulados.Pregunta clave:¿Cómo interactúa esta iniciativa con los demás proyectos de IA de la organización?Fuente: Adobor (2026). Es tiempo de reflexión de lo que hemos visto en este modulo.',
    render: () => `${header('Módulo 8', 'Proyecto zombi y miopía de portafolio')}
  <div class="grid">
    <div class="card"><h3>🧟 Proyectos zombi</h3><p>Prototipos técnicamente funcionales que permanecen activos durante años, consumen recursos, carecen de alineación estratégica y <b>nunca escalan</b>.</p></div>
    <div class="card"><h3>🔭 Miopía de portafolio</h3><p>Áreas desarrollando IA en silos: se duplican esfuerzos, no hay visión institucional y aumentan los riesgos acumulados ocultos.</p><p class="cite">Pregunta clave: ¿cómo interactúa esta iniciativa con los demás proyectos de IA de la organización?</p></div>
  </div>
  
  <blockquote class="cita-gobernanza">
  <span class="icono-cita" aria-hidden="true">❝</span>
  <p>
    La inteligencia artificial no sustituye la responsabilidad ni el criterio humano.
    Las organizaciones obtienen mejores resultados cuando utilizan la IA como una
    herramienta de apoyo para la toma de decisiones, dentro de un marco de gobernanza
    que garantice transparencia, control y generación de valor.
  </p>
  <cite>Adobor (2026).</cite>
</blockquote>

  `
});

addScreen({
    id: 'm9a',
    block: 3,
    module: 'Módulo 9',
    title: 'Capacidades y conocimiento',
    narration: 'El detalle está en la capacidad que tiene una organización para aprovechar ese conocimiento y convertirlo en resultados. Desde esta perspectiva, el recurso más importante no es la tecnología sino el conocimiento que posee la organización. La IA ayuda a procesar información, pero el verdadero valor aparece cuando ese conocimiento se transforma en mejores decisiones, mejores procesos y nuevas oportunidades de innovación. Raina et al., 2026',
    render: () => `${header('Módulo 9', 'Capacidades & AI Literacy')}
    <section class="conocimiento-organizacional">
  <div class="idea-principal">
    <span class="icono" aria-hidden="true">✦</span>
    <h2>La tecnología por sí sola no genera valor</h2>
    <p>
      La IA es cada vez más accesible. El diferencial está en cómo se utiliza.
      El conocimiento sigue siendo un activo estratégico. Las personas siguen siendo fundamentales.
    </p>
    <cite>Raina et al. (2026)</cite>
  </div>

  <div class="conocimiento-card">
    <div class="encabezado-card">
      <span class="icono" aria-hidden="true">🧠</span>
      <h3>Conocimiento Organizacional</h3>
    </div>
    <p class="frase-destacada">Único recurso estratégico más valioso.</p>
    <p>
      Es difícil de imitar, se construye con la experiencia, favorece la innovación
      y mejora la toma de decisiones.
    </p>
    <cite>Raina et al. (2026)</cite>
  </div>

  <div class="capacidades">
    <div class="titulo-capacidades">
      <span class="icono" aria-hidden="true">⚙</span>
      <div>
        <h3>Capacidades dinámicas</h3>
        <p>Visión Basada en el Conocimiento (KBV)</p>
      </div>
    </div>

    <div class="etapas">
      <div class="etapa">
        <span class="numero">01</span>
        <span class="etapa-icono" aria-hidden="true">🔎</span>
        <h4>Sensorizar</h4>
        <p>Identificar cambios y oportunidades.</p>
      </div>

      <div class="conector" aria-hidden="true">→</div>

      <div class="etapa">
        <span class="numero">02</span>
        <span class="etapa-icono" aria-hidden="true">🎯</span>
        <h4>Aprovechar</h4>
        <p>Convertir oportunidades en resultados.</p>
      </div>

      <div class="conector" aria-hidden="true">→</div>

      <div class="etapa">
        <span class="numero">03</span>
        <span class="etapa-icono" aria-hidden="true">🔄</span>
        <h4>Reconfigurar</h4>
        <p>Ajustar procesos y recursos.</p>
      </div>
    </div>
  </div>
</section>
 <img src="./img/m9a.png" alt="Proyecto zombi y miopía de portafolio">

       <footer class="ih-referencia">
    <span class="ih-referencia-icono" aria-hidden="true">▤</span>
     Nota. Infografía de elaboración propia con apoyo de inteligencia artificial, basada en (Huang et al., 2026).
  </footer>

    `
});

addScreen({
    id: 'm9b',
    block: 3,
    module: 'Módulo 9',
    title: 'Valor = IA + juicio humano',
    narration: 'Una decisión acertada al momento de implementar la inteligencia artificial en las organizaciones consiste en aprovechar la capacidad de analizar grandes cantidades de información de forma rápida pero entendiendo que las personas aportan el contexto situacional y toma de decisiones fundamentadas. Es ahí donde se realiza el match perfecto.',
    render: () => `${header('Módulo 9', 'Valor = IA + juicio humano')}
   <img src="./img/m9b.jpg" alt="Proyecto zombi y miopía de portafolio">
      <footer class="ih-referencia">
    <span class="ih-referencia-icono" aria-hidden="true">▤</span>
     Nota. Grafica de elaboración propia con apoyo de inteligencia artificial, basada Raina et al., 2026
  </footer>
   
  `
});

addScreen({
    id: 'm9c',
    block: 3,
    module: 'Módulo 9',
    title: 'Valor = IA + juicio humano',
    narration: '         Aprender a hacer uso de la IA es usarla como herramienta, entender sus limitaciones y desarrollar la capacidad crítica para analizar los resultados generados, evitando tomar  decisiones basadas únicamente en lo que recomienda el sistema. ',
    render: () => `${header('Módulo 9', '')}
  
   <img src="./img/m9c.jpg" alt="Proyecto zombi y miopía de portafolio">
     <footer class="ih-referencia">
    <span class="ih-referencia-icono" aria-hidden="true">▤</span>
     Nota. Grafica de elaboración propia con apoyo de inteligencia artificial, basada Raina et al., 2026
  </footer>
  `
});

addScreen({
    id: 'm9d',
    block: 3,
    module: 'Módulo 9',
    title: 'Valor = IA + juicio humano',
    narration: 'Las empresas que obtienen mejores resultados son aquellas que aprenden de sus errores y realizan ajustes y mejoramiento constante de ello. Aprender Continuamente.',
    render: () => `${header('Módulo 9', 'Cultura de Aprendizaje. Aprender Continuamente')}
  
   <img src="./img/m9d.png" alt="Proyecto zombi y miopía de portafolio">
     <footer class="ih-referencia">
    <span class="ih-referencia-icono" aria-hidden="true">▤</span>
     Nota. Grafica de elaboración propia basada Raina et al., 2026
  </footer>
  
  `
});

/* ---- Actividad 3 (desbloquea el Bloque IV) ---- */
addScreen({
    id: 'a3a',
    block: 3,
    module: 'Actividad 3',
    title: 'Actividad 3 · Verdadero o falso',
    requires: () => isDone('a3a'),
    narration: 'A continuación se presentarán algunas afirmaciones relacionadas con los temas abordados. Tu tarea será identificar si cada afirmación es verdadera o falsa según los conceptos estudiados. No se trata de memorizar definiciones, sino de analizar cada situación y aplicar los conocimientos adquiridos.',
    render: () => `${header('Actividad 3 · Parte A', 'Verdadero o falso')}<p>Identifica si cada afirmación es verdadera o falsa según los conceptos estudiados.</p><div id="tf3"></div>`,
    init: r => tf($('#tf3', r), {
        restore: 'a3a',
        onOk: () => markDone('a3a'),
        items: [{
                q: 'La IA reemplaza completamente el juicio humano.',
                a: false,
                fb: 'En este ODC hemos reforzado que la IA es una herramienta, pero no sustituye la decisión humana.'
            },
            {
                q: 'La calidad de los datos influye en los resultados de la IA.',
                a: true,
                fb: 'Los datos incompletos no permiten obtener resultados óptimos.'
            },
            {
                q: 'Un proyecto zombi genera poco valor pero sigue consumiendo recursos.',
                a: true,
                fb: 'Continúa recibiendo tiempo, esfuerzo y dinero aunque ya no aporte beneficios significativos.'
            },
            {
                q: 'La alfabetización en IA implica usar herramientas sin cuestionarlas.',
                a: false,
                fb: 'Implica comprender cómo funciona la tecnología y evaluarla de forma crítica y responsable.'
            },
            {
                q: 'La gobernanza de datos ayuda a garantizar información confiable.',
                a: true,
                fb: 'Establece las reglas y controles para asegurar la información y sus responsables.'
            }
        ]
    })
});

addScreen({
    id: 'a3b',
    block: 3,
    module: 'Actividad 3',
    title: 'Actividad 3 · Sopa de letras',
    requires: () => isDone('a3b'),
    narration: 'Encuentra las diez palabras. Lee las instrucciones, busca cada palabra en la cuadrícula y márcala cuando la encuentres. Las palabras pueden estar en horizontal, vertical o diagonal. Algunas pueden aparecer de abajo hacia arriba o de derecha a izquierda. No se utilizan tildes.',
    render: () => `${header('Actividad 3 · Parte B', '¡Encuentra las 10 palabras!')}<div id="wsw"></div>`,
    init: r => wordsearch($('#wsw', r), {
        restore: 'a3b',
        onOk: () => markDone('a3b')
    })
});

/* ---------- BLOQUE IV · Facilitadores y ejecución (block 4) ---------- */
addScreen({
    id: 'b4',
    block: 4,
    module: 'Bloque IV',
    title: 'Bloque IV: Facilitadores y ejecución',
    narration: 'Finalmente, cuarto bloque: facilitadores y ejecución. Aquí hablaremos del papel del liderazgo, de la importancia de reconocer las restricciones y barreras desde el comienzo, de la auditoría y el monitoreo de los sistemas de IA, y terminaremos construyendo una hoja de ruta de siete etapas para llevar estos conocimientos a la práctica.',
    render: () => `${header('Bloque IV', 'Facilitadores y ejecución')}${cards([
    ['M10 · Liderazgo & Paradoja PC', 'Factores que facilitan la adopción y la paradoja de restricciones percibidas.'],
    ['M11 · Auditoría & Model Drift', 'Supervisión posterior a la implementación.'],
    ['M12 · Hoja de ruta', 'Siete etapas con puertas de calidad.']])}
  <div class="box">🔓 Al finalizar, la <b>Actividad 4</b> y la <b>evaluación final</b> cierran tu recorrido.</div>`
});

addScreen({
    id: 'm10a',
    block: 4,
    module: 'Módulo 10',
    title: 'Factores facilitadores y liderazgo',
    narration: 'las organizaciones no siguen una única fórmula para implementar inteligencia artificial. Algunas avanzan gracias a su capacidad tecnológica, otras por el impulso de políticas institucionales. Lo importante es que distintos factores pueden combinarse para lograr resultados similares.',
    render: () => `${header('Módulo 10', 'Factores facilitadores de la adopción de IA')}
  
    <section class="ai-adoption">

  <article class="ai-adoption-card ai-adoption-key">
    <p>
      Idea clave: No existe una única ruta para adoptar IA con éxito.
    </p>
  </article>

  <article class="ai-adoption-card">
    <h2>¿Qué impulsa la adopción de IA?</h2>

    <p>
      La adopción exitosa de IA depende de la combinación de:
    </p>

    <ul class="ai-adoption-list">
      <li>Capacidad tecnológica.</li>
      <li>Conocimiento normativo.</li>
      <li>Orientación estratégica.</li>
      <li>Comprensión de las restricciones.</li>
      <li>Apoyo institucional.</li>
    </ul>

    <p class="ai-adoption-reference">
      (Yigitcanlar et al., 2026).
    </p>
  </article>
</section>
`
});

addScreen({
    id: 'm10b',
    block: 4,
    module: 'Módulo 10',
    title: 'Modulo 10 Liderazgo como facilitador',
    narration: 'La IA requiere dirección estratégica, no solo tecnología.(Yigitcanlar et al., 2026).',
    render: () => `${header('Módulo 10', 'Modulo 10 Liderazgo como facilitador')}
  
    <section class="ai-leadership">
  <article class="ai-leadership-card">

    <h2>El liderazgo impulsa la transformación</h2>

    <p class="ai-leadership-intro">
      Los líderes facilitan la adopción de IA cuando:
    </p>

    <ul class="ai-leadership-list">
      <li>Promueven la innovación.</li>
      <li>Definen una visión clara.</li>
      <li>Gestionan riesgos y oportunidades.</li>
      <li>Impulsan la coordinación entre áreas.</li>
    </ul>

    <p class="ai-leadership-reference">
      <strong>Yigitcanlar et al., 2026).</strong>
    </p>

  </article>
</section>
`
});

addScreen({
    id: 'm10c',
    block: 4,
    module: 'Módulo 10',
    title: 'Paradoja de restricciones percibidas',
    narration: 'Según (Yigitcanlar et al., 2026).La llamada  paradoja de restricciones percibidas, Algo que parece bastante contradictorio, pero real, es el hecho de que en este estudio se encontró que aquellas organizaciones que identifican más barreras en la implementación con IA, no dejan de implementarla, por el contrario suelen planificar, gestionar riesgos y desarrollar estrategias mejores y más realistas. Este hallazgo resulta especialmente relevante porque muestra que admitir limitaciones no es una señal de debilidad organizacional. Al contrario, reconocer las dificultades relacionadas con datos, talento, recursos o regulación puede ser el primer paso para construir una adopción de IA más responsable, sostenible y alineada con los objetivos institucionales."',
    render: () => `${header('Módulo 10', 'Paradoja de restricciones percibidas (PC)')}
       <img src="./img/m10c.png" alt="Proyecto zombi y miopía de portafolio">
          <footer class="ih-referencia">
    <span class="ih-referencia-icono" aria-hidden="true">▤</span>
     Nota. Grafica de elaboración propia con apoyo de inteligencia artificial, basada en Yigitcanlar et al., 2026

  </footer>
       `
});

addScreen({
    id: 'm11a',
    block: 4,
    module: 'Módulo 11',
    title: 'El gobierno continuo: model drift',
    narration: 'Ahora veremos en este modulo la auditoria continua y el modelo drift. En este estudio realizado por (Kramer et al., 2026) resalta que la evaluación de una herramienta IA no debe limitarse al momento de su implementación, pues estos modelos pueden ser susceptibles a cambios en su comportamiento ya sea por el factor tiempo, precisión o inclusive incorporarse sesgos que no existían inicialmente. Es por esto, que el seguimiento y supervisión debe ser continua durante todo el ciclo de vida del sistema. Otros autores afirman los siguiente en sus estudios:  ',
    render: () => `${header('Módulo 11', 'La supervisión no termina cuando se implemente la IA ')}
    <section class="ai-supervision">

  <article class="ai-supervision-card">
    <h2 class="ai-supervision-title">
      Supervisión posterior a la implementación, monitoreo continuo y gestión del
      <span class="ai-supervision-term">Model Drift</span>.
    </h2>
  </article>

  <article class="ai-supervision-card">
    <p>
      <span class="ai-supervision-reference">(Kramer et al., 2026)</span>
      resalta que la evaluación de una herramienta IA no debe limitarse al momento de su implementación, pues estos modelos pueden ser susceptibles a cambios en su comportamiento
    </p>
  </article>

  <article class="ai-supervision-card">
    <p>
      Supervisión posterior a la implementación, monitoreo continuo y gestión del
      <span class="ai-supervision-term">Model Drift</span>.
    </p>
  </article>

  <article class="ai-supervision-card">
    <p>
      Según <span class="ai-supervision-reference">Schafer (2026),</span>En cuanto a la auditoria interna en las organizaciones, esta debe evoluacionar continuamente para que se asegure la gobernanza, la protección de la información, validación de los datos, evaluaciones de los riesgos del modelo y el monitoreo constante de los sistemas adoptados.
    </p>
  </article>

  <article class="ai-supervision-card">
    <p>
      Adicionalmente <span class="ai-supervision-reference">(Leon, 2025).</span>
      Refiere en su investigación que las organizaciones necesitan estar implementando auditorias independientes y los mecanismos de supervisión adecuados para garantizar que los sistemas operen de manera transparente y alineada con los principios de Gobernanza de la entidad.
    </p>
  </article>

</section>`
})

addScreen({
    id: 'm11b',
    block: 4,
    module: 'Módulo 11',
    title: 'Auditoría y mitigación de la deriva',

    narration: 'El model Drift  (Deriva del modelo se entiende como Un modelo puede deteriorar su desempeño con el tiempo, aunque inicialmente haya funcionado correctamente. “El modelo comienza a alejarse de los objetivos para los que fue diseñado.” (Kramer et al., 2026). Para este estudio los participantes destacaron algunas necesidades y como mitigar este modelo. ',

    render: () => {
        return `
            ${header('Módulo 11', 'Auditoría & Model Drift')}

            <img
                src="./img/m11b.png"
                alt="Proyecto zombi y miopía de portafolio"
            >

             <footer class="ih-referencia">
    <span class="ih-referencia-icono" aria-hidden="true">▤</span>
     Nota. Grafica de elaboración propiacon apoyo de inteligencia artificial,
 basada en Kramer et al., 2026(Kramer et al., 2026).
  </footer>
        `;
    }
});


addScreen({
    id: 'm11c',
    block: 4,
    module: 'Módulo 11',
    title: ' Auditoría & Model Drift',

    narration: 'La gobernanza de IA requiere un seguimiento permanente. No basta con implementar el modelo; también es necesario evaluar periódicamente su desempeño, identificar posibles desviaciones y tomar acciones oportunas para garantizar que continúe generando resultados confiables y alineados con los objetivos de la organización. (Kramer et al., 2026).',

    render: () => {
        return `
            ${header('Módulo 11', 'Auditoría & Model Drift')}
<section class="drift-quote">
  <blockquote class="drift-quote-card">
    <span class="drift-quote-mark" aria-hidden="true">“</span>

    <p class="drift-quote-text">
      Podríamos sentirnos cómodos pensando que la solución de IA sigue
      haciendo lo que prometió hacer, pero al mismo tiempo puede estar
      ocurriendo una deriva. Necesitamos mantener controles permanentes
      para asegurarnos de que la deriva y los sesgos no la alejen de
      nuestros objetivos principales“
    </p>

    <footer class="drift-quote-reference">
      (EL3, citado por Kramer et al., 2026).
    </footer>
  </blockquote>
</section>

        `;
    }
});

addScreen({
    id: 'm12a',
    block: 4,
    module: 'Módulo 12',
    title: 'Hoja de ruta: ciclo de vida de la IA',
    narration: '(Leon, 2026).propone en su estudio que la implementación de sistemas integrados de inteligencia artificial debe estar bajo una gobernanza presente en todo el ciclo de vida del sistema. Desde la implantación de la idea hasta terminación o retiro.',
    render: () => `${header('Módulo 12', 'Hoja de ruta (7 etapas)')}<p>La gobernanza debe estar presente en todo el ciclo de vida de la IA, <b>desde la idea hasta el retiro</b> (Leon, 2026).</p>${timeline('rm', ROADMAP_STAGES)}`,
    init: r => bindTimeline(r, 'rm', ROADMAP_STAGES)
});

addScreen({
    id: 'm12b',
    block: 4,
    module: 'Módulo 12',
    title: 'Puertas de calidad',
    narration: 'Desde esta verificación se puede dar por validada la continuación de un solución IA asegurando la calidad de los datos, los riesgos éticos, la privacidad y la documentación requerida. A partir de esta tabla es fácil entender como funciona cada puerta de calidad dentro de las etapas para la adopción de IA responsable.',
    render: () => {
        const gates = [ // [etapa, puerta de calidad]
            ['Definición del problema', 'Evaluar impacto y riesgos'],
            ['Datos', 'Revisar calidad, representatividad y sesgos'],
            ['Desarrollo', 'Validar explicabilidad, privacidad y equidad'],
            ['Pruebas', 'Verificar desempeño y robustez'],
            ['Despliegue', 'Confirmar supervisión humana'],
            ['Monitoreo', 'Detectar deriva y fallos'],
            ['Retiro', 'Preservar evidencia y lecciones aprendidas']
        ];
        return `${header('Módulo 12', 'Puertas de calidad')}
    <p>Cada fase debe tener <b>controles de verificación</b> antes de avanzar a la siguiente (Leon, 2026):</p>
    ${flow(['Cumplimiento legal', 'Calidad de los datos', 'Riesgos éticos', 'Equidad y ausencia de sesgos', 'Seguridad y privacidad', 'Documentación y trazabilidad'])}
    <p class="fig">Figura 6. Puertas de calidad. Elaboración propia, basada en León (2026).</p>
    <table id="qg"><caption>Tabla 5. Etapas y puertas de calidad. Elaboración propia, basada en León (2026). Haz clic en una fila para resaltarla.</caption>
    <thead><tr><th>Etapa</th><th>Puerta de calidad</th></tr></thead><tbody>${gates.map(([stage, gate]) => `<tr tabindex="0"><td>${stage}</td><td>${gate}</td></tr>`).join('')}</tbody></table>`;
    },
    init: r => $$('#qg tbody tr', r).forEach(row => {
        const highlight = () => {
            $$('#qg tbody tr', r).forEach(x => x.style.background = '');
            row.style.background = '#ffe9a8';
        };
        row.onclick = highlight;
        row.onkeydown = e => {
            if (e.key === 'Enter') highlight();
        };
    })
});

/* ---- Actividad 4 · ¿En qué módulo estamos? (4 preguntas, todas deben completarse) ---- */
addScreen({
    id: 'a4',
    block: 4,
    module: 'Actividad 4',
    title: 'Actividad 4 · ¿En qué módulo estamos?',
    requires: () => ['a4a', 'a4b', 'a4c', 'a4d'].every(isDone),
    narration: '¿En qué módulo estamos? El objetivo de esta actividad es relacionar conceptos con el módulo correcto. Lee cada afirmación y selecciona el módulo al que pertenece.',
    render: () => `${header('Actividad 4', '¿En qué módulo estamos?')}<p><b>Objetivo:</b> relacionar conceptos con el módulo correcto. Lee cada afirmación y selecciona el módulo al que pertenece: <b>M10</b> Liderazgo y Paradoja de Restricciones Percibidas · <b>M11</b> Auditoría y Model Drift · <b>M12</b> Hoja de Ruta de Implementación.</p><div id="q4a"></div><div id="q4b"></div><div id="q4c"></div><div id="q4d"></div>`,
    init: r => {
        const MODULE_LABELS = ['Liderazgo y Paradoja PC', 'Auditoría y Model Drift', 'Hoja de Ruta de Implementación'];
        /** Construye las 3 opciones M10/M11/M12; `correct` = índice correcto, `feedbacks` = texto por opción. */
        const moduleOptions = (correct, feedbacks) => ['M10', 'M11', 'M12'].map((m, i) => ({
            l: m,
            t: MODULE_LABELS[i],
            ok: i === correct,
            fb: feedbacks[i]
        }));

        const PC = 'Esta situación corresponde a la Paradoja de Restricciones Percibidas (módulo 10), que plantea que identificar limitaciones puede ser una oportunidad.';
        const DRIFT = 'Una vez que el modelo entra en funcionamiento puede sufrir cambios en su rendimiento, por lo que requiere seguimiento permanente y auditorías periódicas (módulo 11).';
        const ROAD = 'La Hoja de Ruta de 7 etapas (módulo 12) propone que la gobernanza no se limite al desarrollo o la implementación, sino que abarque todo el ciclo de vida.';

        const questions = [{
                id: 'a4a',
                q: 'Pregunta 1. Reconocer las limitaciones de una organización puede mejorar la adopción de la IA.',
                correct: 0,
                fbs: ['El módulo 10 explica que reconocer las limitaciones relacionadas con talento, recursos o datos no siempre es una desventaja: puede ayudar a diseñar estrategias más realistas y fortalecer la gobernanza.', PC, PC]
            },
            {
                id: 'a4b',
                q: 'Pregunta 2. La supervisión debe mantenerse incluso después de implementar una solución de IA.',
                correct: 1,
                fbs: [DRIFT, 'La gobernanza no termina con la implementación. Los modelos deben monitorearse continuamente para detectar desviaciones, sesgos o pérdidas de desempeño.', DRIFT]
            },
            {
                id: 'a4c',
                q: 'Pregunta 3. La gobernanza debe estar presente desde la definición del problema hasta el retiro del modelo.',
                correct: 2,
                fbs: [ROAD, ROAD, 'La gobernanza debe acompañar todo el ciclo de vida de la IA para asegurar transparencia, control y cumplimiento en cada etapa.']
            },
            {
                id: 'a4d',
                q: 'Pregunta 4. Las restricciones identificadas pueden convertirse en oportunidades de mejora.',
                correct: 0,
                fbs: ['Una organización que conoce sus debilidades está en mejor posición para fortalecer capacidades, gestionar riesgos y planificar la adopción de IA de forma responsable.',
                    'Este concepto pertenece a la Paradoja de Restricciones Percibidas (módulo 10), que propone ver las limitaciones como oportunidades.',
                    'Este concepto pertenece a la Paradoja de Restricciones Percibidas (módulo 10), que propone ver las limitaciones como oportunidades.'
                ]
            }
        ];
        // El id del contenedor (#q4a...) coincide con el id de la pregunta, y también es la clave de progreso.
        questions.forEach(x => mcq($('#q' + x.id.slice(1), r), {
            id: 'q' + x.id.slice(1),
            restore: x.id,
            onOk: () => markDone(x.id),
            q: x.q,
            opts: moduleOptions(x.correct, x.fbs)
        }));
    }
});

/* ---------- CIERRE (block 5) ---------- */
addScreen({
    id: 'final',
    block: 5,
    module: 'Evaluación',
    title: 'Evaluación final',
    requires: () => isDone('final'),
    avatar: true,
    narration: 'Llegó el momento de la evaluación final. Son diez preguntas alineadas con el resultado esperado de aprendizaje. Necesitas al menos ocho respuestas correctas, es decir, el ochenta por ciento, para aprobar. Si no lo logras, te sugeriré los módulos que conviene repasar y podrás intentarlo de nuevo. ¡Mucho éxito!',
    render: () => `${header('Evaluación sumativa', `Evaluación final (${FINAL_QUESTIONS.length} ítems)`)}
  <p>Alineada con el REA. <b>Criterio de logro:</b> mínimo ${Math.ceil(FINAL_QUESTIONS.length * CONFIG.passPercent / 100)} de ${FINAL_QUESTIONS.length} respuestas correctas (${CONFIG.passPercent} %). Puedes reintentar.</p>
  <form id="evf">${FINAL_QUESTIONS.map(([, question, options], i) =>
    `<fieldset><legend>${i + 1}. ${question}</legend>${options.map((o, j) => `<label><input type="radio" name="q${i}" value="${j}"> ${o}</label>`).join('')}</fieldset>`).join('')}
  <p><button class="btn" type="submit">Calificar</button></p></form><div id="evr" role="status"></div>`,
    init: r => {
        $('#evf', r).onsubmit = e => {
            e.preventDefault();
            const formData = new FormData(e.target);
            let correct = 0;
            const missedModules = [];

            FINAL_QUESTIONS.forEach(([moduleName, , , rightIndex], i) => {
                const chosen = formData.get('q' + i);
                const labels = $$('label', $$('fieldset', r)[i]);
                labels.forEach(l => l.style.background = '');
                if (chosen !== null && +chosen === rightIndex) {
                    correct++;
                    labels[+chosen].style.background = '#e6f6ec';
                } else {
                    missedModules.push(moduleName);
                    if (chosen !== null) labels[+chosen].style.background = '#fdeceb'; // incorrecta elegida
                    labels[rightIndex].style.background = '#e6f6ec'; // muestra la correcta
                }
            });

            const percent = Math.round(100 * correct / FINAL_QUESTIONS.length);
            const passed = percent >= CONFIG.passPercent;
            const result = $('#evr', r);
            result.className = 'fb ' + (passed ? 'ok' : 'no');
            result.innerHTML = `<b>Resultado: ${correct} de ${FINAL_QUESTIONS.length} (${percent} %).</b> ` + (passed ?
                '🎉 ¡Aprobado! Has alcanzado el criterio de logro. Continúa a la conclusión.' :
                `Aún no alcanzas el ${CONFIG.passPercent} %. Repasa: <b>${[...new Set(missedModules)].join(', ')}</b> y vuelve a intentarlo (las respuestas correctas aparecen en verde). <button type="button" class="btn sec rt" id="evre">🔁 Reintentar evaluación</button>`);

            if (passed) markDone('final');
            else $('#evre', r).onclick = () => {
                $('#evf', r).reset();
                $$('#evf label', r).forEach(l => l.style.background = '');
                result.innerHTML = '';
                result.className = '';
                window.scrollTo({
                    top: 0,
                    behavior: 'smooth'
                });
            };
            result.scrollIntoView({
                behavior: 'smooth',
                block: 'center'
            });
        };
    }
});

/* addScreen({
    id: 'concl',
    block: 5,
    module: 'Conclusión',
    title: 'Conclusión',
    narration: 'Has llegado a la conclusión. La gobernanza responsable de la inteligencia artificial no es un documento ni una herramienta: es la capacidad de orientar, controlar y supervisar su uso durante todo el ciclo de vida, con principios éticos, supervisión humana, rendición de cuentas, datos de calidad y liderazgo. Usa la lista de verificación para planear tus próximos pasos.',
    render: () => `${header('Cierre', 'Conclusión')}
  <p class="lead">La gobernanza responsable de la IA es la <b>capacidad de la organización para orientar, controlar y supervisar su uso</b> durante todo el ciclo de vida, integrando marcos existentes, principios éticos, supervisión humana, rendición de cuentas, gobernanza de datos, reconocimiento de barreras y monitoreo continuo.</p>
  ${cards([
    ['🧱 Fundamentos', 'Marcos integrados, cinco principios éticos y gestión continua de riesgos.'],
    ['🛡️ Salvaguardas', 'Gestionar la opacidad, supervisar (HOTL) y cerrar brechas de accountability.'],
    ['🔄 Datos y barreras', 'Gobernar todo el ciclo de datos, evitar el solucionismo y fortalecer capacidades.'],
    ['🚀 Ejecución', 'Liderazgo, auditoría continua y hoja de ruta con puertas de calidad.']])}
  <fieldset id="ck"><legend>✅ Lista de verificación: próximos pasos en mi organización</legend>${[
    'Identificar qué marcos de gobernanza ya existen para integrarlos y adaptarlos.',
    'Verificar que los cinco principios éticos estén traducidos en prácticas concretas.',
    'Asignar responsables, evidencia y una vía de impugnación para decisiones apoyadas por IA.',
    'Revisar controles desde la adquisición de datos, no solo al final.',
    'Inventariar proyectos de IA para evitar proyectos zombi y miopía de portafolio.',
    'Definir monitoreo continuo, auditorías y planes de pausa o retiro de modelos.'].map(x => `<label><input type="checkbox"> ${x}</label>`).join('')}</fieldset>`
}); */

addScreen({
    id: 'fin',
    block: 5,
    module: 'Culminación',
    title: '¡Así se hace! Eres imparable',
    narration: 'Has culminado esta camino de aprendizaje acerca de la gobernanza de IA responsable en las organizaciones.  No podemos estar más orgullosos de ti y todo tu esfuerzo. Nos vemos en un próximo reto de aprendizaje.',
    render: () => `<div id="fin" class="cover"><div style="font-size:3.5rem">🏆</div><h1>¡Así se hace!<br>Eres imparable</h1><p class="lead"><b>Has aprobado satisfactoriamente este curso.</b></p><p>Has culminado este camino de aprendizaje acerca de la gobernanza de IA responsable en las organizaciones. Esperamos que hayas disfrutado de este Moodle interactivo.</p><p class="sub">El conocimiento también te impulsa. ¡Nos vemos pronto!</p></div>`
});

addScreen({
    id: 'refs',
    block: 5,
    module: 'Referencias',
    title: 'Referencias',
    free: true,
    avatar: false,
    narration: '',
    render: () => `${header('Referencias', 'Referencias bibliográficas (APA 7)')}<p>${REFS.length} fuentes ordenadas alfabéticamente. Las imágenes, figuras y tablas del ODC son de elaboración propia con apoyo de inteligencia artificial, basadas en las fuentes aquí citadas.</p>
  <ol class="refs">${REFS.map(([text, url]) => `<li>${text} <a href="${url}" target="_blank" rel="noopener">${url}</a></li>`).join('')}</ol>`
});

addScreen({
    id: 'cred',
    block: 5,
    module: 'Créditos',
    title: 'Créditos y licencia',
    free: true,
    avatar: false,
    narration: '',
    render: () => `${header('Créditos', 'Metadatos, créditos y licencia')}
  <table><caption>Metadatos del ODC</caption><tbody>
  <tr><th>Área de conocimiento</th><td>Gerencia para la Transformación Digital</td></tr>
  <tr><th>Nombre del material</th><td><b>Gobernanza de Inteligencia Artificial Responsable</b></td></tr>
  <tr><th>Autor</th><td>Karol Natalia Pardo Cortes &amp; Jose Ricardo Pedraza Ballén</td></tr>
  <tr><th>Diseño y desarrollo</th><td>Karol Natalia Pardo Cortes &amp; Jose Ricardo Pedraza Ballén</td></tr>
  <tr><th>Imágenes</th><td>Karol Natalia Pardo Cortes &amp; Jose Ricardo Pedraza Ballén</td></tr>
  <tr><th>Sonidos y voces</th><td>Karol Natalia Pardo Cortes (guiones de audio) · Voz sintetizada por el navegador (Web Speech API)</td></tr>
  <tr><th>Fecha de creación</th><td>21/10/2026</td></tr><tr><th>Nivel educativo</th><td>Intermedio</td></tr></tbody></table>
  <h3>Recursos utilizados (esquema TASL)</h3>
  <table><thead><tr><th>Título</th><th>Autor</th><th>Source/URL</th><th>Licencia</th></tr></thead><tbody>
  <tr><td>Avatar Sof-IA</td><td>Pardo Cortes &amp; Pedraza Ballén</td><td>Incluido en este ODC</td><td>CC BY-NC-SA 4.0</td></tr>
  <tr><td>Gráficos, tablas y diagramas (Figuras 1-6, Tablas 1-5, Imágenes 3-14)</td><td>Pardo Cortes &amp; Pedraza Ballén, con apoyo de IA</td><td>Incluidos en este ODC</td><td>CC BY-NC-SA 4.0</td></tr>
  <tr><td>Íconos (emojis y símbolos Unicode)</td><td>Fuentes del sistema del usuario</td><td>Unicode Consortium</td><td>Uso libre del estándar</td></tr>
  <tr><td>Síntesis de voz</td><td>Navegador del usuario</td><td>Web Speech API</td><td>Funcionalidad del navegador</td></tr>
  <tr><td>Video «La supervisión humana en el uso de la IA»</td><td>De Luna, C. (2025)</td><td><a href="https://www.youtube.com/watch?v=5yjmQs06PeA" target="_blank" rel="noopener">YouTube</a></td><td>Licencia de YouTube (solo enlace)</td></tr></tbody></table>
  <h3>Licencia</h3><p>Los ODC producidos por los creadores de oportunidades cuentan con esta licencia:</p>
  <p><a class="cc" href="https://creativecommons.org/licenses/by-nc-sa/4.0/deed.es" target="_blank" rel="noopener">🅭 CC BY-NC-SA 4.0</a></p>
  <p class="cite">Universidad de Cundinamarca · Oficina de Educación Virtual y a Distancia · Gerencia para la Transformación Digital.</p>`
});




/* =====================================================================
   7. NAVEGACIÓN Y DIBUJO DE PANTALLAS
   ===================================================================== */
let current = 0; // índice de la pantalla visible
let userHasInteracted = false; // los navegadores solo permiten audio tras un gesto del usuario

const screenIndex = id => SCREENS.findIndex(s => s.id === id);

/**
 * ¿Se puede ir a la pantalla i? Sí, salvo que alguna pantalla ANTERIOR
 * tenga requires() sin cumplir. Las pantallas con free:true siempre son accesibles.
 */
function canGo(i) {
    if (i < 0 || i >= SCREENS.length) return false;
    if (SCREENS[i].free) return true;
    for (let j = 0; j < i; j++) {
        if (SCREENS[j].requires && !SCREENS[j].requires()) return false;
    }
    return true;
}

/** Actualiza Anterior/Continuar, el mensaje de bloqueo, el contador, la barra de progreso y el tamaño de texto. */
function refreshNav() {
    const screen = SCREENS[current];
    const blocked = !!(screen.requires && !screen.requires());
    const nextOk = current < SCREENS.length - 1 && canGo(current + 1);

    $('#bPrev').disabled = current === 0;
    $('#bNext').disabled = blocked || !nextOk;
    $('#lockmsg').textContent = blocked ? '🔒 Completa la actividad para continuar' : '';
    $('#pgno').textContent = `${screen.module} · Pantalla ${current + 1} de ${SCREENS.length}`;

    const percent = Math.round(100 * Object.keys(state.vis).length / SCREENS.length);
    $('#pbar').style.width = percent + '%';
    $('.prog').setAttribute('aria-valuenow', percent);

    $('#bFa').disabled = state.zoom >= CONFIG.zoom.max;
    $('#bFm').disabled = state.zoom <= CONFIG.zoom.min;
}

/** Envuelve las tablas del contenido en un contenedor con desplazamiento horizontal (móviles). */
function wrapTables(root) {
    $$('table', root).forEach(t => {
        if (t.parentElement && t.parentElement.classList.contains('table-wrap')) return;
        const wrap = document.createElement('div');
        wrap.className = 'table-wrap';
        t.replaceWith(wrap);
        wrap.appendChild(t);
    });
}

/** Cada pie "Imagen N …" recibe un espacio para assets/imagenN.png antes del pie. */
function insertImageSlots(root) {
    $$('.fig', root).forEach(fig => {
        const text = fig.textContent.trim();
        const m = text.match(/^(Imagen|Imágenes)\s+(\d+)/);
        if (m) fig.insertAdjacentHTML('beforebegin', imageSlot('imagen' + m[2], text.split('.')[0]));
    });
}

/** Activa los espacios de imagen: si el archivo existe se muestra; si no, se quita la imagen. */
function bindImageSlots(root) {
    $$('img[data-slot-img]', root).forEach(img => {
        const markOk = () => img.parentElement.classList.add('ok');
        const remove = () => img.remove();
        img.addEventListener('load', markOk);
        img.addEventListener('error', remove);
        if (img.complete)(img.naturalWidth ? markOk : remove)();
    });
}

/** Dibuja el marco de la pantalla: cabecera (menú, módulo, número) + contenido. */
function renderStage(screen, i) {
    const stage = $('#screen');
    stage.classList.toggle('act', /^a\d/.test(screen.id)); // las actividades tienen estilo propio

    const isHome = screen.id === 'cover' || screen.id === 'menu';
    const homeBtn = isHome ?
        '<span></span>' :
        '<button class="home" data-go="menu" aria-label="Ir al menú principal">🏠 <i>Menú Principal</i></button>';

    stage.innerHTML = `<div class="stagehd">${homeBtn}<span class="mod">${screen.id === 'cover' ? '' : screen.module}</span><span class="num" title="Número de pantalla">${String(i + 1).padStart(2, '0')}</span></div>
    <div class="pin" id="inner">${screen.render()}</div>`;

    insertImageSlots(stage);
    bindImageSlots(stage);
    wrapTables(stage);
}

/** Muestra u oculta el panel de Sof-IA y actualiza la transcripción. */
function setAvatarPane(screen) {
    const showAvatar = screen.avatar !== false && !!screen.narration;
    $('#avatarPane').classList.toggle('off', !showAvatar);
    $('main').classList.toggle('noav', !showAvatar);
    $('#trans').textContent = screen.narration || '';
    return showAvatar;
}

/**
 * Dibuja la pantalla i si está desbloqueada.
 *   focus = false evita mover el scroll (primera carga).
 *   push  = false no añade una entrada al historial (navegación con «atrás»).
 */
function show(i, focus = true, push = true) {
    if (!canGo(i)) {
        toast('🔒 Completa primero la actividad pendiente.');
        return;
    }
    stopAudio();

    current = i;
    const screen = SCREENS[i];
    state.vis[screen.id] = 1;
    saveState();
    document.body.dataset.b = screen.block;
    POP = []; // los popups se regeneran con cada render()

    renderStage(screen, i);
    const showAvatar = setAvatarPane(screen);

    screen.init && screen.init($('#inner')); // activa la interactividad
    $$('[data-go]', $('#screen')).forEach(b => b.onclick = () => show(screenIndex(b.dataset.go)));
    refreshNav();

    const hash = '#' + screen.id;
    if (push && location.hash !== hash) history.pushState(null, '', hash);
    else if (!push) history.replaceState(null, '', hash);

    if (focus) {
        window.scrollTo({
            top: 0,
            behavior: 'smooth'
        });
        $('#main').focus({
            preventScroll: true
        });
    }
    if (showAvatar && state.auto !== false && userHasInteracted) {
        setTimeout(() => {
            if (SCREENS[current] === screen) playAudio();
        }, CONFIG.voice.startDelayMs);
    }
}

const goNext = () => {
    if (current < SCREENS.length - 1) show(current + 1);
};


/* =====================================================================
   8. EVENTOS: modal, pestañas, teclado y tamaño de texto
   ===================================================================== */

/** Lee un texto en voz alta sin cambiar la transcripción de la pantalla. */
const play_now = text => speak(text);

/* --- 8.1 Modal (ventana +info y ayuda) --- */
let lastFocus = null; // elemento que abrió el modal, para devolverle el foco al cerrar

function openModal(narration, title, bodyHtml, trigger) {
    lastFocus = trigger;
    $('#mt').textContent = title;
    $('#mb').innerHTML = bodyHtml;
    $('#modal').hidden = false;
    $('#modal .x').focus();
    speak(narration);
}

function closeModal() {
    $('#modal').hidden = true;
    stopAudio(); // la lectura del popup no debe seguir al cerrar
    if (lastFocus) lastFocus.focus();
}

$('#modal .x').onclick = closeModal;
$('#modal').addEventListener('click', e => {
    if (e.target.id === 'modal') closeModal();
});

// Mantiene el foco dentro del modal mientras está abierto.
$('#modal').addEventListener('keydown', e => {
    if (e.key !== 'Tab') return;
    const focusables = $$('button, a[href], input, [tabindex]:not([tabindex="-1"])', $('#modal')).filter(el => !el.disabled);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
    }
});

function openHelp() {
    openModal('', 'Ayuda de navegación', `<ul>
    <li><b>Continuar / Anterior / Menú:</b> botones inferiores (atajo: Alt + ← / →). El ícono 🏠 te lleva al Menú Principal.</li>
    <li><b>Sof-IA:</b> el audio se reproduce automáticamente en cada pantalla; ⏸ pausa, ⏹ detiene, ▶ repite y 🔊 Auto activa o desactiva la reproducción automática. Siempre hay <b>transcripción</b>.</li>
    <li><b>+info:</b> botones que abren ventanas con definiciones y datos.</li>
    <li><b>Actividades:</b> si te equivocas puedes pulsar <b>Reintentar</b> tantas veces como necesites.</li>
    <li><b>Bloques:</b> se desbloquean al completar la actividad del bloque anterior.</li>
    <li>Tu progreso se guarda en este navegador.</li></ul>`, $('#bHelp'));
}
$('#bHelp').onclick = openHelp;

/* --- 8.2 Clics: ventanas +info, pestañas y narración de pestañas (un solo listener) --- */
document.addEventListener('click', e => {
    const popBtn = e.target.closest('[data-pop]');
    if (popBtn) {
        const {
            narration,
            title,
            body
        } = POP[+popBtn.dataset.pop];
        openModal(narration, title, body, popBtn);
        if (popBtn.dataset.track) popBtn.classList.add('seen'); // tarjetas "vistas"
        return;
    }
    const tab = e.target.closest('.tab');
    if (tab) selectTab(tab);
});

/** Activa una pestaña: marca el botón, muestra su panel y reproduce su narración. */
function selectTab(tab) {
    const widget = tab.closest('[data-tabs]');
    $$(':scope > .tablist > .tab', widget).forEach(x => {
        x.setAttribute('aria-selected', String(x === tab));
        x.tabIndex = x === tab ? 0 : -1;
    });
    const index = +tab.dataset.i;
    $$(':scope > .panel', widget).forEach((panel, i) => {
        panel.hidden = i !== index;
    });
    if (tab.dataset.narration) play_now(tab.dataset.narration);
}

/* --- 8.3 Teclado --- */
document.addEventListener('keydown', e => {
    // Modal abierto: solo Esc cierra.
    if (!$('#modal').hidden) {
        if (e.key === 'Escape') closeModal();
        return;
    }

    // Flechas dentro de una lista de pestañas.
    const tab = e.target.closest && e.target.closest('.tab');
    if (tab && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
        const list = $$('.tab', tab.parentElement);
        const step = e.key === 'ArrowRight' ? 1 : list.length - 1;
        const target = list[(list.indexOf(tab) + step) % list.length];
        target.focus();
        selectTab(target);
        return;
    }

    // Atajos Alt+←/→ (no cuando se escribe en un campo).
    if (e.target.matches && e.target.matches('input, textarea, select')) return;
    if (e.altKey && e.key === 'ArrowRight' && !$('#bNext').disabled) goNext();
    if (e.altKey && e.key === 'ArrowLeft' && current > 0) show(current - 1);
});

/* --- 8.4 Tamaño de texto (variable CSS --zoom que escala todo el diseño) --- */
function applyZoom(value, save = true) {
    const {
        min,
        max,
        step
    } = CONFIG.zoom;
    const clamped = Math.min(max, Math.max(min, value));
    state.zoom = Number((Math.round(clamped / step) * step).toFixed(2));
    document.documentElement.style.setProperty('--zoom', state.zoom);
    $('#bFa').disabled = state.zoom >= max;
    $('#bFm').disabled = state.zoom <= min;
    if (save) saveState();
}
$('#bFa').onclick = () => applyZoom(state.zoom + CONFIG.zoom.step);
$('#bFm').onclick = () => applyZoom(state.zoom - CONFIG.zoom.step);

/* --- 8.5 Historial del navegador (atrás / adelante) --- */
window.addEventListener('popstate', () => {
    const i = screenIndex(location.hash.slice(1));
    if (i >= 0 && i !== current) show(i, true, false);
});


/* =====================================================================
   9. SOF-IA: VOZ Y AVATAR (Web Speech API)
   - Lee la narración de la pantalla actual (o del popup / pestaña), frase por frase.
   - Muestra img/Avatar.png; si no existe, el SVG de respaldo.
   ===================================================================== */
const synth = window.speechSynthesis || null;

let audioPaused = false;
let talking = false;
let audioToken = 0; // sube con cada stopAudio(); evita que audios viejos afecten al nuevo

// Si la imagen carga, reemplaza al SVG; si falla, queda visible el SVG.
const avImg = $('#avImg');
avImg.onload = () => {
    avImg.hidden = false;
    $('#avSvg').style.display = 'none'
};
avImg.onerror = () => {
    avImg.hidden = true
};
if (avImg.complete && avImg.naturalWidth) {
    avImg.onload()
}


/** Cambia entre el estado de reposo y el de habla (imagen y animación de boca). */
function setTalking(on) {
    talking = on;
    avwrap.classList.toggle('talk', on);
    avImg.src = on ? CONFIG.avatar.talking : CONFIG.avatar.rest;
}

function setPauseButton(paused) {
    const btn = $('#aPause');
    btn.setAttribute('aria-pressed', String(paused));
    btn.textContent = paused ? '▶ Continuar' : '⏸ Pausa';
}

/** Elige la mejor voz en español disponible (es-CO > es-MX/US/419 > cualquier es). */
function pickVoice() {
    const voices = synth ? synth.getVoices() : [];
    const FEMALE = /female|mujer|paula|sofia|sabina|laura|helena/i;
    const tests = [
        v => /es-CO/i.test(v.lang) && FEMALE.test(v.name),
        v => /es-CO/i.test(v.lang),
        v => /es-(MX|US|419|AR|CL)/i.test(v.lang) && FEMALE.test(v.name),
        v => /es-(MX|US|419|AR|CL)/i.test(v.lang),
        v => /^es/i.test(v.lang) && FEMALE.test(v.name),
        v => /^es/i.test(v.lang)
    ];
    for (const test of tests) {
        const voice = voices.find(test);
        if (voice) return voice;
    }
    return null;
}

/** Detiene cualquier lectura en curso y restablece el avatar. */
function stopAudio() {
    audioToken++;
    if (synth) synth.cancel();
    audioPaused = false;
    setPauseButton(false);
    setTalking(false);
}

/** Lee un texto con Sof-IA (interrumpe la lectura anterior). */
function speak(text) {
    if (!text) return;
    if (!synth) {
        toast('Tu navegador no admite voz sintetizada. Lee la transcripción.');
        return;
    }
    stopAudio();
    const token = audioToken;
    const parts = text.match(/[^.!?]+[.!?]*/g) || [text];
    const voice = pickVoice();
    setTalking(true);

    parts.forEach((part, k) => {
        const u = new SpeechSynthesisUtterance(part.trim());
        u.lang = voice ? voice.lang : 'es-ES';
        if (voice) u.voice = voice;
        u.rate = CONFIG.voice.rate;
        u.onerror = e => { // el navegador bloqueó el audio automático
            if (e.error === 'not-allowed' && token === audioToken) {
                setTalking(false);
                toast('🔊 Pulsa «Escuchar» o «Iniciar» para activar el audio automático');
            }
        };
        u.onend = () => {
            if (token === audioToken && k === parts.length - 1) setTalking(false);
        };
        synth.speak(u);
    });
}

/** Lee la narración de la pantalla actual. */
function playAudio() {
    speak(SCREENS[current].narration);
}

$('#aPlay').onclick = playAudio;
$('#aStop').onclick = stopAudio;

$('#aPause').onclick = () => {
    if (!synth || !talking) return;
    if (!audioPaused) {
        synth.pause();
        audioPaused = true;
        avwrap.classList.remove('talk');
        avImg.src = CONFIG.avatar.rest;
    } else {
        synth.resume();
        audioPaused = false;
        avwrap.classList.add('talk');
        avImg.src = CONFIG.avatar.talking;
    }
    setPauseButton(audioPaused);
};

/** Activa o desactiva la reproducción automática en cada pantalla. */
function setAutoAudio(on) {
    state.auto = on;
    saveState();
    const btn = $('#aAuto');
    btn.setAttribute('aria-pressed', String(on));
    btn.textContent = on ? '🔊 Auto' : '🔇 Auto';
}

$('#aAuto').onclick = () => {
    const turnOn = state.auto === false;
    setAutoAudio(turnOn);
    if (turnOn) playAudio();
    else stopAudio();
};

// Los navegadores exigen un gesto del usuario antes de reproducir audio.
['pointerdown', 'keydown'].forEach(evt => document.addEventListener(evt, e => {
    if (userHasInteracted) return;
    userHasInteracted = true;
    if (current === 0 && state.auto !== false && !e.target.closest('#goStart, #bNext, #aStop, #aAuto')) playAudio();
}, {
    capture: true
}));

setTimeout(() => {
    if (!userHasInteracted && state.auto !== false) {
        toast('🔊 Toca la pantalla o pulsa «Iniciar» para activar el audio automático de Sof-IA');
    }
}, 1500);

window.addEventListener('beforeunload', () => {
    if (synth) synth.cancel();
});

const audioCloseModal = () => {
    const mt = document.querySelector("#mt");

    if (mt?.innerText === "Gobernanza adaptativa") {
        play_now(
            "Una vez comprendidos estos conceptos, podremos avanzar hacia los principios éticos que una organización debería adoptar y tener en cuenta para una correcta gobernanza de sistemas con inteligencia artificial. Dá click en el botón siguente, ¡VAMOS!"
        );
    }
};

document.querySelector("#cerraModal")
    ?.addEventListener("click", audioCloseModal);

/* =====================================================================
   10. ARRANQUE
   ===================================================================== */
$('#bNext').onclick = goNext;
$('#bPrev').onclick = () => show(current - 1);
$('#bMenu').onclick = () => show(screenIndex('menu'));

/** Pantalla inicial: la de la URL (#id) si está desbloqueada; si no, la portada. */
function startIndex() {
    const i = screenIndex(location.hash.slice(1));
    return i > 0 && canGo(i) ? i : 0;
}

applyZoom(state.zoom, false);
setAutoAudio(state.auto !== false);
show(startIndex(), false, false);