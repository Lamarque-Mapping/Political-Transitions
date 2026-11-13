#!/usr/bin/env node
'use strict';
// Independent acceptance checks for the atlas's data-facing browser functions.
// No browser dependencies; run from any working directory with Node.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const C = require(path.join(root, 'dist/core.js'));
const data = JSON.parse(fs.readFileSync(path.join(root, 'dist/data/atlas.json'), 'utf8'));
const base = {series:'handovers', region:'World', subregion:'', mechanism:'', group:'', coverage:'', precision:'', scenario:'main', timeMode:'all', month:C.FIRST_MONTH, search:'', country:''};
const countryByCode = new Map(data.countries.map(c => [c.country_code, c]));
const checks = [];
const failures = [];
const pendingChecks = [];
function test(name, fn) {
  const pass = detail => checks.push({name,status:'passed',...(detail === undefined ? {} : {detail})});
  const fail = error => failures.push({name,status:'failed',error:error.message});
  try { const detail = fn(); if (detail && typeof detail.then === 'function') pendingChecks.push(detail.then(pass,fail)); else pass(detail); }
  catch (error) { fail(error); }
}
const select = changes => C.filter(data, {...base,...changes});
const ids = records => records.map(C.id).sort();
const dayNumber = s => Date.parse(s+'T00:00:00Z') / 86400000;
function csvRows(input) {
  // RFC4180 reader independent of AtlasCore.csv's writer.
  const text = input.replace(/^\ufeff/, '');
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i+1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (ch === ',' && !quoted) { row.push(cell); cell = ''; }
    else if ((ch === '\r' || ch === '\n') && !quoted) {
      if (ch === '\r' && text[i+1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (quoted) throw new Error('Unterminated quoted CSV cell');
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  const header = rows.shift();
  return rows.map((values, i) => {
    assert.equal(values.length, header.length, 'CSV columns at row '+(i+1));
    return Object.fromEntries(header.map((h,j) => [h,values[j]]));
  });
}

test('Adopted series retain all canonical records as separate counting units', () => {
  assert.equal(data.events.length, data.meta.totalHandovers);
  assert.equal(data.collective.length, data.meta.totalCollectiveChanges);
  assert.deepEqual(ids(select({})), ids(data.events));
  assert.deepEqual(ids(select({series:'collective'})), ids(data.collective));
  assert.equal(new Set(select({}).map(C.id)).size, data.events.length);
  assert.equal(new Set(select({series:'collective'}).map(C.id)).size, data.collective.length);
  const eventIDs = new Set(data.events.map(C.id));
  assert(data.collective.every(r => !eventIDs.has(C.id(r))), 'Counting units share an ID');
});

test('Six definition choices reconcile with frozen record exclusions', () => {
  assert.deepEqual(data.sensitivity.scenarios.map(s => s.key).sort(), ['main','no_electoral_withdrawal','no_reserve_power_presidencies','no_nicaragua_formalization','no_same_holder_legal_renewals','strict'].sort());
  for (const spec of data.sensitivity.scenarios) {
    const scenario = spec.key;
    const flags = new Set(data.sensitivity.flags.filter(f => f.categories.some(k => spec.excludes.includes(k))).map(f => f.record_id));
    assert.deepEqual([...spec.excluded_event_ids].sort(), ids(data.events.filter(r => flags.has(C.id(r)))), scenario+' event flag membership');
    assert.deepEqual([...spec.excluded_structural_ids].sort(), ids(data.collective.filter(r => flags.has(C.id(r)))), scenario+' collective flag membership');
    assert.equal(select({scenario}).length, spec.handovers, scenario+' handovers');
    assert.equal(select({scenario,series:'collective'}).length, spec.collective_changes, scenario+' collective');
    assert.deepEqual(ids(select({scenario})), ids(data.events.filter(r => !spec.excluded_event_ids.includes(r.event_id))), scenario+' event membership');
    assert.deepEqual(ids(select({scenario,series:'collective'})), ids(data.collective.filter(r => !spec.excluded_structural_ids.includes(r.structural_record_id))), scenario+' collective membership');
  }
});

test('Every month uses inclusive date-range intersection without duplicate IDs', () => {
  const result = {};
  for (const [series, source] of [['handovers',data.events],['collective',data.collective]]) {
    const union = new Set(); let sum = 0, possible = 0;
    for (let month = C.FIRST_MONTH; month <= C.LAST_MONTH; month++) {
      const selected = select({series,timeMode:'month',month});
      const year = Math.floor(month/12), calendarMonth = month%12;
      const start = Math.max(Date.UTC(year,calendarMonth,1)/86400000, dayNumber(data.meta.windowStart));
      const end = Math.min(Date.UTC(year,calendarMonth+1,0)/86400000, dayNumber(data.meta.windowEnd));
      const expected = source.filter(r => dayNumber(r.date_start) <= end && dayNumber(r.date_end) >= start);
      assert.deepEqual(ids(selected), ids(expected), C.monthISO(month)+' '+series);
      assert.equal(new Set(selected.map(C.id)).size, selected.length, 'Duplicate ID in '+C.monthISO(month));
      const bounds = C.period({...base,timeMode:'month',month});
      for (const record of selected) {
        union.add(C.id(record));
        const crosses = dayNumber(record.date_start) < start || dayNumber(record.date_end) > end;
        assert.equal(C.relation(record,bounds), crosses?'possible':'within', 'Interval relation '+C.id(record));
        if (crosses) possible++;
      }
      sum += selected.length;
    }
    assert.deepEqual([...union].sort(), ids(source), 'Monthly union must recover the full register');
    result[series] = {distinctRecords:union.size,summedMonthlyAppearances:sum,possibleOverlapAppearances:possible};
  }
  return result;
});

test('Partial study endpoints, year-boundary intervals and exact points retain precision', () => {
  assert.deepEqual(C.period({...base,timeMode:'month',month:C.FIRST_MONTH}),['2016-11-11','2016-11-30']);
  assert.deepEqual(C.period({...base,timeMode:'month',month:C.LAST_MONTH}),['2026-11-01','2026-11-11']);
  assert.deepEqual(C.period({...base,timeMode:'year',month:C.FIRST_MONTH}),['2016-11-11','2016-12-31']);
  assert.deepEqual(C.period({...base,timeMode:'year',month:C.LAST_MONTH}),['2026-01-01','2026-11-11']);
  const moldova = data.events.find(r => r.event_id === 'PT-000454');
  assert.equal(moldova.event_date,null);
  for (const [year,month] of [[2020,11],[2021,0]]) {
    assert(select({country:'MDA',timeMode:'month',month:year*12+month}).some(r => r.event_id === moldova.event_id));
    assert.equal(C.relation(moldova,[`${year}-01-01`,`${year}-12-31`]),'possible');
  }
  assert.equal(C.relation(moldova,['2020-12-31','2021-01-01']),'within');
  assert.equal(C.relation({event_date:'2021-01-01'},['2021-01-01','2021-01-01']),'within');
  assert.equal(C.relation({event_date:'2021-01-01'},['2020-12-01','2020-12-31']),'outside');
  const palestine = data.events.find(r => r.event_id === 'PT-000514');
  assert.equal(palestine.event_date,null);
  assert(select({country:'PSE',timeMode:'year',month:2025*12}).some(r => r.event_id === palestine.event_id));
  assert(select({country:'PSE',timeMode:'year',month:2026*12}).some(r => r.event_id === palestine.event_id));
});

test('Continent views partition all 197 cases, including 12 South American cases', () => {
  const expected = {'Africa':54,'Asia':49,'Europe':45,'North America':23,'South America':12,'Oceania':14};
  const counts = {};
  data.countries.forEach(c => { const k=C.continent(c); counts[k]=(counts[k]||0)+1; });
  assert.deepEqual(counts,expected);
  const southCodes = new Set(['ARG','BOL','BRA','CHL','COL','ECU','GUY','PRY','PER','SUR','URY','VEN']);
  assert.deepEqual(data.countries.filter(c => C.continent(c)==='South America').map(c => c.country_code).sort(), [...southCodes].sort());
  const union = new Set();
  for (const region of Object.keys(expected)) {
    const selected = select({region});
    selected.forEach(r => {assert(!union.has(C.id(r)),'Record in two continents'); union.add(C.id(r));});
    const expectedRecords=data.events.filter(r => {
      const country=countryByCode.get(r.country_code);
      const continent=country.region==='Americas'?(southCodes.has(country.country_code)?'South America':'North America'):country.region;
      return continent===region;
    });
    assert.deepEqual(ids(selected),ids(expectedRecords),region+' records');
  }
  assert.equal(union.size,data.events.length);
  return expected;
});

test('Coverage filters preserve partial records and genuine no-transition cases', () => {
  for (const [series, source] of [['handovers',data.events],['collective',data.collective]]) {
    const union = new Set();
    for (const coverage of ['full_window_verified','partial_events_verified']) {
      const actual = select({series,coverage});
      const expected = source.filter(r => countryByCode.get(r.country_code).coverage_status === coverage);
      assert.deepEqual(ids(actual), ids(expected), series+' '+coverage);
      actual.forEach(r => {assert(!union.has(C.id(r)));union.add(C.id(r));});
    }
    assert.equal(union.size,source.length,'Coverage filters must partition the series');
  }
  for (const country of data.countries.filter(c => c.no_transition_verified)) {
    assert.equal(country.coverage_status,'full_window_verified');
    assert.equal(select({country:country.country_code}).length,0);
    assert.equal(select({country:country.country_code,series:'collective'}).length,0);
  }
  for (const country of data.countries.filter(c => c.coverage_status === 'partial_events_verified')) {
    assert.equal(country.no_transition_verified,false,'Partial coverage cannot establish no transitions');
    assert.equal(select({country:country.country_code,coverage:'full_window_verified'}).length,0);
    assert.equal(select({country:country.country_code,coverage:'partial_events_verified'}).length,data.events.filter(r=>r.country_code===country.country_code).length);
  }
});

test('Country, leader, accent-insensitive and multiword searches match records', () => {
  assert.deepEqual(ids(select({search:'Gabon'})),ids(data.events.filter(r => r.country_code==='GAB')));
  assert(select({search:'Hermann Immongault'}).some(r => r.event_id==='PT-000661'));
  const israel = data.events.find(r => r.event_id==='PT-000383');
  assert(select({search:'Israel Netanyahu'}).some(r => r.event_id===israel.event_id));
  const accented = data.events.find(r => /Ž|é|á|í/.test(String(r.incoming)));
  assert(accented,'Accent-bearing test record');
  assert(select({search:C.normalise(accented.incoming)}).some(r => C.id(r)===C.id(accented)));
  assert.equal(select({search:'impossibleatlassearchrecord'}).length,0);
  assert.equal(C.filter(data,{...base,search:'Gabon'},{ignoreSearch:true}).length,data.events.length);
  assert.equal(C.filter(data,{...base,country:'GAB'},{ignoreCountry:true}).length,data.events.length);
  assert.equal(C.filter(data,{...base,timeMode:'month'},{ignoreTime:true}).length,data.events.length);
});

test('Filtered CSV round trip preserves all rows, nullable fields and evidence URLs', () => {
  for (const records of [data.events,data.collective]) {
    const rows=csvRows(C.csv(records)); assert.equal(rows.length,records.length);
    rows.forEach((row,i) => {
      const record=records[i];
      assert.equal(row.record_id,C.id(record));
      assert.equal(row.event_date,record.event_date||'');
      assert.equal(row.date_start,record.date_start);
      assert.equal(row.date_end,record.date_end);
      assert.equal(row.summary,record.summary);
      assert.equal(row.source_urls,(record.sources||[]).map(s => s.url).join(' | '));
      if(record.outgoing===null)assert.equal(row.outgoing,'');
      if(record.incoming===null)assert.equal(row.incoming,'');
    });
  }
});

test('CSV quotes, embedded newlines and formula-like cells are protected', () => {
  const special={...data.events[0],event_id:'TEST',outgoing:'=SUM(1,2)',incoming:'+1',office:'@office',country:'-country',summary:'Line 1, "quoted"\nLine 2',caveats:'\tformula'};
  const row=csvRows(C.csv([special]))[0];
  assert.equal(row.outgoing,"'=SUM(1,2)");
  assert.equal(row.incoming,"'+1");
  assert.equal(row.office,"'@office");
  assert.equal(row.country,"'-country");
  assert.equal(row.caveats,"'\tformula");
  assert.equal(row.summary,special.summary);
  assert.equal(C.holder(null),'Not established');
  assert.equal(C.holder([]),'Not established');
});

test('Source publication dates preserve month-only and year-only precision', () => {
  assert.equal(C.date('2019'),'2019','Year-only source date must not imply 1 January');
  assert.match(C.date('2015-02'),/^(Feb|February) 2015$/,'Month-only source date must not imply the 1st');
  assert.equal(C.date('2026-11-12'),'12 Nov 2026');
});

test('Country coverage and release UI use canonical fields, with mechanism as the default', () => {
  assert(data.countries.every(c => Array.isArray(c.office_chains)&&Array.isArray(c.open_questions)&&Array.isArray(c.sources)));
  assert.equal(data.countries.reduce((n,c)=>n+c.office_chains.length,0),data.meta.officeChains);
  assert.equal(data.countries.reduce((n,c)=>n+c.open_questions.length,0),data.meta.openQuestions);
  assert.equal(new Set(data.countries.flatMap(c=>c.open_questions).map(q=>q.case_id)).size,data.meta.openQuestions);
  assert(data.countries.flatMap(c=>c.open_questions).every(q=>q.reason||q.required_action));
  const app=fs.readFileSync(path.join(root,'dist/app.js'),'utf8');
  assert(app.includes('c.office_chains'),'Office-chain field missing');
  assert(app.includes('c.open_questions'),'Open-question field missing');
  assert.match(app,/const defaults=\{[^;]*colourBy:'mechanism'/,'Default map must show mechanism');
  assert.match(app,/state=\{\.\.\.defaults,page\}/,'Reset must restore the shared defaults');
  assert.match(app,/state\.colourBy=defaults\.colourBy/,'Invalid URL colour choice must restore the default');
  assert(app.includes('data.meta.release'),'Header must use the loaded release');
  const methods=JSON.parse(fs.readFileSync(path.join(root,'dist/data/methods.json'),'utf8'));
  assert.equal(methods.version,data.meta.release);
  assert.deepEqual(methods.overview.cards.map(c=>c.value),[data.events.length,data.collective.length,data.countries.length,data.meta.fullWindowCases]);
});

test('Hidden-map resets defer bounds until visible layout and preserve ordinary navigation', async () => {
  const container = {clientWidth:1200,clientHeight:800,style:{},getBoundingClientRect(){return {left:0,top:0,right:this.clientWidth,bottom:this.clientHeight,width:this.clientWidth,height:this.clientHeight};}};
  const calls = [], frames = new Map(), panes = new Map();
  let frameId = 0, size = {x:1200,y:800};
  const map = {
    setView(){return this;}, getContainer:()=>container, getSize:()=>size,
    fitBounds(bounds){calls.push({type:'fit',bounds:JSON.parse(JSON.stringify(bounds)),size:{...size}});},
    invalidateSize(){size={x:container.clientWidth,y:container.clientHeight};calls.push({type:'resize',size:{...size}});},
    createPane(name){const pane={style:{},setAttribute(){},replaceChildren(){}};panes.set(name,pane);return pane;},
    getPane:name=>panes.get(name), on(){}, attributionControl:{setPrefix(){},addAttribution(){}}
  };
  const layer = {addTo(){return this;},eachLayer(){}};
  const window = {matchMedia:()=>({matches:false}),addEventListener(){}};
  const context = {
    window, document:{querySelectorAll:()=>[]},
    fetch:async()=>({ok:true,json:async()=>({countries:{features:[{properties:{ADM0_A3:'TEST'}}]},disputed:{features:[]}})}),
    requestAnimationFrame:fn=>{frames.set(++frameId,fn);return frameId;},cancelAnimationFrame:id=>frames.delete(id),
    L:{map:()=>map,control:{zoom:()=>layer},canvas:()=>({}),geoJSON:()=>layer,layerGroup:()=>layer}
  };
  const flushFrames = () => {const queued=[...frames.values()];frames.clear();queued.forEach(fn=>fn());};
  vm.runInNewContext(fs.readFileSync(path.join(root,'dist/map.js'),'utf8'),context,{filename:'map.js'});
  const atlas = window.AtlasMap;
  await atlas.init();
  calls.length=0;

  // Dataset hides the map; a resize and Reset filters must not fit zero-sized bounds.
  container.clientWidth=0;container.clientHeight=0;
  atlas.invalidate();flushFrames();
  atlas.setRegion('World');
  assert.equal(calls.filter(c=>c.type==='fit').length,0,'Reset fitted the hidden map');

  // Returning to Map refreshes its dimensions before applying the deferred World view.
  container.clientWidth=1000;container.clientHeight=700;
  atlas.invalidate();flushFrames();
  let fits=calls.filter(c=>c.type==='fit');
  assert.equal(fits.length,1,'Deferred reset did not fit exactly once');
  assert.deepEqual(fits[0].bounds,[[-55,-170],[75,180]]);
  assert.deepEqual(fits[0].size,{x:1000,y:700},'Fit used stale or hidden dimensions');
  atlas.invalidate();flushFrames();
  assert.equal(calls.filter(c=>c.type==='fit').length,1,'Ordinary navigation reset the user view');

  // Several hidden requests coalesce to the latest region, including Analysis filters.
  container.clientWidth=0;container.clientHeight=0;
  atlas.setRegion('Africa');atlas.setRegion('Asia');
  assert.equal(calls.filter(c=>c.type==='fit').length,1,'Hidden region selection fitted immediately');
  container.clientWidth=900;container.clientHeight=600;
  atlas.invalidate();flushFrames();
  fits=calls.filter(c=>c.type==='fit');
  assert.equal(fits.length,2);
  assert.deepEqual(fits[1].bounds,[[-10,25],[74,150]]);
  assert.deepEqual(fits[1].size,{x:900,y:600});
});

Promise.all(pendingChecks).then(() => {
  const report={status:failures.length?'failed':'passed',passed:checks.length,failed:failures.length,checks,failures};
  console.log(JSON.stringify(report,null,2));
  process.exitCode=failures.length?1:0;
});
