const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const repo = path.resolve(__dirname, '..');
const hostRequire = createRequire(path.join(repo, 'package.json'));
const { JSDOM } = hostRequire('jsdom');
const React = hostRequire('react');
let dom, root;
afterEach(async () => {
  if (root) await React.act(async () => root.unmount());
  root = null;
  dom?.window.close();
});

async function setup(fetchJSON, url = 'http://localhost/chat') {
  dom = new JSDOM('<div id="root"></div>', { url, runScripts: 'outside-only' });
  global.window = dom.window; global.document = dom.window.document;
  global.navigator = dom.window.navigator; global.IS_REACT_ACT_ENVIRONMENT = true;
  const components = {}, slots = {};
  dom.window.__HERMES_PLUGIN_SDK__ = { React, sdkVersion: '1.1.0', fetchJSON,
    authedFetch: async () => ({ ok: true, blob: async () => new Blob(['image'], { type: 'image/png' }) }) };
  dom.window.URL.createObjectURL = () => 'blob:fixture-image'; dom.window.URL.revokeObjectURL = () => {};
  dom.window.__HERMES_PLUGINS__ = { register: (name, value) => components[name] = value, registerSlot: (name, slot, value) => slots[slot] = value };
  dom.window.eval(fs.readFileSync(path.resolve(__dirname, '../dist/index.js'), 'utf8'));
  const { createRoot } = hostRequire('react-dom/client');
  root = createRoot(document.getElementById('root'));
  return { components, slots };
}
const id = 'a'.repeat(32);
const summary = { id, kind: 'report', title: 'Swift speed', section: 'MTP results', date: 100, location: 'Documents/report.md', line: 3, excerpt: 'MTP was slower.' };
const search = { results: [summary], status: { sources: 1, updated: '2026-10-10T12:00:00Z', warnings: [], counts: { report: 1 } }, terms: ['mtp'] };
const flush = async () => { await React.act(async () => { await new Promise(resolve => setImmediate(resolve)); }); };

test('clicking evidence renders a formatted highlighted source beside the existing page', async () => {
  const { components, slots } = await setup(async url => url.includes('/source/') ? { ...summary, format: 'markdown', content: '# Swift speed\n\n## MTP results\nMTP was **slower**.\n\n| Mode | Result |\n| --- | --- |\n| MTP | Slower |' } : search);
  await React.act(async () => root.render(React.createElement(React.Fragment, null, React.createElement(components['project-history']), React.createElement(slots.overlay))));
  const input = document.querySelector('input');
  await React.act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, 'MTP');
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
  await React.act(async () => document.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })));
  await React.act(async () => document.querySelector('.ph-result').click());
  assert.ok(document.querySelector('aside[aria-label="Source preview"]'));
  assert.ok(document.body.classList.contains('ph-preview-open'));
  assert.equal(document.querySelectorAll('table').length, 1);
  assert.ok(document.querySelector('strong').textContent.includes('slower'));
  assert.ok(document.querySelector('mark'));
  assert.ok(document.querySelector('.ph-search'));
  await React.act(async () => document.querySelector('[aria-label="Close source preview"]').click());
  assert.equal(document.querySelector('aside'), null);
  assert.ok(!document.body.classList.contains('ph-preview-open'));
});

test('labelled terminal-link events are acknowledged and show a surrounding chat exchange', async () => {
  const { slots } = await setup(async () => ({ ...summary, kind: 'chat', format: 'conversation', selected_message: 2, context_note: 'Surrounding exchange', messages: [
    { id: 1, role: 'user', content: 'Should we use MTP?', timestamp: 100 }, { id: 2, role: 'assistant', content: 'MTP was slower.', timestamp: 101 }
  ] }));
  await React.act(async () => root.render(React.createElement(slots.overlay)));
  const event = new dom.window.CustomEvent('local-ai:open-source', { cancelable: true, detail: { id, query: 'MTP' } });
  await React.act(async () => dom.window.dispatchEvent(event));
  assert.ok(event.defaultPrevented);
  assert.equal(document.querySelectorAll('.ph-message').length, 2);
  assert.ok(document.querySelector('.ph-selected-message mark'));
  assert.ok(document.body.textContent.includes('You'));
});

