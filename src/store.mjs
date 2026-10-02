import { mkdirSync, readFileSync, writeFileSync, renameSync, appendFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

export class Store extends EventEmitter {
  constructor(dir) { super(); this.dir = dir; mkdirSync(join(dir, 'runs'), {recursive:true}); }
  read(name, fallback) { try { return JSON.parse(readFileSync(join(this.dir, name), 'utf8')); } catch(e) { if(e.code === 'ENOENT') return fallback; throw e; } }
  write(name, value) {
    const dest = join(this.dir, name), tmp = `${dest}.${randomUUID()}.tmp`;
    mkdirSync(join(dest, '..'), {recursive:true});
    writeFileSync(tmp, JSON.stringify(value, null, 2)); renameSync(tmp, dest); return value;
  }
  run(id) { if(!/^[a-f0-9-]{36}$/.test(id)) throw new Error('ID de ejecución inválido'); const r=this.read(`runs/${id}/run.json`); if(!r) throw new Error('Ejecución no encontrada'); return r; }
  save(run) { run.updatedAt = new Date().toISOString(); return this.write(`runs/${run.id}/run.json`, run); }
  list() { return readdirSync(join(this.dir,'runs')).filter(id=>existsSync(join(this.dir,'runs',id,'run.json'))).map(id=>this.run(id)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)); }
  event(id, type, data={}) {
    const event={id:randomUUID(), at:new Date().toISOString(), type, ...data};
    appendFileSync(join(this.dir,'runs',id,'events.jsonl'), JSON.stringify(event)+'\n');
    this.emit(id,event); return event;
  }
  events(id) { this.run(id); try { return readFileSync(join(this.dir,'runs',id,'events.jsonl'),'utf8').split('\n').filter(Boolean).flatMap(line=>{try{return [JSON.parse(line)]}catch{return []}}); } catch(e) { if(e.code==='ENOENT')return []; throw e; } }
}
