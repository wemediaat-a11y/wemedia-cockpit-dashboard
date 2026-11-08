// WEMEDIA figma-render: holt die fertige Gestaltung eines Beitrags aus Figma ins Cockpit.
//   {client_id, post_id, url}  url = Figma-Link mit node-id (Frame oder Section)
//   → {paths:[…]}  PNG(s) im Speicher brand-files/<client>/creative/…  (Section = jede Seite/Slide einzeln, von links nach rechts)
// Braucht das Secret FIGMA_TOKEN (Figma → Settings → Security → Personal access token, Scope „File content: read“).
import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const auth = req.headers.get("Authorization") ?? "";
    const url = Deno.env.get("SUPABASE_URL")!;
    const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const { data: { user } } = await asUser.auth.getUser(auth.replace(/^Bearer\s+/i, ""));
    if (!user) return json({ error: "Nicht angemeldet" }, 401);
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: me } = await admin.from("profiles").select("role,name").eq("id", user.id).maybeSingle();
    if (!me || !["admin", "smm", "grafik"].includes(me.role)) return json({ error: "Nur Team" }, 403);
    const token = Deno.env.get("FIGMA_TOKEN");
    if (!token) return json({ error: "Figma-Verbindung fehlt noch (FIGMA_TOKEN) – bitte die Gestaltung als PNG hochladen.", code: "no_token" }, 400);

    const body = await req.json();
    const cid = Number(body.client_id), pid = String(body.post_id ?? "x").replace(/[^0-9a-z]/gi, "");
    const link = String(body.url ?? "");
    const key = link.match(/figma\.com\/(?:design|file|proto)\/([A-Za-z0-9]+)/)?.[1];
    const node = (link.match(/[?&]node-id=([0-9]+[-:][0-9]+)/)?.[1] ?? "").replace("-", ":");
    if (!cid || !key || !node) return json({ error: "Bitte einen Figma-Link mit Frame einfügen (Rechtsklick auf den Frame → Copy link)." }, 400);
    const H = { "X-Figma-Token": token };

    // Section/Group → jede enthaltene Seite einzeln (Carousel), sonst der Frame selbst
    const meta = await fetch(`https://api.figma.com/v1/files/${key}/nodes?ids=${encodeURIComponent(node)}&depth=1`, { headers: H });
    if (!meta.ok) return json({ error: `Figma: ${meta.status} – ist die Datei für den Token-Account freigegeben?` }, 400);
    const doc = (await meta.json()).nodes?.[node]?.document;
    if (!doc) return json({ error: "Frame nicht gefunden" }, 404);
    let ids = [node];
    if (["SECTION", "GROUP", "CANVAS"].includes(doc.type) || (doc.type === "FRAME" && (doc.children ?? []).length > 1 && (doc.children ?? []).every((c: { type: string }) => c.type === "FRAME"))) {
      const kids = (doc.children ?? []).filter((c: { type: string; visible?: boolean }) => ["FRAME", "COMPONENT", "INSTANCE"].includes(c.type) && c.visible !== false)
        .sort((a: { absoluteBoundingBox?: { x: number; y: number } }, b: { absoluteBoundingBox?: { x: number; y: number } }) => (a.absoluteBoundingBox?.y ?? 0) - (b.absoluteBoundingBox?.y ?? 0) || (a.absoluteBoundingBox?.x ?? 0) - (b.absoluteBoundingBox?.x ?? 0));
      if (kids.length) ids = kids.slice(0, 12).map((c: { id: string }) => c.id);
    }
    const img = await fetch(`https://api.figma.com/v1/images/${key}?ids=${encodeURIComponent(ids.join(","))}&format=png&scale=1`, { headers: H });
    const ij = await img.json();
    if (!img.ok || ij.err) return json({ error: "Figma-Export: " + (ij.err ?? img.status) }, 400);
    const paths: string[] = [];
    for (const [i, id] of ids.entries()) {
      const src = ij.images?.[id];
      if (!src) continue;
      const r = await fetch(src);
      if (!r.ok) continue;
      const buf = new Uint8Array(await r.arrayBuffer());
      const path = `${cid}/creative/${pid}-${String(i + 1).padStart(2, "0")}-${id.replace(/[^0-9]+/g, "-")}.png`;
      const up = await admin.storage.from("brand-files").upload(path, buf, { contentType: "image/png", upsert: true });
      if (up.error) return json({ error: up.error.message }, 500);
      paths.push(path);
    }
    if (!paths.length) return json({ error: "Figma hat kein Bild geliefert" }, 502);
    await admin.from("events").insert({ type: "figma.render", client_id: cid, payload: { post: pid, n: paths.length, by: me.name } });
    const { data: signed } = await admin.storage.from("brand-files").createSignedUrls(paths, 60 * 60 * 24 * 7);
    return json({ paths, urls: (signed ?? []).map((s) => s.signedUrl) });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
