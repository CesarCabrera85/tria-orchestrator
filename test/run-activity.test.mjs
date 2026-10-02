import test from 'node:test';
import assert from 'node:assert/strict';
import {activityState} from '../public/run-activity.js';
test('activity distinguishes active, finished and failed turns during replay',()=>{
 const events=[{type:'dispatch',agent:'claude',at:'2026-10-02T12:00:00Z'},{type:'agent_event',agent:'claude',at:'2026-10-02T12:01:00Z',event:{type:'assistant',message:{content:[{type:'tool_use',name:'Bash',input:{description:'Ejecutar pruebas'}}]}}}];
 let state=activityState({status:'running'},events);assert.equal(state.active.agent,'claude');assert.match(state.agents.claude.detail,/Ejecutar pruebas/);
 assert.equal(activityState({status:'failed'},events).active,null);
 events.push({type:'turn_end',agent:'claude'});assert.equal(activityState({status:'running'},events).active,null);
 events.push({type:'dispatch',agent:'codex',at:'2026-10-02T12:02:00Z'});assert.equal(activityState({status:'running'},events).active.agent,'codex');
});
