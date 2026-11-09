# Frigo Chef

Photographiez votre frigo, l'appli trouve la meilleure recette. Frigo partagé en famille, liste de courses, carnet de recettes, mode cuisine avec minuteurs, menus de la semaine et batch cooking.

## Installer en un clic

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/nicolax2b-prog/frigo-chef)

Pendant l'installation, Cloudflare demande deux valeurs :

- **GEMINI_API_KEY** : votre clé Gemini gratuite, à créer sur https://aistudio.google.com/apikey
- **ACCESS_CODE** : le code d'accès que vous donnerez à votre famille et vos amis

Ensuite, ouvrez l'adresse `https://frigo-chef.<votre-nom>.workers.dev`, entrez le code d'accès, un nom de foyer et votre prénom. Les personnes qui tapent le même nom de foyer partagent le même frigo.

## Bon à savoir

- L'IA utilisée est l'offre gratuite de Google Gemini, limitée en nombre de demandes par jour. Avec la clé gratuite, Google peut utiliser les contenus envoyés pour améliorer ses services.
- Chaque foyer est limité à 60 demandes à l'IA par jour (réglable avec `DAILY_AI_LIMIT` dans `wrangler.toml`).
- La clé Gemini reste sur le serveur et n'est jamais envoyée aux téléphones.
