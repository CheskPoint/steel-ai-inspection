import { test, expect, type Page } from '@playwright/test';

const backend = 'http://localhost:8001/api/v1';
const headers = { Origin: 'http://localhost:3001' };
async function login(page: Page) {
  expect((await page.request.post(`${backend}/auth/login`, {headers, data:{username:'admin',password:'admin123'}})).ok()).toBeTruthy();
  await page.goto('/');
  await expect(page.getByRole('navigation', {name:'主导航'})).toBeVisible();
}
async function png(page: Page) {
  return Buffer.from(await page.evaluate(() => {const c=document.createElement('canvas');c.width=160;c.height=120;const x=c.getContext('2d')!;x.fillStyle='#a0aaa9';x.fillRect(0,0,160,120);return c.toDataURL('image/png').split(',')[1];}), 'base64');
}

test('image queue survives navigation and view survives browser reload', async ({page}) => {
  await login(page);
  const nav=page.getByRole('navigation', {name:'主导航'});
  await nav.getByRole('button',{name:/^(实时检测|检测工作台)$/}).click();
  await page.getByRole('tab',{name:/^(量检|图片\/批量检测)$/}).click();
  await page.getByLabel('选择图片',{exact:true}).setInputFiles({name:'retained-queue.png',mimeType:'image/png',buffer:await png(page)});
  await nav.getByRole('button',{name:'生产',exact:true}).click();
  await nav.getByRole('button',{name:/^(实时检测|检测工作台)$/}).click();
  await expect(page.locator('.cam-thumbnail').filter({hasText:'retained-queue.png'})).toBeVisible();
  await nav.getByRole('button',{name:'质量追溯',exact:true}).click();
  await page.reload();
  await expect(page.getByRole('heading',{name:'质量追溯',exact:true})).toBeVisible();
});

