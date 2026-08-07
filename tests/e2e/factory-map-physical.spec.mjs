import { test,expect } from '@playwright/test';
import { FACTORY_MAP_GEOMETRY,factoryMapMachineIds } from '../../app/preparer-map-layout.js';

const machineIds=factoryMapMachineIds();
const serverTime='2026-08-07T20:00:00-03:00';

function machineName(id){
  if(id==='milltap')return 'MILLTAP';
  if(id==='discovery')return 'DISCOVERY';
  return `TNL ${String(Number(id.match(/\d+/)?.[0]||0)).padStart(3,'0')}`;
}

function dashboardSnapshot(){
  const machines=machineIds.map((machineId,index)=>({
    machineId,
    machineName:machineName(machineId),
    lineId:'linha-5',
    lineName:'Linha 5',
    assignedOperator:{ name:`Operador ${String(index+1).padStart(3,'0')}`,registration:String(5000+index) },
    activeOrder:{
      op:`90${String(index).padStart(3,'0')}`,item:`ITEM-${String(index).padStart(3,'0')}`,description:'Peça de teste do mapa',
      opTarget:1000,producedSoFar:100,cycleSeconds:60,frequency1:100,frequency2:null,
      pieceLengthMm:10,currentBarPieces:100,feederBars:2,barLengthMm:3600,kerfMm:1
    },
    turnClock:{ totalMinutes:480,usedMinutes:60,remainingMinutes:420 },
    turnState:{ workflowStatus:'ready',goodPieces:20,rejects:0,stopMinutes:0,lastPointingAt:null },
    runtimeState:{ physicalStatus:'producing',reason:'',note:'' },
    flowAxes:{ physicalStatus:'producing',opStatus:'active',workflowStatus:'ready' },
    forecast:{
      reason:'op',estimatedAt:'2026-08-08T08:00:00-03:00',materialEstimatedAt:'2026-08-08T10:00:00-03:00',
      opRemaining:900,availablePieces:1200
    }
  }));
  return {
    ok:true,serverTime,productionDate:'2026-08-07',shift:'2',
    lines:[{ id:'linha-5',name:'Linha 5' }],machines,
    summary:{ total:machines.length,producing:machines.length,setup:0,stopped:0,pending:0,materialRisks:0 }
  };
}

async function boot(page){
  const pageErrors=[];const consoleErrors=[];
  page.on('pageerror',error=>pageErrors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text());});
  await page.route('**/api/v1/**',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/api/v1/auth/me'){
      return route.fulfill({ status:200,contentType:'application/json',body:JSON.stringify({
        user:{
          id:'prep-e2e',name:'Preparador E2E',registration:'0000',roleCode:'preparator',mustChangePassword:false,
          permissions:['machines.view'],lineAccess:['linha-5'],machineAccess:[],
          operationalContext:{ productionDate:'2026-08-07',shift:'2' }
        },expiresAt:'2026-08-08T08:00:00-03:00'
      }) });
    }
    if(url.pathname==='/api/v1/turn-assistant/line-dashboard'){
      return route.fulfill({ status:200,contentType:'application/json',body:JSON.stringify(dashboardSnapshot()) });
    }
    return route.fulfill({ status:200,contentType:'application/json',body:'{"ok":true}' });
  });
  await page.goto('/?factory-map-e2e=1',{ waitUntil:'domcontentloaded' });
  await expect(page.locator('.factory-workspace')).toBeVisible();
  await expect(page.locator('.prep-map-machine')).toHaveCount(136);
  return { pageErrors,consoleErrors };
}

async function rawBox(page,id){
  return page.locator(`[data-map-machine="${id}"]`).evaluate(element=>({
    left:Number.parseFloat(element.style.left),top:Number.parseFloat(element.style.top),
    width:Number.parseFloat(getComputedStyle(element).width),height:Number.parseFloat(getComputedStyle(element).height)
  }));
}

