#!/usr/bin/env node
'use strict';
// Focused checks for the new annual mechanism aggregation; no DOM dependency.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),C=require(path.join(root,'dist/core.js'));
const data=JSON.parse(fs.readFileSync(path.join(root,'dist/data/atlas.json'),'utf8'));
const context={window:{AtlasCore:C}};
vm.runInNewContext(fs.readFileSync(path.join(root,'dist/analysis.js'),'utf8'),context,{filename:'analysis.js'});
const aggregate=context.window.AtlasAnalysis.aggregateAnnualMechanisms;
const plain=value=>JSON.parse(JSON.stringify(value));
const regions=['World','Africa','Europe','Asia','North America','South America','Oceania'];
const base={series:'handovers',region:'World',subregion:'',mechanism:'',group:'',coverage:'',precision:'',scenario:'main',timeMode:'all',month:C.FIRST_MONTH,search:'',country:''};
const checks=[],world={};let combinations=0;
for(const series of ['handovers','collective'])for(const region of regions)for(const scenario of data.sensitivity.scenarios){
  const records=C.filter(data,{...base,series,region,scenario:scenario.key},{ignoreTime:true}),result=aggregate(records);
  const assigned=new Set();
  for(const row of result.years){
    const start=Date.UTC(row.year,0,1),end=Date.UTC(row.year+1,0,1);
    const expected=records.filter(r=>Date.parse((r.date_start||r.event_date)+'T00:00:00Z')>=start&&Date.parse((r.date_end||r.event_date)+'T00:00:00Z')<end);
    assert.equal(row.count,expected.length,[series,region,scenario.key,row.year].join(' '));
    for(const record of expected){assert(!assigned.has(C.id(record)),'Record counted in two annual bins');assigned.add(C.id(record));}
    for(const mechanism of result.series)assert.equal(mechanism.counts[row.year-2016],expected.filter(r=>(r.mechanism||'unresolved')===mechanism.key).length,'Mechanism/year mismatch');
  }
  assert.equal(result.annualSum,assigned.size);
  assert.equal(result.annualSum+result.unassigned.length,records.length,'Assigned and excluded records do not reconcile');
  assert.deepEqual(plain(result.unassigned.map(C.id)).sort(),records.filter(r=>!assigned.has(C.id(r))).map(C.id).sort());
  assert.equal(result.series.reduce((n,s)=>n+s.total+s.excluded,0),records.length);
  if(region==='World'&&scenario.key==='main')world[series]={selected:records.length,annualAssigned:result.annualSum,crossYearExcluded:result.unassigned.length,yearCounts:plain(result.years)};
  combinations++;
}
checks.push('Annual and mechanism counts reconcile independently across both series, World and all six continents, and every definition ('+combinations+' combinations)');
const fixture=[
  {event_id:'EXACT',mechanism:'election_handover',event_date:'2020-06-12'},
  {event_id:'WITHIN',mechanism:'election_handover',date_start:'2020-01-02',date_end:'2020-12-29'},
  {event_id:'CROSS',mechanism:'resignation_replacement',date_start:'2020-12-31',date_end:'2021-01-01'},
  {event_id:'OPEN',mechanism:'other',event_date:'2016-11-11'},
  {event_id:'CLOSE',mechanism:'other',event_date:'2026-11-11'}
];
const result=aggregate(fixture);
assert.equal(result.annualSum,4);assert.deepEqual(plain(result.unassigned.map(C.id)),['CROSS']);
assert.equal(result.series.find(s=>s.key==='election_handover').counts[4],2);
assert.equal(result.series.find(s=>s.key==='resignation_replacement').total,0);
assert.equal(result.series.find(s=>s.key==='resignation_replacement').excluded,1);
assert.equal(result.years[0].count,1);assert.equal(result.years[10].count,1);
checks.push('Exact days and within-year intervals count once; a cross-year interval is never assigned a fabricated year; study endpoints are retained');
const keys=Object.keys(C.mechanisms),all=aggregate(keys.map(mechanism=>({event_date:'2021-04-01',mechanism})));
assert.deepEqual(plain(all.series.map(s=>s.key)),keys);
for(const s of all.series){
  assert.equal(s.colour,C.mechanisms[s.key][1]);
  const isolated=aggregate([{event_date:'2021-04-01',mechanism:s.key}]).series[0];
  assert.equal(isolated.colour,s.colour);assert.equal(isolated.dash,s.dash);
}
checks.push('Map colours, canonical order and line patterns remain stable when mechanisms are filtered out');
assert.equal(aggregate([]).annualSum,0);assert.equal(aggregate([]).series.length,0);assert.equal(aggregate([]).years.length,11);
checks.push('Empty selections retain the full 2016–2026 annual axis without inventing records');
console.log(JSON.stringify({status:'passed',passed:checks.length,checks,world},null,2));
