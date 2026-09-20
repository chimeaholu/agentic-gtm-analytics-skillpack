/**
 * Reading a report run response.
 *
 * The platform's defining trap: aggregates and grand totals are computed over the
 * FULL result set while detail rows are silently truncated at 2,000 with no
 * pagination. The total is right, the rows are partial, and nothing errors.
 * `allData` is the only signal, so it is surfaced at the top level of every
 * result this server returns.
 */

export const REPORT_ROW_CAP = 2000;

export interface Cell {
  label: string;
  value: unknown;
}

export interface FactMapEntry {
  aggregates?: Array<{ label: string; value: unknown }>;
  rows?: Array<{ dataCells: Cell[] }>;
}

export interface RunResponse {
  allData?: boolean;
  hasDetailRows?: boolean;
  factMap?: Record<string, FactMapEntry>;
  reportMetadata?: Record<string, unknown>;
  reportExtendedMetadata?: {
    detailColumnInfo?: Record<string, { label?: string; dataType?: string }>;
    aggregateColumnInfo?: Record<string, { label?: string; dataType?: string }>;
    groupingColumnInfo?: Record<string, { label?: string; dataType?: string }>;
  };
  groupingsDown?: { groupings?: GroupingNode[] };
  groupingsAcross?: { groupings?: GroupingNode[] };
}

interface GroupingNode {
  key: string;
  label: string;
  value?: unknown;
  groupings?: GroupingNode[];
}

export interface ReadResult {
  /** Top level, never buried, never stripped. */
  allData: boolean;
  truncated: boolean;
  truncation_note: string | null;
  has_detail_rows: boolean;
  grand_total: Array<{ label: string; value: unknown }> | null;
  detail_row_count: number;
  detail_rows: Array<Record<string, unknown>>;
  groupings: Array<{ key: string; label: string; aggregates: Array<{ label: string; value: unknown }> }>;
  aggregate_columns: string[];
  detail_columns: string[];
  applied_filters: unknown;
}

const TRUNCATION_NOTE =
  `allData is false: the report returned the first ${REPORT_ROW_CAP} detail rows and there is no pagination. ` +
  'The aggregates and grand totals above ARE computed over the full result set and can be reported as exact. ' +
  'The detail rows are a truncated extract, biased toward whatever the report\'s sort order put first, so any ' +
  'breakdown computed from them is incomplete. For the complete row-level answer use bulk_query against the ' +
  'underlying objects — noting that you then own the report\'s logic, and custom summary formulas ' +
  '(PARENTGROUPVAL, PREVGROUPVAL, ROWCOUNT) cannot be reproduced outside a report at all.';

export function readRunResponse(body: RunResponse): ReadResult {
  const allData = body.allData !== false; // absent means the API did not say it truncated
  const factMap = body.factMap ?? {};
  const ext = body.reportExtendedMetadata ?? {};

  const aggregateColumns = Object.values(ext.aggregateColumnInfo ?? {}).map(c => c.label ?? '');
  const detailColumnKeys = Object.keys(ext.detailColumnInfo ?? {});
  const detailColumnLabels = Object.values(ext.detailColumnInfo ?? {}).map(c => c.label ?? '');

  // "T!T" is the grand total, and on a tabular report it is the only key.
  const grand = factMap['T!T'];

  const detailRows: Array<Record<string, unknown>> = [];
  for (const entry of Object.values(factMap)) {
    for (const row of entry.rows ?? []) {
      const obj: Record<string, unknown> = {};
      row.dataCells.forEach((cell, i) => {
        const key = detailColumnKeys[i] ?? `column_${i}`;
        // `value` for arithmetic, `label` for display. Parsing a locale-formatted,
        // currency-symboled label back to a number is how a calculation corrupts.
        obj[key] = cell.value;
        obj[`${key}__label`] = cell.label;
      });
      detailRows.push(obj);
    }
  }

  return {
    allData,
    truncated: !allData,
    truncation_note: allData ? null : TRUNCATION_NOTE,
    has_detail_rows: body.hasDetailRows === true,
    grand_total: grand?.aggregates?.map(a => ({ label: a.label, value: a.value })) ?? null,
    detail_row_count: detailRows.length,
    detail_rows: detailRows,
    groupings: flattenGroupings(body.groupingsDown?.groupings ?? [], factMap),
    aggregate_columns: aggregateColumns,
    detail_columns: detailColumnLabels,
    applied_filters: body.reportMetadata?.reportFilters ?? null,
  };
}

/**
 * factMap keys are `<downGroupingKey>!<acrossGroupingKey>`, where `T` means total.
 * "0!T" is the first down-grouping's total; "0!0" crosses it with the first
 * across-grouping on a matrix report.
 */
function flattenGroupings(
  nodes: GroupingNode[],
  factMap: Record<string, FactMapEntry>,
  prefix = '',
): Array<{ key: string; label: string; aggregates: Array<{ label: string; value: unknown }> }> {
  const out: Array<{ key: string; label: string; aggregates: Array<{ label: string; value: unknown }> }> = [];
  for (const node of nodes) {
    const key = prefix ? `${prefix}_${node.key}` : node.key;
    out.push({
      key,
      label: node.label,
      aggregates: factMap[`${key}!T`]?.aggregates?.map(a => ({ label: a.label, value: a.value })) ?? [],
    });
    if (node.groupings?.length) out.push(...flattenGroupings(node.groupings, factMap, key));
  }
  return out;
}
