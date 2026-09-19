'use strict';
// Complete illustrative records, then derived metrics. Never reconstruct rows from a summary.
module.exports = function recordFallback(prompt) {
  const domain = /ticket|support|customer service|csat|sla|help.?desk/i.test(prompt) ? 'support' : /market|campaign|lead|seo|ads?\b|brand|social/i.test(prompt) ? 'marketing' : 'sales';
  const owners = ['Mina', 'Alex', 'Sam', 'Dana'];
  const rows = Array.from({ length: 18 }, (_, i) => {
    const common = { id: `${domain === 'support' ? 'T' : domain === 'marketing' ? 'C' : 'D'}-${1001 + i}`, owner: owners[i % owners.length] };
    if (domain === 'support') return { ...common, subject: ['Account access', 'Invoice question', 'Export error', 'Delivery update', 'Subscription change', 'Integration setup'][i % 6], status: i < 14 ? 'Open' : 'Resolved', priority: i % 5 === 0 ? 'Urgent' : i % 3 === 0 ? 'High' : 'Normal', queue: ['Billing', 'Technical', 'Account'][i % 3], responseHours: (i % 7) + 1, slaBreached: i < 14 && i % 4 === 0 };
    if (domain === 'marketing') return { ...common, campaign: `${['Spring search', 'Product launch', 'Customer stories', 'Partner event', 'Newsletter', 'Retargeting'][i % 6]} ${i + 1}`, status: i < 14 ? 'Active' : 'Paused', channel: ['Search', 'Social', 'Email'][i % 3], spend: 800 + i * 175, revenue: 1800 + i * 310 };
    return { ...common, account: ['Northstar', 'Meridian', 'Juniper', 'Cedar', 'Atlas', 'Lumen'][i % 6] + ' ' + (i + 1), status: i < 14 ? 'Open' : 'Won', stage: i < 14 ? ['Discovery', 'Proposal', 'Negotiation'][i % 3] : 'Closed won', amount: 7000 + i * 2300, region: ['West', 'East', 'Central'][i % 3] };
  });
  const datasetId = domain === 'support' ? 'tickets' : domain === 'marketing' ? 'campaigns' : 'deals';
  const source = (selected, counts = false) => ({ datasetId, recordIds: selected.map(row => row.id), ...(counts ? { counts: true } : {}) });
  const count = (title, selected) => ({ type: 'kpi', title, span: 3, value: selected.length, format: 'number', source: source(selected, true) });
  const metric = (title, selected, field, average = false, format = 'currency') => ({ type: 'kpi', title, span: 3, value: Math.round(selected.reduce((sum, row) => sum + row[field], 0) / (average ? selected.length || 1 : 1) * 100) / 100, format, source: source(selected) });
  const active = rows.filter(row => row.status === (domain === 'marketing' ? 'Active' : 'Open'));
  const kpis = domain === 'support' ? [count('Open tickets', active), count('Urgent open tickets', active.filter(row => row.priority === 'Urgent')), count('SLA breaches', active.filter(row => row.slaBreached)), metric('Average first response', active, 'responseHours', true, 'duration')]
    : domain === 'marketing' ? [count('Active campaigns', active), metric('Total spend', rows, 'spend'), metric('Attributed revenue', rows, 'revenue'), count('Paused campaigns', rows.filter(row => row.status === 'Paused'))]
    : [count('Open deals', active), metric('Open pipeline', active, 'amount'), count('Won deals', rows.filter(row => row.status === 'Won')), metric('Average open deal', active, 'amount', true)];
  const groupKey = domain === 'support' ? 'queue' : domain === 'marketing' ? 'channel' : 'stage';
  const categories = [...new Set(active.map(row => row[groupKey]))];
  const ownerValues = owners.map(owner => active.filter(row => row.owner === owner).length);
  const columns = Object.keys(rows[0]).map(key => ({ key, label: ({ responseHours: 'Response (hours)', slaBreached: 'SLA breached' })[key] || key.charAt(0).toUpperCase() + key.slice(1) }));
  const widgets = [...kpis,
    { type: 'bar', title: `Open ${datasetId} by owner`, span: 8, horizontal: true, format: 'number', x: owners, series: [{ name: domain === 'marketing' ? 'Active campaigns' : `Open ${datasetId}`, values: ownerValues }], source: source(active) },
    { type: 'donut', title: `By ${groupKey}`, span: 4, format: 'number', items: categories.map(label => ({ label, value: active.filter(row => row[groupKey] === label).length })), source: source(active) },
    { type: 'table', title: 'Records to review', span: 12, columns, rows: active, source: source(active) }
  ].map((widget, i) => ({ id: `w${i + 1}`, ...widget }));
  if (domain === 'marketing') widgets[4].title = 'Active campaigns by owner';
  return { title: `${domain === 'support' ? 'Support' : domain === 'marketing' ? 'Marketing' : 'Sales'} overview`, subtitle: 'Complete illustrative dataset · fallback dashboard', domain, accent: '#a78bfa', filters: ['Demo records'], insights: [`${active.length} ${domain === 'marketing' ? 'active' : 'open'} ${datasetId} in this ${rows.length}-record demo. Click any metric to inspect its underlying records.`], datasets: [{ id: datasetId, title: datasetId.charAt(0).toUpperCase() + datasetId.slice(1), columns, rows }], widgets };
};
