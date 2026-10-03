// Minimal stand-in for the chainable supabase-js query builder, for unit-testing
// server logic that talks to `supabaseAdmin` without hitting a real database.

export type FakeCall = { table: string; method: string; args: unknown[] };

export type FakeResult = { data: unknown; error: unknown; count?: number | null };

export type FakeTableConfig = FakeResult | FakeResult[];

type FakeQueryBuilder = {
  [
    K in
      | "select"
      | "insert"
      | "update"
      | "delete"
      | "eq"
      | "neq"
      | "in"
      | "not"
      | "is"
      | "lt"
      | "lte"
      | "gt"
      | "gte"
      | "limit"
      | "order"
  ]: (...args: unknown[]) => FakeQueryBuilder;
} & {
  maybeSingle: () => Promise<FakeResult>;
  single: () => Promise<FakeResult>;
  then: (resolve: (v: FakeResult) => unknown, reject?: (e: unknown) => unknown) => Promise<unknown>;
  catch: (reject: (e: unknown) => unknown) => Promise<unknown>;
};

function toResult(config: FakeTableConfig | undefined, callIndexForTable: number): FakeResult {
  if (!config) return { data: null, error: null };
  if (Array.isArray(config)) return config[callIndexForTable] ?? config[config.length - 1]!;
  return config;
}

/**
 * `tables[tableName]` is either one FakeResult reused for every call against that
 * table, or an array of FakeResults consumed in call order (for tables hit more
 * than once per test with different expected responses).
 */
export function createFakeSupabase(tables: Record<string, FakeTableConfig> = {}) {
  const calls: FakeCall[] = [];
  const callCountByTable = new Map<string, number>();

  const from = (table: string) => {
    const index = callCountByTable.get(table) ?? 0;
    callCountByTable.set(table, index + 1);
    const result = toResult(tables[table], index);

    const record = (method: string, args: unknown[]) => {
      calls.push({ table, method, args });
      return builder;
    };

    const builder: FakeQueryBuilder = {
      select: (...args: unknown[]) => record("select", args),
      insert: (...args: unknown[]) => record("insert", args),
      update: (...args: unknown[]) => record("update", args),
      delete: (...args: unknown[]) => record("delete", args),
      eq: (...args: unknown[]) => record("eq", args),
      neq: (...args: unknown[]) => record("neq", args),
      in: (...args: unknown[]) => record("in", args),
      not: (...args: unknown[]) => record("not", args),
      is: (...args: unknown[]) => record("is", args),
      lt: (...args: unknown[]) => record("lt", args),
      lte: (...args: unknown[]) => record("lte", args),
      gt: (...args: unknown[]) => record("gt", args),
      gte: (...args: unknown[]) => record("gte", args),
      limit: (...args: unknown[]) => record("limit", args),
      order: (...args: unknown[]) => record("order", args),
      maybeSingle: () => Promise.resolve(result),
      single: () => Promise.resolve(result),
      then: (resolve: (v: FakeResult) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(result).then(resolve, reject),
      catch: (reject: (e: unknown) => unknown) => Promise.resolve(result).catch(reject),
    };
    return builder;
  };

  const rpc = (name: string, args?: Record<string, unknown>) => {
    calls.push({ table: `rpc:${name}`, method: "rpc", args: [args] });
    const result = toResult(tables[`rpc:${name}`], 0);
    return Promise.resolve(result);
  };

  return { from, rpc, calls };
}

export function insertPayloads(calls: FakeCall[], table: string): unknown[] {
  return calls.filter((c) => c.table === table && c.method === "insert").map((c) => c.args[0]);
}
