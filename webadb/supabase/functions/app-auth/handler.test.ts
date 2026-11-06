import nodemailer from 'npm:nodemailer@10.3.1';
import { handler } from './handler.ts';
function assert(value: unknown, message = 'Assertion failed'): asserts value { if (!value) throw Error(message); }
const testPublishableKey = 'sb_publishable_test-project-key';
const fallbackPublishableKey = 'sb_publishable_YG9zgjQ5Y56WiBtKdJMQvA_-UBAFv9B';
const request = (email: string, headers: Record<string,string> = {}) => new Request('https://example.test/app-auth', { method: 'POST', headers: { apikey: testPublishableKey, ...headers }, body: JSON.stringify({ email }) });
const configure = () => {
  Deno.env.set('SUPABASE_URL','https://example.supabase.co');
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY','test-only-private-key');
  Deno.env.set('SUPABASE_PUBLISHABLE_KEYS',JSON.stringify({default:testPublishableKey}));
  Deno.env.set('GMAIL_APP_PASSWORD','test-only-app-password');
};

Deno.test('missing, wrong and private caller keys are rejected before any budget, Auth or mail work; OPTIONS stays public', async () => {
  configure(); const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = () => { calls++; throw Error('Network must not be used'); };
  try {
    assert((await handler(new Request('https://example.test/app-auth',{method:'POST',body:JSON.stringify({email:'a@example.com'})}))).status===401);
    for (const apikey of ['sb_publishable_other-project-key','sb_secret_test-private-key','test-only-private-key','Bearer invalid']) {
      assert((await handler(request('a@example.com',{apikey}))).status===401);
    }
    assert((await handler(new Request('https://example.test/app-auth',{method:'OPTIONS'}))).status===200);
    assert(calls===0);
  } finally { globalThis.fetch=original; }
});

Deno.test('named runtime keys take precedence and malformed maps fail closed; public fallback works only when map is absent', async () => {
  configure(); const original=globalThis.fetch; let calls=0;
  globalThis.fetch=async()=>{calls++;return Response.json(false);};
  try {
    Deno.env.set('SUPABASE_PUBLISHABLE_KEYS',JSON.stringify({named:testPublishableKey,notAllowed:'sb_secret_test-private-key',empty:'',object:{key:testPublishableKey}}));
    assert((await handler(request('a@example.com'))).status===202);
    assert((await handler(request('a@example.com',{apikey:fallbackPublishableKey}))).status===401);
    assert((await handler(request('a@example.com',{apikey:'sb_secret_test-private-key'}))).status===401);
    assert(calls===1);
    for (const value of ['{broken','{}','[]','null','']) {
      Deno.env.set('SUPABASE_PUBLISHABLE_KEYS',value);
      assert((await handler(request('a@example.com',{apikey:fallbackPublishableKey}))).status===401);
    }
    assert(calls===1);
    Deno.env.delete('SUPABASE_PUBLISHABLE_KEYS');
    assert((await handler(request('a@example.com',{apikey:fallbackPublishableKey}))).status===202);
    assert((await handler(request('a@example.com'))).status===401);
    assert(Number(calls)===2);
  } finally { globalThis.fetch=original; configure(); }
});

Deno.test('rejects malformed requests and disallowed origins without network calls', async () => {
  configure();
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = () => { calls++; throw Error('Network must not be used'); };
  try {
    assert((await handler(new Request('https://example.test'))).status===405);
    assert((await handler(request('bad-email'))).status===400);
    assert((await handler(request('a@example.com',{Origin:'https://untrusted.example'}))).status===403);
    assert((await handler(new Request('https://example.test',{method:'POST',headers:{apikey:testPublishableKey},body:JSON.stringify({email:'a@example.com',extra:'x'.repeat(1200)})}))).status===400);
    assert(calls===0);
  } finally { globalThis.fetch = original; }
});

