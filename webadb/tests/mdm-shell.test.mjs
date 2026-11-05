import test from 'node:test';
import assert from 'node:assert/strict';
import { MDM_VIEWS, mdmFrameSource, mdmViewFromHash, mdmPage, mdmViewForPage, trustedMdmMessage } from '../src/mdm-shell.js';

test('Classic deep links map only the four integrated MDM views', () => {
  for (const view of MDM_VIEWS) {
    assert.equal(mdmViewFromHash('#mdm-' + view), view);
    assert.equal(mdmViewForPage(mdmPage(view)), view);
  }
  for (const hash of ['#catalogPanel', '#mdm-unknown', '#mdm-catalog/evil', '#mdm-requests<script>', 'mdm-home']) assert.equal(mdmViewFromHash(hash), null);
});

test('Frame sources remain inside the current Suite and embed the requested view', () => {
  const url = new URL(mdmFrameSource('catalog', 'he'), 'https://yidreamkosher.github.io/YiDream-Suite/admin.html');
  assert.equal(url.origin, 'https://yidreamkosher.github.io');
  assert.equal(url.pathname, '/YiDream-Suite/mdm-admin.html');
  assert.equal(url.searchParams.get('embed'), 'classic');
  assert.equal(url.searchParams.get('view'), 'catalog');
  assert.equal(url.searchParams.get('lang'), 'he');
  assert.equal(new URL(mdmFrameSource('home', 'unknown'), url).searchParams.get('lang'), 'fr');
  assert.throws(() => mdmFrameSource('https://evil.example/'), TypeError);
});

test('Frame messages must come from the same origin and the exact mounted child', () => {
  const child = {};
  const frame = { contentWindow: child };
  const event = { origin: 'https://yidreamkosher.github.io', source: child, data: { type: 'yidream-mdm:navigate', view: 'requests' } };
  assert.deepEqual(trustedMdmMessage(event, frame, event.origin), { type: 'navigate', view: 'requests' });
  assert.equal(trustedMdmMessage({ ...event, origin: 'https://evil.example' }, frame, event.origin), null);
  assert.equal(trustedMdmMessage({ ...event, source: {} }, frame, event.origin), null);
  assert.equal(trustedMdmMessage(event, null, event.origin), null);
  assert.equal(trustedMdmMessage({ ...event, data: { ...event.data, view: '../../settings' } }, frame, event.origin), null);
});

test('Resize values are finite bounded numbers, never CSS supplied by the child', () => {
  const child = {};
  const frame = { contentWindow: child };
  const event = { origin: 'https://yidreamkosher.github.io', source: child };
  const parse = height => trustedMdmMessage({ ...event, data: { type: 'yidream-mdm:resize', height } }, frame, event.origin);
  assert.deepEqual(parse(620.2), { type: 'resize', height: 621 });
  assert.deepEqual(parse(80), { type: 'resize', height: 160 });
  for (const value of [0, -1, NaN, Infinity, 30001, '100vh', null]) assert.equal(parse(value), null);
});

test('nested /admin/ entry uses the same root MDM document',()=>{
 for(const pathname of ['/YiDream-Suite/admin', '/YiDream-Suite/admin/', '/YiDream-Suite/admin/index.html','/YiDream-Suite/admin.html']){
  const url=new URL(mdmFrameSource('catalog','fr',pathname),'https://yidreamkosher.github.io'+pathname);
  assert.equal(url.pathname,'/YiDream-Suite/mdm-admin.html');
 }
});
test('focus requests also require the mounted same-origin child',()=>{
 const child={},frame={contentWindow:child},event={origin:'https://yidreamkosher.github.io',source:child,data:{type:'yidream-mdm:focus'}};
 assert.deepEqual(trustedMdmMessage(event,frame,event.origin),{type:'focus'});
 assert.equal(trustedMdmMessage({...event,source:{}},frame,event.origin),null);
});
