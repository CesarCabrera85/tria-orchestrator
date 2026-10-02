import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,chmodSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {callAgent,defaultSettings} from '../src/agents.mjs';

test('Gemini JSON and Kimi 2.x JSONL adapter transport long prompts without shell truncation (fixture CLIs)',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'tria-extra-cli-'));
 const geminiScript=join(dir,'gemini.mjs'),kimiScript=join(dir,'kimi.mjs');
 writeFileSync(geminiScript,`let prompt='';for await(const c of process.stdin)prompt+=c;if(!prompt.endsWith('FIN'))process.exit(8);console.log(JSON.stringify(prompt.includes('FAIL')?{error:{message:'account required'}}:{response:'{"ok":true}'}));`);
 writeFileSync(kimiScript,`const prompt=process.argv[process.argv.indexOf('--prompt')+1];if(!prompt.endsWith('FIN')||prompt.length<60000)process.exit(8);console.log(JSON.stringify({role:'assistant',content:'intermediate',tool_calls:[{}]}));console.log(JSON.stringify({role:'assistant',content:[{type:'text',text:'{"ok":true}'}]}));`);
 const wrapper=join(dir,process.platform==='win32'?'gemini.cmd':'gemini');writeFileSync(wrapper,process.platform==='win32'?`@echo off\r\n"${process.execPath}" "${geminiScript}" %*\r\n`:`#!/bin/sh\nexec '${process.execPath}' '${geminiScript}' "$@"\n`);if(process.platform!=='win32')chmodSync(wrapper,0o755);
 const cfg=defaultSettings();cfg.gemini.command=wrapper;cfg.kimi.command=kimiScript;
 const prompt='texto "citado" & $ especial\n'.repeat(3000)+'FIN';
 for(const id of ['gemini','kimi'])assert.deepEqual(JSON.parse(await callAgent(id,prompt,{settings:cfg,cwd:dir})),{ok:true});
 await assert.rejects(callAgent('gemini','FAIL FIN',{settings:cfg,cwd:dir}),/account required/);
});

test('adapter drives a real child CLI through stdin and streams Codex/Claude protocol (fixture CLI)',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'tria cli '));const script=join(dir,'cli.mjs');
 writeFileSync(script,`let input='';for await(const c of process.stdin)input+=c;const args=process.argv.slice(2);if(!input.includes('quoted "text"'))process.exit(8);if(args.includes('exec')){console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'{"ok":true}'}}));console.log(JSON.stringify({type:'turn.completed'}))}else{console.log(JSON.stringify({type:'assistant',message:{content:[{type:'text',text:'working'}]}}));console.log(JSON.stringify({type:'result',is_error:input.includes('fail'),result:input.includes('fail')?'login failed':'{"ok":true}'}))}`);
 const wrapper=join(dir,process.platform==='win32'?'fixture.cmd':'fixture');
 writeFileSync(wrapper,process.platform==='win32'?`@echo off\r\n"${process.execPath}" "${script}" %*\r\n`:`#!/bin/sh\nexec '${process.execPath}' '${script}' "$@"\n`);if(process.platform!=='win32')chmodSync(wrapper,0o755);
 const settings=defaultSettings();settings.codex.command=wrapper;settings.claude.command=wrapper;const events=[];
 for(const agent of ['codex','claude']){const result=await callAgent(agent,'quoted "text"\nwith newlines',{settings,cwd:dir,onEvent:e=>events.push(e)});assert.deepEqual(JSON.parse(result),{ok:true})}
 assert.ok(events.some(e=>e.agent==='claude'&&e.event?.type==='assistant'));
 await assert.rejects(callAgent('claude','quoted "text" fail',{settings,cwd:dir}),/login failed/);
});
