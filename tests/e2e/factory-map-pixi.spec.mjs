import { test,expect } from '@playwright/test';
import { factoryMapMachineIds } from '../../app/preparer-map-layout.js';

const machineIds=factoryMapMachineIds();
const serverTime='2026-08-08T04:00:00-03:00';

function machineName(id){
  if(id==='milltap')return 'MILLTAP';
  if(id==='discovery')return 'DISCOVERY';
  return `TNL ${String(Number(id.match(/\d+/)?.[0]||0)).padStart(3,'0')}`;
}

function dashboardSnapshot(){
  const machines=machineIds.map((machineId,index)=>{
    const mod=index%13;
    const physicalStatus=mod===1?'setup':mod===2?'maintenance':mod===3?'stopped':'producing';
    return {
      machineId,
      machineName:machineName(machineId),
      lineId:'linha-5',lineName:'Linha 5',
      assignedOperator:{ name:`Operador ${String(index+1).padStart(3,'0')}`,registration:String(5000+index) },
      activeOrder:{
        op:`90${String(index).padStart(3,'0')}`,item:`ITEM-${String(index).padStart(3,'0')}`,description:'Peça de teste do mapa Pixi',
        opTarget:1000,producedSoFar:100+index,cycleSeconds:60,frequency1:100,frequency2:null,
        pieceLengthMm:10,currentBarPieces:100,feederBars:2,barLengthMm:3600,kerfMm:1
      },
      turnClock:{ totalMinutes:480,usedMinutes:60,remainingMinutes:420 },
      turnState:{ workflowStatus:'ready',goodPieces:20,rejects:0,stopMinutes:0,lastPointingAt:null },
      runtimeState:{ physicalStatus,reason:'',note:'' },
      flowAxes:{ physicalStatus,opStatus:'active',workflowStatus:'ready' },
      forecast:{
        reason:'op',estimatedAt:index%17===0?'2026-08-08T07:00:00-03:00':'2026-08-08T12:00:00-03:00',
        materialEstimatedAt:'2026-08-08T13:00:00-03:00',opRemaining:900-index,availablePieces:1200
      }
    };
  });
  return {
    ok:true,serverTime,productionDate:'2026-08-08',shift:'3',
    lines:[{ id:'linha-5',name:'Linha 5' }],machines,
    summary:{ total:machines.length,producing:machines.filter(m=>m.runtimeState.physicalStatus==='producing').length,setup:machines.filter(m=>m.runtimeState.physicalStatus==='setup').length,stopped:machines.filter(m=>m.runtimeState.physicalStatus==='stopped').length,pending:0,materialRisks:0 }
  };
}

async function installApi(page){
  await page.route('**/api/v1/**',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/api/v1/auth/me'){
      return route.fulfill({ status:200,contentType:'application/json',body:JSON.stringify({
        user:{ id:'prep-pixi-e2e',name:'Preparador Pixi',registration:'0000',roleCode:'preparator',mustChangePassword:false,
          permissions:['machines.view'],lineAccess:['linha-5'],machineAccess:[],operationalContext:{ productionDate:'2026-08-08',shift:'3' } },
        expiresAt:'2026-08-08T12:00:00-03:00'
      }) });
    }
    if(url.pathname==='/api/v1/turn-assistant/line-dashboard')return route.fulfill({ status:200,contentType:'application/json',body:JSON.stringify(dashboardSnapshot()) });
    return route.fulfill({ status:200,contentType:'application/json',body:'{"ok":true}' });
  });
}

async function boot(page){
  const pageErrors=[];const consoleErrors=[];
  page.on('pageerror',error=>pageErrors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text());});
  await installApi(page);
  await page.goto('/?factory-map-pixi-e2e=1',{ waitUntil:'domcontentloaded' });
  await expect(page.locator('.factory-workspace')).toBeVisible();
  await expect(page.locator('.prep-map-machine')).toHaveCount(136);
  await expect(page.locator('[data-factory-renderer="classic"]')).toHaveAttribute('aria-pressed','true');
  return { pageErrors,consoleErrors };
}

async function activatePixi(page){
  await page.locator('[data-factory-renderer="pixi"]').click();
  await expect(page.locator('.factory-workspace')).toHaveClass(/factory-renderer-pixi/);
  await expect(page.locator('.factory-pixi-canvas')).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>Boolean(window.NEOMES_FACTORY_PIXI?.ready)),{ timeout:12000 }).toBe(true);
  await expect.poll(()=>page.evaluate(()=>window.NEOMES_FACTORY_PIXI?.machineCount||0)).toBe(136);
  await expect.poll(()=>page.evaluate(()=>window.NEOMES_FACTORY_PIXI?.visibleMachineCount||0)).toBe(136);
  await expect.poll(()=>page.evaluate(()=>window.NEOMES_FACTORY_PIXI?.highlightedMachineCount||0)).toBe(0);
  await expect(page.locator('.factory-pixi-error')).toHaveCount(0);
}

