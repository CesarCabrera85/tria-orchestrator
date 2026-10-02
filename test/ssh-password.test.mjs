import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createHash} from 'node:crypto';
import ssh2 from 'ssh2';
import {runPasswordSSH,passwordConnectionOptions} from '../src/ssh-password.mjs';
const privateKey=generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs1',format:'pem'});
const key=ssh2.utils.parseKey(privateKey).getPublicSSH();const hostFingerprint='SHA256:'+createHash('sha256').update(key).digest('base64').replace(/=+$/,'');
const password='test-$"-ñ-password';
test('real SSH password transport authenticates, streams output and does not log password',async()=>{
 const server=new ssh2.Server({hostKeys:[privateKey]},client=>{
  client.on('error',()=>{}).on('authentication',ctx=>ctx.method==='password'&&ctx.username==='tester'&&ctx.password===password?ctx.accept():ctx.reject());
  client.on('ready',()=>client.on('session',accept=>accept().on('exec',(accept,reject,info)=>{const stream=accept();let input='';stream.on('data',d=>input+=d);stream.on('end',()=>{stream.write('hello\n'+password+'\n');stream.stderr.write('diagnostic\n');stream.exit(0);stream.end()})})));
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const options=passwordConnectionOptions({target:'tester@127.0.0.1',port:server.address().port,password,hostFingerprint});const lines=[];
 try{const result=await runPasswordSSH(options,'test command',{input:'payload',onLine:(ch,s)=>lines.push(s)});assert.equal(result.code,0);assert.match(result.stdout,/hello/);assert.ok(!JSON.stringify({result,lines}).includes(password));await assert.rejects(runPasswordSSH({...options,password:'incorrect'},'test'),/rechazó/);await assert.rejects(runPasswordSSH({...options,hostVerifier:()=>false},'test'),/verification|verify|key/i);}finally{await new Promise(resolve=>server.close(resolve))}
});
