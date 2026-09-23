#!/usr/bin/env node

import { appendFile, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) {
      throw new Error(`Invalid argument near ${key ?? '<end>'}`);
    }
    options[key.slice(2)] = value;
  }
  return options;
}

function required(options, name) {
  const value = options[name];
  if (!value) throw new Error(`Missing --${name}`);
  return value;
}

async function findSummaries(root) {
  const matches = [];
  async function visit(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
    await Promise.all(
      entries.map(async (entry) => {
        const candidate = path.join(directory, entry.name);
        if (entry.isDirectory()) await visit(candidate);
        else if (entry.isFile() && entry.name === 'summary.json') {
          matches.push(candidate);
        }
      }),
    );
  }
  await visit(root);
  return matches.sort();
}

async function findYamlCases(root) {
  const cases = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(candidate);
      else if (entry.isFile() && /\.ya?ml$/i.test(entry.name)) {
        const document = parseYaml(await readFile(candidate, 'utf8'));
        for (const testCase of document?.cases ?? []) {
          if (typeof testCase?.name === 'string') cases.push(testCase.name);
        }
      }
    }
  }
  await visit(root);
  return cases;
}

function mergeSummaries(summaries) {
  const available = summaries.filter(Boolean);
  if (available.length === 0) return null;
  const countKeys = [
    'total', 'passed', 'failed', 'notRun', 'filtered',
    'collectionErrors', 'documentFailures', 'projectFailures',
  ];
  return {
    status: available.every((summary) => summary.status === 'success') ? 'success' : 'failed',
    durationMs: available.reduce((total, summary) => total + (summary.durationMs ?? 0), 0),
    summary: Object.fromEntries(
      countKeys.map((key) => [
        key,
        available.reduce((total, summary) => total + (summary.summary?.[key] ?? 0), 0),
      ]),
    ),
    projects: available.flatMap((summary) => summary.projects ?? []),
  };
}

function cell(value) {
  return String(value ?? '')
    .replaceAll('\\', '\\\\')
    .replaceAll('|', '\\|')
    .replaceAll('[', '\\[')
    .replaceAll(']', '\\]')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll(/[\r\n]+/g, ' ');
}

