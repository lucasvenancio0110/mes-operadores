import { readFile,writeFile } from 'node:fs/promises';

async function patch(path,transform){
  const before=await readFile(path,'utf8');
  const after=transform(before);
  if(after===before)throw new Error(`${path}: nenhuma alteração aplicada`);
  await writeFile(path,after);
  console.log(`patched ${path}`);
}
function required(source,oldText,newText,label){
  if(!source.includes(oldText))throw new Error(`trecho não encontrado: ${label}`);
  return source.replace(oldText,newText);
}

await patch('app/auth-shell.js',source=>{
  const oldLoader=`async function loadOperationalApp(user, offline = false) {\n  currentAuth = { user, offline };\n  window.NEOMES_AUTH = currentAuth;\n  await setOperationalSession(user,offline);\n  if (['preparator','leadership'].includes(user.roleCode)) {\n    await import('./preparer-dashboard.js');\n    return;\n  }\n  await import('./operator-main.js');\n  await import('./cloud-state.js');\n  await import('./exports.js');\n  await import('./premium-runtime.js');\n  await import('./production-planning.js');\n  await import('./measurement-plan.js');\n  await import('./conference-ux.js');\n  await import('./shift-performance.js');\n  await import('./shift-time-fix.js');\n  await import('./measurement-frequency-fix.js');\n  await import('./frequency-fields-v2.js');\n  await import('./admin-ui.js');\n}`;
  const newLoader=`async function importOperationalEnhancement(modulePath) {\n  try {\n    await import(modulePath);\n    return { modulePath,status:'loaded' };\n  } catch (error) {\n    const detail={ modulePath,status:'failed',message:error?.message || String(error) };\n    console.error('[NEOMES MODULE BOOT]',detail,error);\n    window.dispatchEvent(new CustomEvent('neomes:module-error',{ detail }));\n    return detail;\n  }\n}\n\nasync function loadOperationalApp(user, offline = false) {\n  currentAuth = { user, offline };\n  window.NEOMES_AUTH = currentAuth;\n  await setOperationalSession(user,offline);\n  if (['preparator','leadership'].includes(user.roleCode)) {\n    await import('./preparer-dashboard.js');\n    return;\n  }\n\n  // O shell do operador é P0: sem ele não existe aplicação operacional.\n  await import('./operator-main.js');\n  const enhancements=[\n    './cloud-state.js',\n    './exports.js',\n    './premium-runtime.js',\n    './production-planning.js',\n    './measurement-plan.js',\n    './conference-ux.js',\n    './shift-performance.js',\n    './shift-time-fix.js',\n    './measurement-frequency-fix.js',\n    './frequency-fields-v2.js',\n    './admin-ui.js'\n  ];\n  const results=[];\n  for (const modulePath of enhancements) results.push(await importOperationalEnhancement(modulePath));\n  window.__NEOMES_MODULE_BOOT={\n    completedAt:new Date().toISOString(),\n    results,\n    failures:results.filter(result=>result.status==='failed')\n  };\n  window.dispatchEvent(new CustomEvent('neomes:module-boot-complete',{ detail:window.__NEOMES_MODULE_BOOT }));\n}`;
  source=required(source,oldLoader,newLoader,'authenticated operational loader');
  source=required(
    source,
    `  if (event.target.closest('[data-action="logout"]')) {\n    event.preventDefault(); event.stopImmediatePropagation(); secureLogout();\n  }`,
    `  if (event.target.closest('[data-action="logout"]')) {\n    event.preventDefault();\n    event.__NEOMES_AUTH_HANDLED = true;\n    secureLogout();\n  }`,
    'secure logout ownership'
  );
  return source;
});

await patch('app/operator-main.js',source=>required(
  source,
  `  if (event.__NEOMES_ASSISTANT_HANDLED) return;`,
  `  if (event.__NEOMES_ASSISTANT_HANDLED || event.__NEOMES_AUTH_HANDLED) return;`,
  'operator auth ownership'
));

console.log('NEOMES authenticated boot resilience patch applied.');
