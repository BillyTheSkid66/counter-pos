# Counter React frontend source

Contains the current src/, public/, index.html, original package.json, pnpm dependency lockfile, Vite configuration and a standalone frontend build script. Backend source and credentials are not included.

Use Node.js 24 and pnpm 10. Install dependencies with:

    pnpm install --frozen-lockfile

Develop with:

    pnpm dev

Set VITE_API_URL to your Counter API URL before starting Vite or building. For Windows PowerShell, build with the included script:

    .\scripts\build-frontend.ps1 -ApiUrl https://counter-api.app-playground.co.uk

On other platforms set VITE_API_URL in your shell and run pnpm build (or npm run build after installing dependencies). Output is dist/. Upload its contents to the frontend website document root.

VITE_API_URL is compiled into the browser bundle. It is a public URL; never put secrets in VITE_ variables. For local development use your running local API URL. The API must permit the frontend origin through its CORS configuration.

The original package.json also contains api:dev, api:test and saas:up commands for the full repository. Those commands need backend files that are outside this frontend-only package. dev and build work independently.

Do not serve the development server publicly in production. The frontend needs a running, separately configured Counter API and PostgreSQL to use the live inventory, sales and authentication features.
