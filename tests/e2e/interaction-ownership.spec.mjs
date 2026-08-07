import { test,expect } from '@playwright/test';
import { installForensicApi } from './support/forensic-api.mjs';

async function ready(page){
  await page.goto('/');
  await expect(page.getByText('TNL 091',{ exact:true }).first()).toBeVisible();
  const trigger=page.locator('[data-action="open-conference"],[data-ta-reconfirm]').first();
  await expect(trigger).toBeVisible();
  await trigger.tap();
  const form=page.locator('#taHandoffForm');
  await expect(form).toBeVisible();
  await form.locator('[name="currentBarPieces"]').fill('20');
  await form.locator('[name="feederBars"]').fill('2');
  await page.locator('[data-ta-submit-form="taHandoffForm"]').tap();
  await expect(page.getByText('Pronta para o turno',{ exact:true })).toBeVisible();
  await page.getByRole('button',{ name:'Voltar ao painel',exact:true }).tap();
  await expect(page.locator('[data-ta-point]')).toBeVisible();
}

test('sync e fila não substituem o botão crítico durante a janela de toque',async({ page })=>{
  await installForensicApi(page);
  await ready(page);
  const selector='[data-ta-point]';
  const before=await page.locator(selector).first().evaluate(element=>{
    element.dataset.forensicStable='critical';
    window.__NEOMES_CRITICAL_NODE=element;
    return { connected:element.isConnected,text:element.textContent };
  });
  expect(before.connected).toBeTruthy();

  for(const reason of ['sync','queue','queue-flush','sync-error']){
    const state=await page.evaluate(async currentReason=>{
      const { store }=await import('/app/core.js');
      store.update(value=>{
        value.sync.status=currentReason==='sync-error'?'error':'synced';
        value.sync.error=currentReason==='sync-error'?'falha simulada':'';
      },currentReason);
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const current=document.querySelector('[data-forensic-stable="critical"]');
      return {
        same:current===window.__NEOMES_CRITICAL_NODE,
        connected:Boolean(window.__NEOMES_CRITICAL_NODE?.isConnected),
        count:document.querySelectorAll('[data-forensic-stable="critical"]').length
      };
    },reason);
    expect(state,`${reason} substituiu o botão crítico`).toEqual({ same:true,connected:true,count:1 });
  }
});

test('captura do assistente não impede o listener real do botão',async({ page })=>{
  await installForensicApi(page);
  await ready(page);
  const update=page.locator('[data-ta-update]').first();
  await update.evaluate(element=>{
    window.__NEOMES_TARGET_CLICK=0;
    element.addEventListener('click',()=>{ window.__NEOMES_TARGET_CLICK+=1; },{ once:true });
  });
  await update.tap();
  await expect(page.locator('#taHandoffForm')).toBeVisible();
  expect(await page.evaluate(()=>window.__NEOMES_TARGET_CLICK)).toBe(1);
});

test('submit global do operador não bloqueia formulário que não pertence a ele',async({ page })=>{
  await installForensicApi(page);
  await ready(page);
  const result=await page.evaluate(()=>{
    const form=document.createElement('form');
    form.id='forensicForeignForm';
    document.body.append(form);
    const event=new SubmitEvent('submit',{ bubbles:true,cancelable:true });
    const dispatched=form.dispatchEvent(event);
    const output={ defaultPrevented:event.defaultPrevented,dispatchReturned:dispatched };
    form.remove();
    return output;
  });
  expect(result).toEqual({ defaultPrevented:false,dispatchReturned:true });
});
