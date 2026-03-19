// ============================================================
//  ÉCOLE PRO — Routes API dédiées à l'espace parents
//  Ces routes filtrent automatiquement les données par enfant
//  Le parent ne peut accéder qu'aux données de SES enfants
// ============================================================

const express = require('express');
const router  = express.Router();
const { Pool } = require('pg');
const db = new Pool({ connectionString: process.env.DATABASE_URL });

// Import des middlewares d'auth (fichier auth.js)
const { verifyToken, requireRole } = require('./auth');
const parentOnly = requireRole('parent', 'admin');

// ── Sécurité : vérifier que l'élève appartient bien au parent ──
async function verifierEnfant(parentUserId, eleveId) {
  const { rows } = await db.query(`
    SELECT p.id FROM parent p
    JOIN utilisateur u ON u.profil_id = p.id
    WHERE u.id = $1 AND p.eleve_id = $2
  `, [parentUserId, eleveId]);
  return rows.length > 0;
}

// ============================================================
//  GET /api/parents/enfants — Liste des enfants du parent
// ============================================================
router.get('/enfants', verifyToken, parentOnly, async (req, res) => {
  const { rows } = await db.query(`
    SELECT
      e.id, e.nom, e.prenom, e.photo_url, e.date_naissance,
      c.nom AS classe, c.niveau, c.annee_scolaire,
      -- Moyenne générale du dernier trimestre
      (SELECT ROUND(moyenne_generale, 2) FROM bulletin
       WHERE eleve_id = e.id ORDER BY trimestre DESC LIMIT 1) AS derniere_moyenne,
      -- Rang
      (SELECT rang FROM bulletin
       WHERE eleve_id = e.id ORDER BY trimestre DESC LIMIT 1) AS dernier_rang,
      -- Nb absences non justifiées ce mois
      (SELECT COUNT(*) FROM absence
       WHERE eleve_id = e.id AND justifiee = FALSE
         AND date_absence >= NOW() - INTERVAL '30 days') AS absences_recentes
    FROM parent p
    JOIN utilisateur u ON u.profil_id = p.id
    JOIN eleve e ON e.id = p.eleve_id
    LEFT JOIN classe c ON c.id = e.classe_id
    WHERE u.id = $1 AND e.actif = TRUE
    ORDER BY e.prenom
  `, [req.user.id]);

  res.json({ enfants: rows });
});

// ============================================================
//  GET /api/parents/enfants/:eleveId/notes — Notes d'un enfant
// ============================================================
router.get('/enfants/:eleveId/notes', verifyToken, parentOnly, async (req, res) => {
  const { eleveId } = req.params;
  const { trimestre, annee_scolaire = '2024-2025' } = req.query;

  // Vérification d'accès
  if (req.user.role === 'parent') {
    const autorise = await verifierEnfant(req.user.id, eleveId);
    if (!autorise) return res.status(403).json({ error: 'Accès interdit' });
  }

  // Moyennes par matière
  const { rows: matieres } = await db.query(`
    SELECT
      m.nom AS matiere, m.code, m.coefficient,
      ROUND(SUM(n.valeur * n.coefficient) / NULLIF(SUM(n.coefficient), 0), 2) AS moyenne,
      -- Moyenne de la classe pour comparaison
      ROUND((
        SELECT SUM(n2.valeur * n2.coefficient) / NULLIF(SUM(n2.coefficient), 0)
        FROM note n2
        JOIN eleve e2 ON e2.id = n2.eleve_id
        WHERE n2.matiere_id = m.id
          AND n2.trimestre = n.trimestre
          AND n2.annee_scolaire = n.annee_scolaire
          AND e2.classe_id = (SELECT classe_id FROM eleve WHERE id = $1)
      ), 2) AS moyenne_classe,
      -- Liste des notes individuelles
      json_agg(json_build_object(
        'valeur', n.valeur,
        'type_eval', n.type_eval,
        'date', n.created_at::date,
        'commentaire', n.commentaire
      ) ORDER BY n.created_at) AS notes_detail,
      n.trimestre, n.annee_scolaire,
      ens.nom AS enseignant_nom, ens.prenom AS enseignant_prenom
    FROM note n
    JOIN matiere m ON m.id = n.matiere_id
    JOIN enseignant ens ON ens.id = n.enseignant_id
    WHERE n.eleve_id = $1
      AND ($2::int IS NULL OR n.trimestre = $2)
      AND n.annee_scolaire = $3
    GROUP BY m.id, m.nom, m.code, m.coefficient,
             n.trimestre, n.annee_scolaire,
             ens.nom, ens.prenom
    ORDER BY m.nom
  `, [eleveId, trimestre || null, annee_scolaire]);

  // Moyenne générale pondérée
  const moyGen = matieres.reduce((acc, m) => {
    return acc + (parseFloat(m.moyenne) * parseFloat(m.coefficient));
  }, 0) / matieres.reduce((acc, m) => acc + parseFloat(m.coefficient), 0);

  res.json({
    matieres,
    moyenne_generale: Math.round(moyGen * 100) / 100,
    trimestre: trimestre || 'tous',
    annee_scolaire,
  });
});