test('Pixi GPU monta as 136 máquinas, navega, dá zoom e abre detalhe real',async({page},testInfo)=>{
  const errors=await boot(page);
  await activatePixi(page);

  const canvas=page.locator('.factory-pixi-canvas');
  const canvasBox=await canvas.boundingBox();
  expect(canvasBox?.width||0).toBeGreaterThan(250);
  expect(canvasBox?.height||0).toBeGreaterThan(400);

  const beforeScale=await page.evaluate(()=>window.NEOMES_FACTORY_PIXI?.ready ? Number(document.querySelector('[data-pixi-scale]')?.value?.replace('%','')) : 0);
  await page.locator('[data-pixi-action="in"]').click();
  await page.waitForTimeout(320);
  const afterScale=await page.evaluate(()=>Number(document.querySelector('[data-pixi-scale]')?.value?.replace('%',''))||0);
  expect(afterScale).toBeGreaterThan(beforeScale);

  await page.evaluate(()=>window.NEOMES_FACTORY_PIXI.focus('tnl-024'));
  await page.waitForTimeout(220);
  const point=await page.evaluate(()=>window.NEOMES_FACTORY_PIXI.project('tnl-024'));
  expect(point).toBeTruthy();
  expect(point.x).toBeGreaterThan(0);expect(point.y).toBeGreaterThan(0);
  expect(point.x).toBeLessThan(canvasBox.width);expect(point.y).toBeLessThan(canvasBox.height);
  await page.mouse.click(canvasBox.x+point.x,canvasBox.y+point.y);
  await expect(page.locator('#prepDetailLayer')).toHaveClass(/is-open/);
  await expect(page.locator('#prepDetailTitle')).toContainText('TNL 024');
  await page.locator('#prepDetailContent [data-detail-close]').click();

  const beforePan=await page.evaluate(()=>window.NEOMES_FACTORY_PIXI.project('tnl-091'));
  await page.mouse.move(canvasBox.x+canvasBox.width*.62,canvasBox.y+canvasBox.height*.55);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x+canvasBox.width*.42,canvasBox.y+canvasBox.height*.4,{ steps:8 });
  await page.mouse.up();
  await page.waitForTimeout(220);
  const afterPan=await page.evaluate(()=>window.NEOMES_FACTORY_PIXI.project('tnl-091'));
  expect(Math.abs(afterPan.x-beforePan.x)+Math.abs(afterPan.y-beforePan.y)).toBeGreaterThan(20);

  await page.locator('[data-pixi-action="fit"]').click();
  await page.waitForTimeout(220);
  await page.screenshot({ path:testInfo.outputPath('factory-map-pixi.png'),fullPage:true });

  expect(errors.pageErrors).toEqual([]);
  expect(errors.consoleErrors).toEqual([]);
});

test('Pixi acompanha busca/destaque e volta ao mapa clássico sem perder funcionalidade',async({page})=>{
  const errors=await boot(page);
  await activatePixi(page);

  const search=page.locator('#prepSearch');
  await search.fill('TNL 091');
  await expect(page.getByText('1 máquina localizada',{ exact:true })).toBeVisible();
  await expect(page.locator('.prep-map-machine')).toHaveCount(136);
  await expect.poll(()=>page.evaluate(()=>window.NEOMES_FACTORY_PIXI?.machineCount||0),{ timeout:12000 }).toBe(136);
  await expect.poll(()=>page.evaluate(()=>window.NEOMES_FACTORY_PIXI?.visibleMachineCount||0),{ timeout:12000 }).toBe(136);
  await expect.poll(()=>page.evaluate(()=>window.NEOMES_FACTORY_PIXI?.highlightedMachineCount||0),{ timeout:12000 }).toBe(1);
  const canvasBox=await page.locator('.factory-pixi-canvas').boundingBox();
  const point=await page.evaluate(()=>window.NEOMES_FACTORY_PIXI.project('tnl-091'));
  expect(point.x).toBeGreaterThan(0);expect(point.y).toBeGreaterThan(0);
  expect(point.x).toBeLessThan(canvasBox.width);expect(point.y).toBeLessThan(canvasBox.height);

  await search.fill('');
  await expect.poll(()=>page.evaluate(()=>window.NEOMES_FACTORY_PIXI?.highlightedMachineCount||0),{ timeout:12000 }).toBe(0);
  await expect.poll(()=>page.evaluate(()=>window.NEOMES_FACTORY_PIXI?.visibleMachineCount||0),{ timeout:12000 }).toBe(136);

  await page.locator('[data-factory-renderer="classic"]').click();
  await expect(page.locator('.factory-workspace')).not.toHaveClass(/factory-renderer-pixi/);
  await expect(page.locator('.factory-pixi-host')).toHaveCount(0);
  await page.locator('[data-map-machine="tnl-091"]').click();
  await expect(page.locator('#prepDetailTitle')).toContainText('TNL 091');

  expect(errors.pageErrors).toEqual([]);
  expect(errors.consoleErrors).toEqual([]);
});

test('falha do bundle Pixi preserva o mapa clássico',async({page})=>{
  await installApi(page);
  await page.route('**/app/vendor/factory-map-pixi.bundle.js*',route=>route.abort());
  await page.goto('/?factory-map-pixi-fallback=1',{ waitUntil:'domcontentloaded' });
  await expect(page.locator('.prep-map-machine')).toHaveCount(136);
  await page.locator('[data-factory-renderer="pixi"]').click();
  await expect.poll(()=>page.evaluate(()=>window.NEOMES_FACTORY_PIXI?.renderer)).toBe('classic');
  await expect(page.locator('.factory-workspace')).not.toHaveClass(/factory-renderer-pixi/);
  await expect(page.locator('.factory-pixi-host')).toHaveCount(0);
  await page.locator('[data-map-machine="tnl-024"]').click();
  await expect(page.locator('#prepDetailTitle')).toContainText('TNL 024');
});
