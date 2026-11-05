import {test} from 'node:test';
import assert from 'node:assert/strict';
import {VIEWS,resolveView,mayImport} from '../public/mdm-views.js';
test('dedicated views and existing bookmarks resolve only to known views',()=>{
 for(const view of Object.keys(VIEWS))assert.equal(resolveView('?view='+view,''),view);
 for(const [hash,view] of Object.entries({'#catalogPanel':'catalog','#catalogForm':'catalog','#requestsPanel':'requests','#pairPanel':'pair','#homePanel':'home'}))assert.equal(resolveView('',hash),view);
 assert.equal(resolveView('?view=home','#mdm-catalog'),'catalog');
 for(const input of ['../admin','constructor','toString','catalog<script>','https://evil.test'])assert.equal(resolveView('?view='+encodeURIComponent(input),''),'home');
});
test('import UI fails closed without a signed-in user and a true owner result',()=>{
 for(const user of [null,{}, {id:''}])assert.equal(mayImport(user,true),false);
 for(const role of [false,null,undefined,'true','owner',1])assert.equal(mayImport({id:'owner'},role),false);
 assert.equal(mayImport({id:'owner'},true),true);
});
