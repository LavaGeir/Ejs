// Importerer innebygd 'path' for trygg håndtering av filstier
const path = require('path'); // Brukes for å lage OS-uavhengige stier

// Importerer Express
const express = require('express'); // Rammeverk for HTTP-server og ruter

// Importerer SQLite3-driveren for Node.js
const sqlite3 = require('sqlite3').verbose(); // Gir tilgang til SQLite fra Node

// Importerer express-session for innlogging/økter
const session = require('express-session'); // Håndterer server-side sessions

// Importerer bcrypt for hashing av passord (saltet)
let bcrypt; // Definerer variabel for bcrypt
try { // Forsøker å bruke 'bcrypt' (native add-on)
  bcrypt = require('bcrypt'); // Laster bcrypt (anbefalt)
} catch (e) { // Hvis installasjonen av bcrypt feiler
  bcrypt = require('bcryptjs'); // Fallback: bcryptjs (ren JS-variant)
}

// Importerer uuid for å generere unike session-id-er
const { v4: uuidv4 } = require('uuid'); // Lager unike id-er for sessions

// Lager en ny Express-applikasjon
const app = express(); // Initialiserer Express-appen

// Setter portnummeret som serveren skal lytte på
const PORT = 3000; // Standard port for lokal utvikling

// Åpner/oppretter SQLite-databasefilen 'geir.db' i prosjektmappen
const db = new sqlite3.Database(path.join(__dirname, 'geir.db')); // Oppretter/åpner databasefilen

// Slår på fremmednøkler (FK) i SQLite (viktig for referanseintegritet)
db.run('PRAGMA foreign_keys = ON'); // Aktiverer FK-støtte

