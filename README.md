# Bastion Grid

Izometrický 3D tower defense v prehliadači (Three.js). Dva módy: Basic a Zombie.

- `index.html` – hra (ES moduly zo `src/`, three.js z unpkg)
- `npm run build` – vygeneruje `preview.html` (jeden súbor, otvoriteľný cez file://)
- `npm run dev` / `npm run deploy` – lokálny server / deploy na Cloudflare Workers
- Push na `main` = automatický deploy (GitHub Action, secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`)
