import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,chmodSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {callAgent,defaultSettings} from '../src/agents.mjs';

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
