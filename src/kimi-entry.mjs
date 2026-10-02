// Kimi Code 2.x accepts prompts in argv only. Build argv inside the child so long
// shared conversations do not hit Windows command-line limits or shell quoting.
import { pathToFileURL } from 'node:url';
const entry=process.argv[2];
let input='';for await(const chunk of process.stdin)input+=chunk;
const {prompt,model}=JSON.parse(input);
process.argv=[process.execPath,entry,'--prompt',prompt,'--output-format','stream-json'];
if(model)process.argv.push('--model',model);
await import(pathToFileURL(entry).href);
