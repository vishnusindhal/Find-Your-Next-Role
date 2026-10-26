# Job Agent Dashboard

This dashboard displays data produced by the Python job agent. It does not scrape websites,
apply to jobs, or send messages.

## Requirements

- Node.js 20 or newer
- MongoDB locally, or a free MongoDB Atlas cluster

## MongoDB options

### Local MongoDB

1. Install MongoDB Community Server for Windows.
2. Keep the MongoDB service running.
3. Use the default URI in `server/.env`:

   ```text
   mongodb://127.0.0.1:27017/job_agent_dashboard
   ```

### MongoDB Atlas

1. Create a free shared cluster.
2. Create a database user and allow your current IP address.
3. Copy the connection string into `server/.env` as `MONGODB_URI`.

Docker is intentionally not required because the target laptop has 8 GB RAM.

## Install

From PowerShell:

```powershell
cd "C:\Users\vishn\OneDrive\Desktop\job agent\job-dashboard"
Copy-Item server\.env.example server\.env
npm install
npm install --prefix server
npm install --prefix client
```

Edit `server\.env` if MongoDB is not local.

## Seed sample data

```powershell
npm run seed
```

The seed command replaces only the sample database collections with 60 realistic fake jobs,
40 companies, 3 runs, and default tracking records. It never uses real job data.

## Run

Start both the API and Vite client:

```powershell
npm run dev
```

Open <http://localhost:5173>. The page should show the API health status.

The API health endpoint is <http://127.0.0.1:4000/api/health>.

## Phase M1 usage

After seeding, start the apps:

```powershell
npm run dev
```

The Jobs page supports:

- Search by title or company.
- Minimum score and location filters.
- Default sorting by deadline, posted date, and score.
- Separate Internship and Full-time sections.
- Job detail view with pay, deadline, and eligibility evidence.
- Status updates stored in MongoDB through the tracker API.

The API endpoints added in M1 are:

```text
GET   /api/jobs
GET   /api/jobs/:id
PATCH /api/tracker/:jobId
```

## Import the real scans

The sample data is only for development. To remove it and import the real JavaScript scan:

```powershell
cd "C:\Users\vishn\OneDrive\Desktop\job agent\job-dashboard\server"
npm run import:real
```

This imports the PayU scan, the non-PayU scan, and the extracted
`data\thejobcompany_jobs.jsonl` records from the agent workspace. It intentionally removes
the seeded sample collections before importing, so the dashboard cannot mix fake and real
records. The Job Company records retain their third-party source label and evidence; they
are not presented as employer-verified listings.

Example:

```powershell
Invoke-RestMethod "http://127.0.0.1:4000/api/jobs?type=intern&pageSize=12"
```

## M0 scope

M0 provides project setup, database models, sample data, the health endpoint, and the basic
client shell. Jobs pages, importing, tracking views, and charts are intentionally reserved for
later phases.
