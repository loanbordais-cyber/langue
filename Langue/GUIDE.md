# Langue : mise en ligne pas à pas

L'appli fonctionne déjà en **mode démo** : l'IA est simulée et les données restent dans le navigateur.
Pour avoir la vraie correction par l'IA et la sauvegarde dans le cloud, suis ces étapes dans l'ordre.
Compte environ 30 minutes la première fois.

---

## 1. La clé API Gemini (l'IA, gratuite)

1. Va sur **aistudio.google.com** et connecte-toi avec un compte Google.
2. Clique **Get API key → Create API key** et copie-la.
3. **N'ajoute pas de moyen de paiement.** Sans carte bancaire, ton compte reste sur l'offre gratuite et rien ne peut être facturé.

**Coût : 0 €.** L'appli utilise **Gemini 3.8 Flash**, gratuit avec une limite de demandes par jour.
Langue fait environ 3 à 6 demandes par jour, très loin de cette limite.
Si la limite est atteinte (rare), l'appli bascule toute seule sur **Gemini 3.1 Flash-Lite**, gratuit lui aussi.

**À savoir** : sur l'offre gratuite, Google peut utiliser ce que tu envoies à l'IA (tes textes et réponses en anglais) pour améliorer ses produits.
N'y écris rien de confidentiel.

**Tout le reste est gratuit** :
- **Supabase** (offre gratuite) : sauvegarde et connexion. Attention, un projet gratuit est mis en pause après 7 jours sans aucune utilisation. Si tu fais tes exercices chaque jour, ça n'arrive pas. Sinon, tu le réveilles en un clic sur supabase.com.
- **Netlify** (offre gratuite) : hébergement de l'appli.
- **Correcteur rouge, dictée, voix** : intégrés au téléphone et à l'appli, sans aucun coût.

---

## 2. Supabase (sauvegarde + connexion)

1. Va sur **supabase.com**, crée un compte, puis **New project**.
   - Nom : `langue`
   - Région : *West EU (Paris)* ou *Central EU (Frankfurt)*
   - Note bien le mot de passe de la base de données.
2. Ouvre **SQL Editor → New query**, colle tout le contenu du fichier `supabase/schema.sql`, puis clique **Run**.
   Tu dois voir « Success ».
3. **Connexion par code e-mail** : va dans **Authentication → Emails** (Email Templates).
   - Dans le modèle **Magic Link**, remplace le contenu par :
     `<h2>Ton code Langue</h2><p>Ton code de connexion : <strong>{{ .Token }}</strong></p>`
   - Fais pareil dans le modèle **Confirm signup**.

   L'appli demande un code à 6 chiffres plutôt qu'un lien, parce qu'un lien s'ouvrirait dans Safari et non dans l'appli installée.

---

## 3. La fonction IA (côté serveur)

1. Dans Supabase, va dans **Edge Functions → Deploy a new function → Via Editor**.
2. Nomme la fonction exactement `ai`.
3. Remplace le code d'exemple par tout le contenu de `supabase/functions/ai/index.ts`, puis clique **Deploy**.
4. Va dans **Edge Functions → Secrets** et ajoute :
   - `GEMINI_API_KEY` = ta clé de l'étape 1

---

## 4. Relier l'appli à Supabase

1. Dans Supabase, va dans **Project Settings → API**. Copie :
   - **Project URL** (`https://xxxx.supabase.co`)
   - la clé **anon / public**
2. Ouvre `config.js` et colle-les :

```js
SUPABASE_URL: "https://xxxx.supabase.co",
SUPABASE_ANON_KEY: "eyJhbGciOi...",
```

La clé *anon* peut être publique : la sécurité est assurée par les règles de la base (chaque compte ne voit que ses données).
Ta clé Gemini, elle, n'est **jamais** dans l'appli.

---

## 5. Mettre l'appli en ligne (gratuit)

Méthode la plus simple, sans rien installer : **Netlify Drop**.

1. Va sur **app.netlify.com/drop** et crée un compte gratuit.
2. Glisse-dépose **le dossier entier de l'appli** (celui qui contient `index.html`).
3. Netlify te donne une adresse du type `https://langue-xxxx.netlify.app`. Tu peux la renommer dans *Site configuration*.

Pour une mise à jour plus tard : sur Netlify, ouvre ton site → **Deploys** et glisse à nouveau le dossier.

*(Alternative : Vercel. Le fichier `vercel.json` est déjà prêt.)*

---

## 6. Installer Langue sur ton iPhone

1. Ouvre l'adresse Netlify dans **Safari**. Ça ne marche pas depuis Chrome sur iPhone.
2. Touche **Partager ⬆︎ → Sur l'écran d'accueil → Ajouter**.
3. Ouvre Langue depuis l'écran d'accueil, entre ton e-mail, puis le code reçu.

C'est prêt. Chaque jour à 3h, de nouveaux mots et de nouvelles questions t'attendent.

---

## 7. (Facultatif) Les notifications de rappel

Elles demandent un peu plus de configuration. Demande-moi et je générerai les clés pour toi.

1. **Clés VAPID** (identifient tes notifications) : j'en génère une paire publique/privée.
2. Dans `config.js`, colle la clé publique dans `VAPID_PUBLIC_KEY`, puis remets le dossier en ligne (étape 5).
3. Dans Supabase, crée une deuxième Edge Function nommée `reminders` :
   - colle le contenu de `supabase/functions/reminders/index.ts` ;
   - dans ses réglages, **désactive « Verify JWT »**.
4. Dans **Edge Functions → Secrets**, ajoute :
   - `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`
   - `VAPID_SUBJECT` = `mailto:ton-email`
   - `CRON_SECRET` = un mot de passe inventé (ex. `langue-rappel-8f3k2`)
5. Dans **Database → Extensions**, active `pg_cron` et `pg_net`.
6. Dans **SQL Editor**, lance cette requête en remplaçant `xxxx` et `TON_SECRET` :

```sql
select cron.schedule('langue-rappels', '0 * * * *', $$
  select net.http_post(
    url := 'https://xxxx.supabase.co/functions/v1/reminders',
    headers := '{"Content-Type":"application/json","x-cron-secret":"TON_SECRET"}'::jsonb,
    body := '{}'::jsonb
  );
$$);
```

7. Dans l'appli installée : **Réglages → Notification de rappel**, puis choisis l'heure.
   Tu reçois un rappel à cette heure-là seulement si tes exercices du jour ne sont pas finis.

---

## Bon à savoir

- **Nouvelle journée à 3h du matin** : nouveaux mots et nouvelles questions. Chaque exercice a un bouton pour recommencer si tu veux en faire plus.
- **Correcteur rouge** : il est intégré à l'appli (dictionnaire anglais). Il marche quelle que soit la langue de ton clavier. Le correcteur de l'iPhone est désactivé dans ces champs.
- **Dictée** : elle utilise la reconnaissance vocale de Safari, réglée en anglais. Si elle refuse de démarrer, autorise le micro (Réglages iPhone → Safari → Microphone). Sinon, utilise le micro du clavier iPhone avec un clavier anglais.
- **Tester sur ordinateur** : `python3 -m http.server 8765` dans le dossier, puis ouvre http://localhost:8765.
