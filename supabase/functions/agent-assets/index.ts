// WEMEDIA agent-assets: Bild-Zugriff für Server-Agenten (Figma-Agent) ohne Browser.
// Auth: Header "x-agent-ticket" = gültiges Ticket aus agent_tickets (vom Agenten per SQL angelegt, 30 min gültig).
//   insert into agent_tickets(token) values (encode(gen_random_bytes(24),'hex')) returning token;
// verify_jwt ist aus, die Funktion prüft das Ticket selbst.
//   {action:'list',  client_id}                                  → {files:[{name,kind,type,path,url}]}   (signierte Links, 1 h)
//   {action:'clear', client_id}                                  → entfernt die bisherigen Board-Renderings aus brands.data.files
//   {action:'put',   client_id, source_url, name, format, node}  → lädt ein Figma-Rendering (www.figma.com/api/mcp/asset/…) in den Speicher
//                                                                  und hängt es als kind 'board' an brands.data.files an
import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST" }, 405);
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const ticket = req.headers.get("x-agent-ticket") ?? "";
  if (ticket.length < 32) return json({ error: "Nicht berechtigt" }, 401);
  const { data: tk } = await sb.from("agent_tickets").select("token").eq("token", ticket).gt("expires_at", new Date().toISOString()).maybeSingle();
  if (!tk) return json({ error: "Ticket ungültig oder abgelaufen" }, 401);

  try {
    const body = await req.json();
    const cid = Number(body.client_id);
    if (!cid) return json({ error: "client_id fehlt" }, 400);
    const { data: br } = await sb.from("brands").select("data").eq("client_id", cid).maybeSingle();
    if (!br) return json({ error: "Markenprofil fehlt" }, 404);
    const data = (br.data ?? {}) as Record<string, unknown>;
    const files = (Array.isArray(data.files) ? data.files : []) as Record<string, unknown>[];

    if (body.action === "list") {
      const list = files.filter((f) => typeof f.path === "string");
      const { data: signed } = await sb.storage.from("brand-files").createSignedUrls(list.map((f) => f.path as string), 3600);
      const url = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
      return json({ files: list.map((f) => ({ name: f.name, kind: f.kind, type: f.type, path: f.path, url: url.get(f.path as string) ?? null })) });
    }

    if (body.action === "clear") {
      const keep = files.filter((f) => f.kind !== "board");
      await sb.from("brands").update({ data: { ...data, files: keep }, updated_at: new Date().toISOString() }).eq("client_id", cid);
      return json({ removed: files.length - keep.length });
    }

    if (body.action === "put") {
      const src = String(body.source_url ?? "");
      if (!src.startsWith("https://www.figma.com/api/mcp/asset/")) return json({ error: "Nur Figma-Renderings" }, 400);
      const r = await fetch(src);
      if (!r.ok) return json({ error: "Rendering nicht ladbar (" + r.status + ")" }, 400);
      const type = (r.headers.get("content-type") || "image/png").split(";")[0];
      const buf = new Uint8Array(await r.arrayBuffer());
      if (buf.length > 12 * 1024 * 1024) return json({ error: "Bild zu groß" }, 400);
      const node = String(body.node ?? Date.now()).replace(/[^0-9a-z]+/gi, "-");
      const path = `${cid}/board/${node}.${type.includes("jpeg") ? "jpg" : "png"}`;
      const up = await sb.storage.from("brand-files").upload(path, buf, { contentType: type, upsert: true });
      if (up.error) return json({ error: up.error.message }, 500);
      const entry = { id: Date.now(), kind: "board", name: String(body.name ?? "Post").slice(0, 80), format: String(body.format ?? "Feed"), figmaNode: String(body.node ?? ""), path, type, size: buf.length, by: "Figma-Agent", at: new Date().toISOString().slice(0, 10) };
      const next = files.filter((f) => !(f.kind === "board" && f.path === path)).concat([entry]);
      await sb.from("brands").update({ data: { ...data, files: next }, updated_at: new Date().toISOString() }).eq("client_id", cid);
      await sb.from("events").insert({ type: "agent.board", client_id: cid, payload: { name: entry.name, path } });
      return json({ ok: true, path });
    }
    return json({ error: "Unbekannte Aktion" }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