function gapX(a,b){
  const [left,right]=a.left<=b.left?[a,b]:[b,a];
  return right.left-(left.left+left.width);
}
function gapY(a,b){
  const [top,bottom]=a.top<=b.top?[a,b]:[b,a];
  return bottom.top-(top.top+top.height);
}

async function expectGap(actual,expected){expect(Math.abs(actual-expected)).toBeLessThanOrEqual(1);}

test('geometria física, corredores e posições especiais',async({page},testInfo)=>{
  const errors=await boot(page);
  const boxes={};
  for(const id of ['tnl-024','tnl-017','tnl-028','tnl-009','tnl-060','tnl-085','tnl-083','tnl-072','tnl-069','tnl-068','tnl-067','tnl-084','tnl-086','tnl-096','tnl-097','tnl-100','tnl-121','tnl-124','tnl-130','tnl-134','tnl-139','tnl-140','tnl-145','milltap','discovery'])boxes[id]=await rawBox(page,id);

  for(const [a,b] of [['tnl-024','tnl-017'],['tnl-017','tnl-028'],['tnl-028','tnl-009'],['tnl-009','tnl-060'],['tnl-060','tnl-085']])await expectGap(gapX(boxes[a],boxes[b]),FACTORY_MAP_GEOMETRY.aisleGap);
  for(const [a,b] of [['tnl-083','tnl-072'],['tnl-072','tnl-069'],['tnl-069','tnl-068'],['tnl-068','tnl-067']])await expectGap(gapX(boxes[a],boxes[b]),FACTORY_MAP_GEOMETRY.compactGap);

  await expectGap(gapY(boxes['tnl-083'],boxes['tnl-084']),FACTORY_MAP_GEOMETRY.aisleGap);
  await expectGap(gapY(boxes['tnl-084'],boxes['tnl-086']),FACTORY_MAP_GEOMETRY.aisleGap);
  await expectGap(gapY(boxes['tnl-121'],boxes['tnl-124']),FACTORY_MAP_GEOMETRY.aisleGap);
  await expectGap(gapX(boxes['tnl-096'],boxes['tnl-097']),FACTORY_MAP_GEOMETRY.aisleGap);
  await expectGap(gapX(boxes['tnl-097'],boxes['tnl-100']),FACTORY_MAP_GEOMETRY.aisleGap);

  expect(boxes['tnl-140'].top).toBe(boxes['tnl-139'].top);
  await expectGap(gapX(boxes['tnl-139'],boxes['tnl-140']),FACTORY_MAP_GEOMETRY.compactGap);
  expect(boxes['tnl-145'].top).toBe(boxes['tnl-134'].top);
  await expectGap(gapX(boxes['tnl-134'],boxes['tnl-145']),FACTORY_MAP_GEOMETRY.compactGap);
  expect(boxes.milltap.left).toBe(boxes['tnl-145'].left);
  expect(boxes.milltap.top).toBeLessThan(boxes['tnl-145'].top);
  expect(boxes.discovery.top).toBe(boxes.milltap.top);
  await expectGap(gapX(boxes.milltap,boxes.discovery),FACTORY_MAP_GEOMETRY.compactGap);

  expect(boxes['tnl-024'].top).toBeLessThan(boxes['tnl-130'].top);
  expect(boxes['tnl-130'].left).toBeGreaterThan(boxes['tnl-024'].left);

  const viewport=page.locator('[data-map-viewport]');
  const viewportRect=await viewport.boundingBox();
  const viewportHeight=viewportRect?.height || 0;
  const isMobile=testInfo.project.name.startsWith('webkit-');
  if(isMobile){
    expect(viewportHeight).toBeGreaterThanOrEqual(420);
    expect(viewportHeight).toBeLessThan(760);
  }else{
    expect(viewportHeight).toBeGreaterThanOrEqual(1440);
    const pageHeight=await page.evaluate(()=>document.documentElement.scrollHeight);
    expect(pageHeight).toBeGreaterThan(testInfo.project.use.viewport.height);

    // Depois do Ajustar inicial, a planta inteira precisa caber dentro da área
    // rolável do mapa no desktop. Isso impede que a região da 130/139 suma abaixo.
    const renderedMachines=await page.locator('.prep-map-machine').evaluateAll(elements=>elements.map(element=>{
      const rect=element.getBoundingClientRect();
      return { id:element.dataset.mapMachine,left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom };
    }));
    const tolerance=4;
    for(const machine of renderedMachines){
      expect(machine.left,`${machine.id} saiu pela esquerda`).toBeGreaterThanOrEqual((viewportRect?.x || 0)-tolerance);
      expect(machine.top,`${machine.id} saiu por cima`).toBeGreaterThanOrEqual((viewportRect?.y || 0)-tolerance);
      expect(machine.right,`${machine.id} saiu pela direita`).toBeLessThanOrEqual((viewportRect?.x || 0)+(viewportRect?.width || 0)+tolerance);
      expect(machine.bottom,`${machine.id} saiu por baixo`).toBeLessThanOrEqual((viewportRect?.y || 0)+(viewportRect?.height || 0)+tolerance);
    }
  }

  await page.screenshot({ path:testInfo.outputPath('factory-map-full.png'),fullPage:true });
  expect(errors.pageErrors).toEqual([]);
  expect(errors.consoleErrors).toEqual([]);
});

