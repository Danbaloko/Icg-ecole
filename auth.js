// ============================================================
//  ÉCOLE PRO — Système d'authentification (JWT + RBAC)
//  npm install express pg bcryptjs jsonwebtoken dotenv uuid
// ============================================================

const express    = require('express');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const { Pool }   = require('pg');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const router = express.Router();
const db = new Pool({ connectionString: process.env.DATABASE_URL });

const JWT_SECRET         = process.env.JWT_SECRET;          // min 32 chars
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;  // différent du précédent
const ACCESS_TTL         = '15m';   // token d'accès : 15 minutes
const REFRESH_TTL        = '7d';    // refresh token : 7 jours

// ============================================================
//  SQL À AJOUTER AU SCHÉMA (schema.sql)
// ============================================================
/*
CREATE TABLE utilisateur (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email         VARCHAR(150) UNIQUE NOT NULL,
  mot_de_passe  TEXT NOT NULL,         -- bcrypt hash
  role          VARCHAR(20) NOT NULL   -- 'admin' | 'enseignant' | 'parent'
                CHECK (role IN ('admin','enseignant','parent')),
  actif         BOOLEAN DEFAULT TRUE,
  profil_id     UUID,                  -- FK vers enseignant.id ou parent.id
  created_at    TIMESTAMP DEFAULT NOW(),
  last_login    TIMESTAMP
);

CREATE TABLE refresh_token (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  token       TEXT UNIQUE NOT NULL,
  user_id     UUID NOT NULL REFERENCES utilisateur(id) ON DELETE CASCADE,
  expire_le   TIMESTAMP NOT NULL,
  revoque     BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_refresh_token ON refresh_token(token);
CREATE INDEX idx_refresh_user  ON refresh_token(user_id);
*/

// ============================================================
//  HELPERS
// ============================================================

/** Génère un access token JWT (15 min) */
function genAccessToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: ACCESS_TTL }
  );
}

/** Génère un refresh token JWT (7j) et le persiste en BDD */
async function genRefreshToken(userId) {
  const token = jwt.sign({ id: userId }, JWT_REFRESH_SECRET, { expiresIn: REFRESH_TTL });
  const expireAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await db.query(
    'INSERT INTO refresh_token (token, user_id, expire_le) VALUES ($1,$2,$3)',
    [token, userId, expireAt]
  );
  return token;
}

// ============================================================
//  MIDDLEWARE — Vérification du JWT
// ============================================================

/**
 * verifyToken — à placer sur toutes les routes protégées
 * Ajoute req.user = { id, email, role } si valide
 */
function verifyToken(req, res, next) {
  const header = req.headers['authorization'];
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token manquant' });
  }

  const token = header.split(' ')[1];
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expiré', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Token invalide' });
  }
}

