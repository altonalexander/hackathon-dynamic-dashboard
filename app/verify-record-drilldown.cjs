// PLAYWRIGHT_MODULE=/path/to/playwright node app/verify-record-drilldown.cjs [base-url]
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.argv[2] || 'http://127.0.0.1:8097';
const rows = Array.from({ length: 13 }, (_, i) => ({ id: `T-${100 + i}`, subject: `Customer issue ${i + 1}`, owner: i % 2 ? 'Mina' : 'Alex', status: i < 11 ? 'Open' : 'Closed' }));
const source = { datasetId: 'tickets', recordIds: rows.slice(0, 11).map(row => row.id) };
const fixture = { title: 'Raw record drill-down', datasets: [{ id: 'tickets', title: 'Support tickets', rows }], widgets: [
 { id: 'count', type: 'kpi', title: 'Open tickets', value: 11, format: 'number', source },
 { id: 'closed', type: 'kpi', title: 'Closed tickets', value: 2, format: 'number', source: { datasetId: 'tickets', recordIds: rows.slice(11).map(row => row.id) } },
 { id: 'zero', type: 'kpi', title: 'Urgent tickets', value: 0, source: { datasetId: 'tickets', recordIds: [] } },
 { id: 'legacy', type: 'kpi', title: 'Legacy metric', value: 99 },
 { id: 'missing', type: 'kpi', title: 'Missing source ID', value: 1, source: { datasetId: 'tickets', recordIds: ['nonexistent'] } }
] };
async function main() {
 const browser = await chromium.launch({ args: ['--no-sandbox'] });
 try {
  for (const width of [1440, 390]) {
   const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
   const errors = [];
   page.on('pageerror', error => errors.push(error.message));
   await page.route('**/sample.json', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(fixture) }));
   await page.goto(base + '/?sample=1');
   await page.locator('.metric-drill').first().click();
   assert.equal(await page.locator('#dataTable tbody tr').count(), 11);
   assert.deepEqual(JSON.parse(await page.locator('#rawData').textContent()), rows.slice(0, 11));
   assert.equal(await page.locator('#dataTable').innerText().then(text => text.includes('Closed')), false);
   await page.locator('#dataSearch').fill('Mina');
   assert.equal(await page.locator('#dataTable tbody tr').count(), 5);
   await page.locator('#datasetSelect').selectOption('dataset:0');
   assert.equal(await page.locator('#dataTable tbody tr').count(), 13);
   await page.locator('#dashboardTab').click();
   await page.locator('.view-data[data-dataset-index="1"]').click();
   assert.equal(await page.locator('#dataTable tbody tr').count(), 2);
   await page.locator('#dashboardTab').click();
   await page.locator('.metric-drill[data-dataset-index="2"]').focus();
   await page.keyboard.press('Enter');
   assert.match(await page.locator('#dataSummary').innerText(), /0 of 0 records/);
   assert.equal(await page.locator('#dataTable tbody tr').count(), 0);
   for (const index of [3, 4]) {
    await page.locator('#dashboardTab').click();
    await page.locator('.view-data[data-dataset-index="' + index + '"]').click();
    assert.equal(await page.locator('#dataSummary').innerText(), 'Source records unavailable');
    assert.equal(await page.locator('#dataTable tbody tr').count(), 0);
   }
   assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
   assert.deepEqual(errors, []);
   console.log(`PASS ${width}px: 11 actual records, exact IDs, excluded closed records, search, all records, zero, legacy, missing references, keyboard`);
   await page.close();
  }
 } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
