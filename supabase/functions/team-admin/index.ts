// WEMEDIA team-admin: Logins für Team und Kunden verwalten – nur für Admins.
//   {action:'list'}                          → {users:[{email, uid, login, last}]}   (zu jeder Einladung)
//   {action:'set_password', email, password} → legt den Login an (falls noch keiner existiert) oder setzt das Passwort neu
//   {action:'set_email', email, new_email}   → ändert die E-Mail in Einladung, Login und Profil
import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const mailOk = (m: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m);

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
    if (me?.role !== "admin") return json({ error: "Nur für Admins" }, 403);

    const body = await req.json();
    const all: { id: string; email?: string; last_sign_in_at?: string | null }[] = [];
    for (let page = 1; page < 20; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      if (error) throw error;
      all.push(...data.users);
      if (data.users.length < 200) break;
    }
    const byMail = (m: string) => all.find((u) => (u.email ?? "").toLowerCase() === m.toLowerCase());

    if (body.action === "list") {
      const { data: inv } = await admin.from("invites").select("email");
      return json({ users: (inv ?? []).map((i) => { const u = byMail(i.email); return { email: i.email, uid: u?.id ?? null, login: !!u, last: u?.last_sign_in_at ?? null }; }) });
    }

    const email = String(body.email ?? "").trim().toLowerCase();
    const { data: invite } = await admin.from("invites").select("email,name,role").eq("email", email).maybeSingle();
    if (!invite) return json({ error: "Keine Einladung für diese E-Mail" }, 404);

    if (body.action === "set_password") {
      const pw = String(body.password ?? "");
      if (pw.length < 10) return json({ error: "Passwort mindestens 10 Zeichen" }, 400);
      const u = byMail(email);
      if (u) {
        const { error } = await admin.auth.admin.updateUserById(u.id, { password: pw, email_confirm: true });
        if (error) throw error;
      } else {
        const { error } = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true });
        if (error) throw error;
      }
      await admin.from("events").insert({ type: "team.password", payload: { email, by: me.name } });
      return json({ ok: true, created: !u });
    }

    if (body.action === "set_email") {
      const nm = String(body.new_email ?? "").trim().toLowerCase();
      if (!mailOk(nm)) return json({ error: "E-Mail ungültig" }, 400);
      if (nm !== email && (byMail(nm) || (await admin.from("invites").select("email").eq("email", nm).maybeSingle()).data)) return json({ error: "Diese E-Mail ist schon vergeben" }, 409);
      const u = byMail(email);
      if (u) {
        const { error } = await admin.auth.admin.updateUserById(u.id, { email: nm, email_confirm: true });
        if (error) throw error;
        await admin.from("profiles").update({ email: nm }).eq("id", u.id);
      }
      const { error: e2 } = await admin.from("invites").update({ email: nm }).eq("email", email);
      if (e2) throw e2;
      await admin.from("events").insert({ type: "team.email", payload: { from: email, to: nm, by: me.name } });
      return json({ ok: true });
    }
    return json({ error: "Unbekannte Aktion" }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
