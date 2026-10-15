// The benchmark/metric identity a durable GPU round carries: parsing a round's
// declared benchmark, normalizing every historical alias at one compatibility
// boundary, and formatting identities for error messages.
//
// Extracted verbatim from workflow-execution.ts; ownership is unchanged — the
// only consumer is the GPU-round inspection and materialization beside it.

interface BenchmarkIdentity {
  readonly name: string;
  readonly unit?: string;
  readonly direction: "higher" | "lower";
  readonly legacy: boolean;
}

interface DurableBenchmark {
  readonly identity: BenchmarkIdentity;
  readonly best: number;
}

interface DurableMetricCompatibility {
  readonly benchmark?: DurableBenchmark;
  readonly previousBest?: number;
  readonly preserveTopLevelBest: boolean;
  readonly preserveTopLevelDirection: boolean;
}

export function parseBenchmarkIdentity(value: Record<string, unknown>, label: string): BenchmarkIdentity {
  const direction = value.direction;
  if (direction !== "higher" && direction !== "lower") {
    throw new Error(`${label} must have direction higher or lower`);
  }
  const modernName = typeof value.name === "string" && value.name.trim() !== "" ? value.name : undefined;
  const modernUnit = typeof value.unit === "string" && value.unit.trim() !== "" ? value.unit : undefined;
  const legacyName = typeof value.metric === "string" && value.metric.trim() !== "" ? value.metric : undefined;
  if (modernName !== undefined) {
    if (modernUnit === undefined || legacyName !== undefined) {
      throw new Error(`${label} modern identity requires name+unit and must not also use legacy metric`);
    }
    return { name: modernName, unit: modernUnit, direction, legacy: false };
  }
  if (legacyName !== undefined && modernUnit === undefined) {
    return { name: legacyName, direction, legacy: true };
  }
  throw new Error(`${label} must use either modern name+unit or legacy metric without unit`);
}

function parseDurableBenchmark(value: Record<string, unknown>): DurableBenchmark | undefined {
  const metric = value.metric;
  if (metric === undefined) return undefined;
  if (typeof metric === "string") {
    if (metric.trim() === "") throw new Error("durable current_best.metric must be a non-empty string or object");
    if (owns(value, "unit")) {
      throw new Error("legacy durable metric must not contain a modern unit alias");
    }
    const direction = value.direction;
    if (direction !== "higher" && direction !== "lower") {
      throw new Error("legacy durable metric direction must be higher or lower");
    }
    if (typeof value.best !== "number" || !Number.isFinite(value.best)) {
      throw new Error("legacy durable metric best must be a finite number");
    }
    return { identity: { name: metric, direction, legacy: true }, best: value.best };
  }
  if (typeof metric !== "object" || metric === null || Array.isArray(metric)) {
    throw new Error("durable current_best.metric must be a non-empty string or object");
  }
  const metricRecord = metric as Record<string, unknown>;
  if (owns(metricRecord, "metric")) {
    throw new Error("durable metric object must not contain a legacy metric alias");
  }
  if (typeof metricRecord.name !== "string" || metricRecord.name.trim() === "") {
    throw new Error("durable metric name must be a non-empty string");
  }
  const name = metricRecord.name;
  const direction = metricRecord.direction;
  if (direction !== "higher" && direction !== "lower") {
    throw new Error("durable metric direction must be higher or lower");
  }
  if (metricRecord.unit !== undefined && (typeof metricRecord.unit !== "string" || metricRecord.unit.trim() === "")) {
    throw new Error("durable metric unit must be a non-empty string when present");
  }
  if (typeof metricRecord.best !== "number" || !Number.isFinite(metricRecord.best)) {
    throw new Error("durable metric best must be a finite number");
  }
  const unit = metricRecord.unit as string | undefined;
  return {
    identity: unit === undefined
      ? { name, direction, legacy: true }
      : { name, unit, direction, legacy: false },
    best: metricRecord.best,
  };
}

