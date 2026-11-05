import test from 'node:test';
import assert from 'node:assert/strict';
import { preparePhone, phoneConfiguration } from '../src/android-setup.js';
const fake = () => {
  const calls=[];
  return { calls, info:{serial:'phone-a'}, installApk:async()=>calls.push('install'),isInstalled:async()=>true,
    sh:async()=>({out:'Device Owner:\n admin=ComponentInfo{other.app/.Admin}\n User ID: 0'}),
    setDeviceOwner:async()=>{calls.push('owner');return {exitCode:0,out:'Success'};}
  };
};
test('prepares by installing and activating management in order',async()=>{
  const c=fake();assert.equal(await preparePhone(c,{blob:new Blob(['apk'])}),'phone-a');assert.deepEqual(c.calls,['install','owner']);
});
test('does not reactivate YiDream when it is already device owner',async()=>{
  const c=fake();c.sh=async()=>({out:'Device Owner:\n admin=ComponentInfo{com.yidream.mdm/.MyDeviceAdminReceiver}\n User ID: 0'});
  await preparePhone(c,{blob:new Blob()});assert.deepEqual(c.calls,['install']);
});
test('installation failure prevents activating device management',async()=>{
  const c=fake();c.installApk=async()=>{throw Error('APK refused');};await assert.rejects(preparePhone(c,{blob:new Blob()}),/APK refused/);assert.deepEqual(c.calls,[]);
});
test('owner failure is reported rather than completing preparation',async()=>{
  const c=fake();c.setDeviceOwner=async()=>({exitCode:1,out:'Existing accounts'});await assert.rejects(preparePhone(c,{blob:new Blob()}),/Existing accounts/);
});
test('disconnect or switching phones during installation stops the next operation',async()=>{
  for(const next of [null,{serial:'phone-b'}]){const c=fake();c.installApk=async()=>{c.info=next;};await assert.rejects(preparePhone(c,{blob:new Blob()}),/NOT_CONNECTED/);assert.deepEqual(c.calls,[]);}
});
test('a missing installed package prevents management activation',async()=>{
  const c=fake();c.isInstalled=async()=>false;await assert.rejects(preparePhone(c,{blob:new Blob()}),/non confirmée/);assert.deepEqual(c.calls,['install']);
});
test('configuration rejects invalid packages and missing secure material',()=>{
  assert.throws(()=>phoneConfiguration(new Set(), 'not a package',{intermediate_key:'key'}),/invalides/);
  assert.throws(()=>phoneConfiguration(new Set(), '',{}),/sécurisé/);
  assert.deepEqual(phoneConfiguration(new Set(['com.example.app']),'com.example.app, org.example.extra',{intermediate_key:'key'}),{
    block_browsers:false,block_ai:false,block_social:false,block_store:false,extra_packages:['com.example.app','org.example.extra'],unlock_intermediate_key:'key'
  });
});
