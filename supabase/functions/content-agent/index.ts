// WEMEDIA Content-Agent: Redaktionsplan + Grafik-Briefings mit Claude.
// Aufruf aus dem Cockpit (sb.functions.invoke('content-agent', {body})) – nur Admin/SMM.
//   {action:'plan',  client_id, month:'YYYY-MM', count?, notes?}  → {posts:[…], kampagnen:[…]}
//   {action:'monthbrief', client_id, month, notes?, urls?:[…]}      → {briefing:'…'}  (Diktat/Notizen + Website)
//   {action:'ci', client_id, url, name?, type?}                       → {colors:[{hex,name}], font_head, font_body}  (CI-PDF oder Logo-Bild)
//   {action:'camps', client_id, month, ad_budget, notes?}           → {kampagnen:[…]}
//   {action:'brief', post_id | (client_id + post:{…}), notes?}     → {briefing:{…}, caption?}
// Der API-Schlüssel liegt als Secret ANTHROPIC_API_KEY in Supabase, nie im Browser.
import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const MODEL = Deno.env.get("CONTENT_AGENT_MODEL") ?? "claude-sonnet-5-5";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

const TYPES = ["Feed", "Reel", "Carousel", "Story"];
const BRIEFING = {
  type: "object",
  properties: {
    ziel: { type: "string", description: "Ziel des Beitrags in einem Satz (Reichweite, Vertrauen, Anfragen …)" },
    motiv: { type: "string", description: "Konkretes Bildmotiv / Szene, so beschrieben, dass Fotograf:in oder Grafiker:in es sofort umsetzen kann" },
    produktion: { type: "array", items: { type: "string" }, description: "Was an Rohmaterial produziert werden muss (Shots, Clips, Varianten) – 2 bis 5 Punkte" },
    umsetzung: { type: "array", items: { type: "string" }, description: "Grafische Umsetzung nach Social CI (Farben, Schrift, Layout, Slide-/Frame-Aufbau) – 3 bis 6 Punkte" },
    text_auf_design: { type: "array", items: { type: "string" }, description: "Exakte Texte auf dem Creative: Headline (max. 6 Wörter), ggf. Slide-/Frame-Texte" },
    cta: { type: "string", description: "Handlungsaufforderung" },
    vermeiden: { type: "array", items: { type: "string" }, description: "Was auf keinen Fall passieren darf (aus Don'ts / Feedback)" },
  },
  required: ["ziel", "motiv", "produktion", "umsetzung", "text_auf_design", "cta"],
};
const POST = {
  type: "object",
  properties: {
    date: { type: "string", description: "Veröffentlichungsdatum YYYY-MM-DD im gewünschten Monat" },
    time: { type: "string", description: "Empfohlene Uhrzeit HH:MM" },
    type: { type: "string", enum: TYPES },
    pillar: { type: "string", description: "Content-Säule aus dem Social CI" },
    title: { type: "string", description: "Arbeitstitel, max. 60 Zeichen, ohne Format-Präfix" },
    idea: { type: "string", description: "Die Idee in 1–2 Sätzen – warum das für diese Marke funktioniert" },
    caption: { type: "string", description: "Fertige Caption: Hook in Zeile 1 → Nutzen → CTA. Tonalität laut Social CI." },
    hashtags: { type: "string", description: "5–10 Hashtags, mit # und Leerzeichen getrennt" },
  },
  required: ["date", "type", "pillar", "title", "idea", "caption", "hashtags"],
};
const KAMPAGNE = {
  type: "object",
  properties: {
    name: { type: "string", description: "Kurzer Kampagnenname, z. B. „Probetraining Dezember“" },
    ziel: { type: "string", enum: ["Leads", "Termine", "Reichweite", "Traffic", "Verkäufe"] },
    zielgruppe: { type: "string", description: "Zielgruppe konkret: Ort/Umkreis, Alter, Interessen" },
    budget: { type: "number", description: "Gesamtbudget in Euro für diese Kampagne" },
    start: { type: "string", description: "Start YYYY-MM-DD" },
    end: { type: "string", description: "Ende YYYY-MM-DD" },
    idee: { type: "string", description: "Angebot/Hook der Kampagne in 1–2 Sätzen" },
    creatives: {
      type: "array",
      description: "1–3 Werbemittel, die die Grafik gestalten muss",
      items: {
        type: "object",
        properties: {
          format: { type: "string", enum: TYPES },
          titel: { type: "string", description: "Arbeitstitel des Werbemittels" },
          idee: { type: "string", description: "Was zu sehen ist + Kernaussage" },
          text: { type: "string", description: "Primärtext der Anzeige (Hook → Nutzen → CTA)" },
        },
        required: ["format", "titel", "idee", "text"],
      },
    },
  },
  required: ["name", "ziel", "zielgruppe", "budget", "start", "end", "idee", "creatives"],
};
const TOOLS: Record<string, unknown> = {
  plan: {
    name: "redaktionsplan",
    description: "Gibt den fertigen Redaktionsplan für den Monat zurück.",
    input_schema: {
      type: "object",
      properties: {
        strategie: { type: "string", description: "2–3 Sätze: roter Faden des Monats" },
        posts: { type: "array", items: POST },
        kampagnen: { type: "array", items: KAMPAGNE, description: "0–2 Meta-Kampagnen passend zum Plan; leer, wenn kein Werbebudget vorgesehen ist" },
      },
      required: ["strategie", "posts", "kampagnen"],
    },
  },
  camps: {
    name: "kampagnen",
    description: "Gibt die Meta-Kampagnen für den Monat zurück.",
    input_schema: {
      type: "object",
      properties: { kampagnen: { type: "array", items: KAMPAGNE, minItems: 1, maxItems: 2 } },
      required: ["kampagnen"],
    },
  },
  ci: {
    name: "markenwerte",
    description: "Gibt die erkannten Markenfarben und Schriften zurück.",
    input_schema: {
      type: "object",
      properties: {
        colors: { type: "array", maxItems: 6, items: { type: "object", properties: { hex: { type: "string", description: "#RRGGBB" }, name: { type: "string", description: "Bezeichnung laut Dokument oder Rolle (Primär, Sekundär, Akzent, Hintergrund …)" } }, required: ["hex"] }, description: "Markenfarben, wichtigste zuerst (Hauptfarbe zuerst). Keine reinen Graustufen außer sie sind ausdrücklich Markenfarben." },
        font_head: { type: "string", description: "Schrift für Headlines (Familienname, z. B. Montserrat) oder leer" },
        font_body: { type: "string", description: "Schrift für Fließtext oder leer" },
        note: { type: "string", description: "Kurzer Hinweis, falls unsicher" },
      },
      required: ["colors"],
    },
  },
  monthbrief: {
    name: "monatsbriefing",
    description: "Gibt das aufbereitete Monats-Briefing zurück.",
    input_schema: {
      type: "object",
      properties: {
        briefing: { type: "string", description: "Fertiges Monats-Briefing als kurzer, gegliederter Text (Abschnitte: Termine & Aktionen mit Datum, Themen/Neuigkeiten, Ziele, Material, Offene Fragen). Nur Fakten aus den Quellen, nichts erfinden." },
      },
      required: ["briefing"],
    },
  },
  brief: {
    name: "briefing",
    description: "Gibt das Grafik-/Produktions-Briefing für den Beitrag zurück.",
    input_schema: {
      type: "object",
      properties: {
        briefing: BRIEFING,
        caption: { type: "string", description: "Verbesserte Caption, nur falls die bestehende nicht zum Social CI passt – sonst leer lassen" },
      },
      required: ["briefing"],
    },
  },
};