function owns(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function metricCompatibilityKey(name: string): string {
  return `metric_${name.replaceAll(/[^A-Za-z0-9_-]/g, "_")}`;
}

function finiteMetricAlias(value: Record<string, unknown>, key: string): number | undefined {
  if (!owns(value, key)) return undefined;
  const alias = value[key];
  if (typeof alias !== "number" || !Number.isFinite(alias)) {
    throw new Error(`durable metric compatibility alias "${key}" must be a finite number`);
  }
  return alias;
}

/** Normalize historical current-best metric representations at one explicit
 * compatibility boundary. Every alias that is present must identify the same
 * finite value as the canonical metric; malformed or ambiguous durable state
 * is never treated as if it had no previous best. */
export function normalizeDurableMetricCompatibility(
  value: Record<string, unknown>,
  roundIdentity: BenchmarkIdentity | undefined,
): DurableMetricCompatibility {
  const benchmark = parseDurableBenchmark(value);
  const identity = benchmark?.identity ?? roundIdentity;
  const metric = value.metric;
  if (metric === undefined && (owns(value, "best") || owns(value, "direction"))) {
    throw new Error("durable top-level best/direction aliases require current_best.metric");
  }

  const aliases: Array<{ readonly key: string; readonly value: number }> = [];
  const dynamicKeys = Object.keys(value).filter((key) => key.startsWith("metric_"));
  const expectedDynamicKey = identity === undefined ? undefined : metricCompatibilityKey(identity.name);
  if (identity === undefined) {
    const aliasIdentities = new Set(dynamicKeys.map((key) => key.slice("metric_".length)));
    if (owns(value, "tflops")) aliasIdentities.add("tflops");
    if (aliasIdentities.has("")) {
      throw new Error('durable metric compatibility alias "metric_" has no metric identity');
    }
    if (aliasIdentities.size > 1) {
      throw new Error("durable metric compatibility aliases encode conflicting metric identities");
    }
  }
  for (const key of dynamicKeys) {
    if (expectedDynamicKey !== undefined && key !== expectedDynamicKey) {
      throw new Error(`durable metric compatibility alias "${key}" conflicts with metric "${identity!.name}"`);
    }
    aliases.push({ key, value: finiteMetricAlias(value, key)! });
  }
  const genericValue = finiteMetricAlias(value, "value");
  if (genericValue !== undefined) aliases.push({ key: "value", value: genericValue });
  const tflops = finiteMetricAlias(value, "tflops");
  if (tflops !== undefined) {
    if (identity !== undefined && identity.name !== "tflops") {
      throw new Error(`durable metric compatibility alias "tflops" conflicts with metric "${identity.name}"`);
    }
    aliases.push({ key: "tflops", value: tflops });
  }

  const metricIsObject = typeof metric === "object" && metric !== null && !Array.isArray(metric);
  const topLevelBest = metricIsObject ? finiteMetricAlias(value, "best") : undefined;
  if (topLevelBest !== undefined) aliases.push({ key: "best", value: topLevelBest });
  if (metricIsObject && owns(value, "direction")) {
    if (value.direction !== "higher" && value.direction !== "lower") {
      throw new Error("durable top-level direction compatibility alias must be higher or lower");
    }
    if (benchmark !== undefined && value.direction !== benchmark.identity.direction) {
      throw new Error("durable top-level direction compatibility alias conflicts with canonical metric");
    }
  }

  const expectedBest = benchmark?.best ?? aliases[0]?.value;
  if (expectedBest !== undefined) {
    for (const alias of aliases) {
      if (alias.value !== expectedBest) {
        throw new Error(
          `durable metric compatibility alias "${alias.key}" conflicts with canonical metric best ${expectedBest}`,
        );
      }
    }
  }

  return {
    ...(benchmark === undefined ? {} : { benchmark }),
    ...(expectedBest === undefined ? {} : { previousBest: expectedBest }),
    preserveTopLevelBest: typeof metric === "string" || owns(value, "best"),
    preserveTopLevelDirection: typeof metric === "string" || owns(value, "direction"),
  };
}

/** Continue writing historical aliases for compatibility, but keep every
 * metric-specific exception inside the compatibility boundary rather than the
 * capability-driven materializer. */
export function materializedMetricCompatibilityAliases(
  compatibility: DurableMetricCompatibility,
  identity: BenchmarkIdentity,
  best: number,
): Record<string, unknown> {
  return {
    [metricCompatibilityKey(identity.name)]: best,
    value: best,
    ...(identity.name === "tflops" ? { tflops: best } : {}),
    ...(compatibility.preserveTopLevelBest ? { best } : {}),
    ...(compatibility.preserveTopLevelDirection ? { direction: identity.direction } : {}),
  };
}

export function formatBenchmarkIdentity(identity: BenchmarkIdentity): string {
  return identity.legacy
    ? `legacy ${identity.name}/${identity.direction}`
    : `${identity.name}/${identity.unit}/${identity.direction}`;
}
