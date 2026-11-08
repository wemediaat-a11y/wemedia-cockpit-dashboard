# WEMEDIA Social Design System – Regelwerk für den Figma-Agenten

Maßstab: das AFGM-Board von Camillo (Figma f06QjS0CjvKi8nS2ZiKXLm – **nur lesen, nie verändern**).
Referenz-Umsetzung v2: „AFGM · Social“ (Figma cGVSHwSVoVaNeeALJPOXdw) – Seiten *Social CI*, *Posts*, *Bausteine*, *Assets*.

Ziel: Jeder Kunde bekommt ein eigenes, modernes Social-Design auf diesem Niveau – nicht kopiert, sondern
aus seiner CI abgeleitet. Gleich bleiben Handwerk, Post-Typen und Qualitätscheck; individuell sind
Farbwelt, Markenelement, Stil, Logos, Bilder.

## 1. Ablauf pro Kunde
1. **Neue Datei** „<Kunde> · Social“ im Team-Ordner „SoMe-Posts und Kampagnen“ (projectId 550757880). Bestehende Dateien nie anfassen.
2. **Assets hochladen** (Seite *Assets*): alle Logos (SVG, alle Varianten: Farbe, Weiß, auf Akzent) und alle Onboarding-Fotos (`brands.data.files`, kind `assets`/`logo-*`).
   Weg: `upload_assets` → Upload-URLs; die Dateien lädt das eingeloggte Cockpit (`sb.storage.from('brand-files').download(path)`) und schickt sie per `multipart/form-data` (Feld `file`) an die URL. Antwort enthält `imageHash`.
3. **Bausteine** (Seite *Bausteine*): Farbvariablen, Textstile, Komponenten (s. 3.).
4. **Social CI** (Handbuch): 00 Titel · 01 Farben · 02 Typografie · 03 Formate & Raster · 04 Texte & Tonalität.
5. **Posts**: 6–8 Posts aus den Post-Typen (s. 5.), Inhalte aus Monats-Briefing/Website, Fotos thematisch zugeordnet.
6. **Qualitätscheck** (s. 6.), dann `brands.data.figma = {url, postsNode:<ID der Posts-Seite>, ciNode:<ID der Social-CI-Seite>, at, by}` setzen (Links im Cockpit öffnen direkt die Posts) und Figma-Aufgabe erledigen.

## 2. Farbwelt (aus 2–4 CI-Farben ableiten)
| Rolle | AFGM | Ableitung allgemein |
|---|---|---|
| Primär | Blau #0F4C73, Blau 2 #175C85, Blau 4 #508CA5 | CI-Hauptfarbe + 1 heller, 1 entsättigt |
| Tief | Tiefblau #0A3A58, Tiefblau 2 #072B42 | Primär −25 % / −40 % Helligkeit (Verläufe, dunkle Posts) |
| Akzent | Lime #C8D778, dunkel #B2C455, hell #EEF3D5 | auffälligste CI-Farbe; **ein Akzent-Element pro Post** |
| Sekundär | Aqua #A8EAEE, Aqua 2 #71A8C2, Aqua hell #E8F6F7, Sea #2A6B7C | Frische/Sublines/Labels |
| Neutral | Fließtext #50646E, Sand #CFD6DA, Sand hell #EDEFF1, Papier #F4F5F7, Weiß | kühl oder warm passend zur Primärfarbe |

Alle Farben als Variablen-Collection „<Kunde> · Farben“ (Gruppen Primär/Akzent/Sekundär/Neutral), Scopes setzen.

**Verläufe** (immer aus der Farbwelt):
- *Statement/Cover*: diagonal 5 Stopps Aqua → Aqua 2 → Blau 2 → Tiefblau → Tiefblau.
- *Angebot/Preis*: vertikal Blau → Tiefblau 2.
- *Foto oben + Text unten*: Overlay Tiefblau 55 % → 0 % (32 %) → 25 % (62 %) → Blau 100 % (100 %).
- *Foto rechts*: Overlay links→rechts Tiefblau 100 % bis 36 %, 55 % bei 62 %, 0 % am Rand + unten Tiefblau 2 0 → 100 %.
- *Story*: Tiefblau 60 % oben, transparent im Bildzentrum, 92–100 % unten.

