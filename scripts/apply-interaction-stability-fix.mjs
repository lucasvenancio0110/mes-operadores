import { readFile,writeFile } from 'node:fs/promises';

async function patch(path, transform) {
  const before = await readFile(path,'utf8');
  const after = transform(before);
  if (after === before) throw new Error(`${path}: nenhuma alteração aplicada`);
  await writeFile(path,after);
  console.log(`patched ${path}`);
}

function replaceRequired(source,oldText,newText,label){
  if(!source.includes(oldText))throw new Error(`trecho não encontrado: ${label}`);
  return source.replace(oldText,newText);
}

await patch('app/operator-main.js',source=>{
  source=replaceRequired(
    source,
    "document.addEventListener('click', event => {\n  const route = event.target.closest('[data-route]')?.dataset.route;",
    "document.addEventListener('click', event => {\n  if (event.__NEOMES_ASSISTANT_HANDLED) return;\n  const route = event.target.closest('[data-route]')?.dataset.route;",
    'operator click ownership'
  );

  source=replaceRequired(
    source,
    "document.addEventListener('submit', event => {\n  event.preventDefault();\n  if (event.target.id === 'loginForm') submitLogin(event.target);\n  if (event.target.id === 'conferenceForm') submitConference(event.target);\n  if (event.target.id === 'closeOrderForm') submitCloseOrder(event.target);\n});",
    "document.addEventListener('submit', event => {\n  const handlers = {\n    loginForm: submitLogin,\n    conferenceForm: submitConference,\n    closeOrderForm: submitCloseOrder\n  };\n  const handler = handlers[event.target?.id];\n  if (!handler) return;\n  event.preventDefault();\n  handler(event.target);\n});",
    'operator submit ownership'
  );

  source=replaceRequired(
    source,
    "store.subscribe((_state, reason) => {\n  if (!['conference-draft'].includes(reason)) render();\n});",
    "const NON_RENDERING_STORE_REASONS = new Set(['conference-draft','sync','sync-error','queue','queue-flush']);\nstore.subscribe((_state, reason) => {\n  if (!NON_RENDERING_STORE_REASONS.has(reason)) render();\n});",
    'operator render stability'
  );
  return source;
});

await patch('app/turn-assistant.js',source=>{
  const marker="function intercept(event) {";
  if(!source.includes(marker))throw new Error('turn-assistant intercept não encontrado');
  source=source.replace(marker,"function claimAssistantEvent(event) {\n  event.preventDefault();\n  event.__NEOMES_ASSISTANT_HANDLED = true;\n}\n\nfunction intercept(event) {");
  const old="event.preventDefault();event.stopImmediatePropagation();";
  const occurrences=source.split(old).length-1;
  if(occurrences<5)throw new Error(`esperados múltiplos cancelamentos do assistente; encontrados ${occurrences}`);
  source=source.split(old).join('claimAssistantEvent(event);');
  return source;
});

await patch('app/turn-assistant-submit.js',source=>replaceRequired(
  source,
  "    event.preventDefault();\n    event.stopImmediatePropagation?.();\n    onSubmit(form,button);",
  "    event.preventDefault();\n    event.__NEOMES_ASSISTANT_HANDLED = true;\n    onSubmit(form,button);",
  'assistant submit click ownership'
));

console.log('NEOMES interaction stability patch applied.');
