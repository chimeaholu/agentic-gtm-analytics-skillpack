-- Append-only metric contract register.
-- Rows are metric DEFINITIONS, not metric values.
-- A redefinition INSERTS a new version. Nothing is ever overwritten except
-- effective_to and is_current on the superseded row.
--
-- ANSI SQL. Adjust array and timestamp types for your warehouse:
--   Snowflake  : text[] -> ARRAY,        timestamp -> TIMESTAMP_NTZ
--   BigQuery   : text[] -> ARRAY<STRING>, timestamp -> TIMESTAMP
--   Postgres   : as written

create table metric_contract_versions (
  metric_key              text        not null,
  version                 int         not null,
  human_name              text        not null,
  -- The sentence a stakeholder would say out loud. This is what
  -- calculation-integrity-audit checks the actual denominator against.
  stakeholder_sentence    text        not null,
  source_system           text        not null,
  formula                 text        not null,
  numerator_definition    text,
  denominator_definition  text,
  grain                   text        not null,
  time_basis              text        not null,
  -- 'additive' | 'semi-additive over <dimension>' | 'non-additive'
  additivity              text        not null,
  valid_dimensions        text[],
  convention_notes        text,
  effective_from          date        not null,
  effective_to            date,
  is_current              boolean     not null,
  approver                text        not null,
  created_at              timestamp   not null default current_timestamp,
  primary key (metric_key, version)
);

-- Exactly one current version per metric.
create unique index metric_contract_one_current
  on metric_contract_versions (metric_key)
  where is_current;

-- ---------------------------------------------------------------------------
-- Seed rows: one metric, two versions, showing a redefinition.
-- Synthetic. No client data.
-- ---------------------------------------------------------------------------

insert into metric_contract_versions
 (metric_key, version, human_name, stakeholder_sentence, source_system,
  formula, numerator_definition, denominator_definition, grain, time_basis,
  additivity, valid_dimensions, convention_notes,
  effective_from, effective_to, is_current, approver)
values
 ('win_rate', 1, 'Win Rate',
  'Of the opportunities that closed in the period, the share we won, counted by opportunity.',
  'warehouse',
  'won_count / (won_count + lost_count)',
  'count of opportunities with stage Closed Won and close_date in period',
  'count of opportunities with stage Closed Won or Closed Lost and close_date in period',
  'opportunity', 'close_date',
  'non-additive',
  array['segment','region','owner','product','close_month'],
  'Close-date basis. Biased by which deals happened to land in the period. Closed - No Decision is bucketed as Lost in this version, which inflates the loss rate.',
  date '2026-01-01', date '2026-09-30', false, 'name of approver'),

 ('win_rate', 2, 'Win Rate',
  'Of the opportunities that closed in the period where the customer made a decision, the share we won, counted by opportunity.',
  'warehouse',
  'won_count / (won_count + lost_count)',
  'count of opportunities with stage Closed Won and close_date in period',
  'count of opportunities with stage Closed Won or Closed Lost and close_date in period, EXCLUDING stage Closed - No Decision',
  'opportunity', 'close_date',
  'non-additive',
  array['segment','region','owner','product','close_month'],
  'Close-date basis. No Decision moved out of the denominator on 2026-10-01, so the rate steps up at that boundary. Charts crossing 2026-10-01 must mark it. The cohort-created-basis rate is tracked separately as win_rate_cohort.',
  date '2026-10-01', null, true, 'name of approver');

-- ---------------------------------------------------------------------------
-- Redefinition procedure, as a transaction template.
-- ---------------------------------------------------------------------------
--
-- begin;
--   update metric_contract_versions
--      set effective_to = :boundary_date, is_current = false
--    where metric_key = :metric_key and is_current;
--
--   insert into metric_contract_versions (...) values (..., :boundary_date, null, true, :approver);
-- commit;
--
-- Then: run data-lineage-tracer blast radius for :metric_key and mark the
-- boundary on every downstream artefact it returns.

-- ---------------------------------------------------------------------------
-- The check a publishing job runs before rendering a number.
-- ---------------------------------------------------------------------------

-- Does the reporting window cross a definition boundary?
-- If this returns rows, the chart must mark the boundary and must not
-- describe the crossing as a trend.
--
-- select metric_key, version, effective_from
-- from   metric_contract_versions
-- where  metric_key = :metric_key
--   and  effective_from > :window_start
--   and  effective_from <= :window_end;
