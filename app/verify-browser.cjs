// Run: PLAYWRIGHT_MODULE=/path/to/playwright node app/verify-browser.cjs [base-url]
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.argv[2] || 'http://127.0.0.1:8097';
const sample = JSON.parse(fs.readFileSync(path.join(__dirname, 'public/sample.json'), 'utf8'));
async function main() {
 const browser = await chromium.launch({headless:true,args:['--no-sandbox']});
 try {
  for(const width of [1440,390]) {
   const page = await browser.newPage({viewport:{width,height:1000},colorScheme:'dark',reducedMotion:'reduce'}), errors=[];
   page.on('pageerror',error=>errors.push(error.message));
   await page.goto(base+'/?sample=1');
   await page.locator('#grid .card').first().waitFor();
   assert.equal(await page.locator('#grid .card').count(),(sample.spec||sample).widgets.length);
   assert.deepEqual(errors,[],'Browser runtime errors');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Page overflow');
   assert.equal(await page.locator('svg').evaluateAll(nodes=>nodes.some(n=>/NaN|Infinity/.test(n.outerHTML))),false,'Invalid SVG coordinates');
   await page.locator('#grid .card').evaluateAll(cards=>Promise.all(cards.flatMap(card=>card.getAnimations()).map(animation=>animation.finish())));
   await page.screenshot({path:`/tmp/dashboard-agent-c-${width}.png`,fullPage:true});
   console.log(`PASS sample ${width}px: cards, runtime, overflow, SVG`);
   await page.close();
  }
  const page=await browser.newPage();
  let mode='success';
  await page.route('**/api/dashboard',async route=>{
   if(mode==='error')return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false,error:'Service unavailable'})});
   const spec=structuredClone(sample.spec||sample);
   spec.title='<img src=x onerror=alert(1)> Safety check';
   spec.widgets.push({type:'unknown-future',title:'Unknown widget',span:6});
   return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,spec,ms:100,fallback:true})});
  });
  await page.goto(base);
  await page.locator('#prompt').fill('Show sales pipeline');
  await page.locator('#prompt').press('Enter');
  await page.locator('#grid .card').first().waitFor();
  assert.equal(await page.locator('#dash h1 img').count(),0,'Unsafe title HTML');
  assert.equal(await page.locator('.unsupported').count(),1,'Unknown type handling');
  assert.equal(await page.locator('.badge.fallback').count(),1,'Fallback disclosure');
  await page.locator('#newBtn').click();
  assert.equal(await page.locator('#history [data-h]').count(),1,'Session history');
  mode='error';
  await page.locator('#prompt').fill('Show support tickets');
  await page.locator('#prompt').press('Enter');
  await page.locator('#retry').waitFor();
  mode='success';
  await page.locator('#retry').click();
  await page.locator('#grid .card').first().waitFor();
  console.log('PASS generation flow, escaping, unknown type, fallback disclosure, history, failure/retry');
  await page.close();
 } finally {await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