/**
 * requireRole(...roles) — contrôle d'accès par rôle (RBAC)
 * Usage : router.get('/route', verifyToken, requireRole('admin'), handler)
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: `Accès refusé. Rôle requis : ${roles.join(' ou ')}`
      });
    }
    next();
  };
}

// Alias pratiques
const adminOnly       = requireRole('admin');
const staffOnly       = requireRole('admin', 'enseignant');
const allRoles        = requireRole('admin', 'enseignant', 'parent');

// ============================================================
//  ROUTES D'AUTHENTIFICATION
// ============================================================

// ── POST /auth/register ── (admin uniquement en prod)
router.post('/register', async (req, res) => {
  const { email, mot_de_passe, role, profil_id } = req.body;

  if (!['admin', 'enseignant', 'parent'].includes(role)) {
    return res.status(400).json({ error: 'Rôle invalide' });
  }

  const hash = await bcrypt.hash(mot_de_passe, 12);

  try {
    const { rows } = await db.query(
      `INSERT INTO utilisateur (email, mot_de_passe, role, profil_id)
       VALUES ($1,$2,$3,$4) RETURNING id, email, role`,
      [email, hash, role, profil_id || null]
    );
    res.status(201).json({ utilisateur: rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Email déjà utilisé' });
    }
    res.status(500).json({ error: err.message });
  }
});

// ── POST /auth/login ──
router.post('/login', async (req, res) => {
  const { email, mot_de_passe } = req.body;

  if (!email || !mot_de_passe) {
    return res.status(400).json({ error: 'Email et mot de passe requis' });
  }

  const { rows } = await db.query(
    'SELECT * FROM utilisateur WHERE email = $1 AND actif = TRUE',
    [email]
  );
  const user = rows[0];

  // Vérification en temps constant pour éviter les timing attacks
  const passwordOk = user
    ? await bcrypt.compare(mot_de_passe, user.mot_de_passe)
    : await bcrypt.compare(mot_de_passe, '$2b$12$invalide'); // dummy compare

  if (!user || !passwordOk) {
    return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
  }

  // Mettre à jour la date de dernière connexion
  await db.query('UPDATE utilisateur SET last_login = NOW() WHERE id = $1', [user.id]);

  const accessToken  = genAccessToken(user);
  const refreshToken = await genRefreshToken(user.id);

  res.json({
    access_token:  accessToken,
    refresh_token: refreshToken,
    expires_in:    15 * 60,     // secondes
    role:          user.role,
    utilisateur: {
      id:    user.id,
      email: user.email,
      role:  user.role,
    }
  });
});

// ── POST /auth/refresh ── Renouveler le token d'accès
router.post('/refresh', async (req, res) => {
  const { refresh_token } = req.body;
  if (!refresh_token) {
    return res.status(400).json({ error: 'Refresh token manquant' });
  }

  // Vérifier signature JWT
  let payload;
  try {
    payload = jwt.verify(refresh_token, JWT_REFRESH_SECRET);
  } catch {
    return res.status(401).json({ error: 'Refresh token invalide ou expiré' });
  }

  // Vérifier en BDD (non révoqué, non expiré)
  const { rows } = await db.query(
    `SELECT rt.*, u.email, u.role, u.actif
     FROM refresh_token rt
     JOIN utilisateur u ON u.id = rt.user_id
     WHERE rt.token = $1`,
    [refresh_token]
  );
  const stored = rows[0];

  if (!stored || stored.revoque || !stored.actif || new Date(stored.expire_le) < new Date()) {
    return res.status(401).json({ error: 'Refresh token révoqué ou expiré' });
  }

  // Rotation : on révoque l'ancien et en crée un nouveau
  await db.query('UPDATE refresh_token SET revoque = TRUE WHERE token = $1', [refresh_token]);

  const newAccess  = genAccessToken(stored);
  const newRefresh = await genRefreshToken(stored.user_id);

  res.json({
    access_token:  newAccess,
    refresh_token: newRefresh,
    expires_in:    15 * 60,
  });
});

// ── POST /auth/logout ── Révoquer le refresh token
router.post('/logout', verifyToken, async (req, res) => {
  const { refresh_token } = req.body;

  if (refresh_token) {
    await db.query(
      'UPDATE refresh_token SET revoque = TRUE WHERE token = $1 AND user_id = $2',
      [refresh_token, req.user.id]
    );
  }

  res.json({ message: 'Déconnexion réussie' });
});

// ── POST /auth/logout-all ── Révoquer TOUS les tokens (vol de compte)
router.post('/logout-all', verifyToken, async (req, res) => {
  await db.query(
    'UPDATE refresh_token SET revoque = TRUE WHERE user_id = $1',
    [req.user.id]
  );
  res.json({ message: 'Tous les appareils déconnectés' });
});

// ── POST /auth/change-password ──
router.post('/change-password', verifyToken, async (req, res) => {
  const { ancien_mdp, nouveau_mdp } = req.body;

  const { rows } = await db.query(
    'SELECT mot_de_passe FROM utilisateur WHERE id = $1',
    [req.user.id]
  );
  const valide = await bcrypt.compare(ancien_mdp, rows[0].mot_de_passe);
  if (!valide) {
    return res.status(400).json({ error: 'Ancien mot de passe incorrect' });
  }

  const hash = await bcrypt.hash(nouveau_mdp, 12);
  await db.query(
    'UPDATE utilisateur SET mot_de_passe = $1 WHERE id = $2',
    [hash, req.user.id]
  );

  // Révoquer tous les refresh tokens (bonne pratique)
  await db.query(
    'UPDATE refresh_token SET revoque = TRUE WHERE user_id = $1',
    [req.user.id]
  );

  res.json({ message: 'Mot de passe modifié. Reconnectez-vous.' });
});

// ── GET /auth/me ── Profil de l'utilisateur connecté
router.get('/me', verifyToken, async (req, res) => {
  const { rows } = await db.query(
    `SELECT u.id, u.email, u.role, u.last_login,
            CASE
              WHEN u.role = 'enseignant' THEN
                json_build_object('nom', e.nom, 'prenom', e.prenom, 'specialite', e.specialite)
              WHEN u.role = 'parent' THEN
                json_build_object('nom', p.nom, 'prenom', p.prenom, 'telephone', p.telephone)
              ELSE NULL
            END AS profil
     FROM utilisateur u
     LEFT JOIN enseignant e ON e.id = u.profil_id AND u.role = 'enseignant'
     LEFT JOIN parent p     ON p.id = u.profil_id AND u.role = 'parent'
     WHERE u.id = $1`,
    [req.user.id]
  );
  res.json(rows[0]);
});

// ============================================================
//  EXEMPLES D'APPLICATION DES MIDDLEWARES SUR LES ROUTES
// ============================================================

/*
  const app = express();
  app.use('/auth', authRouter);

  // Route accessible à tous les utilisateurs connectés
  app.get('/api/eleves/:id', verifyToken, allRoles, handler);

  // Route réservée aux enseignants et admins
  app.post('/api/notes', verifyToken, staffOnly, handler);

  // Route réservée à l'admin uniquement
  app.post('/api/eleves', verifyToken, adminOnly, handler);
  app.delete('/api/eleves/:id', verifyToken, adminOnly, handler);

  // Route bulletin : admin et enseignant peuvent générer,
  //                  parent peut seulement consulter
  app.post('/api/bulletins/generer', verifyToken, staffOnly, handler);
  app.get('/api/bulletins/:id',      verifyToken, allRoles,  handler);
*/

// ============================================================
//  MATRICE DES PERMISSIONS PAR RÔLE
// ============================================================
/*
  Action                        | Admin | Enseignant | Parent
  ------------------------------|-------|------------|-------
  Créer/modifier un élève       |  ✓    |            |
  Voir le dossier complet       |  ✓    |    ✓       |   ✓*
  Saisir des notes              |  ✓    |    ✓       |
  Générer un bulletin           |  ✓    |    ✓       |
  Voir les bulletins            |  ✓    |    ✓       |   ✓*
  Enregistrer une absence       |  ✓    |    ✓       |
  Gérer les utilisateurs        |  ✓    |            |
  Gérer les salles/classes      |  ✓    |            |
  Voir les statistiques globales|  ✓    |    ✓       |

  * Le parent ne voit que les données de SES enfants (filtre profil_id)
*/

module.exports = { router, verifyToken, requireRole, adminOnly, staffOnly, allRoles };