## 3. Bausteine (Komponenten)
- **Logo/Farbe, Logo/Weiß, Logo/<Akzent-Variante>** aus den SVGs; immer 240 px breit, oben links bei 84/84.
- **Bildmarke** (Signet aus dem Logo) für Icons/Avatare.
- **Markenelement** – bei AFGM *Raster-Molekül*: 72-px-Grundraster (Linien weiß 50 %), radialer Fade als Maske, Knoten (27 px, Akzent + Weiß) mit Bindungen. Im Post 20–35 % Deckkraft, angeschnitten unten rechts. Für andere Kunden aus dem Logo ableiten (Form, Linie, Muster), gleiche Logik: Raster + Fade + wenige Akzentpunkte.
- **CTA-Button** (Varianten Akzent/Primär): Pill 92 px hoch, Text 32 Semi Bold, Pfeilkreis 72 px. Hug-Breite, Text als Komponenten-Property.
- **Label** (Akzent/Sekundär/Weiß): Pill, 26 Bold Versal +14 %, Padding 14/30.
- **Eyebrow** (Hell/Dunkel): Linie 56×3 + 26 Bold Versal +20 %.
- **Datum** (Glas): Primär 55 %, Rand weiß 35 %, Hintergrund-Blur 20, Radius 28; Tage 58 Semi Bold, Monat 28 Medium.
- **Chip** (Glas): weiß 8 %, Rand weiß 28 % 2 px, 29 Medium.

## 4. Typografie (1080er Posts)
Display 124/96 % −3,5 % · Headline 88/94 % −3 % · Headline S 72/94 % −2,5 % · Subline 38 Medium · Body 30/140 % ·
Eyebrow 26 Bold Versal +20 % · Label 26 Bold Versal +14 % · CTA 32 Semi Bold · Small 28 Medium.
Akzentfarbe auf das letzte Wort/die Pointe der Headline („Medizin **neu denken.**“). Ist die CI-Schrift in Figma nicht verfügbar, Ersatz (z. B. Inter für Inter Tight) im Handbuch nennen.

## 5. Post-Typen (je Monat mischen)
1. **Termin** – Foto oben (≈780 px) + Verlauf, Datum-Badge oben rechts, Label + Headline + Ort/Preis ab y≈600, CTA unten links, URL rechts.
2. **Fachbeitrag (hell)** – Papier, Logo Farbe, Label rechts oben, Bildkarte 912×520 r40, Eyebrow + Headline S (Stichwort in Akzent dunkel) + Body, Linie bei 1140, Meta + CTA Primär.
3. **Statement** – diagonaler Verlauf, Markenelement, Display-Headline, Fußzeile.
4. **Event/Kongress** – Foto rechts angeschnitten, Verlauf links/unten, Eyebrow Dunkel, Display + Subline, Ort + CTA.
5. **Seminar-Karte** – Foto oben, schwebende Primär-Karte mit Schatten (Label, Datum, Headline, Subline), unten Ort/Preis + CTA.
6. **Angebot/Preis** – vertikaler Verlauf, Markenelement, riesige Zahl (230 px) in Akzent, Headline, Glas-Chips, CTA.
7. **Carousel** – Cover (Verlauf, Kategorie, Display mit Akzent) + Slides („Schritt 01 von 03“, große Aussage, Subline, Fußzeile 01/03).
8. **Story** – Foto vollflächig, Verlauf, Logo bei y 250, Inhalt über der unteren Safe-Zone (340 px), CTA.

Regeln: Außenrand 84 px · ein CTA pro Post · nie zwei gleiche Farbwelten hintereinander · jeder dritte Post mit Foto ·
keine langen Texte im Bild · Akzentfarbe nie als Text auf Weiß (dafür „Akzent dunkel“).

## 6. Qualitätscheck (vor Abgabe, jeder Post)
Screenshot und prüfen: Text abgeschnitten/überlappend? Kontrast Text/Untergrund ≥ 4.5:1 (Verlauf verstärken)?
84-px-Rand eingehalten? Buttons in Hug-Breite, Pfeilkreis innen? Logo-Variante passend zum Untergrund?
Max. ein Akzent-Element? Fotos thematisch passend und nicht verpixelt? Erst dann freigeben.

## 7. Technik (use_figma)
Kein `setPluginData`, kein `createImageAsync`, kein `figma.notify`. Bilder nur über `upload_assets` + `imageHash`.
Positionen in Instanzen sind nicht überschreibbar → Layout über Auto-Layout oder gelöste Kopien.
Seitenwechsel nur mit `await figma.setCurrentPageAsync(page)`, eine Seite pro Aufruf.
