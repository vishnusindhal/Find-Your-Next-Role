import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

const API_URL = "http://127.0.0.1:4000/api";
const statuses = ["new", "interested", "applied", "rejected", "interview", "offer", "archived"];

function Evidence({ label, item }) {
  const value = item?.value || "Not mentioned";
  return (
    <div className="evidence">
      <strong>{label}: {value}</strong>
      <span>{item?.evidence ? `Evidence: “${item.evidence}”` : "Evidence: Not mentioned"}</span>
    </div>
  );
}

function Badge({ children, className = "" }) {
  return <span className={`badge ${className}`}>{children}</span>;
}

function JobCard({ job, onSelect, onStatusChange }) {
  const eligibilityClass = job.eligibility?.status || "unclear";
  return (
    <article className="job-card">
      <div className="job-card-top">
        <div>
          <p className="company">{job.company}</p>
          <button className="title-button" onClick={() => onSelect(job.id)}>{job.title}</button>
        </div>
        <Badge className="score">{Number(job.score || 0).toFixed(1)}/10</Badge>
      </div>
      <div className="badges">
        <Badge>{job.type}</Badge>
        <Badge className={`eligibility-${eligibilityClass}`}>{eligibilityClass}</Badge>
        {job.isNew && <Badge className="new">NEW</Badge>}
        {job.isUpdated && <Badge className="updated">UPDATED</Badge>}
      </div>
      <p className="muted">{job.location} · Posted {job.posted || "Not mentioned"}</p>
      <div className="evidence-row">
        <Evidence label="Deadline" item={job.deadline} />
        <Evidence label="Pay" item={job.pay} />
      </div>
      <p className="summary">{job.summary || "No summary available."}</p>
      <div className="card-actions">
        <a href={job.applyUrl || job.url} target="_blank" rel="noopener noreferrer">{job.applyUrl ? "Apply on employer site" : "Open listing page"}</a>
        {job.applyUrl && <a href={job.url} target="_blank" rel="noopener noreferrer">View listing source</a>}
        <select value={job.tracking?.status || "new"} onChange={(event) => onStatusChange(job.id, event.target.value)} aria-label={`Status for ${job.title}`}>
          {statuses.map((status) => <option key={status} value={status}>{status}</option>)}
        </select>
      </div>
    </article>
  );
}

function JobDetail({ job, onBack, onStatusChange }) {
  return (
    <section>
      <button className="back-button" onClick={onBack}>← Back to jobs</button>
      <div className="detail-header">
        <p className="company">{job.company}</p>
        <h2>{job.title}</h2>
        <div className="badges">
          <Badge className="score">{Number(job.score || 0).toFixed(1)}/10</Badge>
          <Badge className={`eligibility-${job.eligibility?.status}`}>{job.eligibility?.status || "unclear"}</Badge>
        </div>
        <p className="muted">{job.location} · {job.type} · Posted {job.posted || "Not mentioned"}</p>
      </div>
      <div className="detail-grid">
        <Evidence label="Eligibility" item={{ value: job.eligibility?.status || "unclear", evidence: job.eligibility?.evidence }} />
        <Evidence label="Deadline" item={job.deadline} />
        <Evidence label="Pay" item={job.pay} />
      </div>
      <h3>Summary</h3>
      <p>{job.summary || "No summary available."}</p>
      <h3>Skills</h3>
      <p><strong>Matched:</strong> {job.matchedSkills?.join(", ") || "None listed"}</p>
      <p><strong>Missing:</strong> {job.missingSkills?.join(", ") || "None listed"}</p>
      <h3>Score reasons</h3>
      <ul>{(job.scoreReasons || []).map((reason) => <li key={reason}>{reason}</li>)}</ul>
      <h3>Description</h3>
      <details><summary>Show cleaned description</summary><p className="description">{job.descriptionText || "No description available."}</p></details>
      <div className="detail-actions">
        <a className="primary-link" href={job.applyUrl || job.url} target="_blank" rel="noopener noreferrer">{job.applyUrl ? "Apply on employer site" : "Open listing page"}</a>
        {job.applyUrl && <a href={job.url} target="_blank" rel="noopener noreferrer">View listing source</a>}
        <label>Status <select value={job.tracking?.status || "new"} onChange={(event) => onStatusChange(job.id, event.target.value)}>{statuses.map((status) => <option key={status} value={status}>{status}</option>)}</select></label>
      </div>
    </section>
  );
}

