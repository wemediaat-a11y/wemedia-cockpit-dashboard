# WEMEDIA Cockpit

Modulares Agentur-Dashboard (Prototyp, statisch). Deploy auf Vercel: Framework „Other“, kein Build.


## Passwortschutz
Die ganze Seite ist über `middleware.js` (Vercel Routing Middleware) mit einem Team-Passwort geschützt – gleiches Passwort für Cockpit und CRM. Im Code liegt nur ein Hash.
Öffentlich bleiben nur: Terminbuchung im CRM (`?book=1`) und der Kunden-Fragebogen im Cockpit (`?onboarding=…`).
Abmelden: `/__logout`.
Passwort ändern: `node -e "const c=require(\"crypto\");const t=c.pbkdf2Sync(process.argv[1],\"wemedia-cockpit-v1\",100000,32,\"sha256\").toString(\"hex\");console.log(c.createHash(\"sha256\").update(t).digest(\"hex\"))" "NEUES-PASSWORT"` und den Wert bei `TOKEN_HASH` in **beiden** Repos eintragen.