test('unsaved review is protected and corrected thumbnail uses final boxes',async({page})=>{
  await login(page);
  const filename=`review-layer-${Date.now()}.png`;
  const upload=await page.request.post(`${backend}/inferences`,{headers,multipart:{file:{name:filename,mimeType:'image/png',buffer:await png(page)},threshold:'0.95',source:'manual'}});
  expect(upload.ok()).toBeTruthy();
  await page.getByRole('navigation').getByRole('button',{name:/缺陷复核/}).click();
  await page.locator('.sv-image-card').filter({hasText:filename}).click();
  const drawer=page.getByRole('dialog',{name:filename});
  await drawer.getByRole('button',{name:'＋',exact:true}).click();
  await drawer.getByLabel('复核说明').fill('人工补框回归');
  await drawer.getByRole('button',{name:'关闭详情'}).click();
  await expect(page.getByRole('button',{name:'继续编辑',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'继续编辑',exact:true}).click();
  await expect(drawer.getByLabel('复核说明')).toHaveValue('人工补框回归');
  await drawer.getByRole('button',{name:'保存复核',exact:true}).click();
  await expect(drawer).not.toBeVisible();
  await page.getByLabel('复核状态',{exact:true}).selectOption('corrected');
  const card=page.locator('.sv-image-card').filter({hasText:filename});
  await expect(card.locator('svg rect')).toHaveCount(1);
  await expect(card).toContainText('复核后：1');
});

test('save next advances to successor and refreshing reloads server-side lists',async({page})=>{
  await login(page);
  const prefix=`next-${Date.now()}`;
  const buffer=await png(page);
  for(const suffix of ['first','second']){
    expect((await page.request.post(`${backend}/inferences`,{headers,multipart:{file:{name:`${prefix}-${suffix}.png`,mimeType:'image/png',buffer},threshold:'0.95',source:'manual'}})).ok()).toBeTruthy();
  }
  await page.getByRole('navigation').getByRole('button',{name:/缺陷复核/}).click();
  await page.getByLabel('搜索图片或记录编号').fill(prefix);
  await expect(page.locator('.sv-image-card')).toHaveCount(2);
  await page.locator('.sv-image-card').first().click();
  const dialog=page.getByRole('dialog');
  await expect(dialog).toHaveAttribute('aria-label',`${prefix}-second.png`);
  await dialog.getByLabel('复核说明').fill('确认当前图像');
  await dialog.getByLabel('保存后打开下一张匹配记录').check();
  await dialog.getByRole('button',{name:'保存复核',exact:true}).click();
  await expect(dialog).toHaveAttribute('aria-label',`${prefix}-first.png`);
  await dialog.getByRole('button',{name:'关闭详情'}).click();
  await expect(dialog).not.toBeVisible();
  expect((await page.request.post(`${backend}/inferences`,{headers,multipart:{file:{name:`${prefix}-third.png`,mimeType:'image/png',buffer},threshold:'0.95',source:'manual'}})).ok()).toBeTruthy();
  await page.getByRole('button',{name:'刷新业务数据'}).click();
  await expect(page.locator('.sv-image-card')).toHaveCount(2);
  await expect(page.locator('.sv-image-card').filter({hasText:`${prefix}-third.png`})).toBeVisible();
});

test('retry clears transient errors and does not repeat successful images',async({page})=>{
  await login(page);
  await page.getByRole('navigation').getByRole('button',{name:'检测工作台',exact:true}).click();
  await page.getByRole('tab',{name:'图片/批量检测',exact:true}).click();
  const buffer=await png(page);
  let requests=0;
  await page.route('**/api/v1/inferences',async route=>{
    requests++;
    if(requests===1)await route.fulfill({status:503,json:{detail:'临时检测失败'}});
    else await route.continue();
  });
  await page.getByLabel('选择图片',{exact:true}).setInputFiles([{name:'a-retry.png',mimeType:'image/png',buffer},{name:'b-success.png',mimeType:'image/png',buffer}]);
  await page.getByRole('button',{name:'开始图片检测',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('成功 1 · 失败 1');
  await page.getByRole('button',{name:'重试失败项',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('成功 2 · 失败 0');
  expect(requests).toBe(3);
  await expect(page.locator('.warning')).toHaveCount(0);
});

test('saved detection defaults apply without losing the selected queue',async({page})=>{
  await login(page);
  const nav=page.getByRole('navigation');
  await nav.getByRole('button',{name:'检测工作台',exact:true}).click();
  await page.getByRole('tab',{name:'图片/批量检测',exact:true}).click();
  await page.getByLabel('选择图片',{exact:true}).setInputFiles({name:'settings-queue.png',mimeType:'image/png',buffer:await png(page)});
  const current=await page.getByLabel('置信度阈值',{exact:true}).inputValue();
  const threshold=current==='0.6'?0.65:0.6;
  expect((await page.request.patch(`${backend}/settings`,{headers,data:{threshold}})).ok()).toBeTruthy();
  await page.getByRole('button',{name:'刷新业务数据'}).click();
  await expect(page.getByLabel('置信度阈值',{exact:true})).toHaveValue(String(threshold));
  await expect(page.locator('.cam-thumbnail').filter({hasText:'settings-queue.png'})).toBeVisible();
});

test('reviewing the final item on page two returns to the remaining page',async({page})=>{
  await login(page);
  const upload=await page.request.post(`${backend}/inferences`,{headers,multipart:{file:{name:'page-boundary.png',mimeType:'image/png',buffer:await png(page)},threshold:'0.95',source:'manual'}});
  expect(upload.ok()).toBeTruthy();
  const {record_id}=await upload.json();
  const record=await (await page.request.get(`${backend}/inspections/${record_id}`)).json();
  let reviewed=false;
  await page.route('**/api/v1/inspections?*',async route=>{
    const offset=Number(new URL(route.request().url()).searchParams.get('offset'));
    const items=offset===0?Array.from({length:36},(_,i)=>({...record,id:`fixture-${i}`,filename:`remaining-${i}.png`})):(reviewed?[]:[record]);
    await route.fulfill({json:{items,total:reviewed?36:37}});
  });
  await page.route(`**/api/v1/inspections/${record_id}/review`,async route=>{
    const response=await route.fetch();
    expect(response.ok()).toBeTruthy();
    reviewed=true;
    await route.fulfill({response});
  });
  await page.getByRole('navigation').getByRole('button',{name:/缺陷复核/}).click();
  await page.getByRole('button',{name:'下一页',exact:true}).click();
  await page.locator('.sv-image-card').filter({hasText:'page-boundary.png'}).click();
  const dialog=page.getByRole('dialog');
  await dialog.getByLabel('复核说明').fill('分页边界复核');
  await dialog.getByRole('button',{name:'保存复核',exact:true}).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('.sv-image-card')).toHaveCount(36);
});

test('model page shows verified evaluation and deployed weight fingerprint',async({page})=>{
  await login(page);
  const response=await page.request.get(`${backend}/system/info`);
  expect(response.ok()).toBeTruthy();
  const info=await response.json();
  expect(info.evaluation.status).toBe('available');
  await page.getByRole('navigation').getByRole('button',{name:'模型信息',exact:true}).click();
  await expect(page.locator('.sv-fingerprint')).toHaveText(info.model_sha256);
  await expect(page.locator('.sv-evaluation')).toContainText(`${(info.evaluation.map50*100).toFixed(1)}%`);
  await expect(page.locator('.sv-evaluation-table tbody tr')).toHaveCount(7);
  await page.screenshot({path:'../outputs/model-evidence-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'../outputs/model-evidence-mobile.png',fullPage:true});
});
