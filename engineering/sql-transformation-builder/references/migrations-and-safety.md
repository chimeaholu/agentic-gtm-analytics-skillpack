# Migrations, the runner's failure modes, and the read-only guard

No dbt, no orchestrator, no framework. A directory of SQL files, a ledger table
and a driver. Everything here works on a laptop with a service account and on a
CI runner with nothing installed.

---

## 1. Layout

```
migrations/
  001_create_schemas.sql
  002_create_raw_load_ledger.sql
  …
  destructive/
    D001_drop_legacy_mart.sql        # never auto-applied
  seeds/
    dim_channel.csv                  # config data, loaded by a seed step
runner/
  migrate.py                         # the runner in SKILL.md §2
```

`meta.schema_migrations` is the ledger. It is created by the runner, not by a
migration, so there is no bootstrapping order problem.

---

## 2. Idempotency, per statement type

| Statement | Idempotent form | Note |
|---|---|---|
| create table | `CREATE TABLE IF NOT EXISTS` | does **not** reconcile a changed schema — a column added later needs its own migration |
| create view | `CREATE OR REPLACE VIEW` | safe and self-correcting; the right default for views |
| add column | `ALTER TABLE … ADD COLUMN IF NOT EXISTS` | supported on BigQuery and Snowflake |
| drop column | `ALTER TABLE … DROP COLUMN` | **destructive**, goes in `destructive/` |
| backfill | `MERGE` / `INSERT … WHERE NOT EXISTS` | keyed so a re-run is a no-op; never a bare `INSERT SELECT` |
| grant | `GRANT … TO ROLE …` | naturally idempotent |
| rename | drop-and-recreate, or `ALTER TABLE … RENAME` | **not idempotent**; guard with an existence check and treat as destructive |

A backfill migration deserves particular care: it is the one that runs against
data rather than structure, and a re-run that duplicates rows is exactly the
failure the checksum rule cannot catch (because the file did not change — the
runner simply ran it twice after a partial failure).

```sql
-- 012_backfill_currency_on_fact_ad_spend.sql
-- idempotent: only touches rows that are still null
UPDATE marts.fact_ad_spend f
SET currency_original = a.account_currency
FROM config.dim_ad_account a
WHERE f.account_id = a.account_id
  AND f.currency_original IS NULL;
```

---

## 3. Runner failure modes, and what the runner does about each

| Failure | Symptom | Runner behaviour |
|---|---|---|
| An applied migration was edited | two environments diverge under one version number | **fatal exit with the filename.** Never auto-repair, never re-apply |
| Two migrations share a number | `006_a.sql` and `006_b.sql` | fatal at scan time — ordering would be filesystem-dependent |
| Partial failure mid-file | some objects created, no ledger row | the migration is **not** recorded, so the next run re-applies it; this is why every statement must be idempotent |
| Two runners concurrently | duplicate applications, interleaved DDL | acquire an advisory lock (a row in `meta.migration_lock` with a `CREATE TABLE IF NOT EXISTS` plus a conditional insert) before scanning; release in a `finally` |
| A migration depends on a later number | fails on a missing object | numbering is the dependency graph; fix by renumbering the **unapplied** file |
| Drift: someone changed prod by hand | schema does not match migrations | detect by diffing `INFORMATION_SCHEMA.COLUMNS` against the expected set; report, do not silently correct |

**Warehouse-specific constraints on transactionality:**

- **BigQuery** supports scripting and multi-statement transactions for DML, but
  DDL is effectively auto-committed. Keep one logical change per migration so a
  partial failure leaves an obvious state.
- **Snowflake** auto-commits DDL per statement. Same rule.
- Neither gives you the all-or-nothing DDL transaction a Postgres habit
  assumes. **Idempotency is the substitute for transactionality**, which is why
  rule 2 in `SKILL.md` §1 is non-negotiable rather than stylistic.

---

## 4. The destructive set

