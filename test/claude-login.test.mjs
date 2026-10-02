import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { ClaudeLogin, authorizationUrl } from '../src/claude-login.mjs';
const url='https://claude.com/cai/oauth/authorize?state=abc&code_challenge=def';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(verified=false) {
  const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();
  let checks=0,launches=0;
  const login=new ClaudeLogin({spawnProcess:()=>{launches++;return child},verify:async()=>++checks>1&&verified});
  return {child,login,launches:()=>launches};
}
test('captures complete official URL across chunks; reuses pending session; never returns auth code',async()=>{
  assert.equal(authorizationUrl('https://example.org/oauth/authorize?state=a&code_challenge=b\n'),null);
  const {child,login,launches}=fixture(true);
  try {
    await Promise.all([login.start('claude'),login.start('claude')]);assert.equal(launches(),1);
    child.stdout.write(url.slice(0,-3));assert.equal(login.snapshot().url,null);
    child.stdout.write(url.slice(-3)+'\nPaste code >');assert.equal(login.snapshot().url,url);
    const id=login.snapshot().sessionId;
    assert.throws(()=>login.submit('stale','secret'),/sesión/);
    assert.throws(()=>login.submit(id,'bad\ncode'),/línea/);
    let sent='';child.stdin.on('data',chunk=>sent+=chunk);
    login.submit(id,'  secret#state  ');assert.equal(sent,'secret#state\n');
    assert.equal(JSON.stringify(login.snapshot()).includes('secret'),false);
    child.emit('close',0);await tick();assert.equal(login.snapshot().status,'authenticated');assert.equal(login.snapshot().url,null);
  } finally {login.close()}
});
test('exit zero is not proof of login; already linked account launches no process',async()=>{
  const {child,login}=fixture();
  try {await login.start('claude');child.emit('close',0);await tick();assert.equal(login.snapshot().status,'failed')}finally{login.close()}
  const existing=new ClaudeLogin({verify:async()=>true,spawnProcess:()=>{throw new Error('must not launch')}});
  assert.equal((await existing.start('claude')).status,'authenticated');existing.close();
});
test('expired and cancelled sessions reject codes, and late completion cannot override cancellation',async()=>{
  const {child,login}=fixture(true);
  login.timeout=10;await login.start('claude');
  await new Promise(resolve=>setTimeout(resolve,25));assert.equal(login.snapshot().status,'expired');
  await login.start('claude');login.close();child.emit('close',0);await tick();assert.equal(login.snapshot().status,'cancelled');
  assert.throws(()=>login.submit(login.snapshot().sessionId,'secret'),/sesión/);
});