// Webseite holen und als reinen Text zurückgeben (für das Monats-Briefing)
async function pageText(url: string): Promise<string> {
  if (!/^https?:\/\//i.test(url)) return "";
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 12000);
  try {
    const r = await fetch(url, { signal: ctl.signal, redirect: "follow", headers: { "User-Agent": "Mozilla/5.0 (WEMEDIA Cockpit Content-Agent)", "Accept-Language": "de-AT,de;q=0.9" } });
    if (!r.ok) return `[${url}: HTTP ${r.status}]`;
    const html = (await r.text()).slice(0, 600000);
    const txt = html
      .replace(/<(script|style|noscript|svg|iframe)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article)[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;|&rsquo;|&lsquo;/g, "'").replace(/&ndash;|&#8211;/g, "–").replace(/&mdash;|&#8212;/g, "—").replace(/&auml;/g, "ä").replace(/&ouml;/g, "ö").replace(/&uuml;/g, "ü").replace(/&szlig;/g, "ß").replace(/&Auml;/g, "Ä").replace(/&Ouml;/g, "Ö").replace(/&Uuml;/g, "Ü").replace(/&euro;/g, "€")
      .replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").replace(/\n{2,}/g, "\n").trim();
    return txt.slice(0, 14000);
  } catch (e) {
    return `[${url}: nicht erreichbar – ${(e as Error).name}]`;
  } finally { clearTimeout(t); }
}

// Große/irrelevante Felder raus, damit der Kontext schlank bleibt.
function slim(v: unknown, depth = 0): unknown {
  if (depth > 6) return undefined;
  if (typeof v === "string") return v.startsWith("data:") ? "[Datei]" : v.length > 1500 ? v.slice(0, 1500) + " …" : v;
  if (Array.isArray(v)) return v.slice(0, 40).map((x) => slim(x, depth + 1));
  if (v && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      if (["data", "url", "path", "token", "fromDeal", "files", "_brief", "v", "at"].includes(k)) continue;
      const s = slim(x, depth + 1);
      if (s !== undefined && s !== "" && !(Array.isArray(s) && !s.length)) o[k] = s;
    }
    return o;
  }
  return v;
}

