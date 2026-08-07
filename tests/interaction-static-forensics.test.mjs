import { readdir,readFile } from 'node:fs/promises';
import { join } from 'node:path';
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
const assistantSubmit=await readFile(join(root,'app/turn-assistant-submit.js'),'utf8');
const auth=await readFile(join(root,'app/auth-shell.js'),'utf8');

assert.match(operator,/document\.addEventListener\(['"]click['"]/,'operator-main precisa ter delegação de clique');
assert.match(operator,/if \(event\.__NEOMES_ASSISTANT_HANDLED \|\| event\.__NEOMES_AUTH_HANDLED\) return;/,'operator-main deve respeitar ownership do assistente e autenticação');
assert.match(operator,/const handler = handlers\[event\.target\?\.id\];\s*if \(!handler\) return;\s*event\.preventDefault\(\);/s,'submit global deve bloquear apenas formulários do operator-main');
assert.match(operator,/NON_RENDERING_STORE_REASONS = new Set\(\['conference-draft','sync','sync-error','queue','queue-flush'\]\)/,'sync/queue não podem recriar toda a interface');

assert.match(assistant,/document\.addEventListener\(['"]click['"],intercept,true\)/,'captura do assistente permanece explícita e deve usar ownership cooperativo');
assert.match(assistant,/function claimAssistantEvent\(event\)/,'assistente deve marcar eventos que possui');
assert.doesNotMatch(assistant,/stopImmediatePropagation\s*\(/,'assistente não pode matar propagação global');
assert.doesNotMatch(assistantSubmit,/stopImmediatePropagation\s*\(/,'ponte de submit não pode matar propagação global');
assert.match(assistantSubmit,/event\.__NEOMES_ASSISTANT_HANDLED = true/,'ponte de submit deve marcar ownership sem cancelar outros listeners');

assert.match(auth,/async function importOperationalEnhancement\(modulePath\)/,'auth-shell deve isolar falhas dos enhancements autenticados');
assert.match(auth,/window\.__NEOMES_MODULE_BOOT=/,'auth-shell deve publicar diagnóstico do boot operacional');
assert.match(auth,/window\.dispatchEvent\(new CustomEvent\('neomes:module-error'/,'falhas de módulo devem ser observáveis, não escondidas');
assert.match(auth,/event\.__NEOMES_AUTH_HANDLED = true/,'logout seguro deve usar ownership cooperativo');
const authLogout=auth.slice(auth.indexOf("if (event.target.closest('[data-action=\"logout\"]'))"));
assert.doesNotMatch(authLogout.slice(0,300),/stopImmediatePropagation/,'logout não pode matar outros listeners globais');

const operatorActions=[...operator.matchAll(/data-action=\\?['"]([^'"]+)/g)].map(m=>m[1]);
const assistantIntercept=[...assistant.matchAll(/action===['"]([^'"]+)['"]/g)].map(m=>m[1]);
const overlap=[...new Set(assistantIntercept.filter(action=>operatorActions.includes(action)))];
console.log('Ações sobrepostas operator-main x turn-assistant:',overlap.join(', ')||'(nenhuma)');
assert(overlap.includes('open-conference'),'sobreposição open-conference existe e precisa de ownership cooperativo');
assert(overlap.includes('close-order'),'sobreposição close-order existe e precisa de ownership cooperativo');