Deno.test('missing private sender configuration cannot generate an OTP or claim a budget', async () => {
  configure(); Deno.env.delete('GMAIL_APP_PASSWORD'); const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = () => { calls++; throw Error('Network must not be used'); };
  try { assert((await handler(request('a@example.com'))).status===503); assert(calls===0); }
  finally { globalThis.fetch=original; configure(); }
});

Deno.test('budget is reserved before OTP generation and spoofed forwarded headers cannot change the peer bucket', async () => {
  configure(); const original=globalThis.fetch; const bodies:Array<Record<string,string>>=[];
  globalThis.fetch = async (input,init) => {
    const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;
    assert(url.endsWith('/rest/v1/rpc/yd_claim_app_auth_email'),'No auth or SMTP work is allowed after a refused budget');
    bodies.push(JSON.parse(String(init?.body))); return Response.json(false);
  };
  try {
    const first=await handler(request('a@example.com',{'x-forwarded-for':'1.1.1.1','cf-connecting-ip':'1.1.1.1'}),'198.51.100.7');
    const second=await handler(request('b@example.com',{'x-forwarded-for':'9.9.9.9','cf-connecting-ip':'9.9.9.9'}),'198.51.100.7');
    assert(first.status===202&&second.status===202); assert(bodies.length===2);
    assert(bodies[0].ip_hash===bodies[1].ip_hash); assert(bodies[0].email_hash!==bodies[1].email_hash);
    assert(/^[0-9a-f]{64}$/.test(bodies[0].email_hash)); assert(!JSON.stringify(bodies).includes('@example.com'));
  } finally { globalThis.fetch=original; }
});

Deno.test('one allowed request privately sends only the generated OTP to the normalized recipient', async () => {
  configure(); const originalFetch=globalThis.fetch; const originalTransport=nodemailer.createTransport;
  const order:string[]=[]; let mail:Record<string,unknown>|null=null;
  globalThis.fetch = async (input,init) => {
    const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;
    if(url.endsWith('/rest/v1/rpc/yd_claim_app_auth_email')) { order.push('budget'); return Response.json(true); }
    assert(url.endsWith('/auth/v1/admin/generate_link')); order.push('generate');
    const body=JSON.parse(String(init?.body)); assert(body.email==='a@example.com'&&body.type==='magiclink');
    return Response.json({email_otp:'123456',action_link:'https://example.test/private-link',hashed_token:'private-hash',verification_type:'magiclink',redirect_to:'https://example.test',id:'00000000-0000-4000-8000-000000000001',email:'a@example.com'});
  };
  nodemailer.createTransport = (() => ({sendMail:async(value:Record<string,unknown>)=>{order.push('send');mail=value;return {accepted:['a@example.com']};},close:()=>{order.push('close');}})) as unknown as typeof nodemailer.createTransport;
  try {
    const response=await handler(request(' A@EXAMPLE.COM '),'198.51.100.7');
    assert(response.status===202); assert(order.join(',')==='budget,generate,send,close');
    assert(mail!==null); assert((mail as Record<string,unknown>).to==='a@example.com');
    assert((mail as Record<string,unknown>).from==='YiDream <yiddishdream@gmail.com>');
    assert(String((mail as Record<string,unknown>).text).includes('123456'));
    assert(!(await response.text()).includes('123456'),'OTP must never be returned to the caller');
  } finally { globalThis.fetch=originalFetch;nodemailer.createTransport=originalTransport; }
});

Deno.test('provider errors return the same acknowledgment and do not leak account existence', async () => {
  configure(); const original=globalThis.fetch;
  globalThis.fetch=async(input)=>{
    const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;
    return url.endsWith('/rest/v1/rpc/yd_claim_app_auth_email')?Response.json(true):Response.json({msg:'private account detail'},{status:400});
  };
  try { const response=await handler(request('a@example.com')); assert(response.status===202); assert(!(await response.text()).includes('private account detail')); }
  finally { globalThis.fetch=original; }
});