const SYSTEM = `Du bist der Content-Agent der Social-Media-Agentur WEMEDIA in Wien.
Du planst Instagram-/Facebook-Content für Kund:innen und schreibst Briefings, mit denen der Grafiker (Artur) und das Content-Team ohne Rückfragen produzieren können.
Regeln:
- Halte dich strikt an Markenprofil und Social CI (Farben, Schriften, Bildsprache, Tonalität, Do's & Don'ts) und an das gelernte Kundenfeedback.
- Schreibe auf Deutsch (Österreich), Anrede laut Social CI (Du/Sie).
- Jede Idee muss konkret und für genau diese Marke sein – keine generischen Floskeln, keine erfundenen Fakten, Preise oder Aktionen. Wenn ein Detail fehlt, formuliere es als Platzhalter in [eckigen Klammern].
- Formate: Feed 1080×1350, Carousel 1080×1350 (5–7 Slides), Reel/Story 1080×1920.
- Abwechslung: Content-Säulen und Formate mischen; mindestens ein Drittel Reels, wenn die Marke Video zulässt.`;

async function claude(tool: { name: string }, user: string | unknown[], maxTokens: number) {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("ANTHROPIC_API_KEY fehlt in den Supabase-Secrets");
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system: SYSTEM,
      tools: [tool],
      tool_choice: { type: "auto" },
      messages: [{ role: "user", content: typeof user === "string"
        ? `${user}\n\nGib das Ergebnis ausschließlich über das Tool „${tool.name}“ zurück.`
        : [...user, { type: "text", text: `Gib das Ergebnis ausschließlich über das Tool „${tool.name}“ zurück.` }] }],
    }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error("Claude: " + (j?.error?.message ?? r.status));
  if (j.stop_reason === "max_tokens") throw new Error("Die Antwort war zu lang – bitte weniger Beiträge auf einmal planen.");
  const use = (j.content ?? []).find((c: { type: string }) => c.type === "tool_use");
  if (!use) throw new Error("Claude hat kein Ergebnis geliefert");
  return { out: use.input, usage: j.usage };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const auth = req.headers.get("Authorization") ?? "";
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
    });
    const { data: { user } } = await sb.auth.getUser(auth.replace(/^Bearer\s+/i, ""));
    if (!user) return json({ error: "Nicht angemeldet" }, 401);
    const { data: prof } = await sb.from("profiles").select("role,name").eq("id", user.id).maybeSingle();
    if (!prof || !["admin", "smm"].includes(prof.role)) return json({ error: "Nur Admin und Social Media" }, 403);

    const body = await req.json();
    const action = body.action;
    if (!TOOLS[action]) return json({ error: "Unbekannte Aktion" }, 400);

    let clientId = body.client_id;
    let post: Record<string, unknown> | null = null;
    if (action === "brief" && body.post && typeof body.post === "object") {
      post = { id: body.post.id ?? null, client_id: clientId, data: body.post };
    } else if (action === "brief") {
      const { data: p } = await sb.from("posts").select("id,client_id,status,data").eq("id", body.post_id).maybeSingle();
      if (!p) return json({ error: "Beitrag nicht gefunden" }, 404);
      post = p;
      clientId = p.client_id;
    }
    const [{ data: client }, { data: brand }, { data: posts }] = await Promise.all([
      sb.from("clients").select("id,name,data").eq("id", clientId).maybeSingle(),
      sb.from("brands").select("data").eq("client_id", clientId).maybeSingle(),
      sb.from("posts").select("id,status,data").eq("client_id", clientId).order("id", { ascending: false }).limit(60),
    ]);
    if (!client) return json({ error: "Kunde nicht gefunden" }, 404);

    const ctx = {
      kunde: { name: client.name, ...(slim(client.data) as object) },
      markenprofil_und_social_ci: slim(brand?.data ?? {}),
      bisherige_beitraege: (posts ?? []).map((p) => {
        const d = p.data as Record<string, unknown>;
        return { datum: d.date, format: d.type, titel: d.title, status: p.status };
      }),
    };
    const ctxText = "KONTEXT (JSON):\n" + JSON.stringify(ctx).slice(0, 60000);

    if (action === "plan") {
      const month = String(body.month ?? "").match(/^\d{4}-\d{2}$/)?.[0];
      if (!month) return json({ error: "Monat fehlt" }, 400);
      const count = Math.max(1, Math.min(20, Number(body.count) || 8));
      const taken = (posts ?? []).map((p) => (p.data as { date?: string }).date).filter((d) => d?.startsWith(month));
      const prompt = `${ctxText}

AUFGABE: Erstelle den Redaktionsplan für ${client.name} für ${month} mit genau ${count} Beiträgen.
- Termine gleichmäßig über den Monat verteilen, nur Daten in ${month}${taken.length ? `, nicht an diesen schon belegten Tagen: ${taken.join(", ")}` : ""}.
- Keine Themen wiederholen, die schon in den bisherigen Beiträgen vorkommen.
- Saisonale Anlässe in Österreich in diesem Monat nutzen, wenn sie zur Marke passen.
- Pro Beitrag: Idee, fertige Caption und Hashtags (das Grafik-Briefing folgt separat).
- Kampagnen: ${Number(body.ad_budget) > 0 ? `Werbebudget für diesen Monat: ${Number(body.ad_budget)} €. Plane PFLICHT 1–2 Meta-Kampagnen, die das Monatsziel unterstützen, Summe der Budgets = ${Number(body.ad_budget)} €, Laufzeit innerhalb von ${month}.` : "Wenn im Kontext oder in den Hinweisen ein Werbebudget steht, plane 1–2 Meta-Kampagnen (Summe ≤ Budget). Ohne Werbebudget: kampagnen = []."}
- Material vom Kunden (Fotos, Drive-Links) nach Möglichkeit konkret den Beiträgen zuordnen und in der Idee nennen.${body.notes ? `\nHINWEISE VOM SOCIAL MEDIA MANAGEMENT: ${String(body.notes).slice(0, 2000)}` : ""}`;
      const { out, usage } = await claude(TOOLS.plan as { name: string }, prompt, 16000);
      let raw = out.posts ?? [];
      if (typeof raw === "string") { try { raw = JSON.parse(raw); } catch { raw = []; } }
      if (!Array.isArray(raw)) raw = [];
      const posts2 = raw.filter((p: { date?: string }) => typeof p === "object" && p && String(p.date ?? "").startsWith(month)).slice(0, count);
      if (!posts2.length) return json({ error: "Der Agent hat keinen gültigen Plan geliefert – bitte nochmal versuchen.", debug: JSON.stringify(out).slice(0, 1500) }, 502);
      await sb.from("events").insert({ type: "agent.plan", client_id: clientId, payload: { month, count: posts2.length, by: prof.name, usage } });
      let kamp = out.kampagnen ?? [];
      if (typeof kamp === "string") { try { kamp = JSON.parse(kamp); } catch { kamp = []; } }
      if (!Array.isArray(kamp)) kamp = [];
      return json({ strategie: out.strategie ?? "", posts: posts2, kampagnen: kamp.slice(0, 3), model: MODEL });
    }

    if (action === "ci") {
      const url = String(body.url ?? "");
      if (!url.startsWith(Deno.env.get("SUPABASE_URL") + "/storage/v1/object/sign/brand-files/")) return json({ error: "Nur Dateien aus dem Cockpit-Speicher" }, 400);
      const r = await fetch(url);
      if (!r.ok) return json({ error: "Datei nicht lesbar (" + r.status + ")" }, 400);
      const type = (r.headers.get("content-type") || body.type || "").split(";")[0];
      const buf = new Uint8Array(await r.arrayBuffer());
      if (buf.length > 25 * 1024 * 1024) return json({ error: "Datei zu groß (max. 25 MB)" }, 400);
      let bin = ""; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      const b64 = btoa(bin);
      const isPdf = type === "application/pdf" || /\.pdf$/i.test(String(body.name ?? ""));
      const media = isPdf ? "application/pdf" : (/png/.test(type) ? "image/png" : /webp/.test(type) ? "image/webp" : "image/jpeg");
      const block = isPdf ? { type: "document", source: { type: "base64", media_type: media, data: b64 } } : { type: "image", source: { type: "base64", media_type: media, data: b64 } };
      const { out, usage } = await claude(TOOLS.ci as { name: string }, [block, { type: "text", text: `Das ist ${isPdf ? "das CI/CD-Manual" : "das Logo"} von ${client.name}. Lies die Markenfarben (exakte Hex-Codes; bei CMYK/RGB-Angaben in Hex umrechnen) und die Hausschriften aus. Nur was im Dokument steht bzw. im Logo zu sehen ist – nichts erfinden.` }], 4000);
      await sb.from("events").insert({ type: "agent.ci", client_id: clientId, payload: { by: prof.name, usage } });
      const colors = (Array.isArray(out.colors) ? out.colors : []).map((c: { hex?: string; name?: string }) => ({ hex: String(c.hex ?? "").trim(), name: c.name ?? "" })).filter((c: { hex: string }) => /^#?[0-9a-f]{6}$/i.test(c.hex)).map((c: { hex: string; name: string }) => ({ ...c, hex: (c.hex.startsWith("#") ? c.hex : "#" + c.hex).toLowerCase() }));
      return json({ colors, font_head: out.font_head || "", font_body: out.font_body || "", note: out.note || "", model: MODEL });
    }

    if (action === "monthbrief") {
      const month = String(body.month ?? "").match(/^\d{4}-\d{2}$/)?.[0] ?? "";
      const urls: string[] = (Array.isArray(body.urls) ? body.urls : []).map(String).filter((u: string) => /^https?:\/\//i.test(u)).slice(0, 5);
      const pages = await Promise.all(urls.map(async (u) => `QUELLE ${u}:\n${await pageText(u)}`));
      const notes = String(body.notes ?? "").slice(0, 6000);
      if (!notes.trim() && !pages.length) return json({ error: "Bitte etwas eintippen/einsprechen oder eine Website hinterlegen." }, 400);
      const prompt = `${ctxText}

AUFGABE: Erstelle das Monats-Briefing für ${client.name}${month ? ` für ${month}` : ""}.
QUELLEN:
1) Notizen/Diktat vom Social Media Management (kann unsauber diktiert sein – Sinn erfassen, nichts weglassen):
${notes || "(keine)"}

2) Inhalte von der Website des Kunden:
${pages.join("\n\n") || "(keine)"}

REGELN:
- Übernimm alle Termine, Veranstaltungen, Kurse, Aktionen und Neuigkeiten${month ? ` aus ${month} (und kurz danach, falls für die Bewerbung relevant)` : ""} mit Datum, Uhrzeit, Ort und Link, wenn vorhanden.
- Alles aus den Notizen kommt ins Briefing, auch wenn es nicht auf der Website steht.
- Nichts erfinden. Unklare Punkte unter „Offene Fragen“ sammeln.
- Kurz und gegliedert, deutsch, als Fließtext mit Zwischenüberschriften und Spiegelstrichen.`;
      const { out, usage } = await claude(TOOLS.monthbrief as { name: string }, prompt, 8000);
      await sb.from("events").insert({ type: "agent.monthbrief", client_id: clientId, payload: { month, urls, by: prof.name, usage } });
      return json({ briefing: String(out.briefing ?? ""), sources: urls, model: MODEL });
    }

    if (action === "camps") {
      const month = String(body.month ?? "").match(/^\d{4}-\d{2}$/)?.[0];
      const budget = Number(body.ad_budget) || 0;
      if (!month || budget <= 0) return json({ kampagnen: [] });
      const prompt = `${ctxText}

AUFGABE: Plane 1–2 Meta-Kampagnen (Facebook/Instagram) für ${client.name} im ${month}.
- Werbebudget für den Monat: ${budget} € – die Summe der Kampagnen-Budgets ist genau ${budget} €.
- Laufzeit innerhalb von ${month}; Ziel passend zum Kundenziel (z. B. Leads/Termine statt nur Reichweite).
- Zielgruppe konkret (Ort/Umkreis, Alter, Interessen), Angebot/Hook ohne erfundene Preise – fehlende Details als [Platzhalter].
- Pro Kampagne 1–3 Werbemittel mit Format, Arbeitstitel, Bildidee und Primärtext.${body.notes ? `\nHINWEISE: ${String(body.notes).slice(0, 2000)}` : ""}`;
      const { out, usage } = await claude(TOOLS.camps as { name: string }, prompt, 10000);
      let kamp = out.kampagnen ?? [];
      if (typeof kamp === "string") { try { kamp = JSON.parse(kamp); } catch { kamp = []; } }
      await sb.from("events").insert({ type: "agent.camps", client_id: clientId, payload: { month, by: prof.name, usage } });
      return json({ kampagnen: Array.isArray(kamp) ? kamp.slice(0, 2) : [], model: MODEL });
    }

    const d = post!.data as Record<string, unknown>;
    const feedback = ((d.comments as { who: string; text: string }[]) ?? []).map((c) => `${c.who}: ${c.text}`);
    const prompt = `${ctxText}

BEITRAG: ${JSON.stringify({ datum: d.date, format: d.type, plattform: d.pf, titel: d.title, idee: d.idea, saeule: d.pillar, caption: d.caption, hashtags: d.hashtags, kommentare: feedback })}

AUFGABE: Schreibe das Grafik-/Produktions-Briefing für diesen Beitrag. Kundenkommentare unbedingt einarbeiten.${body.notes ? `\nHINWEISE VOM SOCIAL MEDIA MANAGEMENT: ${String(body.notes).slice(0, 2000)}` : ""}`;
    const { out, usage } = await claude(TOOLS.brief as { name: string }, prompt, 8000);
    await sb.from("events").insert({ type: "agent.brief", client_id: clientId, payload: { post: post!.id, by: prof.name, usage } });
    let br = out.briefing;
    if (typeof br === "string") { try { br = JSON.parse(br); } catch { /* bleibt Text */ } }
    return json({ briefing: br, caption: out.caption || null, model: MODEL });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
