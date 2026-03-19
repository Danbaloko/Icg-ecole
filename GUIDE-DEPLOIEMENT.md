# 🚀 Guide de déploiement ICG sur Vercel
## Intelligentsia Corporation Gabon — Plateforme scolaire

---

## 📋 Contenu de ce dossier

```
icg-vercel/
├── index.html       ← Application complète (toutes les pages)
├── sw.js            ← Service Worker (mode offline)
├── manifest.json    ← Config PWA (installation mobile)
├── offline.html     ← Page hors connexion
├── vercel.json      ← Configuration Vercel
├── .gitignore
└── icons/           ← Icônes de l'application
    ├── icon-192.png
    ├── icon-512.png
    └── icon.svg
```

---

## ✅ ÉTAPE 1 — Créer un compte GitHub (GRATUIT)

1. Ouvrez : **https://github.com**
2. Cliquez **"Sign up"**
3. Entrez votre email, un mot de passe, un nom d'utilisateur
   → Exemple : `icg-gabon`
4. Vérifiez votre email (cliquer le lien reçu)
5. Choisissez le plan **Free** (gratuit)

---

## ✅ ÉTAPE 2 — Créer un dépôt GitHub et uploader les fichiers

### Option A : Via le site GitHub (plus simple)

1. Sur GitHub, cliquez **"+"** en haut à droite → **"New repository"**
2. Nom du dépôt : `icg-ecole`
3. Visibilité : **Public** (obligatoire pour Vercel gratuit)
4. Cochez **"Add a README file"**
5. Cliquez **"Create repository"**

**Uploader les fichiers :**
1. Dans votre nouveau dépôt, cliquez **"uploading an existing file"**
2. Glissez-déposez TOUS les fichiers de ce dossier
   (index.html, sw.js, manifest.json, offline.html, vercel.json, .gitignore)
3. Glissez aussi le **dossier icons/** avec ses images
4. Cliquez **"Commit changes"** en bas
5. ✅ Vos fichiers sont maintenant en ligne sur GitHub

### Option B : Via Git (si vous avez Git installé)

```bash
# Dans le dossier icg-vercel/
git init
git add .
git commit -m "ICG École — déploiement initial"
git branch -M main
git remote add origin https://github.com/VOTRE_NOM/icg-ecole.git
git push -u origin main
```

---

## ✅ ÉTAPE 3 — Créer un compte Vercel (GRATUIT)

1. Ouvrez : **https://vercel.com**
2. Cliquez **"Sign Up"**
3. Choisissez **"Continue with GitHub"**
   → Connectez votre compte GitHub créé à l'étape 1
4. Autorisez Vercel à accéder à vos dépôts
5. Choisissez le plan **Hobby (Free)**

---

## ✅ ÉTAPE 4 — Déployer l'application

1. Sur le tableau de bord Vercel, cliquez **"Add New…" → "Project"**
2. Dans la liste de vos dépôts GitHub, trouvez **icg-ecole**
3. Cliquez **"Import"**
4. Configuration :
   - **Framework Preset** : `Other` (pas Next.js, pas React)
   - **Root Directory** : `.` (laisser par défaut)
   - **Build Command** : laisser vide
   - **Output Directory** : laisser vide
5. Cliquez **"Deploy"**
6. ⏳ Attendez 30 à 60 secondes…
7. 🎉 **Votre application est en ligne !**

Vercel vous donne une URL du type :
```
https://icg-ecole.vercel.app
```

---

## ✅ ÉTAPE 5 — Ajouter un domaine personnalisé (optionnel)

Si vous voulez `icg-gabon.ga` ou `app.icg-gabon.ga` :

1. Dans Vercel → votre projet → onglet **"Settings"** → **"Domains"**
2. Tapez votre domaine : `app.icg-gabon.ga`
3. Vercel vous donne des enregistrements DNS à configurer
4. Chez votre registraire de domaine, ajoutez :
   ```
   Type : CNAME
   Nom  : app
   Valeur: cname.vercel-dns.com
   ```
5. Attendez 5 à 60 minutes → domaine actif avec HTTPS automatique

---

## 📱 ÉTAPE 6 — Installer l'application sur chaque appareil

Une fois votre URL Vercel active, partagez-la avec tous les utilisateurs.

### 📱 Android (Samsung, Xiaomi, etc.)
1. Ouvrez **Google Chrome**
2. Allez sur votre URL Vercel (ex: icg-ecole.vercel.app)
3. Chrome affiche automatiquement une bannière **"Ajouter à l'écran d'accueil"**
   → Si pas de bannière : Menu ⋮ → **"Ajouter à l'écran d'accueil"**
4. Confirmez → L'icône ICG apparaît sur votre bureau
5. ✅ L'app s'ouvre comme une application native !

### 🍎 iPhone / iPad (iOS 16.4+)
1. Ouvrez **Safari** (obligatoire, pas Chrome)
2. Allez sur votre URL Vercel
3. Appuyez sur le bouton **Partager** (carré avec flèche vers le haut)
4. Faites défiler → **"Sur l'écran d'accueil"**
5. Tapez le nom : **ICG École**
6. Appuyez **"Ajouter"**
7. ✅ L'icône ICG apparaît sur votre écran d'accueil

### 💻 Windows (PC)
1. Ouvrez **Google Chrome**
2. Allez sur votre URL Vercel
3. Dans la barre d'adresse, cliquez l'icône 💻 (ou ⊕) à droite
   → Ou : Menu ⋮ → **"Installer Intelligentsia Corporation Gabon"**
4. Cliquez **"Installer"**
5. ✅ Une fenêtre dédiée s'ouvre, l'app apparaît dans le menu Démarrer

### 🍏 Mac (macOS)
1. Ouvrez **Google Chrome** ou **Safari**
2. Allez sur votre URL Vercel
3. **Chrome** : icône d'installation dans la barre d'adresse → "Installer"
4. **Safari** : Fichier → "Ajouter au Dock" (macOS Sonoma+)
5. ✅ L'app apparaît dans votre Launchpad et Dock

### 📟 Tablette Android / iPad
→ Même procédure que le téléphone correspondant (Android ou iOS)

---

## 🔄 Mises à jour automatiques

Chaque fois que vous modifiez et uploadez des fichiers sur GitHub,
Vercel redéploie automatiquement en moins de 60 secondes.
Les utilisateurs reçoivent la mise à jour lors de leur prochaine visite.

---

## 🌐 Limites du plan Vercel gratuit

| Fonctionnalité | Plan Free | Suffisant ? |
|---|---|---|
| Déploiements | Illimités | ✅ Oui |
| Bande passante | 100 Go/mois | ✅ Oui |
| Domaine .vercel.app | Inclus | ✅ Oui |
| Domaine personnalisé | 1 gratuit | ✅ Oui |
| HTTPS automatique | Inclus | ✅ Oui |
| Vitesse CDN mondial | Inclus | ✅ Oui |

**⚠️ Important :** Vercel héberge uniquement le frontend (HTML/CSS/JS).
Pour les fonctionnalités temps réel (BDD, API, WhatsApp, caméras),
il faudra un serveur backend séparé (Railway, Render, ou VPS).

---

## 📞 Support

En cas de problème lors du déploiement :
- Documentation Vercel : https://vercel.com/docs
- Support GitHub : https://support.github.com
