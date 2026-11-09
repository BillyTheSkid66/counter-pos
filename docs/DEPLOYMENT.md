# Counter POS: self-hosted ScalaHosting / SPanel release

This is the authoritative deployment guide for the supplied SPanel package. The app uses Node.js 24, Apache/SPanel HTTPS routing and the VPS PostgreSQL service over localhost TCP. It needs no Neon subscription, Docker, Redis or Python. Docker files are an optional development alternative and are not the installation method for this VPS.

## Before upload

The intended existing application is `/home/ggadmin/counter-api`, served at `https://counter-api.app-playground.co.uk`. Its port was 3134 in the supplied infrastructure audit. Confirm the current SPanel values before updating it. Do not allocate another application on that port. Ports 3000, 3100 and 3148 belong to other applications.

ScalaHosting must confirm account access to PostgreSQL, create the isolated database/roles, verify Apache proxies to localhost, investigate the reported high kernel CPU usage and confirm SPanel starts the app after reboot. No production configuration has been changed by this local release work.

## 1. Prepare PostgreSQL

For a NEW EMPTY installation only, ask ScalaHosting to run `api/bootstrap.sql` as a PostgreSQL administrator. It creates database `counter`, restricted runtime role `counter_app`, and privileged migration role `counter_migrator`, and prompts for separate passwords. The migrator uses BYPASSRLS because migrations and security-definer authentication helpers need to access protected rows. Its credentials must never be used by the running API or frontend. Give each deployment its own database and credentials. Do not run bootstrap.sql against an existing installation.

Require PostgreSQL 15 or later (the supplied VPS profile reports PostgreSQL 18), pgcrypto and standard TCP access to 127.0.0.1:5432. Keep PostgreSQL private. Confirm local authentication rules with the provider; do not edit shared PostgreSQL services yourself.

## 2. Transfer existing Neon data, if needed

Changing DATABASE_URL does not move data. Put the old application into a maintenance window so no sales can be written while taking the final dump. Export the existing database with a pg_dump client at least as new as the source server. Store source credentials in a protected libpq service/.pgpass, not shell history. Use `pg_dump --format=custom --file=counter-transfer.dump` with that service. Verify `pg_restore --list counter-transfer.dump` and a checksum.

Restore into a NEW EMPTY VPS database, using `pg_restore --exit-on-error --single-transaction --no-owner --role=counter_migrator --dbname="service=counter_target" counter-transfer.dump`. Run the restore as an administrator permitted to SET ROLE. The target must have counter_app, counter_migrator and pgcrypto available. Check for source-only extensions/roles first; ask ScalaHosting to resolve incompatible dependencies. Do not ignore restore errors. Retain the schema_migrations table from the dump so already-applied migrations do not run again. Verify customer, product, stock, sale, tender and loyalty totals before opening the new installation.

The supplied transfer procedure is not a claim that the current Neon database has been exported or tested. Keep the source untouched until the VPS pilot and recovery checks pass. Never allow both old and new databases to accept live transactions simultaneously.

## 3. Install and configure the API

1. Preserve the existing app directory, environment and a verified database backup before updating.
2. Extract `counter-api-spanel.zip` into a new private release directory under `/home/ggadmin`, outside any public document root. Install with `npm ci --omit=dev` under Node 24. Do not upload Windows node_modules.
3. Copy `.env.example` to `.env`. Set the localhost DATABASE_URL with URL-encoded credentials; set PORT to the current SPanel assigned port. Use HOST=127.0.0.1 and trust only the actual Apache proxy addresses. Keep the default five-connection pool until resource tests justify changing it.
4. Generate two DIFFERENT secrets using `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Use one for JWT_SECRET and one for MFA_ENCRYPTION_KEY. Save the encryption key securely with recovery records: changing or losing it makes enrolled authenticators unreadable.
5. Set CORS_ORIGIN and PUBLIC_APP_URL to the final frontend HTTPS origin. Set PLATFORM_ADMIN_EMAILS to your real owner account, never a demo address. MFA is required for these platform owners.
6. Configure SMTP_URL and MAIL_FROM for the existing VPS Exim service. The example localhost port is a candidate only; ask ScalaHosting which authenticated submission settings and sender domain to use. Verify real delivery, SPF/DKIM and the recovery link. SMTP is not considered tested merely because the app starts.
7. Set permissions `chmod 600 .env`. Keep RUN_MIGRATIONS=false and SEED_SHOWCASE=false. The production startup refuses automatic migrations/showcase seeding.
8. Create a private `.env.migrate` from `.env.migrate.example`, using the separate migration credentials. Run `node --env-file=.env.migrate src/migrate.js`, then `node --env-file=.env src/preflight.js`. Keep `.env.migrate` outside the runtime directory after use, or restrict it to the owner. Never put it in public_html.
9. In SPanel NodeJS Manager update only Counter API: Custom application, correct API domain and release directory, current assigned port, start command `npm start`. The entry script reads the private .env. Verify the proxy before changing directories for the active app.
10. Check `/health/live` for process availability and `/health` for API plus database readiness. A failed database check returns HTTP 503.

For a completely new business use the trial onboarding with your own unique PIN, then set up an authenticator in Account security. Do not run demo:reset on a real customer database. Existing sessions are intentionally invalidated when upgrading to the new server-backed session format; sign in again.

## 4. Upload the frontend

Upload only the CONTENTS of `counter-frontend-spanel.zip` to the frontend document root. Include `.htaccess` for client-side route fallback. The supplied build targets `https://counter-api.app-playground.co.uk`. If the API domain changes, rebuild on your development computer:

