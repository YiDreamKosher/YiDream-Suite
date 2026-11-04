import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { fetchCurrentApk, MANIFEST_URL, APK_URL, LEGACY_APK_URL } from '../src/current-apk.js';
const bytes = new TextEncoder().encode('verified APK fixture');
const manifest = { versionCode: 12, versionName: 'v5.7', apkUrl: APK_URL, apkSha256: createHash('sha256').update(bytes).digest('hex') };
function server(metadata = manifest, content = bytes) {
 const calls = [];
 const fetcher = async (url, options) => { calls.push({url,options}); return url===MANIFEST_URL ? {ok:true,json:async()=>metadata} : {ok:true,arrayBuffer:async()=>content.buffer}; };
 return { calls, fetcher };
}
test('downloads the same verified release as the app updater', async () => {
 const s=server(); const release=await fetchCurrentApk(s.fetcher,webcrypto);
 assert.equal(release.versionCode,12); assert.equal(release.blob.size,bytes.length);
 assert.deepEqual(s.calls.map(c=>c.url),[MANIFEST_URL,APK_URL]);
 assert.ok(s.calls.every(c=>c.options.cache==='no-store'&&c.options.redirect==='error'));
});
test('rejects stale versions, changed source and absent checksum before download', async () => {
 for(const change of [{versionCode:8},{apkUrl:'https://other.example/app.apk'},{apkSha256:''}]){
  const s=server({...manifest,...change});await assert.rejects(()=>fetchCurrentApk(s.fetcher,webcrypto));assert.equal(s.calls.length,1);
 }
});
test('does not accept corrupt or empty files', async () => {
 for(const content of [new Uint8Array([1,2,3]),new Uint8Array()]) await assert.rejects(()=>fetchCurrentApk(server(manifest,content).fetcher,webcrypto));
});

test('the pre-transfer manifest URL is narrowly mapped to the new official host and still hashed', async()=>{
 const s=server({...manifest,apkUrl:LEGACY_APK_URL});await fetchCurrentApk(s.fetcher,webcrypto);assert.deepEqual(s.calls.map(c=>c.url),[MANIFEST_URL,APK_URL]);
 await assert.rejects(()=>fetchCurrentApk(server({...manifest,apkUrl:LEGACY_APK_URL},new Uint8Array([1])).fetcher,webcrypto));
 for(const apkUrl of [LEGACY_APK_URL+'?x=1',APK_URL+'#x',APK_URL.replace('https:','http:')]){const bad=server({...manifest,apkUrl});await assert.rejects(()=>fetchCurrentApk(bad.fetcher,webcrypto));assert.equal(bad.calls.length,1);}
});
