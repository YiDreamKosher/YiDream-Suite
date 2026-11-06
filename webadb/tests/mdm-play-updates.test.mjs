import {test} from 'node:test';
import assert from 'node:assert/strict';
import {playSource, strictVersionCode, comparePlayRelease, checkPlayCatalog} from '../public/mdm-play-updates.js';
const app=(id='one',extra={})=>({id,name:'Example',package_name:'com.example.app',version_code:20,source_url:'https://play.google.com/store/apps/details?id=com.example.app',...extra});

test('Play sources must identify the exact catalog package on the official HTTPS listing',()=>{
 assert.equal(playSource(app()),app().source_url);
 assert.equal(playSource(app('one',{source_url:app().source_url+'&hl=fr&gl=FR'})),app().source_url);
 for(const source_url of [null,'','https://play.google.com.evil.test/store/apps/details?id=com.example.app',
  'http://play.google.com/store/apps/details?id=com.example.app','https://play.google.com:443/store/apps/details?id=com.example.app',
  'https://play.google.com:8443/store/apps/details?id=com.example.app','https://user:secret@play.google.com/store/apps/details?id=com.example.app',
  app().source_url+'#fragment',app().source_url+'&id=com.example.other','https://play.google.com/store/apps/details?id=com.other.app',
  'https://play.google.com/store/search?id=com.example.app']) {
  assert.throws(()=>playSource(app('one',{source_url})));
 }
});

test('Only positive safe integer version codes are compared, never version-name strings',()=>{
 for(const value of [1,42,'42',Number.MAX_SAFE_INTEGER])assert.equal(strictVersionCode(value),Number(value));
 for(const value of [null,undefined,true,false,{},[],0,-1,2.5,Infinity,NaN,'',' 42','42 ','4e2','4.2','042',Number.MAX_SAFE_INTEGER+1])
  assert.equal(strictVersionCode(value),null);
 assert.equal(comparePlayRelease(app(),{versionCode:'100',versionName:'1.0'}).kind,'update');
 assert.equal(comparePlayRelease(app(),{version_code:20,versionName:'a different name'}).kind,'current');
 assert.equal(comparePlayRelease(app(),{versionCode:19,versionName:'99.9'}).kind,'older');
 assert.equal(comparePlayRelease(app('draft',{version_code:null}),{versionCode:21}).kind,'prepare');
 for(const info of [{version:'999.999'}, {versionCode:'2e2'}, {versionCode:21,version_code:22},{}]){
  const result=comparePlayRelease(app(),info);assert.equal(result.kind,'unconfirmed');assert.equal(result.code,null);
 }
 assert.throws(()=>comparePlayRelease(app(),{packageName:'com.other.app',versionCode:200}));
 assert.throws(()=>comparePlayRelease(app(),{error:'Provider denied'}),/Provider denied/);
 assert.equal(comparePlayRelease(app(),{versionCode:19}).canPrepare,false);
});

test('The catalog check is sequential and keeps successful rows when another app fails',async()=>{
 const apps=[app('one'),app('two'),app('three')];const results=[];let concurrent=0,max=0;
 await checkPlayCatalog(apps,async current=>{
  concurrent++;max=Math.max(max,concurrent);await Promise.resolve();concurrent--;
  if(current.id==='two')throw Error('Provider unavailable');return {versionCode:21};
 },(current,result)=>results.push([current.id,result.kind]));
 assert.equal(max,1);assert.deepEqual(results,[['one','update'],['two','error'],['three','update']]);
});

test('Invalid sources are never fetched and cancellation stops later calls and stale results',async()=>{
 let calls=0;const results=[];
 await checkPlayCatalog([app('bad',{source_url:'https://example.invalid/'}),app('good')],async()=>{calls++;return {versionCode:21};},
  (current,result)=>results.push(result.kind));
 assert.equal(calls,1);assert.deepEqual(results,['error','update']);
 let active=true;calls=0;
 await checkPlayCatalog([app('one'),app('two')],async()=>{calls++;active=false;return {versionCode:21};},
  ()=>assert.fail('A result after cancellation must not enter the UI'),()=>active);
 assert.equal(calls,1);
});


test('Apps without a Play listing are skipped without a network call or retry failure',async()=>{
 const apps=[app('missing',{source_url:null}),app('empty',{source_url:''}),app('spaces',{source_url:'  '}),app('valid')];
 const fetched=[],results=[];
 await checkPlayCatalog(apps,async current=>{fetched.push(current.id);return {versionCode:21};},
  (current,result)=>results.push([current.id,result.kind,result.canPrepare]));
 assert.deepEqual(fetched,['valid']);
 assert.deepEqual(results,[['missing','skipped',false],['empty','skipped',false],['spaces','skipped',false],['valid','update',true]]);
});
