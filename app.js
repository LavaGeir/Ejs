// Importerer innebygd 'path' for trygg håndtering av filstier på tvers av OS
const path = require('path'); // Brukes til å lage korrekte stier til views, public og databasefil

// Importerer Express-rammeverket
const express = require('express'); // Gjør det enkelt å lage HTTP-server og ruter

// Importerer SQLite3-driveren for Node.js
const sqlite3 = require('sqlite3').verbose(); // Lar oss koble til og kjøre SQL mot en lokal SQLite-fil

// Lager en ny Express-applikasjon
const app = express(); // Initialiserer Express-appen

// Setter portnummeret som serveren skal lytte på
const PORT = 3000; // Standard port for lokal utvikling

// Åpner/oppretter SQLite-databasefilen 'geir.db' i prosjektmappen
const db = new sqlite3.Database(path.join(__dirname, 'geir.db')); // Oppretter/åpner databasefilen der data lagres

// Oppretter 'songs'-tabellen hvis den ikke finnes fra før
db.serialize(() => { // Sørger for at SQL-kommandoer kjører i rekkefølge
  db.run(` -- Starter SQL for å lage tabellen
    CREATE TABLE IF NOT EXISTS people (               -- Lager tabellen bare hvis den ikke finnes
      id INTEGER PRIMARY KEY AUTOINCREMENT,          -- Primærnøkkel som øker automatisk
      name TEXT NOT NULL,                            -- Navn (påkrevd)
      age TEXT NOT NULL,                             -- Alder (påkrevd)
      nationality TEXT NOT NULL                       -- Nasjonalitet (påkrevd)
    )                                                -- Slutt på CREATE TABLE
  `); // Avslutter kjøringen av SQL-setningen
}); // Avslutter serialize-blokk

// Setter EJS som templatemotor
app.set('view engine', 'ejs'); // Forteller Express at .ejs-filer skal rendre HTML

// Angir mappen som inneholder EJS-visningene
app.set('views', path.join(__dirname, 'views')); // Sikrer korrekt sti til 'views'-mappen

// Gjør statiske filer tilgjengelig (f.eks. CSS) fra 'public'-mappen
app.use(express.static(path.join(__dirname, 'public'))); // Lar nettleseren hente /styles.css osv.

// Aktiverer parsing av URL-enkodede skjemaer (application/x-www-form-urlencoded)
app.use(express.urlencoded({ extended: true })); // Lar oss lese req.body ved POST fra HTML-skjema

// Hjelpefunksjon: kjør SELECT som henter flere rader (Promise-basert)
function dbAll(sql, params = []) { // Definerer en funksjon for å kjøre SELECT som returnerer flere rader
  return new Promise((resolve, reject) => { // Returnerer et Promise for å kunne bruke async/await
    db.all(sql, params, (err, rows) => { // Kjører spørringen med parametere
      if (err) return reject(err); // Avviser Promise hvis SQL-feil oppstår
      resolve(rows); // Løser Promise med resultat-radene
    }); // Avslutter callback for db.all
  }); // Avslutter Promise
} // Avslutter funksjonen dbAll

// Hjelpefunksjon: kjør INSERT/UPDATE/DELETE (Promise-basert)
function dbRun(sql, params = []) { // Definerer en funksjon for å kjøre skrivende spørringer
  return new Promise((resolve, reject) => { // Returnerer et Promise
    db.run(sql, params, function (err) { // Kjører spørringen og beholder 'this' for lastID/changes
      if (err) return reject(err); // Avviser Promise ved SQL-feil
      resolve(this); // Løser Promise med 'this' (inneholder lastID for INSERT)
    }); // Avslutter callback for db.run
  }); // Avslutter Promise
} // Avslutter funksjonen dbRun

// GET / - viser skjema for å legge inn sang og lister alle lagrede sanger
app.get('/', async (req, res) => { // Definerer rute for å vise startsiden
  try { // Starter try/catch for feilhandtering
    const people = await dbAll( // Henter alle personer fra databasen
      'SELECT id, name, age, nationality FROM people ORDER BY id DESC', // SQL for å liste personer
      [] // Ingen parametere for denne spørringen
    ); // Avslutter henting av personer
    res.render('index', { title: 'Registrer personer', people, message: null }); // Renderer index.ejs med data
  } catch (err) { // Fanger eventuelle feil
    console.error(err); // Logger feilen i konsollen
    res.status(500).send('Noe gikk galt.'); // Sender en enkel feilmelding til klienten
  } // Avslutter try/catch
}); // Avslutter GET-ruten

// POST /people - validerer og lagrer en ny person i databasen
app.post('/people', async (req, res) => { // Definerer rute for innsending av nytt personskjema
  try { // Starter try/catch for å håndtere feil
    const { name, age, nationality } = req.body; // Leser ut feltene fra skjemaet
    if (!name || !age || !nationality) { // Sjekker at alle felt er utfylt
      const songs = await dbAll('SELECT id, name, age, nationality FROM people ORDER BY id DESC'); // Henter liste for visning ved feil
      return res.status(400).render('index', { title: 'Registrer personer', songs, message: 'Fyll ut navn, alder og nasjonalitet.' }); // Viser feilmelding
    } // Avslutter validering for tomme felt
    await dbRun( // Kjører INSERT for å lagre sangen
      'INSERT INTO people (name, age, nationality) VALUES (?, ?, ?)', // SQL med parametere
      [name.trim(), parseInt(age), nationality.trim()] // Verdier å sette inn (trim fjerner ekstra mellomrom)
    ); // Avslutter INSERT
    res.redirect('/'); // Sender brukeren tilbake til forsiden for å se oppdatert liste
  } catch (err) { // Fanger uventede feil
    console.error(err); // Logger feilen
    const songs = await dbAll('SELECT id, name, age, nationality FROM people ORDER BY id DESC'); // Henter liste for visning ved feil
    res.status(500).render('index', { title: 'Registrer personer', songs, message: 'Kunne ikke lagre personen.' }); // Viser generell feilmelding
  } // Avslutter try/catch
}); // Avslutter POST-ruten

// Starter serveren
app.listen(PORT, () => { // Ber Express lytte på definert port
  console.log(`Server kjører på http://localhost:${PORT}`); // Logger URL for lett tilgang i nettleser
}); // Avslutter app.listen