import assert from 'node:assert/strict';
import test from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import MarkdownPreview from '../src/markdown-preview.mjs';

test('Markdown preview renders formatted document content', () => {
  const source = '# Setup\n\n- [x] Install\n\n| Tool | Version |\n| --- | --- |\n| Node | 24 |\n\n' +
    '```js\nconst ready = true;\n```';
  const html = renderToStaticMarkup(createElement(MarkdownPreview,{source}));
  assert.match(html,/<h1>Setup<\/h1>/);
  assert.match(html,/<input[^>]+type="checkbox"[^>]*checked/);
  assert.match(html,/<th>Tool<\/th>/);
  assert.match(html,/<pre><code class="language-js">const ready = true;/);
});

test('Markdown preview skips raw HTML and only opens supported link destinations', () => {
  const source = '<b>Raw HTML</b>\n\n[Unsafe](javascript:alert%281%29)\n\n' +
    '[Local](./guide.md)\n\n[Website](https://example.org/)';
  const html = renderToStaticMarkup(createElement(MarkdownPreview,{source}));
  assert.doesNotMatch(html,/<b>|href="[^"]*(?:javascript:|guide\.md)/);
  assert.match(html,/<a[^>]+href="https:\/\/example\.org\/"[^>]+target="_blank"[^>]+rel="noreferrer"/);
});
