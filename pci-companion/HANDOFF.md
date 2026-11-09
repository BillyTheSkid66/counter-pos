# PCI Companion — AI handoff

Start here, then read pci-assistant/README.md and design/DESIGN.md.

## Owner intent and status
The owner wanted a website to help a merchant prepare PCI questionnaires across a mix of payment providers. This is a working local prototype. They then said it was just a test and they may return to it. This bundle is for sharing and continuing development; no deployment or external submission is requested by this handoff.

The separate Counter inventory/till/loyalty application is outside this package. PCI Companion is independent and does not use Counter's API or database.

## Run it
Install Node 24. In pci-assistant run npm ci, npm test, then npm run dev.
Development: http://127.0.0.1:5187/ . Production: npm run build, then npm run preview at http://127.0.0.1:5188/ . Ports are strict; stop any old instance if occupied.
The included dist directory is a compiled static website. Follow README.md for Apache/SPanel upload and access protection. No Docker, database, server process or paid AI API is needed for this prototype.

## Implemented
- Shared checked business profile; multiple providers and channels.
- Guided original preparation questions, explicit application of suggestions from checked facts, evidence references and reviewer/date.
- Custom question packs by pasted wording or structured JSON; example schema included.
- Review of unknown/no answers, unsupported scope, missing references and NA explanations.
- CSV working answers, browser print/PDF, JSON backup/import and browser-local persistence.
- Import validation, CSV formula neutralisation, potential card-data guardrails and corrupt-storage recovery.

## Boundaries to preserve
This is a preparation workspace, not a complete official SAQ, PCI certification, scan, automatic eligibility decision or attestation. The acquirer/compliance-accepting entity confirms the required form and scope. Do not infer compliant answers or silently reuse answers after scope/form changes. Current official form wording must be supplied and reviewed.
There is no real provider portal integration, portal autofill, PDF extraction, AI service, sign-in, server-side storage, tenant isolation or audit retention. Browser localStorage is unencrypted and specific to the origin/profile. No card data, secrets, credentials or detailed sensitive security evidence should be entered. Guardrails are not comprehensive detection.
Future portal automation needs the real form and field mapping. A shared commercial version would need a properly designed backend/access model and operational controls. Keep final review/declaration with the responsible person.

## Code map
- src/main.jsx: React UI, forms, navigation, import/export, local persistence.
- src/model.js: data validation, question model, suggestions, review and CSV.
- src/styles.css: responsive visual design.
- test/model.test.js: model behaviour tests.
- public/.htaccess: Apache response headers; merge with hosting access-control directives.
- design/: visual concept and implementation notes; concept PNG is not a runtime asset.

## Verification and next steps
Eight model tests and production build were rerun when packaging this handoff. Previous browser QA covered profile/provider editing, mixed providers, draft suggestions, NA validation, custom forms, review, persistence, CSV download, desktop/mobile layout and the clean compiled preview. Fictional browser QA records were never bundled.
No VPS deployment, email, provider login, submission or scan has occurred. Scope guidance references in README were checked during initial development; recheck current authoritative guidance before extending the compliance logic.
Discuss the owner's next objective before expanding this shelved test. Prior likely next work: map actual provider forms, then decide whether browser-local storage remains sufficient.

## Package contents
Source, locked dependencies, tests, design reference, setup/deployment guide, sample question pack and compiled site are included. npm ci restores dependencies. node_modules, browser records, credentials and the unrelated Counter application are excluded. SHA256SUMS.txt verifies bundled files.
