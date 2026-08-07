import { test,expect } from '@playwright/test';
import { installForensicApi } from './support/forensic-api.mjs';

test('falha de enhancement autenticado não interrompe os módulos seguintes nem os botões P0',async({ page })=>{
  const pageErrors=[];
  const requested=[];
  page.on('pageerror',error=>pageErrors.push(error.message));
  page.on('request',request=>requested.push(new URL(request.url()).pathname));
  await installForensicApi(page);
  await page.route('**/app/premium-runtime.js*',route=>route.abort('failed'));

  await page.goto('/');
  await expect(page.getByText('TNL 091',{ exact:true }).first()).toBeVisible();
  await page.waitForFunction(()=>Boolean(window.__NEOMES_MODULE_BOOT));

  const boot=await page.evaluate(()=>window.__NEOMES_MODULE_BOOT);
  expect(boot.failures).toHaveLength(1);
  expect(boot.failures[0].modulePath).toBe('./premium-runtime.js');
  expect(boot.results.find(item=>item.modulePath==='./production-planning.js')?.status).toBe('loaded');
  expect(boot.results.find(item=>item.modulePath==='./measurement-plan.js')?.status).toBe('loaded');
  expect(boot.results.find(item=>item.modulePath==='./conference-ux.js')?.status).toBe('loaded');
  expect(requested.some(path=>path.endsWith('/app/measurement-plan.js'))).toBeTruthy();
  expect(requested.some(path=>path.endsWith('/app/conference-ux.js'))).toBeTruthy();

  const conference=page.locator('[data-action="open-conference"],[data-ta-reconfirm]').first();
  await expect(conference).toBeVisible();
  await conference.tap();
  await expect(page.locator('#taHandoffForm')).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test('logout seguro tem um único dono e não dispara confirmação duplicada',async({ page })=>{
  await installForensicApi(page);
  await page.goto('/');
  await expect(page.getByText('TNL 091',{ exact:true }).first()).toBeVisible();
  await page.locator('[data-action="menu"]').tap();
  const logout=page.locator('[data-action="logout"]').first();
  await expect(logout).toBeVisible();

  let dialogs=0;
  page.on('dialog',async dialog=>{ dialogs+=1;await dialog.dismiss(); });
  await logout.tap();
  await page.waitForTimeout(250);
  expect(dialogs).toBe(1);
  await expect(page.getByText('TNL 091',{ exact:true }).first()).toBeVisible();
});
