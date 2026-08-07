import { readdir,readFile } from 'node:fs/promises';
import { join,relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const root=process.cwd();
const scanRoots=['app','worker','tests/e2e'];
const files=['index.html','sw.js'];
async function walk(dir){
  for(const entry of await readdir(join(root,dir),{ withFileTypes:true })){
    const path=join(dir,entry.name);
    if(entry.isDirectory())await walk(path);
    else if(/\.(?:js|mjs|css|html)$/.test(entry.name))files.push(path);
  }
}
for(const dir of scanRoots)await walk(dir);

const patterns={
  captureClick:/addEventListener\(\s*['"]click['"][\s\S]{0,180}?,\s*true\s*\)/g,
  stopImmediate:/stopImmediatePropagation\s*\(/g,
  preventDefault:/preventDefault\s*\(/g,
  mutationObserver:/MutationObserver/g,
  layerWrite:/layers?\.innerHTML\s*=/g,
  fullScreenFixed:/position\s*:\s*fixed[^}]{0,220}inset\s*:\s*0|inset\s*:\s*0[^}]{0,220}position\s*:\s*fixed/g,
  pointerEvents:/pointer-events\s*:/g,
  zIndex:/z-index\s*:/g,
  disabledWrite:/\.disabled\s*=|setAttribute\(\s*['"]disabled/g,
  ariaDisabled:/aria-disabled/g,
  globalSubmit:/document\.addEventListener\(\s*['"]submit['"]/g
};

const report={ filesScanned:files.length,syntaxErrors:[],hits:{} };
for(const key of Object.keys(patterns))report.hits[key]=[];

for(const path of files){
  const content=await readFile(join(root,path),'utf8');
  if(/\.(?:js|mjs)$/.test(path)){
    const check=spawnSync(process.execPath,['--check',join(root,path)],{ encoding:'utf8' });
    if(check.status!==0)report.syntaxErrors.push({ path,error:(check.stderr||check.stdout).trim() });
  }
  const lines=content.split('\n');
  for(const [key,regex] of Object.entries(patterns)){
    regex.lastIndex=0;
    for(const match of content.matchAll(regex)){
      const line=content.slice(0,match.index).split('\n').length;
      report.hits[key].push({ path,line,snippet:lines.slice(Math.max(0,line-2),Math.min(lines.length,line+2)).join(' ').trim().slice(0,420) });
    }
  }
}

console.log('\n=== NEOMES INTERACTION FORENSICS ===');
console.log(`Arquivos analisados: ${report.filesScanned}`);
for(const [key,hits] of Object.entries(report.hits)){
  console.log(`\n[${key}] ${hits.length}`);
  for(const hit of hits)console.log(`- ${hit.path}:${hit.line} :: ${hit.snippet}`);
}
console.log('\n=== END FORENSICS ===\n');

assert.equal(report.syntaxErrors.length,0,`Erros de sintaxe: ${JSON.stringify(report.syntaxErrors,null,2)}`);

const index=await readFile(join(root,'index.html'),'utf8');
assert.doesNotMatch(index,/production-counter\.(?:js|css)/,'contador não pode estar acoplado ao frontend');

const operator=await readFile(join(root,'app/operator-main.js'),'utf8');
const assistant=await readFile(join(root,'app/turn-assistant.js'),'utf8');
assert.match(operator,/document\.addEventListener\(['"]click['"]/,'operator-main precisa ter delegação de clique');
assert.match(assistant,/document\.addEventListener\(['"]click['"],intercept,true\)/,'assistente usa captura global: risco conhecido precisa ficar explícito');
assert.match(assistant,/stopImmediatePropagation\(\)/,'assistente cancela propagação em ações sobrepostas: risco conhecido precisa ficar explícito');

const operatorActions=[...operator.matchAll(/data-action=\\?['"]([^'"]+)/g)].map(m=>m[1]);
const assistantIntercept=[...assistant.matchAll(/action===['"]([^'"]+)['"]/g)].map(m=>m[1]);
const overlap=[...new Set(assistantIntercept.filter(action=>operatorActions.includes(action)))];
console.log('Ações sobrepostas operator-main x turn-assistant:',overlap.join(', ')||'(nenhuma)');
assert(overlap.includes('open-conference'),'auditoria espera detectar a sobreposição de open-conference');
assert(overlap.includes('close-order'),'auditoria espera detectar a sobreposição de close-order');
