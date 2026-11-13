(function (root) {
  'use strict';
  const FIRST_MONTH = 2016 * 12 + 10, LAST_MONTH = 2026 * 12 + 10;
  const mechanisms = {
    election_handover: ['Election handover', '#287e67'],
    parliamentary_or_coalition_replacement: ['Parliamentary / coalition replacement', '#477987'],
    interim_or_caretaker_succession: ['Interim / caretaker succession', '#8255a5'],
    same_party_succession: ['Same-party succession', '#287fb5'],
    resignation_replacement: ['Resignation replacement', '#b97713'],
    constitutional_succession: ['Constitutional succession', '#587c28'],
    negotiated_transition: ['Negotiated transition', '#ad527e'],
    coup_or_military_takeover: ['Coup / military takeover', '#b8473f'],
    restoration: ['Restoration', '#5967a8'],
    hereditary_succession: ['Hereditary succession', '#67503a'],
    other: ['Other', '#7d8884']
  };
  const groupLabels = {yes:'Change established',no:'Continuity established',mixed:'Mixed',unclear:'Unclear',not_applicable:'Not applicable'};
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const normalise = v => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const id = r => r.event_id || r.structural_record_id;
  const date = d => {
    if(!d)return 'Date not established';
    const s=String(d);
    if(/^\d{4}$/.test(s))return s;
    if(/^\d{4}-\d{2}$/.test(s))return new Intl.DateTimeFormat('en-GB',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(s+'-01T00:00:00Z'));
    if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return s;
    const parsed=new Date(s+'T00:00:00Z');
    return Number.isFinite(parsed.getTime())?new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(parsed):s;
  };
  const dateLabel = r => r.date_precision === 'day' ? date(r.event_date || r.date_start) : date(r.date_start) + ' – ' + date(r.date_end);
  const holder = v => Array.isArray(v) ? (v.length ? v.join('; ') : 'Not established') : v || 'Not established';
  const monthISO = n => `${Math.floor(n/12)}-${String(n%12+1).padStart(2,'0')}`;
  const monthLabel = n => new Intl.DateTimeFormat('en-GB',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(monthISO(n)+'-01T00:00:00Z'));
  function continent(c) {
    if (c.region === 'Americas') return new Set(['ARG','BOL','BRA','CHL','COL','ECU','GUY','PRY','PER','SUR','URY','VEN']).has(c.country_code) ? 'South America' : 'North America';
    return c.region;
  }
  function period(state) {
    if(state.timeMode === 'all') return ['2016-11-11','2026-11-11'];
    const m=Number(state.month), y=Math.floor(m/12);
    const start=state.timeMode === 'year' ? `${y}-01-01` : monthISO(m)+'-01';
    const end=state.timeMode === 'year' ? `${y}-12-31` : new Date(Date.UTC(y,m%12+1,0)).toISOString().slice(0,10);
    return [start<'2016-11-11'?'2016-11-11':start,end>'2026-11-11'?'2026-11-11':end];
  }
  function relation(r, bounds) {
    const s=r.date_start||r.event_date,e=r.date_end||r.event_date;
    if (!s||!e||s>bounds[1]||e<bounds[0]) return 'outside';
    return s>=bounds[0]&&e<=bounds[1] ? 'within' : 'possible';
  }
  function filter(data,state,{ignoreTime=false,ignoreSearch=false,ignoreCountry=false}={}) {
    const countries=new Map(data.countries.map(c=>[c.country_code,c]));
    const list=state.series==='collective'?data.collective:data.events;
    const scenario=data.sensitivity.scenarios.find(s=>s.key===state.scenario)||data.sensitivity.scenarios[0];
    const excluded=new Set(state.series==='collective'?scenario.excluded_structural_ids:scenario.excluded_event_ids);
    const bounds=ignoreTime?['2016-11-11','2026-11-11']:period(state);
    const words=ignoreSearch?[]:normalise(state.search).split(/\s+/).filter(Boolean);
    return list.filter(r=>{
      const c=countries.get(r.country_code);
      if(!c||excluded.has(id(r))) return false;
      if(state.region!=='World'&&continent(c)!==state.region) return false;
      if(state.subregion&&c.subregion!==state.subregion) return false;
      if(state.coverage&&c.coverage_status!==state.coverage) return false;
      if(state.mechanism&&r.mechanism!==state.mechanism) return false;
      if(state.group&&r.governing_group_change!==state.group) return false;
      if(state.precision&&r.date_precision!==state.precision) return false;
      if(!ignoreCountry&&state.country&&r.country_code!==state.country) return false;
      if(relation(r,bounds)==='outside') return false;
      if(words.length){
        const haystack=normalise([r.country,c.country,r.office,r.collective_body,holder(r.incoming),holder(r.outgoing),r.summary,r.mechanism,id(r)].join(' '));
        if(!words.every(w=>haystack.includes(w))) return false;
      }
      return true;
    });
  }
  function csv(records) {
    const cols=['record_id','record_type','country_code','country','office','date_precision','event_date','date_start','date_end','outgoing','incoming','mechanism','governing_group_change','summary','caveats','source_urls'];
    const cell=v=>{let s=String(v??'');if(/^[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
    return '\ufeff'+[cols.join(','),...records.map(r=>[
      id(r),r.event_id?'office_or_authority_handover':'collective_membership_change',r.country_code,r.country,r.office||r.collective_body,r.date_precision,r.event_date,r.date_start,r.date_end,
      r.outgoing==null?'':holder(r.outgoing),r.incoming==null?'':holder(r.incoming),r.mechanism,r.governing_group_change,r.summary,
      Array.isArray(r.caveats)?r.caveats.join(' | '):r.caveats,(r.sources||[]).map(s=>s.url).join(' | ')
    ].map(cell).join(','))].join('\r\n');
  }
  const api={FIRST_MONTH,LAST_MONTH,mechanisms,groupLabels,esc,normalise,id,date,dateLabel,holder,monthISO,monthLabel,continent,period,relation,filter,csv};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.AtlasCore=api;
})(typeof window==='object'?window:globalThis);
