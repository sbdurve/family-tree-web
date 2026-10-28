# Family Tree Web - Setup Guide

This guide reflects the current architecture of `family-tree-web`, where GitHub stores the application code, Cloudflare D1 stores the live family-tree data, and Cloudflare R2 stores Excel backups/import files and images.

## Current data flow

- **Live site data:** Cloudflare D1
- **Upload/replace:** Admin Dashboard -> uploaded `data.xlsx` -> D1 + R2 `data.xlsx`
- **Backup/export:** D1 -> R2 `data_export.xlsx` + browser download
- **Code deployment:** GitHub -> Cloudflare Pages
- **Important:** normal code deployments do **not** import the repository `data.xlsx` into D1.

---

## Prerequisites

- Node.js 18+
- npm 9+ (bundled with Node.js)
- Wrangler CLI 3+
- Cloudflare account
- GitHub repository for the project

Install Wrangler if required:

```bash
npm install -g wrangler
```

Log in to Cloudflare:

```bash
wrangler login
```

Python and `openpyxl` are **not required for the current production workflow**. The application uses the npm `xlsx` package to read and generate Excel workbooks at runtime.

---

## Step 1 - Install dependencies

From the project directory:

```bash
cd family-tree-web
npm install
```

The project must include the `xlsx` package because the Admin upload/export API routes process Excel workbooks directly.

If it is missing:

```bash
npm install xlsx
```

Commit both `package.json` and `package-lock.json` if this command changes them.

---

## Step 2 - Create the D1 database

Create the production D1 database:

```bash
wrangler d1 create family-tree-db
```

Copy the returned database ID into `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "family-tree-db"
database_id = "PASTE_YOUR_ID_HERE"
```

The binding name must match the application helper in `src/lib/db.ts`.

---

## Step 3 - Create the R2 bucket

Create the R2 bucket used by the application:

```bash
wrangler r2 bucket create family-tree-images
```

Configure the R2 binding in `wrangler.toml`. For example:

```toml
[[r2_buckets]]
binding = "R2"
bucket_name = "family-tree-images"
```

The binding name must be `R2` if `src/lib/db.ts` returns `env.R2` from `getR2()`.

If the application uses a public R2 URL for images, configure the required public-access URL in Cloudflare and set the corresponding application variable, for example:

```toml
[vars]
NEXT_PUBLIC_R2_PUBLIC_URL = "YOUR_R2_PUBLIC_URL"
```

Do not make family-tree Excel backups public merely because image objects require public access.

---

## Step 4 - Create the D1 schema

Apply the initial schema migration.

Local development database:

```bash
npm run migrate:local
```

Production D1 database:

```bash
npm run migrate:remote
```

The live application uses D1 tables including:

- `people`
- `spouses`
- `links`
- `galleries`
- submission-related tables defined by the project schema

The old `migrations/0002_import.sql` Excel-data import is no longer required for routine production updates.

---

## Step 5 - Configure the admin password

Set the Cloudflare secret used by the Admin login:

```bash
wrangler pages secret put ADMIN_PASSWORD
```

Enter a strong password when prompted.

The Admin Dashboard is available at:

`/admin`

Unauthenticated users are redirected to:

`/admin/login`

Admin API routes should use the existing `isAdmin(request)` check from `src/lib/auth.ts`.

Sensitive routes that must be protected include:

- `/api/admin/upload-data`
- `/api/admin/export-data`
- the existing people, spouse, links and submission administration routes

Signing out deletes the Admin session through the existing login API.

---

## Step 6 - Prepare `data.xlsx`

The Admin Dashboard accepts an `.xlsx` workbook containing these sheets:

### `Main`

Columns used:

- `person`
- `person_full`
- `parent`
- `tooltip`
- `spouse`
- `spouse_full`

### `images`

Columns used:

- `person`
- `image`

### `links`

Columns used:

- `person`
- `link`
- `tooltip`

### `gdrives`

Columns used:

- `description`
- `link`

The worksheet names should remain exactly `Main`, `images`, `links` and `gdrives` because the upload route validates these names.

---

## Step 7 - Upload/replace family data

Log in to the Admin Dashboard and use the Excel upload controls.

The current import flow is:

```text
Computer data.xlsx
        |
        v
/api/admin/upload-data
        |
        +--> parse and validate workbook with xlsx
        |
        +--> replace relevant D1 records
        |
        +--> save the uploaded workbook to R2 as data.xlsx
        v
Live family tree reads the updated D1 data
```

The live site does **not** read `data.xlsx` directly. D1 remains the operational database.

The upload route reproduces the original Excel mapping for:

- people
- spouses
- images
- links
- galleries
- generation placeholder nodes

The route should only report success after the D1 import completes and the uploaded workbook is stored in R2.

A website rebuild is not required when family data is updated through the Admin Dashboard.

---

## Step 8 - Export/backup D1 to Excel

The Admin Dashboard's **Backup D1 to Excel** function uses:

`/api/admin/export-data`

The flow is:

```text
Live D1
   |
   v
/api/admin/export-data
   |
   +--> create data_export.xlsx
   +--> store data_export.xlsx in R2
   +--> download data_export.xlsx to the browser
```

The generated workbook recreates these sheets:

- `Main`
- `gdrives`
- `images`
- `links`

