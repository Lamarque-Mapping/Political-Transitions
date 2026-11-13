(function () {
  'use strict';
  const LABELS = {
    election_handover: 'Election handover',
    parliamentary_or_coalition_replacement: 'Parliamentary / coalition',
    same_party_succession: 'Same-party succession',
    constitutional_succession: 'Constitutional succession',
    resignation_replacement: 'After resignation',
    interim_or_caretaker_succession: 'Interim / caretaker',
    coup_or_military_takeover: 'Coup / military takeover',
    negotiated_transition: 'Negotiated transition',
    restoration: 'Restoration',
    hereditary_succession: 'Hereditary succession',
    other: 'Other mechanism',
    unresolved: 'Unresolved mechanism'
  };
  const GROUPS = {
    yes: 'Governing group changed', no: 'Governing group continued', mixed: 'Mixed change and continuity',
    unclear: 'Unclear', not_applicable: 'Not applicable'
  };
  const GROUP_COLORS = { yes: '#287567', no: '#70988a', mixed: '#b88843', unclear: '#8d9299', not_applicable: '#c3c7c7' };
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const number = n => Number(n).toLocaleString('en-GB');
  const percent = (n, total) => total ? (n * 100 / total).toFixed(1) + '%' : '—';
  const label = value => LABELS[value] || String(value || 'Unresolved mechanism').replace(/_/g, ' ');
  const mechanismColour = key => window.AtlasCore?.mechanisms[key]?.[1] || '#7d8884';
  const lineDashes = ['', '7 3', '2 3', '10 3 2 3', '5 2', '1 3', '12 3', '8 3 2 3 2 3', '4 3', '10 2 2 2', '3 2 1 2'];
  const hiddenMechanisms = new Set();
  let mechanismObserver, mechanismResizeFrame;
  function aggregateAnnualMechanisms(records) {
    const yearNumbers = Array.from({length:11}, (_,i) => 2016+i);
    const counts = new Map(), excluded = new Map(), unassigned = [];
    for (const r of records) {
      const key = r.mechanism || 'unresolved';
      if (!counts.has(key)) counts.set(key, yearNumbers.map(() => 0));
      const start = r.date_start || r.event_date, end = r.date_end || r.event_date;
      const firstYear = Number(String(start || '').slice(0,4)), lastYear = Number(String(end || '').slice(0,4));
      if (start && end && firstYear === lastYear && firstYear >= 2016 && firstYear <= 2026) counts.get(key)[firstYear-2016]++;
      else { unassigned.push(r); excluded.set(key,(excluded.get(key)||0)+1); }
    }
    const canonical = Object.keys(window.AtlasCore?.mechanisms || LABELS);
    const keys = [...canonical.filter(key => counts.has(key)), ...[...counts.keys()].filter(key => !canonical.includes(key)).sort()];
    const series = keys.map((key,i) => ({key,label:label(key),colour:mechanismColour(key),dash:lineDashes[(canonical.includes(key)?canonical.indexOf(key):canonical.length+i)%lineDashes.length],counts:counts.get(key),total:counts.get(key).reduce((a,b)=>a+b,0),excluded:excluded.get(key)||0}));
    const years = yearNumbers.map((year,i) => ({year,count:series.reduce((sum,s)=>sum+s.counts[i],0)}));
    return {years,series,unassigned,annualSum:years.reduce((sum,y)=>sum+y.count,0)};
  }
  function aggregate(records, key) {
    const counts = new Map();
    records.forEach(r => {const k = key(r); counts.set(k, (counts.get(k) || 0) + 1);});
    return [...counts].map(([key, count]) => ({key, count})).sort((a,b) => b.count - a.count || String(a.key).localeCompare(String(b.key)));
  }
  function dateLabel(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return value || 'Date unestablished';
    return new Date(value + 'T00:00:00Z').toLocaleDateString('en-GB', {day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC'});
  }
  function help(title, copy) {
    return '<details class="analysis-help"><summary aria-label="About ' + esc(title) + '">?</summary><div>' + esc(copy) + '</div></details>';
  }
  function table(caption, headers, rows, scrollLabel) {
    return '<details class="analysis-data-table"><summary>View data table</summary><div class="analysis-table-scroll"' + (scrollLabel ? ' tabindex="0" role="region" aria-label="'+esc(scrollLabel)+'"' : '') + '><table><caption>' + esc(caption) + '</caption><thead><tr>' + headers.map(h => '<th scope="col">' + esc(h) + '</th>').join('') + '</tr></thead><tbody>' + rows.map(row => '<tr>' + row.map((v, i) => i === 0 ? '<th scope="row">' + esc(v) + '</th>' : '<td>' + esc(v) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div></details>';
  }
  function lineSwatch(series) {
    return '<svg class="analysis-line-swatch" viewBox="0 0 30 12" aria-hidden="true"><path d="M1 6H29" fill="none" stroke="'+series.colour+'" stroke-width="2.5"'+(series.dash?' stroke-dasharray="'+series.dash+'"':'')+'/><circle cx="15" cy="6" r="2.5" fill="#fff" stroke="'+series.colour+'" stroke-width="1.5"/></svg>';
  }
  function mechanismPanel(annual, records, shortUnit) {
    const rows = annual.years.map((y,i) => [y.year+(y.year===2016||y.year===2026?'*':''),...annual.series.map(s=>s.counts[i]),y.count]);
    if (annual.unassigned.length) rows.push(['Cross-year intervals — excluded',...annual.series.map(s=>s.excluded),annual.unassigned.length]);
    rows.push(['Selected total',...annual.series.map(s=>s.total+s.excluded),records.length]);
    return `<section class="analysis-panel analysis-panel-wide analysis-mechanism-lines" aria-labelledby="analysis-lines-title">
      <div class="analysis-panel-heading"><div><p class="analysis-eyebrow">Compare mechanisms</p><h3 id="analysis-lines-title">Mechanisms over time</h3></div>${help('mechanisms over time','Lines count records assigned to one calendar year, using the same rule as the annual bars. Intervals spanning years are excluded from the lines and reported separately. Counts are not annualised; 2016 and 2026 cover partial years. Show or hide mechanisms with the legend. The data table retains all matching mechanisms.')}</div>
      <p class="analysis-line-intro">Compare continents with the Continent filter above. The lines use the current series, definition and record filters.</p>
      <div class="analysis-mechanism-plot" aria-label="Annual mechanism line graph"></div>
      <p class="analysis-line-instruction">Hover, tap or focus a year for exact values. Use the arrow keys to move between years.</p>
      <div class="analysis-line-control-heading"><span>Show or hide lines <small>Numbers are totals plotted</small></span><div><button type="button" data-line-action="all">Show all</button><button type="button" data-line-action="none">Hide all</button></div></div>
      <div class="analysis-line-legend" role="group" aria-label="Mechanisms shown in the line graph">${annual.series.map(s=>`<button type="button" class="analysis-line-key" data-mechanism-line="${esc(s.key)}" aria-pressed="${!hiddenMechanisms.has(s.key)}">${lineSwatch(s)}<span>${esc(s.label)}</span><strong>${number(s.total)}</strong></button>`).join('')}</div>
      <p class="analysis-chart-caption"><strong>* Partial years:</strong> 2016 starts on 11 November; 2026 ends on 11 November. Lines include ${number(annual.annualSum)} of ${number(records.length)} selected ${esc(shortUnit.toLowerCase())}.${annual.unassigned.length?' '+number(annual.unassigned.length)+' cross-year '+(annual.unassigned.length===1?'interval is':'intervals are')+' excluded and listed in the annual totals below.':''} Hiding a line does not change the selected-record totals or data table.</p>
      ${table(shortUnit+' by mechanism and calendar year — all matching mechanisms',['Year',...annual.series.map(s=>s.label),'Total'],rows,'Annual mechanism values; scroll horizontally for all columns')}
    </section>`;
  }
  function bindMechanismChart(host, annual, shortUnit) {
    const panel = host.querySelector('.analysis-mechanism-lines'), plot = panel.querySelector('.analysis-mechanism-plot');
    let lastWidth = 0;
    function draw() {
      const width = Math.max(280,Math.round(plot.clientWidth||900)), height = width<600?300:350;
      lastWidth = width;
      const left=48,right=20,top=28,bottom=46,plotWidth=width-left-right,plotHeight=height-top-bottom,stepX=plotWidth/10;
      const shown = annual.series.filter(s=>!hiddenMechanisms.has(s.key));
      const max = Math.max(1,...shown.flatMap(s=>s.counts)), rough=max/4, magnitude=Math.pow(10,Math.floor(Math.log10(rough)));
      const stepY=Math.max(1,[1,2,5,10].find(n=>n*magnitude>=rough)*magnitude), ceiling=Math.max(stepY,Math.ceil(max/stepY)*stepY);
      const x=i=>left+i*stepX,y=n=>top+plotHeight-(n/ceiling)*plotHeight;
      const ticks=Array.from({length:Math.round(ceiling/stepY)+1},(_,i)=>i*stepY);
      const description='Annual '+shortUnit.toLowerCase()+' by primary mechanism, 2016 to 2026. '+annual.annualSum+' records assigned to one year; '+annual.unassigned.length+' cross-year intervals excluded. 2016 and 2026 are partial observation years. Use Left and Right arrow keys on a year to inspect exact values. An accessible table follows the legend.';
      plot.innerHTML=`<svg class="analysis-line-svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="group" aria-labelledby="analysis-line-svg-title analysis-line-svg-desc">
        <title id="analysis-line-svg-title">${esc(shortUnit)} by mechanism and year</title><desc id="analysis-line-svg-desc">${esc(description)}</desc>
        <g aria-hidden="true"><rect class="analysis-line-partial" x="${left}" y="${top}" width="${stepX/2}" height="${plotHeight}"/><rect class="analysis-line-partial" x="${x(10)-stepX/2}" y="${top}" width="${stepX/2}" height="${plotHeight}"/>
        ${ticks.map(n=>`<line class="analysis-line-grid" x1="${left}" x2="${width-right}" y1="${y(n)}" y2="${y(n)}"/><text class="analysis-line-tick" x="${left-10}" y="${y(n)+4}" text-anchor="end">${n}</text>`).join('')}
        <text class="analysis-line-axis-title" x="${left}" y="15">${esc(shortUnit)} (count)</text>
        <line class="analysis-line-axis" x1="${left}" x2="${width-right}" y1="${y(0)}" y2="${y(0)}"/>
        ${annual.years.map((v,i)=>`<line class="analysis-line-year-tick" x1="${x(i)}" x2="${x(i)}" y1="${y(0)}" y2="${y(0)+5}"/>${width>=540||i%2===0?`<text class="analysis-line-tick" x="${x(i)}" y="${height-bottom+22}" text-anchor="${i===0?'start':i===10?'end':'middle'}">${v.year}${i===0||i===10?'*':''}</text>`:''}`).join('')}
        <text class="analysis-line-axis-title" x="${left+plotWidth/2}" y="${height-3}" text-anchor="middle">Year</text>
        ${shown.map(s=>`<path class="analysis-mechanism-line" d="${s.counts.map((n,i)=>(i?'L':'M')+x(i).toFixed(2)+' '+y(n).toFixed(2)).join(' ')}" stroke="${s.colour}"${s.dash?' stroke-dasharray="'+s.dash+'"':''}/>${s.counts.map((n,i)=>n?`<circle class="analysis-line-point" cx="${x(i)}" cy="${y(n)}" r="2.7" stroke="${s.colour}"/>`:'').join('')}`).join('')}
        <line class="analysis-line-guide" x1="0" x2="0" y1="${top}" y2="${y(0)}" visibility="hidden"/>
        </g>
        ${annual.years.map((v,i)=>`<rect class="analysis-line-hit" data-line-year="${i}" x="${i?x(i)-stepX/2:left}" y="${top}" width="${i===0||i===10?stepX/2:stepX}" height="${plotHeight}" tabindex="${i===0?0:-1}" role="button" aria-label="${v.year}${i===0||i===10?', partial year':''}. ${shown.reduce((sum,s)=>sum+s.counts[i],0)} visible ${esc(shortUnit.toLowerCase())}." aria-describedby="analysis-line-tooltip"/>`).join('')}
      </svg><div id="analysis-line-tooltip" class="analysis-line-tooltip" role="tooltip" hidden></div>${shown.length?'':'<p class="analysis-line-no-series">'+(annual.series.length?'Select a mechanism below to show its line.':'No records match these filters.')+'</p>'}`;
      const tooltip=plot.querySelector('.analysis-line-tooltip'),guide=plot.querySelector('.analysis-line-guide'),hits=[...plot.querySelectorAll('[data-line-year]')];
      function hide(){tooltip.hidden=true;guide.setAttribute('visibility','hidden');}
      function show(index){
        if(!shown.length)return;
        const year=annual.years[index].year;
        tooltip.innerHTML='<strong>'+year+(index===0||index===10?' · partial year':'')+'</strong><ul>'+shown.map(s=>'<li><span><i style="background:'+s.colour+'" aria-hidden="true"></i>'+esc(s.label)+'</span><b>'+number(s.counts[index])+'</b></li>').join('')+'</ul>';
        tooltip.hidden=false;tooltip.style.left=Math.max(8,Math.min(x(index)+12,width-tooltip.offsetWidth-8))+'px';
        guide.setAttribute('x1',x(index));guide.setAttribute('x2',x(index));guide.setAttribute('visibility','visible');
      }
      hits.forEach((hit,i)=>{
        hit.addEventListener('pointerenter',()=>show(i));
        hit.addEventListener('pointerleave',()=>{if(!plot.contains(document.activeElement))hide();});
        hit.addEventListener('focus',()=>{hits.forEach(v=>v.setAttribute('tabindex',v===hit?'0':'-1'));show(i);});
        hit.addEventListener('blur',hide);
        hit.addEventListener('click',()=>{hit.focus({preventScroll:true});show(i);});
        hit.addEventListener('keydown',event=>{
          const next=event.key==='ArrowRight'?Math.min(10,i+1):event.key==='ArrowLeft'?Math.max(0,i-1):event.key==='Home'?0:event.key==='End'?10:null;
          if(next!==null){event.preventDefault();hits[next].focus({preventScroll:true});}
          else if(event.key==='Escape'){event.preventDefault();hide();}
          else if(event.key==='Enter'||event.key===' '){event.preventDefault();show(i);}
        });
      });
    }
    function refreshLegend(){
      panel.querySelectorAll('[data-mechanism-line]').forEach(button=>{
        const key=button.getAttribute('data-mechanism-line'),on=!hiddenMechanisms.has(key),s=annual.series.find(item=>item.key===key);
        button.setAttribute('aria-pressed',String(on));button.setAttribute('aria-label',(on?'Hide ':'Show ')+s.label+' line. '+s.total+' records plotted'+(s.excluded?', '+s.excluded+' cross-year intervals excluded':'')+'.');
      });
      draw();
    }
    panel.querySelectorAll('[data-mechanism-line]').forEach(button=>button.addEventListener('click',()=>{
      const key=button.getAttribute('data-mechanism-line');hiddenMechanisms.has(key)?hiddenMechanisms.delete(key):hiddenMechanisms.add(key);refreshLegend();
    }));
    panel.querySelectorAll('[data-line-action]').forEach(button=>button.addEventListener('click',()=>{
      for(const s of annual.series)button.getAttribute('data-line-action')==='all'?hiddenMechanisms.delete(s.key):hiddenMechanisms.add(s.key);
      refreshLegend();
    }));
    refreshLegend();
    if(typeof ResizeObserver!=='undefined'){
      mechanismObserver=new ResizeObserver(()=>{if(plot.clientWidth>0&&Math.round(plot.clientWidth)!==lastWidth){cancelAnimationFrame(mechanismResizeFrame);mechanismResizeFrame=requestAnimationFrame(draw);}});
      mechanismObserver.observe(plot);
    }
  }
  function bars(rows, total, opts) {
    const largest = Math.max(1, ...rows.map(r => r.count));
    if (!rows.length) return '<p class="analysis-empty-inline">No matching records.</p>';
    return '<div class="analysis-horizontal-bars" role="list">' + rows.map(r => {
      const title = opts.label(r.key);
      const color = opts.color ? opts.color(r.key) : '#287567';
      return '<div class="analysis-bar-row" role="listitem" aria-label="' + esc(title) + ': ' + r.count + ', ' + percent(r.count,total) + ' of selected records"><div class="analysis-bar-label"><span>' + esc(title) + '</span><strong>' + number(r.count) + '<small>' + percent(r.count,total) + '</small></strong></div><div class="analysis-bar-track" aria-hidden="true"><span style="width:' + (r.count / largest * 100).toFixed(3) + '%;background:' + color + '"></span></div></div>';
    }).join('') + '</div>';
  }
  function render(options) {
    const host = document.getElementById('analysis-content');
    if (!host) return;
    mechanismObserver?.disconnect();cancelAnimationFrame(mechanismResizeFrame);
    const data = options.data || {};
    const records = Array.isArray(options.records) ? options.records : [];
    const collective = options.series === 'collective';
    const unit = collective ? 'collective membership changes' : 'office and authority handovers';
    const shortUnit = collective ? 'Collective changes' : 'Handovers';
    const countries = new Map((data.countries || []).map(c => [c.country_code, c]));
    const countryCounts = aggregate(records, r => r.country_code);
    const exactCount = records.filter(r => r.date_precision === 'day' && r.event_date).length;
    const rangeCount = records.length - exactCount;
    const annual = aggregateAnnualMechanisms(records), {years,unassigned,annualSum} = annual;
    const maxAnnual = Math.max(1,...years.map(y => y.count));
    const mechanisms = aggregate(records, r => r.mechanism || 'unresolved');
    const groups = aggregate(records, r => r.governing_group_change || 'unclear');
    const regions = aggregate(records, r => countries.get(r.country_code)?.region || 'Unassigned region');
    const countLabel = collective ? 'Collective membership records' : 'Office / authority handovers';
    const rankRows = countryCounts.slice(0,12);
    const selectedPartial = countryCounts.filter(r => countries.get(r.key)?.coverage_status !== 'full_window_verified').length;
    const countriesUnit = countryCounts.length === 1 ? 'case' : 'cases';
    const selectedNote = 'All study years · 11 Nov 2016 – 11 Nov 2026 · Current search and category filters';
    const annualDescription = years.map(y => y.year + ': ' + y.count).join('; ') + '. ' + unassigned.length + ' records not assigned to a single year.';
    const unassignedHtml = unassigned.length ? '<div class="analysis-unassigned"><h4>' + number(unassigned.length) + ' ' + (unassigned.length === 1 ? 'record spans' : 'records span') + ' calendar years</h4><p>Kept separate from the bars because the exact year is not established.</p><ul>' + unassigned.map(r => '<li><button type="button" class="analysis-country-text" data-analysis-country="' + esc(r.country_code) + '">' + esc(r.country || countries.get(r.country_code)?.country || r.country_code) + '</button><span>' + esc(dateLabel(r.date_start || r.event_date)) + ' – ' + esc(dateLabel(r.date_end || r.event_date)) + '</span><small>' + esc(r.office || r.collective_body || '') + '</small></li>').join('') + '</ul></div>' : '';
    host.innerHTML = `
      <div class="analysis-scope"><span class="analysis-scope-dot" aria-hidden="true"></span><span>${esc(selectedNote)}</span></div>
      <div class="analysis-kpis" aria-label="Selected series summary">
        <div class="analysis-kpi"><strong>${number(records.length)}</strong><span>${esc(countLabel)}</span></div>
        <div class="analysis-kpi"><strong>${number(countryCounts.length)}</strong><span>Geographic ${countriesUnit} with records</span></div>
        <div class="analysis-kpi"><strong>${number(exactCount)}</strong><span>Records with an exact day</span></div>
        <div class="analysis-kpi"><strong>${number(rangeCount)}</strong><span>Records with a date interval</span></div>
      </div>
      <p class="analysis-reading-note">${collective ? 'This series counts changes in the membership of bodies that share executive authority. Simultaneous replacements within one body form one record. It is kept separate from office and authority handovers.' : 'These are changes in the holder of a tracked executive office or governing authority. Several offices can be tracked in one country; these counts do not measure regime change or political instability.'} The monthly timeline applies to the map; these charts use the whole study window.</p>
      ${records.length ? '' : '<div class="analysis-empty"><h3>No records match these filters</h3><p>Change the search or category filters to explore this series. An empty result does not establish that no political transition occurred.</p></div>'}
      <div class="analysis-grid">
        ${mechanismPanel(annual,records,shortUnit)}
        <section class="analysis-panel analysis-panel-wide" aria-labelledby="analysis-annual-title">
          <div class="analysis-panel-heading"><div><p class="analysis-eyebrow">Across the decade</p><h3 id="analysis-annual-title">${esc(shortUnit)} by year</h3></div>${help('annual counts','2016 and 2026 cover part of a year. An interval is assigned to a year only when both its bounds fall within that year. Cross-year intervals remain separate; no date is guessed.')}</div>
          <div class="analysis-annual-chart" role="img" aria-label="${esc(annualDescription)}"><div class="analysis-annual-columns">${years.map(y => `<div class="analysis-year-column"><div class="analysis-year-count">${number(y.count)}</div><div class="analysis-year-track"><span class="analysis-year-bar${y.year === 2016 || y.year === 2026 ? ' is-partial' : ''}" style="height:${(y.count / maxAnnual * 100).toFixed(3)}%" title="${y.year}: ${y.count} ${esc(unit)}"></span></div><span class="analysis-year-label">${y.year}${y.year === 2016 || y.year === 2026 ? '*' : ''}</span></div>`).join('')}</div></div>
          <p class="analysis-chart-caption"><strong>* Partial years:</strong> 2016 starts on 11 November; 2026 ends on 11 November. Bars include ${number(annualSum)} of ${number(records.length)} selected records.${unassigned.length ? ' The remaining records span years, as listed below.' : ''}</p>
          ${unassignedHtml}
          ${table(shortUnit + ' by calendar year', ['Year','Count','Period observed'], years.map(y => [y.year,y.count,y.year === 2016 ? '11 Nov – 31 Dec' : y.year === 2026 ? '1 Jan – 11 Nov' : 'Full calendar year']).concat(unassigned.length ? [['Cross-year intervals', unassigned.length, 'Not allocated to a single year']] : []))}
        </section>
        <section class="analysis-panel" aria-labelledby="analysis-mechanisms-title">
          <div class="analysis-panel-heading"><div><p class="analysis-eyebrow">How authority changed</p><h3 id="analysis-mechanisms-title">Primary mechanism</h3></div>${help('primary mechanisms','Each record has one primary classification. Political processes can overlap; each record explains the circumstances. An electoral or constitutional label does not assess the quality of democratic institutions.')}</div>
          ${bars(mechanisms, records.length, {label})}
          <p class="analysis-chart-caption">Percentages refer to the ${number(records.length)} selected ${esc(unit)}. See individual records for context.</p>
          ${table('Primary mechanism', ['Mechanism','Count','Share'], mechanisms.map(r => [label(r.key),r.count,percent(r.count,records.length)]))}
        </section>
        <section class="analysis-panel" aria-labelledby="analysis-groups-title">
          <div class="analysis-panel-heading"><div><p class="analysis-eyebrow">Change and continuity</p><h3 id="analysis-groups-title">Governing group</h3></div>${help('governing-group changes','A different officeholder does not necessarily mean a different ruling party, coalition or regime. Unclear is an unknown classification, not evidence of continuity.')}</div>
          ${bars(groups, records.length, {label: k => GROUPS[k] || k, color: k => GROUP_COLORS[k] || '#8d9299'})}
          <div class="analysis-insight"><strong>${number(groups.find(r => r.key === 'unclear')?.count || 0)} classified as unclear</strong><p>Group change is reported where the evidence supports it. Unclear cases remain unknown.</p></div>
          ${table('Governing-group change', ['Classification','Count','Share'], groups.map(r => [GROUPS[r.key] || r.key,r.count,percent(r.count,records.length)]))}
        </section>
        <section class="analysis-panel" aria-labelledby="analysis-region-title">
          <div class="analysis-panel-heading"><div><p class="analysis-eyebrow">Geographic distribution</p><h3 id="analysis-region-title">Records by region</h3></div>${help('regional totals','Regions contain different numbers of cases and tracked offices. Totals count the recorded events. They are not adjusted for population or the number of countries and offices in each region.')}</div>
          ${bars(regions, records.length, {label:k => k})}
          <p class="analysis-chart-caption">Totals reflect different numbers of cases and executive offices, together with coverage gaps. They should not be read as comparable transition rates.</p>
          ${table('Records by region', ['Region','Count','Share'], regions.map(r => [r.key,r.count,percent(r.count,records.length)]))}
        </section>
        <section class="analysis-panel" aria-labelledby="analysis-country-title">
          <div class="analysis-panel-heading"><div><p class="analysis-eyebrow">Open the evidence</p><h3 id="analysis-country-title">Cases with most records</h3></div>${help('country totals','More recorded handovers can reflect several concurrent executive offices, substantive interim successions or differences in coverage. This ordering is not an instability index. Select a country to inspect its records and coverage.')}</div>
          ${rankRows.length ? '<ol class="analysis-country-rank">' + rankRows.map((r,i) => { const c = countries.get(r.key) || {}; return '<li><button type="button" data-analysis-country="' + esc(r.key) + '"><span class="analysis-rank-number">' + (i+1) + '</span><span class="analysis-rank-name">' + esc(c.country || records.find(x => x.country_code === r.key)?.country || r.key) + (c.coverage_status !== 'full_window_verified' ? '<small class="analysis-partial-badge">Partial coverage</small>' : '') + '</span><strong>' + number(r.count) + '</strong><span class="analysis-rank-arrow" aria-hidden="true">→</span></button></li>'; }).join('') + '</ol>' : '<p class="analysis-empty-inline">No matching records.</p>'}
          <p class="analysis-chart-caption">Showing ${rankRows.length} of ${number(countryCounts.length)} cases with matching records. ${selectedPartial ? number(selectedPartial) + ' of those ' + countryCounts.length + ' cases retain a coverage gap.' : 'No matching cases have a partial-coverage flag.'} Select a case to read the evidence.</p>
          ${table('All cases with matching records', ['Case','Count','Coverage'], countryCounts.map(r => [countries.get(r.key)?.country || r.key,r.count,countries.get(r.key)?.coverage_status === 'full_window_verified' ? 'Full period checked' : 'Partial']))}
        </section>
      </div>
      <p class="analysis-source-note">Source: Political Transitions register, research version ${esc(data.meta.release)}, frozen ${esc(data.meta.researchDate)}. Counts are calculated from the selected records. Supporting source links, date qualifications and coverage notes are available in each country view.</p>`;
    host.querySelectorAll('[data-analysis-country]').forEach(button => button.addEventListener('click', () => {
      if (typeof options.onCountry === 'function') options.onCountry(button.getAttribute('data-analysis-country'));
    }));
    bindMechanismChart(host,annual,shortUnit);
  }
  window.AtlasAnalysis = {render,aggregateAnnualMechanisms};
})();