// Oppretter tabeller og indeks (hvis de ikke finnes)
db.serialize(() => { // Sørger for at SQL-kommandoer kjører i rekkefølge
  // Tabell for brukere (autentisering)
  db.run(`
    CREATE TABLE IF NOT EXISTS users (                 -- Tabell for brukere
      id INTEGER PRIMARY KEY AUTOINCREMENT,           -- Primærnøkkel
      username TEXT UNIQUE NOT NULL,                  -- Unikt brukernavn
      email TEXT NOT NULL,                            -- E-post
      password_hash TEXT NOT NULL,                    -- Bcrypt-hash av passord
      created_at TEXT NOT NULL                        -- Opprettelsestid (ISO)
    )
  `); // Avslutter CREATE TABLE users

  // Tabell for nasjonaliteter
  db.run(`
    CREATE TABLE IF NOT EXISTS nationalities (         -- Lager tabell for nasjonaliteter
      id   INTEGER PRIMARY KEY AUTOINCREMENT,          -- Primærnøkkel
      name TEXT NOT NULL                               -- Navn på nasjonalitet
    )
  `); // Avslutter CREATE TABLE nationalities

  // UNIQUE-indeks på name (case-insensitiv)
  db.run(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_nationalities_name_nocase
    ON nationalities(name COLLATE NOCASE)              -- Unik uten case-sensitivitet
  `); // Avslutter CREATE INDEX

  // Tabell for personer
  db.run(`
    CREATE TABLE IF NOT EXISTS people (                 -- Lager tabell for personer
    id             INTEGER PRIMARY KEY AUTOINCREMENT, -- Primærnøkkel
    name           TEXT NOT NULL,                     -- Navn
    birthdate      TEXT NOT NULL,                     -- Fødselsdato i ISO-format YYYY-MM-DD
    nationality_id INTEGER NOT NULL,                  -- FK til nationalities.id
    created_by     INTEGER,                           -- (Valgfritt) FK til users.id: hvem la inn
    FOREIGN KEY (nationality_id) REFERENCES nationalities(id), -- FK definisjon
    FOREIGN KEY (created_by) REFERENCES users(id)               -- FK til users
  )
`); // Avslutter CREATE TABLE people
}); // Avslutter serialize-blokk

// Hjelpefunksjon: valider ISO-dato 'YYYY-MM-DD' og returnér { y, m, d } ved suksess
function parseISODate(iso) { // Tar inn en streng som skal være 'YYYY-MM-DD'
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '')); // Matcher år, måned, dag
  if (!m) return null; // Returnerer null om formatet er feil
  const y = Number(m[1]); // År som tall
  const mo = Number(m[2]); // Måned som tall
  const d = Number(m[3]); // Dag som tall
  const dt = new Date(y, mo - 1, d); // Lager en Date i lokal tid (måned 0-basert)
  if (dt.getFullYear() !== y || dt.getMonth() !== (mo - 1) || dt.getDate() !== d) return null; // Avviser ugyldig kalenderdato
  return { y, m: mo, d }; // Returnerer komponentene
} // Slutt parseISODate

function computeAge(isoBirthdate) { // Tar inn fødselsdato i 'YYYY-MM-DD'
  const parsed = parseISODate(isoBirthdate); // Parser og validerer datoen
  if (!parsed) return null; // Returnerer null hvis ugyldig dato
  const today = new Date(); // Henter dagens dato
  let age = today.getFullYear() - parsed.y; // Starter med differanse i år
  const currentMonth = today.getMonth() + 1; // Henter måned (1-12)
  const currentDay = today.getDate(); // Henter dag i måneden
  if (currentMonth < parsed.m || (currentMonth === parsed.m && currentDay < parsed.d)) { // Har ikke hatt bursdag ennå i år
    age--; // Justerer ned alder
  } // Slutt if
  return age; // Returnerer beregnet alder
} // Slutt computeAge

// Setter EJS som templatemotor
app.set('view engine', 'ejs'); // Forteller Express at .ejs-filer skal rendre HTML

// Angir mappen som inneholder EJS-visningene
app.set('views', path.join(__dirname, 'views')); // Sikrer korrekt sti til 'views'-mappen

// Gjør statiske filer tilgjengelig (f.eks. CSS) fra 'public'-mappen
app.use(express.static(path.join(__dirname, 'public'))); // Lar nettleseren hente /styles.css osv.

// Aktiverer parsing av URL-enkodede skjemaer (application/x-www-form-urlencoded)
app.use(express.urlencoded({ extended: true })); // Lar oss lese req.body ved POST fra HTML-skjema

// Setter opp session-håndtering (lagrer minimal info om innlogget bruker)
app.use(session({ // Starter session-middleware
  genid: () => uuidv4(), // Bruker UUID til session-id
  secret: 'bytt-denne-til-en-lang-hemmelig-nokkel', // Hemmelig streng for å signere cookie (bytt i prod)
  resave: false, // Ikke lagre session på nytt hvis uendret
  saveUninitialized: false, // Ikke lagre tomme sessions
  cookie: { // Innstillinger for cookie
    httpOnly: true, // Hindrer JS i å lese cookie i nettleser
    maxAge: 1000 * 60 * 60 * 24 // Levetid: 1 døgn
  } // Slutt cookie
})); // Slutt session

// Gjør innlogget bruker tilgjengelig i alle EJS-views via res.locals
app.use((req, res, next) => { // Lager egen middleware
  res.locals.currentUser = req.session.user || null; // Setter currentUser for bruk i EJS
  next(); // Går videre til neste middleware/rute
}); // Slutt middleware

// Hjelper: Promise-basert SELECT én rad
function dbGet(sql, params = []) { // Funksjon for å hente én rad
  return new Promise((resolve, reject) => { // Returnerer Promise
    db.get(sql, params, (err, row) => { // Kjører spørringen
      if (err) return reject(err); // Avviser ved feil
      resolve(row || null); // Returnerer rad eller null
    }); // Avslutter db.get
  }); // Avslutter Promise
} // Slutt dbGet

// Hjelper: Promise-basert SELECT mange rader
function dbAll(sql, params = []) { // Funksjon for å hente flere rader
  return new Promise((resolve, reject) => { // Returnerer Promise
    db.all(sql, params, (err, rows) => { // Kjører spørringen
      if (err) return reject(err); // Avviser ved feil
      resolve(rows); // Returnerer rader
    }); // Avslutter db.all
  }); // Avslutter Promise
} // Slutt dbAll

// Hjelper: Promise-basert INSERT/UPDATE/DELETE
function dbRun(sql, params = []) { // Funksjon for skrivende spørringer
  return new Promise((resolve, reject) => { // Returnerer Promise
    db.run(sql, params, function (err) { // Kjører spørringen; 'this' har lastID/changes
      if (err) return reject(err); // Avviser ved feil
      resolve(this); // Returnerer this (lastID/changes)
    }); // Avslutter db.run
  }); // Avslutter Promise
} // Slutt dbRun

// Hjelpefunksjon: finn/lag nasjonalitet og returnér id
async function getOrCreateNationalityId(name) { // Finner/lagrer nasjonalitet
  const clean = String(name || '').trim(); // Trimmer input
  if (!clean) throw new Error('Nasjonalitet kan ikke være tom.'); // Validering

  const existing = await dbGet( // Sjekker om finnes
    'SELECT id FROM nationalities WHERE name = ? COLLATE NOCASE',
    [clean]
  ); // Ferdig SELECT
  if (existing) return existing.id; // Returnerer id hvis finnes

  await dbRun('INSERT OR IGNORE INTO nationalities(name) VALUES (?)', [clean]); // Oppretter om ikke finnes
  const row = await dbGet( // Leser id etter insert
    'SELECT id FROM nationalities WHERE name = ? COLLATE NOCASE',
    [clean]
  ); // Ferdig SELECT
  if (!row) throw new Error('Kunne ikke opprette nasjonalitet.'); // Sikring
  return row.id; // Returnerer id
} // Slutt getOrCreateNationalityId

// Middleware: krever innlogging
function requireAuth(req, res, next) { // Tilgangskontroll
  if (!req.session.user) { // Hvis ikke innlogget
    return res.redirect('/users/login?message=Logg+inn'); // Send til login
  } // Slutt if
  next(); // Fortsett
} // Slutt requireAuth

// GET / - viser skjema og lister alle personer
app.get('/', async (req, res) => { // Forsiden
  try { // Feilhåndtering
    const people = await dbAll( // Henter personer + nasjonalitet + fødselsdato
      `SELECT 
        p.id,                                  -- Person-ID
        p.name,                                -- Navn
        p.birthdate,                           -- Fødselsdato (ISO)
        COALESCE(n.name, '(ukjent)') AS nationality -- Nasjonalitetens navn
        FROM people p
        LEFT JOIN nationalities n ON n.id = p.nationality_id
       ORDER BY p.id DESC`,                    // Nyeste først
      []                                       // Ingen parametre
    ); // Ferdig SELECT

    const peopleWithAge = people.map(p => { // Mapper gjennom personene
      const age = p.birthdate ? computeAge(p.birthdate) : null; // Beregner alder (eller null om mangler fødselsdato)
      return { ...p, age }; // Legger til 'age' i hvert objekt
    }); // Slutt map

    res.render( // Renderer EJS
      'index', // View-fil
      { 
        title: 'Registrer personer',                 // Tittel for siden
        people: peopleWithAge,                       // Personliste med alder
        message: req.query.message || null           // Valgfri melding
      } // Slutt data-objekt
    ); // Slutt render
  } catch (err) { // Ved feil
    console.error(err); // Logger feilen i konsollen
    res.status(500).send('Noe gikk galt.'); // Returnerer 500-feil til klient
  } // Slutt try/catch
}); // Slutt rute

// POST /people - lagrer ny person
app.post('/people', async (req, res) => { // Lagrer person
  try { // Feilhåndtering
    const { name, birthdate, nationality } = req.body; // Leser felter fra skjema

    if (!name || !birthdate || !nationality) { // Sjekker at alle felt er fylt ut
      const people = await dbAll( // Henter liste for å vise igjen
        `SELECT p.id, p.name, p.birthdate, COALESCE(n.name, '(ukjent)') AS nationality
         FROM people p LEFT JOIN nationalities n ON n.id = p.nationality_id
         ORDER BY p.id DESC`
      ); // Ferdig SELECT
      const peopleWithAge = people.map(p => ({ ...p, age: p.birthdate ? computeAge(p.birthdate) : null })); // Legger på alder
      return res.status(400).render('index', { title: 'Registrer personer', people: peopleWithAge, message: 'Fyll ut navn, fødselsdato og nasjonalitet.' }); // Feilmelding
    } // Slutt validering for tomme felt

    const parsed = parseISODate(birthdate); // Parser og validerer 'YYYY-MM-DD'
    if (!parsed) { // Ugyldig datoformat eller kalenderdato
      const people = await dbAll(
        `SELECT p.id, p.name, p.birthdate, COALESCE(n.name, '(ukjent)') AS nationality
         FROM people p LEFT JOIN nationalities n ON n.id = p.nationality_id
         ORDER BY p.id DESC`
      ); // Henter liste
      const peopleWithAge = people.map(p => ({ ...p, age: p.birthdate ? computeAge(p.birthdate) : null })); // Legger på alder
      return res.status(400).render('index', { title: 'Registrer personer', people: peopleWithAge, message: 'Ugyldig fødselsdato. Bruk format YYYY-MM-DD.' }); // Feilmelding
    } // Slutt datoformat-sjekk

    const minDate = { y: 1800, m: 1, d: 1 }; // Nedre grense 1800-01-01
    const today = new Date(); // Dagens dato
    const todayParts = { y: today.getFullYear(), m: today.getMonth() + 1, d: today.getDate() }; // Dagens dato-komponenter

    const beforeMin = (parsed.y < minDate.y) || (parsed.y === minDate.y && (parsed.m < minDate.m || (parsed.m === minDate.m && parsed.d < minDate.d))); // Sjekker mot nedre grense
    const afterToday = (parsed.y > todayParts.y) || (parsed.y === todayParts.y && (parsed.m > todayParts.m || (parsed.m === todayParts.m && parsed.d > todayParts.d))); // Sjekker om i fremtiden

    if (beforeMin || afterToday) { // Utenfor gyldig intervall
      const people = await dbAll(
        `SELECT p.id, p.name, p.birthdate, COALESCE(n.name, '(ukjent)') AS nationality
        FROM people p LEFT JOIN nationalities n ON n.id = p.nationality_id
        ORDER BY p.id DESC`
      ); // Henter liste
      const peopleWithAge = people.map(p => ({ ...p, age: p.birthdate ? computeAge(p.birthdate) : null })); // Legger på alder
      return res.status(400).render('index', { title: 'Registrer personer', people: peopleWithAge, message: 'Fødselsdato må være mellom 1800-01-01 og i dag.' }); // Feilmelding
    } // Slutt intervall-sjekk

    const nationalityId = await getOrCreateNationalityId(nationality); // Henter/lagrer nasjonalitet og får id

    const createdBy = req.session.user ? req.session.user.id : null; // (Valgfritt) hvem la inn
    await dbRun( // Setter inn person med fødselsdato
      'INSERT INTO people (name, birthdate, nationality_id, created_by) VALUES (?, ?, ?, ?)', // Bruker birthdate i stedet for birthyear
      [String(name).trim(), String(birthdate), nationalityId, createdBy] // Parametre
    ); // Ferdig INSERT

    res.redirect('/?message=Person+lagret'); // Til forsiden med melding
  } catch (err) { // Uventet feil
    console.error(err); // Logger
    res.redirect('/?message=Kunne+ikke+lagre+personen'); // Enkel melding
  } // Slutt try/catch
}); // Slutt rute

// POST /people/:id/delete - sletter en person
app.post('/people/:id/delete', async (req, res) => { // Slette person
  try { // Feilhåndtering
    const id = Number(req.params.id); // Leser id
    if (!Number.isInteger(id) || id <= 0) { // Validerer id
      return res.redirect('/?message=Ugyldig+ID'); // Avbryter
    } // Slutt if
    await dbRun('DELETE FROM people WHERE id = ?', [id]); // Sletter
    res.redirect('/?message=Person+slettet'); // Til forsiden
  } catch (err) { // Ved feil
    console.error(err); // Logger
    res.redirect('/?message=Kunne+ikke+slette'); // Meld
  } // Slutt catch
}); // Slutt rute

// AUTH: registreringsskjema
app.get('/users/register', (req, res) => { // Viser register-siden
  res.render('auth/register', { title: 'Registrer', message: req.query.message || '' }); // Renderer
}); // Slutt rute

// AUTH: håndter registrering
app.post('/users/register', async (req, res) => { // Registrerer ny bruker
  try { // Feilhåndtering
    const username = String(req.body.username || '').trim(); // Leser brukernavn
    const email = String(req.body.email || '').trim(); // Leser e-post
    const password = String(req.body.password || ''); // Leser passord
    if (!username || !email || !password) { // Sjekker felt
      return res.render('auth/register', { title: 'Registrer', message: 'Fyll ut alle felt.' }); // Feil
    } // Slutt if
    const password_hash = await bcrypt.hash(password, 12); // Hasher passord (med salt)
    const created_at = new Date().toISOString(); // Tidsstempel
    await dbRun( // Setter inn bruker
      'INSERT INTO users (username, email, password_hash, created_at) VALUES (?, ?, ?, ?)',
      [username, email, password_hash, created_at]
    ); // Ferdig INSERT
    return res.redirect('/users/login?message=Bruker+opprettet'); // Til login med melding
  } catch (err) { // Fanger feil (f.eks. duplikat brukernavn)
    console.error(err); // Logger
    return res.render('auth/register', { title: 'Registrer', message: 'Kunne ikke opprette bruker (brukernavn kan være opptatt).' }); // Feilmelding
  } // Slutt try/catch
}); // Slutt rute

// AUTH: login-skjema
app.get('/users/login', (req, res) => { // Viser login-siden
  res.render('auth/login', { title: 'Logg inn', message: req.query.message || '' }); // Renderer
}); // Slutt rute

// AUTH: håndter innlogging
app.post('/users/login', async (req, res) => { // Logger inn
  const username = String(req.body.username || '').trim(); // Leser brukernavn
  const password = String(req.body.password || ''); // Leser passord
  const user = await dbGet( // Henter bruker
    'SELECT id, username, email, password_hash FROM users WHERE username = ?',
    [username]
  ); // Ferdig SELECT
  if (!user) { // Finner ikke bruker
    return res.render('auth/login', { title: 'Logg inn', message: 'Ugyldig brukernavn eller passord.' }); // Feil
  } // Slutt if
  const ok = await bcrypt.compare(password, user.password_hash); // Sammenligner passord
  if (!ok) { // Feil passord
    return res.render('auth/login', { title: 'Logg inn', message: 'Ugyldig brukernavn eller passord.' }); // Feil
  } // Slutt if
  req.session.user = { id: user.id, username: user.username, email: user.email }; // Lagrer minimal info i session
  res.redirect('/?message=Velkommen+' + encodeURIComponent(user.username)); // Til forsiden
}); // Slutt rute

// AUTH: logg ut
app.post('/users/logout', (req, res) => { // Logger ut
  req.session.destroy(() => { // Ødelegger session
    res.redirect('/?message=Du+er+logget+ut'); // Til forsiden
  }); // Slutt destroy
}); // Slutt rute

// PROFIL: min side
app.get('/users/me', requireAuth, async (req, res) => { // Krever innlogging
  const user = await dbGet( // Henter oppdatert bruker
    'SELECT id, username, email, created_at FROM users WHERE id = ?',
    [req.session.user.id]
  ); // Ferdig SELECT
  res.render('users/me', { title: 'Min profil', user, message: req.query.message || '' }); // Renderer
}); // Slutt rute

// PROFIL: oppdater e-post
app.post('/users/me', requireAuth, async (req, res) => { // Oppdaterer e-post
  const email = String(req.body.email || '').trim(); // Leser e-post
  if (!email) { // Tom e-post
    return res.redirect('/users/me?message=E-post+mangler'); // Feil
  } // Slutt if
  await dbRun('UPDATE users SET email = ? WHERE id = ?', [email, req.session.user.id]); // Oppdaterer i DB
  req.session.user.email = email; // Oppdaterer i session
  res.redirect('/users/me?message=E-post+oppdatert'); // Suksess
}); // Slutt rute

// PROFIL: slett bruker
app.post('/users/delete', requireAuth, async (req, res) => { // Sletter bruker
  await dbRun('DELETE FROM users WHERE id = ?', [req.session.user.id]); // Slett i DB
  req.session.destroy(() => { // Ødelegg session
    res.redirect('/?message=Bruker+slettet'); // Til forsiden
  }); // Slutt destroy
}); // Slutt rute

// Starter serveren
app.listen(PORT, () => { // Starter HTTP-serveren
  console.log(`Server kjører på http://localhost:${PORT}`); // Logger URL i konsollen
}); // Avslutter app.listen