function html(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function duration(value) {
  if (!Number.isFinite(value)) return '—';
  if (value < 1000) return `${value} ms`;
  return `${(value / 1000).toFixed(1)} s`;
}

function normalizedBaseUrl(value) {
  const url = new URL(value);
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url;
}

function publishedUrl(baseUrl, relativePath, stepId) {
  if (!baseUrl || !relativePath) return null;
  const url = new URL(relativePath, normalizedBaseUrl(baseUrl));
  if (stepId) url.hash = new URLSearchParams({ 'runner-step': stepId }).toString();
  return url.href;
}

export function renderSummary({
  summary,
  artifactName,
  testOutcome,
  runUrl,
  pagesUrl,
  feishuOutcome,
  skippedCases = [],
  evidenceCases = [],
}) {
  const nativeCases = (summary?.projects ?? []).flatMap((project) =>
    (project.cases ?? []).map((testCase) => ({
      ...testCase,
      project: project.name,
    })),
  );
  const skipped = skippedCases.map((name) => ({
    name,
    project: 'feishu-browser',
    status: 'skipped',
    attempts: [],
  }));
  const nativeCaseKeys = new Set([
    ...nativeCases.map((testCase) => `${testCase.project}\0${testCase.name}`),
    ...skipped.map((testCase) => `${testCase.project}\0${testCase.name}`),
  ]);
  const evidenceOnlyCases = evidenceCases
    .filter((testCase) => !nativeCaseKeys.has(`${testCase.project}\0${testCase.name}`))
    .map((testCase) => ({ ...testCase, attempts: [] }));
  const cases = [...nativeCases, ...evidenceOnlyCases, ...skipped];
  const reportAvailable = Boolean(summary || evidenceCases.length > 0);
  const abnormalCases = cases.filter((testCase) => testCase.status !== 'success');
  const passedCases = cases.filter((testCase) => testCase.status === 'success');
  const status =
    testOutcome === 'success' &&
    summary?.status === 'success' &&
    (feishuOutcome === 'success' || feishuOutcome === 'skipped' || !feishuOutcome)
      ? skipped.length > 0
        ? 'passed with skips'
        : 'passed'
      : testOutcome === 'skipped'
        ? 'live cases skipped'
        : testOutcome === 'not-run'
          ? 'not run'
          : 'failed';
  const artifactUrl = runUrl ? `${runUrl}#artifacts` : null;
  const evidence = new Map(
    evidenceCases.map((testCase) => [`${testCase.project}\0${testCase.name}`, testCase]),
  );
  const unreportedFailure = status === 'failed' && abnormalCases.length === 0;
  const needsAttention = abnormalCases.length + Number(unreportedFailure);
  const allPassed =
    status === 'passed' &&
    feishuOutcome !== 'skipped' &&
    passedCases.length > 0 &&
    needsAttention === 0;
  const caseRow = (testCase, detail) => {
    const caseEvidence = evidence.get(`${testCase.project}\0${testCase.name}`);
    const target = publishedUrl(pagesUrl, caseEvidence?.reportPath, caseEvidence?.stepId);
    const preview = publishedUrl(pagesUrl, caseEvidence?.previewPath);
    const fallback = !target && testCase.status !== 'skipped' ? artifactUrl : null;
    const label = target || fallback
      ? `[${cell(testCase.name)}](${target ?? fallback})`
      : cell(testCase.name);
    const screenshot = preview && target
      ? `<a href="${html(target)}"><img src="${html(preview)}" alt="${
        html(testCase.name).replaceAll('|', '&#124;').replaceAll(/[\r\n]+/g, ' ')
      }" width="160"></a>`
      : '—';
    const elapsed = testCase.durationMs ?? caseEvidence?.durationMs
      ?? testCase.attempts?.at(-1)?.durationMs;
    return `| ${cell(testCase.project)} | ${label} | ${screenshot} | ${cell(detail)} | ${duration(elapsed)} |`;
  };
  const lines = [
    `## Botmux × Midscene · ${status}`,
    '',
    reportAvailable
      ? `**${allPassed ? '✅ ' : ''}${needsAttention} need attention · ${passedCases.length} passed**`
      : testOutcome === 'skipped'
        ? '**Static Midscene validation passed.** Live Feishu browser cases were skipped because their repository secrets are unavailable.'
        : '**No Midscene result was produced.** The job stopped before the test runner started.',
    '',
  ];

  if (reportAvailable && artifactUrl) {
    lines.push(
      `[Download the native Midscene HTML report and runner data (${artifactName})](${artifactUrl})`,
      '',
    );
  } else if (reportAvailable) {
    lines.push(`Artifact: ${artifactName}`, '');
  }

  if (reportAvailable && pagesUrl) {
    lines.push(`[Open the published Midscene HTML report](${pagesUrl})`, '');
  }

  if (feishuOutcome === 'skipped') {
    lines.push(
      '> The credential-free Dashboard project ran normally. The separate Feishu live project was skipped because its URL or authenticated storage state is unavailable.',
      '',
    );
  } else if (feishuOutcome) {
    lines.push(`Feishu live project: **${cell(feishuOutcome)}**.`, '');
  }

  if (needsAttention) {
    lines.push(
      '### Needs attention',
      '',
      '| Project | Case | Screenshot | Status / reason | Duration |',
      '|:--|:--|:--|:--|--:|',
      ...(unreportedFailure
        ? [`| Workflow | — | — | ❌ Failed before report · [Workflow run](${runUrl}) | — |`]
        : []),
      ...abnormalCases
        .sort((left, right) => {
          const priority = (testCase) => testCase.status === 'failed' ? 0 : 1;
          return priority(left) - priority(right);
        })
        .map((testCase) => {
          const icon = testCase.status === 'skipped' || testCase.status === 'not-run'
            ? '⏭️'
            : '❌';
          const label = testCase.status === 'not-run'
            ? 'Not run'
            : testCase.status === 'skipped'
              ? 'Skipped'
              : 'Failed';
          const reason = testCase.reason ?? evidence.get(`${testCase.project}\0${testCase.name}`)?.reason;
          return caseRow(testCase, `${icon} ${label}${reason ? `: ${reason}` : ''}`);
        }),
      '',
    );
  } else if (allPassed) {
    lines.push(`🎉 All ${passedCases.length} cases passed.`, '');
  }

  if (reportAvailable) {
    lines.push(
      '<details>',
      `<summary>Appendix: passed cases (${passedCases.length})</summary>`,
      '',
      '| Project | Case | Screenshot | Status | Duration |',
      '|:--|:--|:--|:--|--:|',
      ...passedCases.map((testCase) => caseRow(testCase, '✅ Passed')),
      '',
      '</details>',
      '',
      `Run duration: ${duration(summary?.durationMs)}.`,
      '',
    );
  }

  return lines.join('\n');
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const results = required(options, 'results');
  const files = await findSummaries(results);
  const latest = files.at(-1);
  const summary = latest
    ? JSON.parse(await readFile(latest, 'utf8'))
    : null;
  const feishuFiles = options['feishu-results']
    ? await findSummaries(options['feishu-results'])
    : [];
  const feishuLatest = feishuFiles.at(-1);
  const combinedSummary = mergeSummaries([
    summary,
    feishuLatest ? JSON.parse(await readFile(feishuLatest, 'utf8')) : null,
  ]);
  const repository = process.env.GITHUB_REPOSITORY;
  const runId = process.env.GITHUB_RUN_ID;
  const runUrl =
    repository && runId
      ? `https://github.com/${repository}/actions/runs/${runId}`
      : null;
  const skippedCases =
    options['feishu-outcome'] === 'skipped' && options['skipped-cases-dir']
      ? await findYamlCases(options['skipped-cases-dir'])
      : [];
  const siteManifest = options['site-manifest']
    ? JSON.parse(await readFile(options['site-manifest'], 'utf8'))
    : null;
  const markdown = renderSummary({
    summary: combinedSummary,
    artifactName: required(options, 'artifact-name'),
    testOutcome: required(options, 'test-outcome'),
    runUrl,
    pagesUrl: options['pages-url'],
    feishuOutcome: options['feishu-outcome'],
    skippedCases,
    evidenceCases: siteManifest?.cases ?? [],
  });
  await appendFile(required(options, 'output'), markdown);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