Anything in `destructive/` is never applied by the normal run. To apply one:

1. The runner prints the **blast radius, computed not asserted**: row count,
   byte size, dependent views and downstream marts found by scanning
   `view_definition` text for the object name.
2. `write-gate` takes it from there — explicit approval, naming the object and
   the row count, from the human in the conversation.
3. The applied destructive migration is recorded in the same ledger with a
   `destructive = TRUE` flag, so "when did that table disappear" is answerable.

```sql
-- what "dependent" means, concretely, on BigQuery
SELECT table_schema, table_name
FROM `project.region-us`.INFORMATION_SCHEMA.VIEWS
WHERE REGEXP_CONTAINS(view_definition, r'(?i)\blegacy_mart\b');
```

This is a text scan and it is not complete — it misses dynamic SQL, BI tool
queries and anything outside the warehouse. **Say that when you report the
blast radius.** An incomplete dependency list presented as complete is worse
than no list.

---

## 5. The read-only guard, in full

```python
import re

FORBIDDEN = re.compile(
    r"\b(INSERT|UPDATE|DELETE|MERGE|TRUNCATE|DROP|ALTER|CREATE|GRANT|REVOKE|"
    r"COPY|UNLOAD|PUT|GET|CALL|EXECUTE|BEGIN|COMMIT|ROLLBACK|USE)\b", re.I)

SYSTEM = re.compile(
    r"\b(INFORMATION_SCHEMA|ACCOUNT_USAGE|PG_CATALOG|SNOWFLAKE\.|SYS\.|"
    r"MYSQL\.|__INTERNAL)", re.I)

LINE_COMMENT  = re.compile(r"--[^\n]*")
BLOCK_COMMENT = re.compile(r"/\*.*?\*/", re.S)

class Unsafe(Exception):
    pass

def strip_comments(sql: str) -> str:
    prev = None
    while prev != sql:                     # nested block comments
        prev = sql
        sql = BLOCK_COMMENT.sub(" ", sql)
    return LINE_COMMENT.sub(" ", sql)

def assert_read_only(sql: str, allowed_objects: set[str], allow_metadata=False):
    s = strip_comments(sql).strip().rstrip(";")
    if ";" in s:
        raise Unsafe("stacked statements are not permitted")
    if not re.match(r"^\s*(WITH|SELECT)\b", s, re.I):
        raise Unsafe("query must begin with SELECT or WITH")
    if FORBIDDEN.search(s):
        raise Unsafe("write or DDL keyword present")
    if SYSTEM.search(s) and not allow_metadata:
        raise Unsafe("system schema access not permitted in this context")
    for obj in referenced_objects(s):
        if obj.lower() not in {a.lower() for a in allowed_objects}:
            raise Unsafe(f"object not in allowlist: {obj}")
    return True
```

### Why each piece is there

- **Strip comments first.** `SELECT 1 /* DROP TABLE x */` is harmless and must
  not be blocked; `SELECT 1 --\n; DROP TABLE x` is not harmless and must be.
  A matcher that runs before stripping gets both backwards.
- **Require a `SELECT`/`WITH` prefix.** Positive assertion beats negative
  enumeration — it is the difference between "nothing I thought of" and "only
  what I intended".
- **Reject stacked statements** instead of parsing them. Parsing multi-statement
  SQL correctly is a project; rejecting it is a line.
- **Allowlist objects.** A denylist is a list of the attacks you thought of.
- **`allow_metadata` is a parameter, not a prompt permission.** The introspection
  skills need `INFORMATION_SCHEMA`; an analysis query does not. The distinction
  is made by the caller in code.

### What the guard is not

It is the **second** line of defence. The first is a database role with
`SELECT` only, granted on `marts` and `quality`. If the guard is the only thing
standing between an agent and a `DELETE`, the credential is wrong.

And it does not stop an expensive query — that is the cost pre-flight in
`SKILL.md` §7. Safe and cheap are different properties with different controls.
