COUNTER POS - SELF-HOSTED SPANEL RELEASE

Read DEPLOYMENT.md supplied beside the archives for the complete instructions.
This release uses the VPS PostgreSQL service at 127.0.0.1:5432.
No Neon subscription or Docker installation is required.

1. Ask ScalaHosting to provision the isolated database and roles (bootstrap.sql is for NEW empty installations only).
2. If preserving Neon data, export/restore it into a new database before applying migrations. Changing DATABASE_URL does not transfer data.
3. Upload the API archive outside the public website folder. Run npm ci --omit=dev with Node 24.
4. Create private .env and .env.migrate from their examples. Replace all placeholders and keep the two secrets separate.
5. Run node --env-file=.env.migrate src/migrate.js explicitly. Remove privileged migration credentials from the runtime environment.
6. Run node --env-file=.env src/preflight.js.
7. Configure ONLY Counter API in SPanel. Preserve its assigned port (3134 at the supplied audit) and run npm start. Verify localhost proxy routing and HTTPS.
8. Upload only the frontend archive contents into the frontend document root, including .htaccess.
9. Verify readiness at /health. Sign in again; older sessions are intentionally invalidated. Enable an authenticator for platform owners.
10. Configure/test local SMTP, daily backups, restore checks and monitored alerts before accepting real sales.

RUN_MIGRATIONS=false and SEED_SHOWCASE=false are mandatory for the production startup.
Never expose .env, .env.migrate, database dumps or API source in public_html.
The old Docker/Neon instructions do not apply to this package.