test('late source responses cannot reopen a closed preview or overwrite a newer source', async () => {
  let resolve;
  const { slots } = await setup(() => new Promise(value => resolve = value));
  await React.act(async () => root.render(React.createElement(slots.overlay)));
  await React.act(async () => dom.window.dispatchEvent(new dom.window.CustomEvent('local-ai:open-source', { detail: { id } })));
  await React.act(async () => document.querySelector('[aria-label="Close source preview"]').click());
  await React.act(async () => resolve({ ...summary, format: 'markdown', content: '# Old source' }));
  assert.equal(document.querySelector('aside'), null);
});

test('missing sources produce a visible error and retry instead of an empty preview', async () => {
  const { slots } = await setup(async () => { throw new Error('404: Source was removed'); });
  await React.act(async () => root.render(React.createElement(slots.overlay)));
  await React.act(async () => dom.window.dispatchEvent(new dom.window.CustomEvent('local-ai:open-source', { detail: { id } })));
  assert.ok(document.querySelector('[role="alert"]').textContent.includes('Source was removed'));
  assert.ok(document.querySelector('[role="alert"] button'));
});

test('raw HTML and unsafe schemes remain inert; authenticated images appear without clicking', async () => {
  const { slots } = await setup(async () => ({ ...summary, format: 'markdown', content: '# Image\n<script>alert(1)</script>\n[Bad](javascript:alert)\n![Chart](chart.png)' }));
  await React.act(async () => root.render(React.createElement(slots.overlay)));
  await React.act(async () => dom.window.dispatchEvent(new dom.window.CustomEvent('local-ai:open-source', { detail: { id } })));
  await flush();
  assert.equal(document.querySelector('script'), null);
  assert.equal(document.querySelector('a[href^="javascript"]'), null);
  assert.equal(document.querySelector('img').getAttribute('src'), 'blob:fixture-image');
  await React.act(async () => document.querySelector('[aria-label="Enlarge Chart"]').click());
  assert.ok(document.querySelector('[role="dialog"] img'));
  await React.act(async () => document.getElementById('ph-image-close').click());
  assert.equal(document.querySelector('[role="dialog"]'), null);
});

test('image tool gallery renders local and web pictures automatically in the current conversation', async () => {
  const calls = [];
  const { slots } = await setup(async url => {
    calls.push(url);
    if (url.includes('/api/pty/session')) return { session_id: 'current-conversation' };
    return { groups: [{ id: 'group', title: 'Image search results', date: 100, images: [
      { id, remote: true, source: 'https://example.org/chart.png', caption: 'Web chart', source_url: 'https://example.org' },
      { id: 'b'.repeat(32), remote: false, caption: 'Local chart', source_url: '' }
    ] }] };
  });
  await React.act(async () => root.render(React.createElement(slots['chat:bottom'], { channel: 'channel-1', profile: 'default', isActive: true })));
  await flush();
  assert.equal(document.querySelectorAll('.ph-image-cards img').length, 2);
  assert.ok(calls.some(url => url.includes('session=current-conversation')));
  assert.equal(document.querySelector('[role="dialog"]'), null);
  await React.act(async () => root.render(React.createElement(slots['chat:bottom'], { channel: 'channel-2', profile: 'default', isActive: false })));
  assert.equal(document.querySelector('.ph-inline-gallery'), null);
});

test('web image failures are visible and preserve the attribution link', async () => {
  const { slots } = await setup(async url => url.includes('/api/pty/session') ? { session_id: 'current' } : { groups: [{ id: 'group', title: 'Web results', date: 100, images: [{ id, remote: true, source: 'https://example.org/missing.png', caption: 'Web image', source_url: 'https://example.org/source' }] }] });
  await React.act(async () => root.render(React.createElement(slots['chat:bottom'], { channel: 'c', isActive: true })));
  await React.act(async () => document.querySelector('img').dispatchEvent(new dom.window.Event('error')));
  assert.ok(document.querySelector('.ph-image-error').textContent.includes('could not load'));
  assert.equal(document.querySelector('figcaption a').href, 'https://example.org/source');
});
