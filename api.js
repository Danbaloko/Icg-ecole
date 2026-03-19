// ============================================================
//  ÉCOLE PRO — API REST (Node.js + Express + PostgreSQL)
// ============================================================
//  Installation : npm install express pg uuid dotenv
//  Démarrage    : node api.js
// ============================================================

const express = require('express');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
app.use(express.json());

// --- Connexion PostgreSQL ---
const db = new Pool({
  connectionString: process.env.DATABASE_URL ||
    'postgresql://user:password@localhost:5432/ecolepro'
});

// ============================================================
//  ÉLÈVES
// ============================================================

// GET /api/eleves — liste avec filtre optionnel par classe
app.get('/api/eleves', async (req, res) => {
  const { classe_id, search } = req.query;
  let query = `
    SELECT e.id, e.nom, e.prenom, e.date_naissance, e.photo_url,
           c.nom AS classe, c.niveau
    FROM eleve e
    LEFT JOIN classe c ON c.id = e.classe_id
    WHERE e.actif = TRUE
  `;
  const params = [];

  if (classe_id) {
    params.push(classe_id);
    query += ` AND e.classe_id = $${params.length}`;
  }
  if (search) {
    params.push(`%${search}%`);
    query += ` AND (e.nom ILIKE $${params.length} OR e.prenom ILIKE $${params.length})`;
  }
  query += ' ORDER BY e.nom, e.prenom';

  const { rows } = await db.query(query, params);
  res.json({ data: rows, total: rows.length });
});

// GET /api/eleves/:id — dossier complet
app.get('/api/eleves/:id', async (req, res) => {
  const { id } = req.params;

  const [eleve, parents, absences, bulletins] = await Promise.all([
    db.query(`
      SELECT e.*, c.nom AS classe_nom, c.niveau, c.annee_scolaire
      FROM eleve e LEFT JOIN classe c ON c.id = e.classe_id
      WHERE e.id = $1
    `, [id]),
    db.query('SELECT * FROM parent WHERE eleve_id = $1', [id]),
    db.query(`
      SELECT date_absence, nb_heures, justifiee, motif
      FROM absence WHERE eleve_id = $1 ORDER BY date_absence DESC LIMIT 10
    `, [id]),
    db.query(`
      SELECT trimestre, annee_scolaire, moyenne_generale, mention, rang, statut
      FROM bulletin WHERE eleve_id = $1 ORDER BY annee_scolaire DESC, trimestre DESC
    `, [id]),
  ]);

  if (!eleve.rows[0]) return res.status(404).json({ error: 'Élève introuvable' });

  res.json({
    eleve: eleve.rows[0],
    parents: parents.rows,
    absences: absences.rows,
    bulletins: bulletins.rows,
  });
});