test('interações do mapa continuam funcionando depois da geometria nova',async({page})=>{
  const errors=await boot(page);

  await page.locator('[data-map-machine="tnl-024"]').click();
  await expect(page.locator('#prepDetailLayer')).toHaveClass(/is-open/);
  await expect(page.locator('#prepDetailTitle')).toContainText('TNL 024');
  await page.locator('#prepDetailContent [data-detail-close]').click();
  await expect(page.locator('#prepDetailLayer')).not.toHaveClass(/is-open/);

  const before=await page.locator('[data-map-surface]').evaluate(element=>element.style.transform);
  await page.locator('[data-map-zoom="in"]').click();
  await expect.poll(()=>page.locator('[data-map-surface]').evaluate(element=>element.style.transform)).not.toBe(before);

  await page.locator('[data-factory-filter="producing"]').click();
  await expect(page.locator('[data-factory-filter="producing"]')).toHaveAttribute('aria-pressed','true');

  const minimapButton=page.locator('[data-factory-action="minimap"]');
  const workspace=page.locator('.factory-workspace');
  await expect(minimapButton).toHaveAttribute('aria-pressed','true');
  await expect(workspace).toHaveClass(/show-minimap/);
  await minimapButton.click();
  await expect(minimapButton).toHaveAttribute('aria-pressed','false');
  await expect(workspace).not.toHaveClass(/show-minimap/);
  await expect.poll(()=>page.locator('.factory-minimap').evaluate(element=>getComputedStyle(element).pointerEvents)).toBe('none');
  await minimapButton.click();
  await expect(minimapButton).toHaveAttribute('aria-pressed','true');
  await expect(workspace).toHaveClass(/show-minimap/);
  await expect.poll(()=>page.locator('.factory-minimap').evaluate(element=>getComputedStyle(element).pointerEvents)).not.toBe('none');

  const fullscreen=page.locator('[data-factory-action="fullscreen"]');
  await fullscreen.click();
  await expect(page.locator('.factory-workspace')).toHaveClass(/is-factory-fullscreen/);
  await fullscreen.click();
  await expect(page.locator('.factory-workspace')).not.toHaveClass(/is-factory-fullscreen/);

  await page.locator('[data-view-mode="cards"]').click();
  await expect(page.locator('.prep-machine-grid')).toBeVisible();
  await page.locator('[data-view-mode="map"]').click();
  await expect(page.locator('.factory-workspace')).toBeVisible();
  await expect(page.locator('.prep-map-machine')).toHaveCount(136);

  expect(errors.pageErrors).toEqual([]);
  expect(errors.consoleErrors).toEqual([]);
});