// ============================================================
//  GET /api/parents/enfants/:eleveId/bulletins — Liste bulletins
// ============================================================
router.get('/enfants/:eleveId/bulletins', verifyToken, parentOnly, async (req, res) => {
  const { eleveId } = req.params;

  if (req.user.role === 'parent') {
    const autorise = await verifierEnfant(req.user.id, eleveId);
    if (!autorise) return res.status(403).json({ error: 'Accès interdit' });
  }

  const { rows } = await db.query(`
    SELECT id, trimestre, annee_scolaire, moyenne_generale,
           rang, mention, statut, pdf_url, genere_le
    FROM bulletin
    WHERE eleve_id = $1 AND statut = 'publié'
    ORDER BY annee_scolaire DESC, trimestre DESC
  `, [eleveId]);

  res.json({ bulletins: rows });
});

// ============================================================
//  GET /api/parents/enfants/:eleveId/absences
// ============================================================
router.get('/enfants/:eleveId/absences', verifyToken, parentOnly, async (req, res) => {
  const { eleveId } = req.params;
  const { mois } = req.query;

  if (req.user.role === 'parent') {
    const autorise = await verifierEnfant(req.user.id, eleveId);
    if (!autorise) return res.status(403).json({ error: 'Accès interdit' });
  }

  let query = `
    SELECT a.id, a.date_absence, a.nb_heures, a.justifiee, a.motif,
           ens.nom AS enseignant_nom, ens.prenom AS enseignant_prenom
    FROM absence a
    LEFT JOIN enseignant ens ON ens.id = a.enseignant_id
    WHERE a.eleve_id = $1
  `;
  const params = [eleveId];

  if (mois) {
    params.push(mois); // format: '2025-03'
    query += ` AND TO_CHAR(a.date_absence, 'YYYY-MM') = $${params.length}`;
  }

  query += ' ORDER BY a.date_absence DESC';
  const { rows } = await db.query(query, params);

  // Stats résumées
  const total   = rows.reduce((s, r) => s + parseFloat(r.nb_heures), 0);
  const justif  = rows.filter(r => r.justifiee).reduce((s, r) => s + parseFloat(r.nb_heures), 0);

  res.json({
    absences: rows,
    stats: { total_heures: total, justifiees: justif, injustifiees: total - justif }
  });
});

// ============================================================
//  POST /api/parents/enfants/:eleveId/absences/:absenceId/justifier
//  Le parent soumet un justificatif
// ============================================================
router.post(
  '/enfants/:eleveId/absences/:absenceId/justifier',
  verifyToken, parentOnly,
  async (req, res) => {
    const { eleveId, absenceId } = req.params;
    const { motif, document_url } = req.body;

    if (req.user.role === 'parent') {
      const autorise = await verifierEnfant(req.user.id, eleveId);
      if (!autorise) return res.status(403).json({ error: 'Accès interdit' });
    }

    await db.query(`
      UPDATE absence
      SET motif = $1, document_url = $2, justifiee = TRUE
      WHERE id = $3 AND eleve_id = $4
    `, [motif, document_url || null, absenceId, eleveId]);

    res.json({ message: 'Justificatif soumis avec succès' });
  }
);

// ============================================================
//  GET /api/parents/agenda — Événements des enfants du parent
// ============================================================
router.get('/agenda', verifyToken, parentOnly, async (req, res) => {
  // Récupère les classes des enfants du parent
  const { rows: enfants } = await db.query(`
    SELECT e.classe_id FROM parent p
    JOIN utilisateur u ON u.profil_id = p.id
    JOIN eleve e ON e.id = p.eleve_id
    WHERE u.id = $1
  `, [req.user.id]);

  const classeIds = enfants.map(r => r.classe_id).filter(Boolean);
  if (classeIds.length === 0) return res.json({ evenements: [] });

  // Hypothèse : table `evenement` liée aux classes
  // (à créer selon vos besoins : examens, réunions, sorties...)
  const { rows } = await db.query(`
    SELECT ev.*, c.nom AS classe
    FROM evenement ev
    JOIN classe c ON c.id = ev.classe_id
    WHERE ev.classe_id = ANY($1::uuid[])
      AND ev.date_evenement >= NOW()
    ORDER BY ev.date_evenement ASC
    LIMIT 20
  `, [classeIds]);

  res.json({ evenements: rows });
});

// ============================================================
//  GET /api/parents/messages — Messagerie parent-enseignant
// ============================================================
router.get('/messages', verifyToken, parentOnly, async (req, res) => {
  // Implémentation simple : messages entre utilisateurs
  const { rows } = await db.query(`
    SELECT m.id, m.contenu, m.lu, m.created_at,
           u.email AS expediteur_email,
           COALESCE(ens.nom || ' ' || ens.prenom, 'Administration') AS expediteur_nom
    FROM message m
    JOIN utilisateur u ON u.id = m.expediteur_id
    LEFT JOIN enseignant ens ON ens.id = u.profil_id
    WHERE m.destinataire_id = $1
    ORDER BY m.created_at DESC
    LIMIT 50
  `, [req.user.id]);

  res.json({ messages: rows, non_lus: rows.filter(m => !m.lu).length });
});

// ============================================================
//  POST /api/parents/messages — Envoyer un message
// ============================================================
router.post('/messages', verifyToken, parentOnly, async (req, res) => {
  const { destinataire_id, contenu } = req.body;

  if (!contenu || !destinataire_id) {
    return res.status(400).json({ error: 'Destinataire et contenu requis' });
  }

  const { rows } = await db.query(`
    INSERT INTO message (expediteur_id, destinataire_id, contenu)
    VALUES ($1, $2, $3) RETURNING id, created_at
  `, [req.user.id, destinataire_id, contenu]);

  res.status(201).json({ message_id: rows[0].id, envoye_le: rows[0].created_at });
});

module.exports = router;
