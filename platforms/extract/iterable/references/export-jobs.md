# Export jobs — sync versus async, and the list that is not finished

Iterable has a **proper async export job API**, which several platforms in this pack lack.
Use it. The sync endpoints exist for small pulls and are a trap for anything historical.

## Sync versus async

| Path | Limit | Use for |
|---|---|---|
| `/api/export/data.csv`, `/api/export/data.json` | **4/minute**, returns data inline | small, immediate pulls |
| `/api/export/userEvents` | sync | small event pulls |
| **`POST /api/export/start`** | **1/second, per organization** | **anything real** |

**Sync export endpoints are 4 per minute and return data inline — fine for small pulls,
useless for history.**

## The async lifecycle

```
POST   /api/export/start                → jobId
GET    /api/export/jobs                 → job status
GET    /api/export/{jobId}/files        → file list (paginate with startAfter)
DELETE /api/export/{jobId}              → clean up
```

**Call `get_available_export_data_types` rather than hard-coding the exportable list.** It
covers email, push, SMS, WhatsApp and in-app events plus user and purchase data, and it
changes.

## The progressive file list — the trap that looks like success

**Files are added to the list progressively as the job runs.** So a `get_export_files`
response mid-job:

- returns HTTP 200
- contains a list of real, downloadable files
- **is not the complete file list**

An agent that fetches the list once, downloads everything in it, and reports the export
complete has **silently truncated the export**. Nothing in the response says "partial".

**Poll to terminal state before treating the list as final.**

```python
def wait_for_export(client, job_id, interval=10, timeout=3600):
    """File lists grow progressively — only a terminal job status means the list is final."""
    deadline = time.monotonic() + timeout
    while True:
        job = client.get_export_job(job_id)
        if job["state"] in ("complete", "failed", "cancelled"):
            return job
        if time.monotonic() > deadline:
            raise TimeoutError(f"export {job_id} still running")
        time.sleep(interval)
```

## Caps and queueing

- **Each file is up to 10 MB.** Paginate the file list with `startAfter`.
- **Each job is limited to 100 GB.** A larger extraction means multiple jobs, chunked by
  date or type.
- **Concurrent export jobs are limited, and additional starts are queued rather than
  rejected.** So a successful `POST /api/export/start` may simply be **waiting**, not
  running. Check the job state rather than inferring from the 200.

And remember the scope: **`POST /api/export/start` is 1/second per *organization*.** Your
export budget is shared with every other team on the org, and there is nothing in the
response that tells you they are using it.

## The 60-second consistency window

**Iterable's own docs advise allowing at least 60 seconds between updates to the same
user, or before sending a campaign based on that update.**

That is a much longer window than most platforms admit to, and it is documented rather than
folklore. Two patterns it breaks:

- **update profile → immediately trigger a campaign** — the campaign targets stale data
- **update profile → immediately read it back to verify** — intermittent false failures

Build the delay in. "Intermittently correct" is the worst failure shape because it passes
in testing.

## Per-user event history defaults to 30

**`GET /api/events/{email}` defaults to `limit=30`.**

An agent asking "what has this user done" receives **the 30 most recent events** and,
unchecked, **reports that as the whole history**. Set `limit` explicitly, and when the
returned count equals the limit, assume there is more.

For genuine per-user history at scale, the async export with `userEvents` is the right
tool, not a loop over `/api/events/{email}`.

## Regions do not join

**US and EU data centres are separate universes** — `api.iterable.com` versus
`api.eu.iterable.com`, different keys, no cross-DC queries.

**A multi-region brand needs two integrations and cannot join the data inside Iterable.**
Any unified view is assembled downstream, by you, in a warehouse. Say that at planning time
rather than after building one side.

## Key storage, when using the MCP

The official MCP stores the API key locally: **macOS Keychain, Windows DPAPI, or a
mode-0600 file on Linux.** Permissions bind to the stored key, so:

- **defaults are read-only, no PII, no writes, no sends**
- each capability is opted into explicitly: **`ITERABLE_USER_PII`,
  `ITERABLE_ENABLE_WRITES`, `ITERABLE_ENABLE_SENDS`** (which requires writes)
- **a sandbox key and a production key can carry different grants on the same machine**

For a public skillpack, recommend the default posture — read-only, no PII — and treat
enabling sends as a `write-gate` decision, not a configuration step.