// POST /api/eleves — créer un élève
app.post('/api/eleves', async (req, res) => {
  const { nom, prenom, date_naissance, lieu_naissance, sexe,
          adresse, groupe_sanguin, classe_id, parents } = req.body;

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(`
      INSERT INTO eleve (nom, prenom, date_naissance, lieu_naissance,
                         sexe, adresse, groupe_sanguin, classe_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id
    `, [nom, prenom, date_naissance, lieu_naissance,
        sexe, adresse, groupe_sanguin, classe_id]);

    const eleve_id = rows[0].id;

    // Insérer les parents en même temps
    if (parents && parents.length > 0) {
      for (const p of parents) {
        await client.query(`
          INSERT INTO parent (nom, prenom, telephone, telephone2,
                              email, lien_parente, eleve_id)
          VALUES ($1,$2,$3,$4,$5,$6,$7)
        `, [p.nom, p.prenom, p.telephone, p.telephone2,
            p.email, p.lien_parente, eleve_id]);
      }
    }

    await client.query('COMMIT');
    res.status(201).json({ id: eleve_id, message: 'Élève créé avec succès' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ============================================================
//  NOTES
// ============================================================

// GET /api/notes?eleve_id=&trimestre=&annee_scolaire=
app.get('/api/notes', async (req, res) => {
  const { eleve_id, trimestre, annee_scolaire } = req.query;
  const { rows } = await db.query(`
    SELECT n.id, n.valeur, n.coefficient, n.type_eval, n.trimestre,
           n.commentaire, m.nom AS matiere, m.code,
           e.nom AS enseignant_nom, e.prenom AS enseignant_prenom
    FROM note n
    JOIN matiere m ON m.id = n.matiere_id
    JOIN enseignant e ON e.id = n.enseignant_id
    WHERE n.eleve_id = $1
      AND ($2::int IS NULL OR n.trimestre = $2)
      AND ($3::varchar IS NULL OR n.annee_scolaire = $3)
    ORDER BY n.trimestre, m.nom
  `, [eleve_id, trimestre || null, annee_scolaire || null]);
  res.json({ data: rows });
});

// POST /api/notes — saisir une note
app.post('/api/notes', async (req, res) => {
  const { valeur, coefficient, type_eval, trimestre,
          annee_scolaire, commentaire,
          eleve_id, matiere_id, enseignant_id } = req.body;

  const { rows } = await db.query(`
    INSERT INTO note (valeur, coefficient, type_eval, trimestre,
                      annee_scolaire, commentaire,
                      eleve_id, matiere_id, enseignant_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id
  `, [valeur, coefficient, type_eval, trimestre,
      annee_scolaire, commentaire,
      eleve_id, matiere_id, enseignant_id]);

  res.status(201).json({ id: rows[0].id });
});

// ============================================================
//  BULLETINS
// ============================================================

// POST /api/bulletins/generer — déclencher la génération
app.post('/api/bulletins/generer', async (req, res) => {
  const { eleve_id, trimestre, annee_scolaire } = req.body;

  // Appel à la fonction SQL generer_bulletin
  const { rows } = await db.query(
    'SELECT generer_bulletin($1, $2, $3) AS bulletin_id',
    [eleve_id, trimestre, annee_scolaire]
  );

  res.json({
    bulletin_id: rows[0].bulletin_id,
    message: 'Bulletin généré avec succès'
  });
});

// POST /api/bulletins/generer-classe — génération en masse pour une classe
app.post('/api/bulletins/generer-classe', async (req, res) => {
  const { classe_id, trimestre, annee_scolaire } = req.body;

  const { rows: eleves } = await db.query(
    'SELECT id FROM eleve WHERE classe_id = $1 AND actif = TRUE',
    [classe_id]
  );

  const results = [];
  for (const eleve of eleves) {
    const { rows } = await db.query(
      'SELECT generer_bulletin($1, $2, $3) AS bulletin_id',
      [eleve.id, trimestre, annee_scolaire]
    );
    results.push({ eleve_id: eleve.id, bulletin_id: rows[0].bulletin_id });
  }

  res.json({
    total: results.length,
    bulletins: results,
    message: `${results.length} bulletins générés`
  });
});

// GET /api/bulletins/:id — récupérer un bulletin avec détails
app.get('/api/bulletins/:id', async (req, res) => {
  const { id } = req.params;

  const [bulletin, details] = await Promise.all([
    db.query(`
      SELECT b.*, e.nom, e.prenom, e.photo_url,
             c.nom AS classe, c.niveau, c.annee_scolaire
      FROM bulletin b
      JOIN eleve e ON e.id = b.eleve_id
      JOIN classe c ON c.id = e.classe_id
      WHERE b.id = $1
    `, [id]),
    db.query(`
      SELECT bd.moyenne, bd.coefficient, bd.appreciation, bd.rang_classe,
             m.nom AS matiere, m.code
      FROM bulletin_detail bd
      JOIN matiere m ON m.id = bd.matiere_id
      WHERE bd.bulletin_id = $1
      ORDER BY m.nom
    `, [id]),
  ]);

  if (!bulletin.rows[0]) return res.status(404).json({ error: 'Bulletin introuvable' });

  res.json({ bulletin: bulletin.rows[0], matieres: details.rows });
});

// ============================================================
//  ABSENCES
// ============================================================

// GET /api/absences?eleve_id=
app.get('/api/absences', async (req, res) => {
  const { eleve_id } = req.query;
  const { rows } = await db.query(`
    SELECT a.*, ens.nom AS enseignant_nom
    FROM absence a
    LEFT JOIN enseignant ens ON ens.id = a.enseignant_id
    WHERE a.eleve_id = $1
    ORDER BY a.date_absence DESC
  `, [eleve_id]);
  res.json({ data: rows });
});

// POST /api/absences
app.post('/api/absences', async (req, res) => {
  const { date_absence, nb_heures, justifiee, motif,
          eleve_id, enseignant_id } = req.body;
  const { rows } = await db.query(`
    INSERT INTO absence (date_absence, nb_heures, justifiee,
                         motif, eleve_id, enseignant_id)
    VALUES ($1,$2,$3,$4,$5,$6) RETURNING id
  `, [date_absence, nb_heures, justifiee, motif, eleve_id, enseignant_id]);
  res.status(201).json({ id: rows[0].id });
});

// ============================================================
//  STATISTIQUES TABLEAU DE BORD
// ============================================================

// GET /api/stats/dashboard
app.get('/api/stats/dashboard', async (req, res) => {
  const { annee_scolaire = '2024-2025' } = req.query;

  const [effectif, tauxPresence, moyenneGenerale, alertes] = await Promise.all([
    db.query('SELECT COUNT(*) AS total FROM eleve WHERE actif = TRUE'),
    db.query(`
      SELECT ROUND(100.0 - (
        COUNT(DISTINCT a.eleve_id)::numeric / NULLIF(COUNT(DISTINCT e.id), 0) * 100
      ), 1) AS taux
      FROM eleve e
      LEFT JOIN absence a ON a.eleve_id = e.id
        AND a.date_absence >= NOW() - INTERVAL '30 days'
      WHERE e.actif = TRUE
    `),
    db.query(`
      SELECT ROUND(AVG(moyenne_generale), 2) AS moy
      FROM bulletin
      WHERE annee_scolaire = $1 AND statut != 'brouillon'
    `, [annee_scolaire]),
    db.query(`
      SELECT e.id, e.nom, e.prenom, COUNT(a.id) AS nb_absences
      FROM eleve e
      JOIN absence a ON a.eleve_id = e.id
        AND a.justifiee = FALSE
        AND a.date_absence >= NOW() - INTERVAL '30 days'
      WHERE e.actif = TRUE
      GROUP BY e.id, e.nom, e.prenom
      HAVING COUNT(a.id) >= 3
      ORDER BY nb_absences DESC
      LIMIT 10
    `),
  ]);

  res.json({
    effectif_total: parseInt(effectif.rows[0].total),
    taux_presence: parseFloat(tauxPresence.rows[0].taux),
    moyenne_generale: parseFloat(moyenneGenerale.rows[0].moy),
    alertes_absences: alertes.rows,
  });
});

// ============================================================
//  DÉMARRAGE DU SERVEUR
// ============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Serveur ÉcolePro démarré sur le port ${PORT}`);
});
