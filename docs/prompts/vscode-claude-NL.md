# StageGremlin — startprompt voor Claude Code (VS Code)

Plak alles onder de lijn in Claude Code, met de map StageGremlin open in VS Code.

---

Je werkt aan **StageGremlin**, een audio-cueplayer in de stijl van QLab voor Windows. Ik (Ruben) gebruik hem voor de
klank op de shows van mijn school (schoolfeest). Eén stereosignaal gaat via USB naar een Allen & Heath Qu-24-mengtafel;
GO is de spatiebalk van de laptop. Het is een Tauri 2-app: audio-engine in Rust (kira) + UI in React/TypeScript.
Repo: `RareGoudvis/StageGremlin` (publiek, AGPL-3.0).

**Lees eerst deze bestanden, in deze volgorde, voor je iets verandert:**
1. `CLAUDE.md` — opbouw, regels, status, gekende beperkingen.
2. `docs/brief.md` — de volledige v1-specificatie (bij twijfel tussen code en brief wint de brief; vraag het me voor je van richting verandert).
3. `docs/ipc.md` — alle Tauri-commando's en events tussen UI en Rust.
4. `docs/ui-v2.md` + `docs/mockups/*.dc.html` — de goedgekeurde, nog NIET gebouwde opgeruimde UI (de volgende grote taak).
5. `docs/TESTING.md` — het testplan voor Windows.

**Zo werk ik (volg dit aub):**
- Ik stuur en lees code, maar schrijf zelf geen moderne syntax. Leg wijzigingen uit in gewone woorden, houd de code
  eenvoudig, zet in commentaar *waarom*, liever kleine bestanden. Korte antwoorden, geen lange samenvattingen.
- Antwoord in het Nederlands. De UI van de app blijft **Engels én Nederlands** (`src/i18n.ts`): elk nieuw label
  krijgt een EN- en een NL-tekst.
- Commit gerust naar `main` met duidelijke berichten. **Start nooit een build tenzij ik "build" zeg.** Een build
  gebeurt lokaal: push `main`, dan bouwt `scripts/release.ps1` de portable zip + installer en maakt een GitHub
  Release met `gh`. Ik wil veel fixes in één build bundelen. Gebruik GitHub Actions niet voor builds (enkel als reserve).
- Voor elke commit moeten `cargo test -p cueplay-engine`, `cargo clippy -p stagegremlin` en `npm run build` slagen.
- Blijf af van de Windows-volumecode van de achtergrondspeler (`src-tauri/src/background/session_volume_win.rs`),
  tenzij de taak daarover gaat; die is gevoelig.
- De app heet **StageGremlin** (één woord), showbestanden zijn **.sg** (oude `.cueplay` openen nog). De interne
  crate `cueplay-engine` houdt haar naam.

**Huidige stand (26 okt 2026):**
- v0.1.0 build 7 is getest op Windows: de basis-afspeelfuncties werken.
- Sindsdien op `main`, nog niet gebouwd: rechtsklikmenu's in de eigen stijl (het menu van WebView2 zelf staat uit),
  een volledig instellingenscherm, aanpasbare toetsen in Run, Dumbo-modus (vereenvoudigd scherm voor een
  onervaren technieker), `.sg`-bestanden, kleinere download (geen ffprobe).

**Volgende taken, in volgorde — doe er één, toon het me, en ga dan verder:**
1. Bouw de UI om volgens `docs/ui-v2.md`: Bestand-menu op de shownaam, één knop `+ Toevoegen` met het
   toevoegvenster (bestanden / YouTube & lijsten / pad / sectie), linkerbalk Cues · Pads · Media, één werkbalk +
   Weergave-menu, selectiebalk bij meerdere geselecteerde cues, inspector met tabbladen Basis · Klank · Timing ·
   Notities, instellingen herschikt in Deze laptop / Deze show / Tools. Hergebruik bestaande componenten en logica;
   dit is een herschikking van de layout, geen herschrijving.
2. Wacht daarna op mijn testnotities uit `docs/TESTING.md` en los die op.

Lokaal starten: `npm install`, dan `npm run tauri dev`. Begin met de bestanden hierboven te lezen en vertel me in een
paar regels wat je begrepen hebt en wat je eerst gaat doen.