function App() {
  const [jobs, setJobs] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [filters, setFilters] = useState({ search: "", minScore: "", location: "", sort: "default" });
  const [selectedId, setSelectedId] = useState(null);
  const [selectedJob, setSelectedJob] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadJobs = async (page = 1) => {
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ page, pageSize: 12, ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== "")) });
    try {
      const response = await fetch(`${API_URL}/jobs?${params}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not load jobs");
      setJobs(result.data);
      setPagination(result.pagination);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadJobs(); }, [filters]);

  useEffect(() => {
    if (!selectedId) {
      setSelectedJob(null);
      return;
    }
    fetch(`${API_URL}/jobs/${encodeURIComponent(selectedId)}`)
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Job not found")))
      .then(setSelectedJob)
      .catch((requestError) => setError(requestError.message));
  }, [selectedId]);

  const updateStatus = async (jobId, status) => {
    const response = await fetch(`${API_URL}/tracker/${encodeURIComponent(jobId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!response.ok) {
      const result = await response.json();
      setError(result.error || "Could not update status");
      return;
    }
    setJobs((current) => current.map((job) => job.id === jobId ? { ...job, tracking: { ...job.tracking, status } } : job));
    setSelectedJob((current) => current?.id === jobId ? { ...current, tracking: { ...current.tracking, status } } : current);
  };

  const changeFilter = (key, value) => setFilters((current) => ({ ...current, [key]: value }));

  return (
    <main className="app-shell">
      <header className="app-header">
        <div><p className="eyebrow">JOB AGENT DASHBOARD · PHASE M1</p><h1>Find your next role.</h1></div>
        <p className="header-note">Display-only dashboard. Applications happen on the company site.</p>
      </header>
      {selectedJob ? <JobDetail job={selectedJob} onBack={() => setSelectedId(null)} onStatusChange={updateStatus} /> : (
        <>
          <section className="filter-panel">
            <label>Search<input value={filters.search} onChange={(event) => changeFilter("search", event.target.value)} placeholder="Title or company" /></label>
            <label>Minimum score<input type="number" min="0" max="10" value={filters.minScore} onChange={(event) => changeFilter("minScore", event.target.value)} /></label>
            <label>Location<input value={filters.location} onChange={(event) => changeFilter("location", event.target.value)} placeholder="India or Remote" /></label>
            <label>Sort<select value={filters.sort} onChange={(event) => changeFilter("sort", event.target.value)}><option value="default">Deadline, newest, score</option><option value="score">Highest score</option><option value="posted">Newest posted</option><option value="deadline">Deadline soonest</option></select></label>
          </section>
          {error && <p className="error-message">{error}</p>}
          {loading ? <p className="empty">Loading jobs...</p> : jobs.length === 0 ? <p className="empty">No jobs match these filters.</p> : (
            <>
              <JobSection title="Internships" jobs={jobs.filter((job) => job.type === "intern")} onSelect={setSelectedId} onStatusChange={updateStatus} />
              <JobSection title="Full-time" jobs={jobs.filter((job) => job.type === "full-time")} onSelect={setSelectedId} onStatusChange={updateStatus} />
              <JobSection title="Other / unclear type" jobs={jobs.filter((job) => !["intern", "full-time"].includes(job.type))} onSelect={setSelectedId} onStatusChange={updateStatus} />
              <nav className="pagination"><button disabled={pagination.page <= 1} onClick={() => loadJobs(pagination.page - 1)}>Previous</button><span>Page {pagination.page} of {pagination.pages}</span><button disabled={pagination.page >= pagination.pages} onClick={() => loadJobs(pagination.page + 1)}>Next</button></nav>
            </>
          )}
        </>
      )}
    </main>
  );
}

function JobSection({ title, jobs, onSelect, onStatusChange }) {
  if (jobs.length === 0) return null;
  return <section className="job-section"><div className="section-heading"><h2>{title}</h2><span>{jobs.length} shown</span></div><div className="job-grid">{jobs.map((job) => <JobCard key={job.id} job={job} onSelect={onSelect} onStatusChange={onStatusChange} />)}</div></section>;
}

createRoot(document.getElementById("root")).render(<StrictMode><App /></StrictMode>);