`powershell -File scripts/build-spanel-release.ps1 -ApiUrl https://your-api-domain.example`

API_URL is embedded at build time; changing backend environment variables will not change it. Build outside the VPS to save RAM/CPU. Use SPanel/Apache HTTPS, not a second Caddy listener on ports 80/443.

## 5. Backups, monitoring and recovery

Configure a private libpq service `counter_backup` in ~/.pg_service.conf and credentials in ~/.pgpass (chmod 600). Use the isolated migrator or a provider-created read-only role with BYPASSRLS for complete backups. A normal tenant role can produce incomplete backups. Service entries need host, port, dbname and user; never upload these files to the frontend.

Run `PGSERVICE=counter_backup BACKUP_DIR=/home/ggadmin/counter-backups sh backup.sh` daily using account cron. The script writes a custom archive atomically, checks its table of contents and creates a checksum. It does not delete old backups automatically. Define retention for the VPS disk allowance and copy encrypted backups to separate storage under your control. The app itself runs fully on the VPS; a same-disk backup cannot recover a lost VPS.

For a recovery drill, ask the provider to create a new empty database ending in `_restore_test` and a libpq service for it. Run `RESTORE_SERVICE=counter_restore_test RESTORE_DATABASE=counter_restore_test sh restore-test.sh /path/to/backup.dump`. This refuses a non-empty database or a name without the test suffix. A successful SQL restore is only the first step: compare totals and test sign-in, checkout and refunds using that isolated restored database. A production restore is a separate owner-approved maintenance operation.

Use cron MAILTO for a monitored mailbox. Run `HEALTH_URL=https://counter-api.app-playground.co.uk/health BACKUP_DIR=/home/ggadmin/counter-backups sh monitor.sh` every five minutes. It reports readiness failure, a missing/older-than-26-hour backup and disk use at or above 85%. It stays quiet when checks pass. Verify alert delivery deliberately. A cron check on this VPS cannot alert during a complete VPS outage; provider monitoring or an independent uptime check is still needed for that case.

Set a supported SPanel/PM2 memory restart threshold after measuring usage; start with one API process. Confirm restart recovery with ScalaHosting before a production reboot test. Do not add a competing PM2 daemon or systemd service. Rotate logs and monitor CPU, swap activity, connection counts and API response times during the pilot.

## 6. Update / rollback / pilot

Keep the previous release directory and verified recovery point. Apply migrations explicitly in maintenance mode, switch SPanel to the new directory, upload the matching frontend, restart only Counter API and run the smoke checks. For rollback, stop writes first. Confirm the old application is compatible with the migrated schema before reverting it. If a database restore is necessary, use a compatible verified backup and document any transactions after that backup. Do not copy PostgreSQL data files or blindly re-run bootstrap.

Pilot checks: unique staff login, authenticator enrolment/login, logout-everywhere, emailed password recovery, no cross-business access, checkout retry after a lost response, concurrent sales, discounts and mixed tax categories, split payments, full/partial refunds, store-credit redemption and returns, loyalty reversal, till closing and a refund issued in a later till session. Verify real scanners, receipts and card-terminal procedures. Counter records card payments; it does not command a terminal to charge/refund a card. Do that through the chosen provider and reconcile its records.

Lost authenticator: request a verified administrator-assisted recovery. The database owner can remove only the verified user's auth_security secret/pending_secret, reset last_totp_step and revoke all their auth_sessions in one transaction, then require re-enrolment. A password reset does not remove MFA. Do not clear another user's MFA based only on an email request.

## Local verification commands

`npm run build`

`npm --prefix server test` runs source contracts and money tests; database tests explicitly skip when no test connection is supplied.

Set NODE_ENV=test, INTEGRATION_DATABASE_URL to a counter_app connection to an isolated database whose name ends in `_test`, and TEST_ADMIN_DATABASE_URL to that test database's administrator connection. Apply migrations first, then run `npm --prefix server run test:integration`. These tests create disposable businesses and require no production access.

Infrastructure capacity, reboot recovery, production SMTP, off-server recovery and shop hardware remain deployment/pilot checks. Passing local tests does not establish VPS capacity or replace an accounting/security review.
