import { describe, expect, it } from 'vitest';
import { renderSummary } from '../scripts/render-midscene-summary.mjs';

describe('Midscene CI summary', () => {
  it('renders native case results and the report artifact link', () => {
    const markdown = renderSummary({
      artifactName: 'midscene-feishu-report',
      testOutcome: 'failure',
      runUrl: 'https://github.com/quanru/botmux/actions/runs/42',
      summary: {
        status: 'failed',
        durationMs: 1500,
        summary: { total: 2, passed: 1, failed: 1, notRun: 0 },
        projects: [
          {
            name: 'feishu-browser',
            cases: [
              { name: 'Aiden basic bot flow', status: 'success', attempts: [{}] },
              { name: 'Streaming card lifecycle', status: 'failed', attempts: [{}, {}] },
            ],
          },
        ],
      },
    });

    expect(markdown).toContain('Botmux × Midscene · failed');
    expect(markdown).toContain('1 need attention · 1 passed');
    expect(markdown).toContain('Aiden basic bot flow');
    expect(markdown).toContain('Streaming card lifecycle');
    expect(markdown.indexOf('Streaming card lifecycle')).toBeLessThan(markdown.indexOf('<details>'));
    expect(markdown.indexOf('Aiden basic bot flow')).toBeGreaterThan(markdown.indexOf('<details>'));
    expect(markdown).toContain(
      'https://github.com/quanru/botmux/actions/runs/42#artifacts',
    );
  });

  it('labels unavailable live credentials as skipped without a report link', () => {
    const markdown = renderSummary({
      artifactName: 'midscene-feishu-report',
      testOutcome: 'skipped',
      runUrl: 'https://github.com/quanru/botmux/actions/runs/43',
      summary: null,
    });

    expect(markdown).toContain('Botmux × Midscene · live cases skipped');
    expect(markdown).toContain('Static Midscene validation passed');
    expect(markdown).not.toContain('#artifacts');
  });

  it('keeps every unavailable Feishu case visible next to real results', () => {
    const markdown = renderSummary({
      artifactName: 'botmux-midscene-report',
      testOutcome: 'success',
      feishuOutcome: 'skipped',
      skippedCases: ['Aiden basic bot flow', 'Streaming card lifecycle'],
      summary: {
        status: 'success',
        durationMs: 2500,
        summary: { total: 1, passed: 1, failed: 0, notRun: 0 },
        projects: [
          {
            name: 'dashboard-smoke',
            cases: [
              {
                name: 'Navigate the core read-only Dashboard pages',
                status: 'success',
                attempts: [{}],
              },
            ],
          },
        ],
      },
    });

    expect(markdown).toContain('Botmux × Midscene · passed with skips');
    expect(markdown).toContain('2 need attention · 1 passed');
    expect(markdown).toContain(
      '| feishu-browser | Aiden basic bot flow | — | ⏭️ Skipped | — |',
    );
    expect(markdown).toContain(
      '| feishu-browser | Streaming card lifecycle | — | ⏭️ Skipped | — |',
    );
    expect(markdown.indexOf('Navigate the core read-only Dashboard pages')).toBeGreaterThan(markdown.indexOf('<details>'));
  });

  it('links each executed case to its published step and screenshot', () => {
    const markdown = renderSummary({
      artifactName: 'botmux-midscene-report',
      testOutcome: 'success',
      pagesUrl: 'https://deepcoldy.github.io/botmux-midscene/pr-1512/',
      evidenceCases: [{
        name: 'Dashboard smoke',
        project: 'dashboard-smoke',
        reportPath: 'dashboard/index.html',
        previewPath: 'previews/dashboard.jpg',
        stepId: 'attempt:steps:6',
      }],
      summary: {
        status: 'success',
        durationMs: 1000,
        summary: { total: 1, passed: 1, failed: 0, notRun: 0 },
        projects: [{
          name: 'dashboard-smoke',
          cases: [{ name: 'Dashboard smoke', status: 'success', attempts: [{}] }],
        }],
      },
    });

    expect(markdown).toContain('dashboard/index.html#runner-step=attempt%3Asteps%3A6');
    expect(markdown).toContain('previews/dashboard.jpg');
    expect(markdown).toContain('✅ 0 need attention · 1 passed');
    expect(markdown).toContain('🎉 All 1 cases passed.');
    expect(markdown).toContain('<summary>Appendix: passed cases (1)</summary>');
    expect(markdown).toContain('width="160"');
  });

  it('shows failed screenshots first without duplicating passed cases', () => {
    const markdown = renderSummary({
      artifactName: 'botmux-midscene-report',
      testOutcome: 'failure',
      pagesUrl: 'https://example.test/reports/',
      evidenceCases: [
        { name: 'Passed case', project: 'dashboard', status: 'success', reportPath: 'dashboard/index.html', previewPath: 'previews/passed.jpg' },
        { name: 'Failed | case', project: 'feishu', status: 'failed', reason: 'button missing', reportPath: 'feishu/index.html', previewPath: 'previews/failed.jpg', stepId: 'step-1' },
      ],
      summary: null,
    });
    const appendix = markdown.indexOf('<details>');
    expect(markdown.indexOf('Failed \\| case')).toBeLessThan(appendix);
    expect(markdown.indexOf('Passed case')).toBeGreaterThan(appendix);
    expect(markdown.slice(0, appendix)).toContain('previews/failed.jpg');
    expect(markdown.slice(0, appendix)).not.toContain('previews/passed.jpg');
    expect(markdown.slice(appendix)).toContain('previews/passed.jpg');
    expect(markdown.slice(appendix)).not.toContain('previews/failed.jpg');
    expect(markdown).toContain('alt="Failed &#124; case"');
    expect(markdown).toContain('button missing');
  });

  it('keeps partial evidence visible when a timed-out project has no summary', () => {
    const markdown = renderSummary({
      artifactName: 'botmux-midscene-report',
      testOutcome: 'failure',
      runUrl: 'https://github.com/deepcoldy/botmux/actions/runs/44',
      pagesUrl: 'https://deepcoldy.github.io/botmux-midscene/pr-1512/',
      evidenceCases: [
        {
          name: 'Completed case',
          project: 'feishu-browser',
          status: 'success',
          reportPath: 'feishu/run-001/index.html',
          previewPath: 'previews/completed.jpg',
        },
        {
          name: 'Unfinished case',
          project: 'feishu-browser',
          status: 'not-run',
        },
      ],
      summary: null,
    });

    expect(markdown).toContain('1 need attention · 1 passed');
    expect(markdown).toContain('feishu/run-001/index.html');
    expect(markdown).toContain('| feishu-browser | [Unfinished case](https://github.com/deepcoldy/botmux/actions/runs/44#artifacts) | — | ⏭️ Not run | — |');
  });

  it('does not call the run passed when the Feishu project fails before writing results', () => {
    const markdown = renderSummary({
      artifactName: 'botmux-midscene-report',
      testOutcome: 'success',
      feishuOutcome: 'failure',
      summary: {
        status: 'success',
        durationMs: 1000,
        summary: { total: 1, passed: 1, failed: 0, notRun: 0 },
        projects: [{
          name: 'dashboard-smoke',
          cases: [{ name: 'Dashboard smoke', status: 'success', attempts: [{}] }],
        }],
      },
    });

    expect(markdown).toContain('Botmux × Midscene · failed');
  });
});
