// WEMEDIA Figma-Agent – Board-Baukasten für use_figma (Figma MCP).
// Verwendung: Diesen Code als use_figma-Script schicken, davor EINE Zeile
//   const DATA = { client, branche, month, sci:{v,goal,colors:[{hex,role,use}],fonts:{head,body},layout,imagery,voice,pillars,sources}, logoSvg };
// und danach:
//   const msg = await build(DATA, null); return { msg, pages: figma.root.children.map(p => ({ id: p.id, name: p.name })) };
// Baut in einer LEEREN Datei: Seite „Social CI“ (Logo, Farben als Variablen, Typo, Formate, Regeln, Säulen),
// Seite „Vorlagen“ (Komponenten Feed/Story/Quadrat), Seite „Posts · <Monat>“.
// Ziel-Ordner: Team „WEMEDIA team“ (team::1417891021239599069), Projekt „SoMe-Posts und Kampagnen“ (projectId 550757880).
// Bestehende Kunden-Dateien NIE verändern – immer eine neue Datei „<Kunde> · Social“ anlegen.
const PANEL_WIDTH = 320;
const PLUGIN_ID = '7742eec0-d11c-46f9-b82d-3c693f6aa019';
function hexRgb(hex) {
    let h = String(hex || '').replace('#', '').trim();
    if (h.length === 3)
        h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h.slice(0, 6), 16);
    if (!Number.isFinite(n))
        return { r: 0.5, g: 0.5, b: 0.5 };
    return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}
const lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
const solid = (c, opacity = 1) => ({ type: 'SOLID', color: c, opacity });
const WHITE = { r: 1, g: 1, b: 1 };
const INK = { r: 0.08, g: 0.08, b: 0.09 };
const MUTED = { r: 0.42, g: 0.42, b: 0.45 };
const CARD = { r: 0.955, g: 0.955, b: 0.962 };
async function tryLoad(family, styles) {
    for (const style of styles) {
        try {
            await figma.loadFontAsync({ family, style });
            return { family, style };
        }
        catch (_e) {
        }
    }
    return null;
}
async function loadFonts(head, body) {
    const heavy = ['ExtraBold', 'Extra Bold', 'Bold', 'Black', 'Heavy', 'SemiBold', 'Semi Bold', 'Regular'];
    const H = (await tryLoad(head, heavy)) || (await tryLoad('Inter', ['Extra Bold', 'Bold']));
    const B = (await tryLoad(body, ['Regular', 'Book', 'Roman', 'Medium'])) || (await tryLoad('Inter', ['Regular']));
    const BS = (await tryLoad(body, ['SemiBold', 'Semi Bold', 'Medium', 'Bold'])) || (await tryLoad('Inter', ['Semi Bold']));
    return { H, B, BS, headOk: H.family === head, bodyOk: B.family === body };
}
function af(name, dir, gap, pad, fill = []) {
    const f = figma.createFrame();
    f.name = name;
    f.layoutMode = dir;
    f.itemSpacing = gap;
    f.paddingTop = f.paddingBottom = f.paddingLeft = f.paddingRight = pad;
    f.fills = fill;
    f.primaryAxisSizingMode = 'AUTO';
    f.counterAxisSizingMode = 'AUTO';
    return f;
}
function txt(chars, font, size, color, lineHeight) {
    const t = figma.createText();
    t.fontName = font;
    t.fontSize = size;
    if (lineHeight)
        t.lineHeight = { unit: 'PERCENT', value: lineHeight };
    t.characters = chars;
    t.fills = [solid(color)];
    return t;
}
function addFill(parent, child) {
    parent.appendChild(child);
    if ('layoutSizingHorizontal' in child) {
        child.layoutSizingHorizontal = 'FILL';
    }
    if (child.type === 'TEXT')
        child.textAutoResize = 'HEIGHT';
}
async function findOrCreatePage(name) {
    for (const p of figma.root.children) {
        if (p.name === name) {
            await p.loadAsync();
            return p;
        }
    }
    const p = figma.createPage();
    p.name = name;
    return p;
}
function removeOwned(page, key) {
    for (const n of page.children.slice()) {
        /* no plugin data via MCP */
    }
}
async function makeVariables(client, colors) {
    const name = client + ' · Social CI';
    const existing = (await figma.variables.getLocalVariableCollectionsAsync()).find((c) => c.name === name);
    const coll = existing || figma.variables.createVariableCollection(name);
    const modeId = coll.modes[0].modeId;
    const all = await figma.variables.getLocalVariablesAsync('COLOR');
    const out = [];
    for (const c of colors) {
        const vname = 'Farben/' + c.role;
        let v = all.find((x) => x.variableCollectionId === coll.id && x.name === vname);
        if (!v)
            v = figma.variables.createVariable(vname, coll, 'COLOR');
        const rgb = hexRgb(c.hex);
        v.setValueForMode(modeId, { r: rgb.r, g: rgb.g, b: rgb.b, a: 1 });
        v.description = c.use || '';
        out.push(v);
    }
    return out;
}
function boundFill(v, fallback) {
    const p = solid(fallback);
    return [v ? figma.variables.setBoundVariableForPaint(p, 'color', v) : p];
}
async function makeTextStyles(client, F) {
    const defs = [
        ['Headline XL', F.H, 96, 100],
        ['Headline', F.H, 64, 105],
        ['Subline', F.BS, 32, 125],
        ['Fließtext', F.B, 26, 140],
        ['Caption', F.BS, 20, 130],
    ];
    const existing = await figma.getLocalTextStylesAsync();
    const out = {};
    for (const [n, font, size, lh] of defs) {
        const full = client + '/' + n;
        const s = existing.find((x) => x.name === full) || figma.createTextStyle();
        s.name = full;
        s.fontName = font;
        s.fontSize = size;
        s.lineHeight = { unit: 'PERCENT', value: lh };
        out[n] = s;
    }
    return out;
}
function makeLogo(data, png) {
    if (data.logoSvg) {
        try {
            const n = figma.createNodeFromSvg(data.logoSvg);
            n.name = 'Logo';
            return n;
        }
        catch (_e) {
        }
    }
    if (png) {
        const r = figma.createRectangle();
        r.name = 'Logo';
        r.resize(png.w, png.h);
        r.fills = [{ type: 'IMAGE', imageHash: png.image.hash, scaleMode: 'FIT' }];
        return r;
    }
    return null;
}
function scaleTo(n, w) {
    if ('rescale' in n && n.width > 0)
        n.rescale(w / n.width);
}
function bullets(title, items, F) {
    const col = af(title, 'VERTICAL', 14, 28, [solid(CARD)]);
    col.cornerRadius = 20;
    col.appendChild(txt(title.toUpperCase(), F.BS, 13, MUTED));
    for (const it of items.slice(0, 14))
        addFill(col, txt('•  ' + it, F.B, 17, INK, 145));
    return col;
}
async function build(data, logoBytes) {
    const sci = data.sci;
    const client = String(data.client || 'Kunde').slice(0, 60);
    const colors = (sci.colors || []).slice(0, 8);
    if (!colors.length)
        throw new Error('Im Board-Code fehlen die Farben.');
    const F = await loadFonts(sci.fonts.head, sci.fonts.body);
    const vars = await makeVariables(client, colors);
    const styles = await makeTextStyles(client, F);
    let png = null;
    if (logoBytes && logoBytes.length) {
        const image = figma.createImage(logoBytes);
        const size = await image.getSizeAsync();
        png = { image, w: size.width, h: size.height };
    }
    const idx = (re) => colors.findIndex((c) => re.test(c.role));
    const iPrim = Math.max(0, idx(/Prim/));
    const iBg = idx(/Hintergrund/) >= 0 ? idx(/Hintergrund/) : colors.reduce((b, c, i) => (lum(hexRgb(c.hex)) > lum(hexRgb(colors[b].hex)) ? i : b), 0);
    const iText = colors.reduce((b, c, i) => (lum(hexRgb(c.hex)) < lum(hexRgb(colors[b].hex)) ? i : b), 0);
    const bgRgb = lum(hexRgb(colors[iBg].hex)) > 0.8 ? hexRgb(colors[iBg].hex) : WHITE;
    const bgVar = lum(hexRgb(colors[iBg].hex)) > 0.8 ? vars[iBg] : undefined;
    const textRgb = lum(hexRgb(colors[iText].hex)) < 0.3 ? hexRgb(colors[iText].hex) : INK;
    const textVar = lum(hexRgb(colors[iText].hex)) < 0.3 ? vars[iText] : undefined;
    const firstPage = figma.root.children[0];
    let ciPage;
    if (firstPage && firstPage.name !== 'Social CI' && !figma.root.children.some((p) => p.name === 'Social CI')) {
        await firstPage.loadAsync();
        if (firstPage.children.length === 0) {
            firstPage.name = 'Social CI';
            ciPage = firstPage;
        }
        else
            ciPage = await findOrCreatePage('Social CI');
    }
    else
        ciPage = await findOrCreatePage('Social CI');
    removeOwned(ciPage, 'ci');
    const W = 1440;
    const ci = af(client + ' · Social CI', 'VERTICAL', 56, 80, [solid(WHITE)]);
    ci.counterAxisSizingMode = 'FIXED';
    ci.resize(W, 100);
    ci.primaryAxisSizingMode = 'AUTO';
    ci.cornerRadius = 32;
    ciPage.appendChild(ci);
    const head = af('Kopf', 'HORIZONTAL', 48, 0);
    head.counterAxisAlignItems = 'CENTER';
    addFill(ci, head);
    const logo = makeLogo(data, png);
    if (logo) {
        scaleTo(logo, 340);
        head.appendChild(logo);
    }
    const ht = af('Titel', 'VERTICAL', 8, 0);
    head.appendChild(ht);
    ht.layoutGrow = 1;
    addFill(ht, txt('SOCIAL CI · VERSION ' + (sci.v || 1), F.BS, 14, hexRgb(colors[iPrim].hex)));
    addFill(ht, txt(client, F.H, 56, INK, 105));
    addFill(ht, txt((data.branche ? data.branche + ' · ' : '') + 'Gestaltungsregeln für alle Beiträge, Stories und Kampagnen' + (sci.goal ? ' · Ziel: ' + sci.goal : ''), F.B, 18, MUTED, 140));
    const section = (title) => {
        const s = af(title, 'VERTICAL', 20, 0);
        addFill(ci, s);
        addFill(s, txt(title, F.H, 30, INK));
        return s;
    };
    const sCol = section('Farben');
    const row = af('Farbfelder', 'HORIZONTAL', 16, 0);
    row.layoutWrap = 'WRAP';
    row.counterAxisSpacing = 16;
    addFill(sCol, row);
    colors.forEach((c, i) => {
        const card = af(c.role, 'VERTICAL', 0, 0, [solid(CARD)]);
        card.cornerRadius = 18;
        card.clipsContent = true;
        card.counterAxisSizingMode = 'FIXED';
        card.resize(304, 100);
        card.primaryAxisSizingMode = 'AUTO';
        const sw = figma.createRectangle();
        sw.name = 'Farbe';
        sw.resize(304, 150);
        sw.fills = boundFill(vars[i], hexRgb(c.hex));
        addFill(card, sw);
        const info = af('Info', 'VERTICAL', 4, 18);
        addFill(card, info);
        addFill(info, txt(c.role, F.BS, 18, INK));
        addFill(info, txt(String(c.hex).toUpperCase(), F.B, 15, MUTED));
        if (c.use)
            addFill(info, txt(c.use, F.B, 14, MUTED, 140));
        row.appendChild(card);
    });
    const sTyp = section('Typografie');
    const trow = af('Schriften', 'HORIZONTAL', 16, 0);
    addFill(sTyp, trow);
    const tc1 = af('Headline', 'VERTICAL', 10, 32, [solid(CARD)]);
    tc1.cornerRadius = 20;
    trow.appendChild(tc1);
    tc1.layoutGrow = 1;
    const hs = txt('Headline Aa', F.H, 64, INK, 105);
    await hs.setTextStyleIdAsync(styles['Headline'].id);
    addFill(tc1, hs);
    addFill(tc1, txt(F.H.family + ' ' + F.H.style + (F.headOk ? '' : ' (Ersatz – „' + sci.fonts.head + '“ ist auf diesem Rechner nicht installiert)'), F.B, 15, MUTED));
    const tc2 = af('Fließtext', 'VERTICAL', 10, 32, [solid(CARD)]);
    tc2.cornerRadius = 20;
    trow.appendChild(tc2);
    tc2.layoutGrow = 1;
    const bs = txt('Fließtext und Untertitel – gut lesbar, auch klein auf dem Handy.', F.B, 26, INK, 140);
    await bs.setTextStyleIdAsync(styles['Fließtext'].id);
    addFill(tc2, bs);
    addFill(tc2, txt(F.B.family + ' ' + F.B.style + (F.bodyOk ? '' : ' (Ersatz – „' + sci.fonts.body + '“ ist auf diesem Rechner nicht installiert)'), F.B, 15, MUTED));
    const sFmt = section('Formate');
    const frow = af('Formate', 'HORIZONTAL', 32, 0);
    frow.counterAxisAlignItems = 'MAX';
    addFill(sFmt, frow);
    const FORMATS = [['Feed / Carousel', 1080, 1350], ['Story / Reel', 1080, 1920], ['Quadrat (Ads)', 1080, 1080]];
    for (const [n, w, h] of FORMATS) {
        const cell = af(n, 'VERTICAL', 8, 0);
        cell.counterAxisAlignItems = 'CENTER';
        const r = figma.createRectangle();
        r.name = n;
        const k = 220 / 1920;
        r.resize(Math.round(w * k), Math.round(h * k));
        r.cornerRadius = 10;
        r.fills = [solid(CARD)];
        r.strokes = [solid(MUTED, 0.5)];
        r.dashPattern = [6, 4];
        cell.appendChild(r);
        cell.appendChild(txt(n, F.BS, 15, INK));
        cell.appendChild(txt(w + ' × ' + h, F.B, 14, MUTED));
        frow.appendChild(cell);
    }
    const sRules = section('Regeln');
    const rrow = af('Regeln', 'HORIZONTAL', 16, 0);
    rrow.counterAxisAlignItems = 'MIN';
    addFill(sRules, rrow);
    for (const [t, items] of [['Layout', sci.layout || []], ['Bildsprache', sci.imagery || []], ['Tonalität & Captions', sci.voice || []]]) {
        const b = bullets(t, items, F);
        rrow.appendChild(b);
        b.layoutGrow = 1;
        b.counterAxisSizingMode = 'FIXED';
    }
    if ((sci.pillars || []).length) {
        const sP = section('Content-Säulen');
        const prow = af('Säulen', 'HORIZONTAL', 16, 0);
        addFill(sP, prow);
        for (const p of sci.pillars.slice(0, 6)) {
            const c = af(p.t, 'VERTICAL', 6, 24, [solid(CARD)]);
            c.cornerRadius = 18;
            prow.appendChild(c);
            c.layoutGrow = 1;
            addFill(c, txt(p.t, F.BS, 18, INK));
            addFill(c, txt(p.s, F.B, 15, MUTED, 140));
        }
        if (sci.sources && sci.sources.length)
            addFill(sP, txt('Content-Quellen: ' + sci.sources.join(' · '), F.B, 15, MUTED));
    }
    const center = { x: 720, y: 200 };
    ci.x = Math.round(center.x - W / 2);
    ci.y = Math.round(center.y - 200);
    const tplPage = await findOrCreatePage('Vorlagen');
    removeOwned(tplPage, 'tpl');
    let x = 0;
    const comps = [];
    for (const [n, w, h] of FORMATS) {
        const c = figma.createComponent();
        c.name = 'Vorlage · ' + n;
        c.resize(w, h);
        c.fills = boundFill(bgVar, bgRgb);
        tplPage.appendChild(c);
        c.x = x;
        c.y = 0;
        x += w + 160;
        const m = Math.round(w * 0.07);
        const top = n.startsWith('Story') ? 250 : m;
        const bottom = n.startsWith('Story') ? 340 : m;
        const bar = figma.createRectangle();
        bar.name = 'Akzent';
        bar.resize(Math.round(w * 0.12), 14);
        bar.cornerRadius = 7;
        bar.fills = boundFill(vars[iPrim], hexRgb(colors[iPrim].hex));
        c.appendChild(bar);
        bar.x = m;
        bar.y = top + 40;
        const hl = txt('Headline mit\nhöchstens sechs Wörtern', F.H, n.startsWith('Quadrat') ? 80 : 92, textRgb, 100);
        await hl.setTextStyleIdAsync(styles['Headline XL'].id);
        hl.name = 'Headline';
        hl.fills = boundFill(textVar, textRgb);
        c.appendChild(hl);
        hl.textAutoResize = 'HEIGHT';
        hl.resize(w - 2 * m, hl.height);
        hl.x = m;
        hl.y = top + 90;
        const sl = txt('Subline: Nutzen in einem Satz', F.BS, 36, textRgb, 125);
        await sl.setTextStyleIdAsync(styles['Subline'].id);
        sl.name = 'Subline';
        sl.fills = boundFill(textVar, textRgb);
        c.appendChild(sl);
        sl.textAutoResize = 'HEIGHT';
        sl.resize(w - 2 * m, sl.height);
        sl.x = m;
        sl.y = hl.y + hl.height + 32;
        const ph = figma.createRectangle();
        ph.name = 'Bild / Video (ersetzen)';
        const phTop = sl.y + sl.height + 56;
        const phH = Math.max(120, h - bottom - phTop - 150);
        ph.resize(w - 2 * m, phH);
        ph.cornerRadius = 28;
        ph.fills = [solid(textRgb, 0.08)];
        c.appendChild(ph);
        ph.x = m;
        ph.y = phTop;
        const lg = logo ? logo.clone() : null;
        if (lg) {
            c.appendChild(lg);
            scaleTo(lg, Math.round(w * 0.24));
            lg.x = w - m - lg.width;
            lg.y = h - bottom - lg.height;
        }
        const sz = figma.createRectangle();
        sz.name = 'Safe Zone – vor Export ausblenden';
        sz.resize(w - 2 * m, h - top - bottom);
        sz.fills = [];
        sz.strokes = [solid({ r: 1, g: 0.2, b: 0.4 }, 0.8)];
        sz.strokeWeight = 3;
        sz.dashPattern = [16, 10];
        c.appendChild(sz);
        sz.x = m;
        sz.y = top;
        sz.locked = true;
        comps.push(c);
    }
    const month = data.month || '';
    const postPage = await findOrCreatePage('Posts' + (month ? ' · ' + month : ''));
    removeOwned(postPage, 'posts');
    const note = af('Hinweis', 'VERTICAL', 10, 40, [solid(CARD)]);
    note.cornerRadius = 24;
    note.counterAxisSizingMode = 'FIXED';
    note.resize(900, 100);
    note.primaryAxisSizingMode = 'AUTO';
    postPage.appendChild(note);
    addFill(note, txt('Posts' + (month ? ' · ' + month : ''), F.H, 40, INK));
    addFill(note, txt('Hier landen die Beiträge aus dem Redaktionsplan. Für jeden Beitrag eine Vorlage aus der Seite „Vorlagen“ einsetzen (Assets → Lokale Komponenten) und Inhalte laut Briefing ersetzen.', F.B, 20, MUTED, 145));
    await figma.setCurrentPageAsync(ciPage);
    figma.currentPage.selection = [ci];
    
    const warn = [!F.headOk ? sci.fonts.head : '', !F.bodyOk && sci.fonts.body !== sci.fonts.head ? sci.fonts.body : ''].filter(Boolean);
    return 'Board für ' + client + ' steht: Social CI, ' + vars.length + ' Farb-Variablen, 5 Textstile, ' + comps.length + ' Vorlagen.' + (warn.length ? ' Schrift fehlt auf diesem Rechner: ' + warn.join(', ') + ' – bitte installieren und Board neu bauen.' : '');
}
