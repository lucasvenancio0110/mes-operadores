import { test,expect } from '@playwright/test';
import { installForensicApi } from './support/forensic-api.mjs';

async function waitForOperationalBoot(page){
  await expect(page.getByText('TNL 091',{ exact:true }).first()).toBeVisible();
  await page.waitForFunction(()=>Boolean(window.__NEOMES_MODULE_BOOT));
  await page.waitForTimeout(350);
}

test('painel estabiliza sem ciclo de MutationObserver e o primeiro toque abre a conferência',async({ page })=>{
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await installForensicApi(page);
  await page.goto('/');
  await waitForOperationalBoot(page);

  const mutations=await page.evaluate(async()=>{
    const app=document.getElementById('app');
    let count=0;
    const observer=new MutationObserver(records=>{ count+=records.length; });
    observer.observe(app,{ childList:true,subtree:true,characterData:true });
    await new Promise(resolve=>setTimeout(resolve,650));
    observer.disconnect();
    return count;
  });
  expect(mutations).toBe(0);

  const conference=page.getByRole('button',{ name:/^(Assumir máquina|Fazer conferência)$/ }).first();
  await expect(conference).toBeVisible();
  await conference.evaluate(element=>{ window.__NEOMES_TOUCH_TARGET=element; });
  await conference.tap();
  await expect(page.locator('#taHandoffForm')).toBeVisible();
  expect(await page.evaluate(()=>window.__NEOMES_TOUCH_TARGET?.isConnected)).toBe(true);
  expect(errors).toEqual([]);
});

test('campo de peças boas não é recriado nem perde valor durante o fechamento da OP',async({ page })=>{
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await installForensicApi(page);
  await page.goto('/');
  await waitForOperationalBoot(page);

  const conference=page.getByRole('button',{ name:/^(Assumir máquina|Fazer conferência)$/ }).first();
  await conference.tap();
  const handoff=page.locator('#taHandoffForm');
  await expect(handoff).toBeVisible();
  await handoff.locator('[name="currentBarPieces"]').fill('20');
  await handoff.locator('[name="feederBars"]').fill('2');
  await page.locator('[data-ta-submit-form="taHandoffForm"]').click();
  await expect(page.getByText(/pronta para o turno/).first()).toBeVisible();
  await page.getByRole('button',{ name:'Voltar ao painel' }).click();

  await page.getByRole('button',{ name:'Encerrar OP' }).click();
  const form=page.locator('#taOrderCloseForm');
  await expect(form).toBeVisible();
  const good=form.locator('[data-ta-good]');
  await good.fill('20');
  await expect(good).toHaveValue('20');
  const original=await good.evaluate(element=>{ window.__NEOMES_GOOD_FIELD=element; return element.name; });
  expect(original).toBeTruthy();
  await page.waitForTimeout(900);
  await expect(good).toHaveValue('20');
  expect(await page.evaluate(()=>window.__NEOMES_GOOD_FIELD?.isConnected)).toBe(true);

  await form.locator('[data-ta-rejects]').fill('0');
  await form.locator('[data-ta-stops]').fill('0');
  await page.locator('[data-ta-submit-form="taOrderCloseForm"]').click();
  await expect(page.getByText('Nova OP do mesmo item')).toBeVisible();
  await expect(page.getByText('Máquina ficará parada')).toBeVisible();
  expect(errors).toEqual([]);
});
