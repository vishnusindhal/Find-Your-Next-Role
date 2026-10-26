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

## Import real data and run the dashboard

The normal workflow imports the real scan output. Run the importer after the Python or
JavaScript scans have produced data:

```powershell
cd "C:\Users\vishn\OneDrive\Desktop\job agent\job-dashboard\server"
npm run import:real
```

The importer removes existing dashboard collections before loading the real records. It
imports PayU, Atlan, and The Job Company records, including valid employer application
URLs and company LinkedIn links. The Job Company records remain labeled as third-party
listings.

Start the API and React client in two terminals, or use the combined command:

```powershell
cd "C:\Users\vishn\OneDrive\Desktop\job agent\job-dashboard"
npm run dev
```

Open the dashboard at <http://localhost:5173>.

Verify the API:

```powershell
Invoke-RestMethod "http://127.0.0.1:4000/api/health"
Invoke-RestMethod "http://127.0.0.1:4000/api/jobs?pageSize=12"
```

The dashboard provides employer application links when a reliable URL was resolved,
the original listing source, and a company LinkedIn link for manual referral research.
It does not search for employees, send messages, request referrals, or submit applications.

## Optional sample data

```powershell
cd "C:\Users\vishn\OneDrive\Desktop\job agent\job-dashboard"
npm run seed
```

The seed command replaces only the sample database collections with 60 realistic fake jobs,
40 companies, 3 runs, and default tracking records. It never uses real job data.

## Dashboard features

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

Example:

```powershell
Invoke-RestMethod "http://127.0.0.1:4000/api/jobs?type=intern&pageSize=12"
```