R2 therefore normally contains:

- `data.xlsx` - latest workbook uploaded through Admin
- `data_export.xlsx` - latest workbook regenerated from live D1

`data_export.xlsx` is the better representation of the current live database when Admin edits have been made after the last Excel upload.

---

## Step 9 - Local development

For the Cloudflare-compatible preview workflow use the project's preview command:

```bash
npm run preview
```

For a faster Next.js-only development loop you can use:

```bash
npx next dev
```

D1 and R2 behaviour should be tested in an environment where the appropriate Cloudflare bindings are available.

---

## Step 10 - Cloudflare Pages deployment

The normal Cloudflare build command is now:

```bash
npm run pages:build
```

Do **not** restore the old build command that automatically ran:

```text
python scripts/import_from_excel.py
npm run import:remote
```

That old process could overwrite newer Admin-managed D1 data with an older repository workbook during a code deployment.

The intended separation is now:

```text
GitHub code change -> Cloudflare deployment -> application code only

Admin Excel upload -> D1 + R2 -> family data update
```

If deploying manually using the configured project script:

```bash
npm run pages:deploy
```

A custom domain can be configured for the Cloudflare Pages project separately from the family-data workflow.

---

## Project structure

Relevant current structure:

```text
family-tree-web/
├── migrations/
│   └── 0001_initial.sql
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   ├── submit/
│   │   │   └── page.tsx
│   │   ├── admin/
│   │   │   ├── page.tsx
│   │   │   └── login/
│   │   │       └── page.tsx
│   │   └── api/
│   │       ├── tree/
│   │       │   └── route.ts
│   │       ├── submit/
│   │       │   └── route.ts
│   │       ├── upload/
│   │       │   └── route.ts
│   │       └── admin/
│   │           ├── login/
│   │           │   └── route.ts
│   │           ├── submissions/
│   │           ├── people/
│   │           ├── spouses/
│   │           ├── links/
│   │           ├── upload-data/
│   │           │   └── route.ts
│   │           ├── download-data/
│   │           │   └── route.ts
│   │           └── export-data/
│   │               └── route.ts
│   ├── components/
│   │   ├── FamilyTree.tsx
│   │   └── SubmissionForm.tsx
│   └── lib/
│       ├── db.ts
│       └── auth.ts
├── env.d.ts
├── next.config.mjs
├── wrangler.toml
├── package.json
└── package-lock.json
```

If `scripts/import_from_excel.py`, `migrations/0002_import.sql`, or the old GitHub Actions D1-export workflow remain in the repository, treat them as legacy/fallback material rather than part of the current live-data workflow. They may be removed after confirming that no package script or workflow still references them.

---

## Admin workflow

1. Visit `/admin`.
2. If not authenticated, log in using the `ADMIN_PASSWORD`-protected login page.
3. Review, approve or reject public submissions.
4. Use the **People** area to add, edit or delete family members and spouses.
5. Use the **Links** area to add or delete links.
6. Use **Upload data.xlsx** when a complete Excel-based replacement/import is required.
7. The upload API updates D1 and stores the uploaded workbook in R2 as `data.xlsx`.
8. Use **Backup D1 to Excel** to create `data_export.xlsx` from the current live D1 database, save it to R2 and download it.
9. Use **Sign out** when finished.

---

## Updating the family tree

### For individual changes

Prefer the Admin Dashboard's People, Spouse, Links and submission tools. These modify the live D1 database directly.

### For a full Excel replacement/import

1. Prepare the four-sheet `data.xlsx` workbook.
2. Log in to `/admin`.
3. Choose the workbook.
4. Run the upload/replace operation.
5. Confirm the Admin success response.
6. Refresh the family tree if required.

Do not run the old Python import or `npm run import:remote` for normal production updates.

---

## Backup and recovery model

The current arrangement provides two useful Excel copies:

### `R2/data.xlsx`

The last workbook uploaded through the Admin Dashboard.

### `R2/data_export.xlsx`

The latest workbook generated from the live D1 database when **Backup D1 to Excel** was run.

For recovery after Admin edits, prefer the most recent verified `data_export.xlsx`, because D1 may contain changes that were made after the last `data.xlsx` upload.

---

## Important operational rules

- Treat **D1 as the live source used by the website**.
- Do not automatically re-import GitHub `data.xlsx` during code deployments.
- Keep `/api/admin/upload-data` authenticated because it can replace live family data.
- Keep `/api/admin/export-data` authenticated because it exports the family database.
- Do not expose family Excel backups publicly through R2 unless that is explicitly intended.
- Take a D1-to-Excel backup before a major workbook replacement.
- Keep GitHub focused on application code; data updates should normally happen through the Admin Dashboard.

---

## Current architecture summary

```text
                    GitHub
                       |
                       | code deployment
                       v
                Cloudflare Pages
                       |
                       | reads
                       v
                      D1
                  LIVE DATA
                 /         \
                /           \
 Admin data.xlsx             Backup D1 to Excel
      |                            |
      v                            v
upload-data API              export-data API
      |                            |
      +--> D1                      +--> data_export.xlsx
      |                            |      in R2
      +--> data.xlsx in R2         +--> browser download
```

This architecture keeps application deployment independent from family-data maintenance and prevents routine code deployments from replacing the current D1 data.
