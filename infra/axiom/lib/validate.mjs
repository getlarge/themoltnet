import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const DATASETS = new Set(['moltnet-logs', 'moltnet-metrics', 'moltnet-traces']);

const ACTIVE_METRICS = new Set([
  'auth.remote.cache.accesses',
  'auth.remote.cache.entries',
  'auth.remote.cache.evictions',
  'auth.remote.upstream.requests',
  'auth.scope.denial.total',
  'http.server.active_requests',
  'http.server.request.duration',
  'http.server.request.total',
  'nodejs.eventloop.delay.p99',
  'nodejs.eventloop.utilization',
  'v8js.gc.duration',
  'v8js.memory.heap.used',
]);

function extractAplDataset(query) {
  return query?.match(/^\['([^']+)'\]/)?.[1];
}

function extractMplMetric(query) {
  const match = query?.match(/^`([^`]+)`:`([^`]+)`/);
  return match ? { dataset: match[1], metric: match[2] } : undefined;
}

function validateQuery(query, language, context, { enabled = true } = {}) {
  const errors = [];
  if (language === 'apl') {
    const dataset = extractAplDataset(query);
    if (!dataset) errors.push(`${context}: APL must start with ['dataset'].`);
    else if (!DATASETS.has(dataset))
      errors.push(`${context}: unknown APL dataset '${dataset}'.`);
  } else {
    const source = extractMplMetric(query);
    if (!source)
      errors.push(
        `${context}: MPL must start with a dataset and metric source.`,
      );
    else {
      if (source.dataset !== 'moltnet-metrics')
        errors.push(`${context}: unknown metrics dataset '${source.dataset}'.`);
      if (enabled && !ACTIVE_METRICS.has(source.metric))
        errors.push(
          `${context}: active query references unavailable metric '${source.metric}'.`,
        );
    }
    if (query.includes('| filter '))
      errors.push(`${context}: MPL uses deprecated 'filter'; use 'where'.`);
  }
  return errors;
}

export function validateResources(kind, defs) {
  const errors = [];
  const names = new Set();

  for (const { def, file } of defs) {
    const context = file;
    if (!def.name) errors.push(`${context}: missing name.`);
    else if (names.has(def.name))
      errors.push(`${context}: duplicate name '${def.name}'.`);
    else names.add(def.name);

    if (kind === 'monitor') {
      const enabled = def.enabled !== false;
      if (!enabled && !def.disabledReason)
        errors.push(`${context}: disabled monitor needs disabledReason.`);
      if (Boolean(def.aplQuery) === Boolean(def.mplQuery))
        errors.push(`${context}: monitor needs exactly one APL or MPL query.`);
      if (def.aplQuery)
        errors.push(
          ...validateQuery(def.aplQuery, 'apl', context, { enabled }),
        );
      if (def.mplQuery)
        errors.push(
          ...validateQuery(def.mplQuery, 'mpl', context, { enabled }),
        );
      continue;
    }

    if (!def.uid) errors.push(`${context}: dashboard is missing uid.`);
    if (def.owner !== 'X-AXIOM-EVERYONE')
      errors.push(`${context}: dashboard owner must be X-AXIOM-EVERYONE.`);
    const declaredDatasets = new Set(def.datasets ?? []);
    for (const dataset of declaredDatasets) {
      if (!DATASETS.has(dataset))
        errors.push(`${context}: unknown declared dataset '${dataset}'.`);
    }

    const chartIds = new Set();
    for (const chart of def.charts ?? []) {
      const chartContext = `${context} chart '${chart.id ?? '(missing id)'}'`;
      if (!chart.id) errors.push(`${chartContext}: missing id.`);
      else if (chartIds.has(chart.id))
        errors.push(`${chartContext}: duplicate chart id.`);
      else chartIds.add(chart.id);

      if (chart.type === 'Note' || chart.type === 'SmartFilter') continue;
      const apl = chart.query?.apl;
      const mpl = chart.query?.mpl;
      if (Boolean(apl) === Boolean(mpl))
        errors.push(`${chartContext}: needs exactly one APL or MPL query.`);
      if (apl) {
        errors.push(...validateQuery(apl, 'apl', chartContext));
        const dataset = extractAplDataset(apl);
        if (dataset && !declaredDatasets.has(dataset))
          errors.push(
            `${chartContext}: dataset '${dataset}' is missing from dashboard.datasets.`,
          );
      }
      if (mpl) {
        errors.push(...validateQuery(mpl, 'mpl', chartContext));
        const source = extractMplMetric(mpl);
        if (source && !declaredDatasets.has(source.dataset))
          errors.push(
            `${chartContext}: dataset '${source.dataset}' is missing from dashboard.datasets.`,
          );
      }
    }

    const layoutIds = new Set();
    for (const item of def.layout ?? []) {
      if (!chartIds.has(item.i))
        errors.push(`${context}: layout references missing chart '${item.i}'.`);
      if (layoutIds.has(item.i))
        errors.push(`${context}: duplicate layout item '${item.i}'.`);
      layoutIds.add(item.i);
    }
    for (const chartId of chartIds) {
      if (!layoutIds.has(chartId))
        errors.push(`${context}: chart '${chartId}' has no layout item.`);
    }
  }

  if (errors.length) {
    throw new Error(
      [
        'Axiom configuration validation failed:',
        ...errors.map((e) => `- ${e}`),
      ].join('\n'),
    );
  }
}

async function load(directory) {
  const files = (await readdir(directory))
    .filter((file) => file.endsWith('.json'))
    .sort();
  return Promise.all(
    files.map(async (file) => ({
      def: JSON.parse(await readFile(join(directory, file), 'utf8')),
      file: join(directory, file),
    })),
  );
}

export async function validateAll(
  root = new URL('..', import.meta.url).pathname,
) {
  validateResources('monitor', await load(join(root, 'monitors')));
  validateResources('dashboard', await load(join(root, 'dashboards')));
}
