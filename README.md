# Counter POS

Multi-tenant till, inventory and loyalty system. Node.js 24 + Fastify + PostgreSQL API, React/Vite frontend. Self-hosted on a ScalaHosting SPanel VPS.

| Folder | What it is |
|---|---|
| `api/` | Fastify API, SQL migrations, seeds, backup/monitor/restore scripts |
| `frontend/` | React till and back-office UI (Vite) |
| `pci-companion/` | Standalone PCI questionnaire preparation tool (static, browser-local) — future add-on |
| `docs/` | Deployment guide and VPS infrastructure profile |

## Run locally

```bash
# API
cd api && npm ci && cp .env.example .env   # edit .env, then:
npm run migrate && npm run dev

# Frontend (separate terminal)
cd frontend && pnpm install --frozen-lockfile
VITE_API_URL=http://127.0.0.1:3134 pnpm dev
```

## Build for the VPS

```bash
cd frontend && VITE_API_URL=https://counter-api.app-playground.co.uk pnpm build
# upload dist/ contents to the frontend document root
```

See `docs/DEPLOYMENT.md` for the full SPanel procedure. Never commit `.env` files, database dumps or anything under `dist/`.

## Live

- API: https://counter-api.app-playground.co.uk (SPanel app, port 3134, account `ggadmin`)
- Frontend: https://counterpos.app-playground.co.uk
