(function(root){
  'use strict';
  const P={ink:'#244e46',text:'#233a45',muted:'#65756f',teal:'#287567',land:'#f5f6f4',ocean:'#e1e6e4',border:'#c3ccc6',coast:'#b5c0b9',disputed:'#9aa59d',selected:'#b16b4c'};
  const countBins=[{label:'0',colour:P.land},{label:'1–2',colour:'#dcebe1'},{label:'3–5',colour:'#a9ccbb'},{label:'6–9',colour:'#609781'},{label:'10+',colour:'#244e46'}];
  const mechanisms={
    election_handover:{label:'Election',colour:'#287e67'},
    parliamentary_or_coalition_replacement:{label:'Parliamentary / coalition',colour:'#477987'},
    interim_or_caretaker_succession:{label:'Interim / caretaker',colour:'#8255a5'},
    same_party_succession:{label:'Same-party succession',colour:'#287fb5'},
    resignation_replacement:{label:'Resignation / replacement',colour:'#b97713'},
    constitutional_succession:{label:'Constitutional succession',colour:'#587c28'},
    negotiated_transition:{label:'Negotiated transition',colour:'#ad527e'},
    coup_or_military_takeover:{label:'Coup / military takeover',colour:'#b8473f'},
    restoration:{label:'Restoration',colour:'#5967a8'},
    hereditary_succession:{label:'Hereditary succession',colour:'#67503a'},
    other:{label:'Other mechanism',colour:'#7d8884'},
    multiple:{label:'Multiple mechanisms',colours:['#287e67','#8255a5','#b8473f']}
  };
  const views={World:[[-55,-170],[75,180]],Africa:[[-36,-20],[38,54]],Europe:[[34,-25],[72,48]],Asia:[[-10,25],[74,150]],'North America':[[6,-168],[73,-50]],'South America':[[-56,-83],[14,-32]],Oceania:[[-50,110],[5,180]]};
  const aliases={SDS:'SSD',PSX:'PSE',KOS:'XKX'};
  const microCodes=new Set(['AND','ATG','BHR','BRB','COM','CPV','DMA','FSM','GRD','KIR','KNA','LCA','LIE','MDV','MHL','MLT','MUS','NRU','PLW','SMR','STP','SYC','SGP','TON','TUV','VAT','VCT','WSM']);
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const countryCode=c=>c?.country_code||c?.code||'';
  const countryName=c=>c?.country||c?.name||countryCode(c);
  const featureCode=f=>aliases[f?.properties?.ADM0_A3]||f?.properties?.ADM0_A3||f?.properties?.ISO_A3;
  const isPartial=c=>String(c?.coverage_status||c?.coverage||'').startsWith('partial');
  const isFull=c=>String(c?.coverage_status||c?.coverage||'').startsWith('full');
  const compact=()=>window.matchMedia('(max-width:760px), (max-width:950px) and (max-height:500px)').matches;
  let map,geography,countryLayer,labelPane,microLayer,callback,resizeFrame,pendingView=null,selectedRegion='World',labelVisible=false;
  let countries=new Map(),features=new Map(),counts=new Map(),recordsByCountry=new Map(),microMarkers=new Map();
  let current={records:[],colourBy:'mechanism',series:'handovers',selectedCountry:null};
  const mechanismOrder=Object.keys(mechanisms).filter(key=>key!=='multiple'),patternCache=new Map();

  function countColour(n){return countBins[n>=10?4:n>=6?3:n>=3?2:n>=1?1:0].colour;}
  function mechanismKeys(code){
    const present=new Set((recordsByCountry.get(code)||[]).map(r=>mechanismOrder.includes(r.mechanism)?r.mechanism:'other'));
    return mechanismOrder.filter(key=>present.has(key));
  }
  function stripeColours(code){return current.colourBy==='mechanism'?mechanismKeys(code).map(key=>mechanisms[key].colour):[];}
  function stripeGradient(colours,band=3){return 'repeating-linear-gradient(135deg,'+colours.map((colour,i)=>colour+' '+i*band+'px '+(i+1)*band+'px').join(',')+')';}
  function stripePattern(colours,band=6){
    const step=Math.max(1,Math.round(band*Math.SQRT2)),size=step*colours.length,key=size+':'+colours.join(',');
    if(patternCache.has(key))return patternCache.get(key);
    const tile=document.createElement('canvas');tile.width=tile.height=size;
    const ctx=tile.getContext('2d');
    ctx.fillStyle=colours[0];ctx.fillRect(0,0,size,size);
    // A complete equal-width colour cycle repeats along either tile edge.
    for(let i=0;i<colours.length*2;i++){
      ctx.fillStyle=colours[i%colours.length];ctx.beginPath();
      ctx.moveTo(i*step,0);ctx.lineTo((i+1)*step,0);ctx.lineTo((i+1)*step-size,size);ctx.lineTo(i*step-size,size);ctx.closePath();ctx.fill();
    }
    const pattern=ctx.createPattern(tile,'repeat');patternCache.set(key,pattern);return pattern;
  }
  function markerSize(code,colours){return colours.length>1?(code===current.selectedCountry?14:12):(code===current.selectedCountry?9:7);}
  function mechanismLabel(code){return mechanismKeys(code).map(key=>mechanisms[key].label).join(' · ');}
  function styleFor(code){
    const c=countries.get(code),n=counts.get(code)||0,selected=current.selectedCountry===code;
    let fillColor=c?countColour(n):'#e9ede8';
    if(current.colourBy==='coverage')fillColor=!c?'#e9ede8':isFull(c)?'#a9ccbb':isPartial(c)?'#ead7b3':'#e9ede8';
    if(current.colourBy==='mechanism'&&c&&n){const colours=stripeColours(code);fillColor=colours.length>1?stripePattern(colours):colours[0];}
    return {fillColor,fillOpacity:1,color:selected?P.selected:P.coast,weight:selected?2.5:.65,opacity:1,dashArray:null};
  }
  function seriesLabel(n){return current.series==='collective'?(n===1?'membership change':'membership changes'):(n===1?'handover':'handovers');}
  function tooltip(code){
    const c=countries.get(code),n=counts.get(code)||0;
    if(!c)return '';
    let note=isPartial(c)?'Partial coverage':isFull(c)?'Full window checked':'Coverage under review';
    if(!n&&c.no_transition_verified)note+=' · no eligible handover found in the full study window';
    const mechanism=current.colourBy==='mechanism'&&n?'<span class="map-tip-meta">'+escape(mechanismLabel(code))+'</span>':'';
    return '<strong class="map-tip-title">'+escape(countryName(c))+'</strong><span class="map-tip-meta">'+n+' '+seriesLabel(n)+' in selection</span>'+mechanism+'<span class="map-tip-meta">'+escape(note)+'</span><span class="map-tip-hint">Select for records and sources →</span>';
  }
  function visibleRect(selector){
    for(const el of document.querySelectorAll(selector)){
      const b=el.getBoundingClientRect(),s=getComputedStyle(el);
      if(!el.hidden&&s.display!=='none'&&s.visibility!=='hidden'&&b.width>0&&b.height>0)return b;
    }
    return null;
  }
  function padding(){
    if(!map)return {paddingTopLeft:[30,55],paddingBottomRight:[30,150]};
    const r=map.getContainer().getBoundingClientRect(),side=visibleRect('.sidebar,#explore-panel,#map-sidebar'),dock=visibleRect('.timeline');
    const right=!compact()&&side&&side.left>r.left+r.width*.45&&side.left<r.right?Math.max(25,r.right-side.left+18):25;
    const bottom=dock&&dock.top>r.top+r.height*.4&&dock.top<r.bottom?Math.min(r.height*.4,r.bottom-dock.top+18):compact()?140:95;
    return {paddingTopLeft:[compact()?20:25,compact()?76:64],paddingBottomRight:[right,bottom]};
  }
  function hasMapSize(){const el=map.getContainer();return el.clientWidth>0&&el.clientHeight>0;}
  function prepareView(view){
    // Other pages can reset filters while the map has no layout dimensions.
    if(!hasMapSize()){pendingView=view;return false;}
    pendingView=null;map.invalidateSize({animate:false,pan:false});return true;
  }
  function setRegion(name='World'){
    selectedRegion=views[name]?name:'World';if(!map)return;
    if(!prepareView(()=>setRegion(selectedRegion)))return;
    const bounds=views[selectedRegion],pad=padding(),size=map.getSize();
    if(selectedRegion==='World'&&compact()&&size.y>size.x){
      const top=L.point(pad.paddingTopLeft),bottom=L.point(pad.paddingBottomRight);
      const zoom=map.getBoundsZoom(bounds,false,top.add(bottom))+.5;
      const centre=map.unproject(map.project([30,12],zoom).add(bottom.subtract(top).divideBy(2)),zoom);
      map.setView(centre,zoom,{animate:false});
    }else map.fitBounds(bounds,{...pad,animate:false});
  }
  function fitRecords(records=[]){
    if(!map)return;
    if(!prepareView(()=>fitRecords(records)))return;
    const codes=[...new Set(records.map(countryCode))],points=codes.map(code=>features.get(code)?.properties).filter(p=>p&&Number.isFinite(p.LABEL_X)&&Number.isFinite(p.LABEL_Y)).map(p=>[p.LABEL_Y,p.LABEL_X]);
    if(!points.length){setRegion(selectedRegion);return;}
    map.fitBounds(L.latLngBounds(points),{...padding(),maxZoom:codes.length===1?5:6,animate:false});
  }
  function select(code){if(countries.has(code)&&callback)callback(code);}
  function markerIcon(code){
    const s=styleFor(code),colours=stripeColours(code),size=markerSize(code,colours),background=colours.length>1?stripeGradient(colours,(size-3)/colours.length):s.fillColor;
    return L.divIcon({className:'atlas-country-marker',iconSize:[24,24],iconAnchor:[12,12],html:'<span style="display:block;width:'+size+'px;height:'+size+'px;margin:'+(24-size)/2+'px;border:1.4px solid '+s.color+';border-radius:50%;background:'+background+';box-shadow:0 0 0 1px #fff" aria-hidden="true"></span>',tooltipAnchor:[0,-9]});
  }
  function renderMicro(){
    if(!map)return;
    for(const [code,marker]of microMarkers){
      marker.setIcon(markerIcon(code));marker.setTooltipContent(tooltip(code));
      const el=marker.getElement();if(el){el.setAttribute('role','button');el.setAttribute('aria-label',countryName(countries.get(code))+'. '+(counts.get(code)||0)+' '+seriesLabel(counts.get(code)||0)+' in selection. '+(current.colourBy==='mechanism'&&counts.get(code)?mechanismLabel(code)+'. ':'')+'Open records.');el.style.cursor='pointer';}
    }
  }
  function ringArea(ring){
    let sum=0;for(let i=0,j=ring.length-1;i<ring.length;j=i++){
      const a=ring[j],b=ring[i];let dl=(b[0]-a[0])*Math.PI/180;
      while(dl>Math.PI)dl-=2*Math.PI;while(dl< -Math.PI)dl+=2*Math.PI;
      sum+=dl*(2+Math.sin(a[1]*Math.PI/180)+Math.sin(b[1]*Math.PI/180));
    }return Math.abs(sum)*6371*6371/2;
  }
  const areaCache=new WeakMap();
  function area(f){
    if(areaCache.has(f))return areaCache.get(f);
    const g=f.geometry,p=g.type==='Polygon'?[g.coordinates]:g.type==='MultiPolygon'?g.coordinates:[];
    const a=p.reduce((total,rings)=>total+Math.max(0,ringArea(rings[0]||[])-rings.slice(1).reduce((s,r)=>s+ringArea(r),0)),0);areaCache.set(f,a);return a;
  }
  function labelSpecs(){
    if(!map||!labelVisible||!geography)return [];
    const z=map.getZoom(),size=map.getSize(),minArea=z<1.6?600000:z<2.5?300000:z<3.25?110000:z<4?18000:z<5?3000:0;
    const limit=z<1.6?16:z<2.5?30:z<3.25?48:z<4?70:z<5?100:140,fontSize=z<2.5?10:z<4?11:12,candidates=[];
    for(const f of geography.countries.features){
      const p=f.properties;if(!Number.isFinite(p.LABEL_X)||!Number.isFinite(p.LABEL_Y)||area(f)<minArea)continue;
      const name=countries.has(featureCode(f))?countryName(countries.get(featureCode(f))):p.NAME;
      const pt=map.latLngToContainerPoint([p.LABEL_Y,p.LABEL_X]),w=Math.max(fontSize,name.length*fontSize*.56);
      const box={left:pt.x-w/2-8,right:pt.x+w/2+8,top:pt.y-fontSize/2-8,bottom:pt.y+fontSize/2+8};
      if(box.left<4||box.right>size.x-4||box.top<4||box.bottom>size.y-4)continue;
      candidates.push({text:name,x:pt.x,y:pt.y,fontSize,box,rank:Number(p.LABELRANK??p.SCALERANK??99),area:area(f)});
    }
    candidates.sort((a,b)=>a.rank-b.rank||b.area-a.area||a.text.localeCompare(b.text));
    const chosen=[],names=new Set();
    for(const c of candidates){if(names.has(c.text)||chosen.some(v=>c.box.left<v.box.right&&c.box.right>v.box.left&&c.box.top<v.box.bottom&&c.box.bottom>v.box.top))continue;chosen.push(c);names.add(c.text);if(chosen.length>=limit)break;}
    return chosen;
  }
  function renderLabels(){
    if(!labelPane||!map)return;labelPane.replaceChildren();if(!labelVisible)return;
    for(const p of labelSpecs()){
      const label=document.createElement('span'),position=map.containerPointToLayerPoint([p.x,p.y]);
      label.textContent=p.text;label.style.cssText='position:absolute;left:'+position.x+'px;top:'+position.y+'px;transform:translate(-50%,-50%);font:'+p.fontSize+'px/1.2 Atlas,Arial,sans-serif;color:#52685e;white-space:nowrap;text-shadow:0 1px 2px #fff,1px 0 2px #fff,-1px 0 2px #fff;pointer-events:none';labelPane.appendChild(label);
    }
  }
  function setLabels(value){labelVisible=Boolean(value);renderLabels();}
  function update(options={}){
    if(options.countries)countries=new Map(options.countries.map(c=>[countryCode(c),c]));
    current={...current,...options};counts=new Map();recordsByCountry=new Map();
    for(const r of current.records||[]){const code=countryCode(r);counts.set(code,(counts.get(code)||0)+1);if(!recordsByCountry.has(code))recordsByCountry.set(code,[]);recordsByCountry.get(code).push(r);}
    if(countryLayer)countryLayer.eachLayer(layer=>{const code=featureCode(layer.feature);layer.setStyle(styleFor(code));if(layer.getTooltip())layer.setTooltipContent(tooltip(code));});
    renderMicro();renderLabels();
  }
  function invalidate(){
    if(!map)return;cancelAnimationFrame(resizeFrame);
    resizeFrame=requestAnimationFrame(()=>{
      if(!hasMapSize())return;
      map.invalidateSize({animate:false,pan:false});
      if(pendingView)pendingView();
      renderLabels();
    });
  }

  async function init(options={}){
    if(map){callback=options.onCountry||callback;update({countries:options.countries||[...countries.values()]});return api;}
    callback=options.onCountry;countries=new Map((options.countries||[]).map(c=>[countryCode(c),c]));
    const response=await fetch('assets/world-reference.json');if(!response.ok)throw Error('The map geography could not be loaded. Please reload.');geography=await response.json();
    if(!geography.countries?.features?.length)throw Error('Map geography is missing.');
    map=L.map('map',{preferCanvas:true,zoomControl:false,attributionControl:true,worldCopyJump:false,minZoom:.25,maxZoom:14,zoomSnap:.25,scrollWheelZoom:true}).setView([17,5],2);
    map.getContainer().style.background=P.ocean;
    L.control.zoom({position:'topleft'}).addTo(map);
    map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
    map.attributionControl.addAttribution('Reference geography: <a href="https://www.naturalearthdata.com/" target="_blank" rel="noopener">Natural Earth</a>');
    const renderer=L.canvas({padding:.35});
    countryLayer=L.geoJSON(geography.countries,{renderer,style:f=>styleFor(featureCode(f)),onEachFeature(f,layer){
      const code=featureCode(f);if(countries.has(code)){features.set(code,f);layer.bindTooltip(tooltip(code),{direction:'top',sticky:true,opacity:1,className:'atlas-country-tooltip'});layer.on('click',()=>select(code));layer.on('mouseover',()=>layer.setStyle({weight:2,color:P.ink}));layer.on('mouseout',()=>layer.setStyle(styleFor(code)));}
    }}).addTo(map);
    map.createPane('referenceBoundaries');map.getPane('referenceBoundaries').style.zIndex=410;map.getPane('referenceBoundaries').style.pointerEvents='none';
    const referenceRenderer=L.canvas({pane:'referenceBoundaries',padding:.35});
    // Ordinary country borders remain visible. Separately recorded disputed
    // boundaries are overlaid above them.
    L.geoJSON(geography.disputed,{pane:'referenceBoundaries',renderer:referenceRenderer,interactive:false,style:{color:P.disputed,weight:.8,opacity:.8,dashArray:'4 4',fill:false}}).addTo(map);
    labelPane=map.createPane('countryLabels');labelPane.style.zIndex=430;labelPane.style.pointerEvents='none';labelPane.setAttribute('aria-hidden','true');
    microLayer=L.layerGroup().addTo(map);
    for(const code of microCodes){
      const f=features.get(code),p=f?.properties;if(!p)continue;
      const marker=L.marker([p.LABEL_Y,p.LABEL_X],{icon:markerIcon(code),keyboard:true,title:countryName(countries.get(code)),riseOnHover:true}).addTo(microLayer);
      marker.bindTooltip(tooltip(code),{direction:'top',opacity:1});marker.on('click',()=>select(code));
      const el=marker.getElement();if(el)el.addEventListener('keydown',e=>{if(e.key===' '){e.preventDefault();select(code);}});
      microMarkers.set(code,marker);
    }
    map.on('moveend zoomend resize',renderLabels);window.addEventListener('resize',invalidate);if(window.visualViewport)window.visualViewport.addEventListener('resize',invalidate);
    update({countries:[...countries.values()]});setRegion('World');
    return api;
  }

  function exportLegend(){
    if(current.colourBy==='coverage')return [{label:'Full window checked',colour:'#a9ccbb'},{label:'Partial coverage',colour:'#ead7b3'},{label:'Outside research frame',colour:'#e9ede8'}];
    if(current.colourBy==='mechanism'){
      const sets=[...recordsByCountry.keys()].sort().map(mechanismKeys),active=new Set(sets.flat()),mixed=sets.find(keys=>keys.length>1);
      return [...mechanismOrder.filter(key=>active.has(key)).map(key=>mechanisms[key]),...(mixed?[{label:'Multiple mechanisms',colours:mixed.slice(0,3).map(key=>mechanisms[key].colour)}]:[]),{label:'No matching record',colour:P.land}];
    }
    return countBins;
  }
  function drawGeometry(ctx,g){
    if(!g)return;
    function line(coords,close){if(!coords.length)return;coords.forEach((c,i)=>{const p=map.latLngToContainerPoint([c[1],c[0]]);i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y);});if(close)ctx.closePath();}
    if(g.type==='Polygon')g.coordinates.forEach(r=>line(r,true));
    else if(g.type==='MultiPolygon')g.coordinates.forEach(poly=>poly.forEach(r=>line(r,true)));
    else if(g.type==='LineString')line(g.coordinates,false);
    else if(g.type==='MultiLineString')g.coordinates.forEach(r=>line(r,false));
    else if(g.type==='GeometryCollection')g.geometries.forEach(v=>drawGeometry(ctx,v));
  }
  async function exportPNG({title='Political transitions',subtitle='',credit='Hugh Lamarque · Reference geography: Natural Earth'}={}){
    if(!map||!geography)throw Error('Wait for the map to finish loading before saving.');
    if(document.fonts?.ready)await document.fonts.ready;
    const rect=map.getContainer().getBoundingClientRect(),side=visibleRect('.sidebar,#explore-panel,#map-sidebar'),dock=visibleRect('.timeline');
    const width=Math.round(!compact()&&side&&side.left>rect.left+rect.width*.45&&side.left<rect.right?side.left-rect.left-12:rect.width);
    const height=Math.round(dock&&dock.top>rect.top+rect.height*.4&&dock.top<rect.bottom?dock.top-rect.top-10:rect.height);
    const legend=exportLegend(),cols=width>900?4:width>600?3:2,legendRows=Math.ceil(legend.length/cols),head=72,stripeNote=current.colourBy==='mechanism'?16:0,foot=70+legendRows*24+stripeNote;
    const canvas=document.createElement('canvas'),scale=Math.min(2,4096/(width+0),4096/(height+head+foot));canvas.width=Math.round(width*scale);canvas.height=Math.round((height+head+foot)*scale);
    const ctx=canvas.getContext('2d');ctx.scale(scale,scale);ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height+head+foot);
    ctx.fillStyle=P.ink;ctx.font='600 23px Atlas,Arial,sans-serif';ctx.fillText(String(title),20,30,width-40);
    ctx.fillStyle=P.muted;ctx.font='12px Atlas,Arial,sans-serif';ctx.fillText(String(subtitle),20,53,width-40);
    ctx.save();ctx.translate(0,head);ctx.beginPath();ctx.rect(0,0,width,height);ctx.clip();ctx.fillStyle=P.ocean;ctx.fillRect(0,0,width,height);
    for(const f of geography.countries.features){const s=styleFor(featureCode(f));ctx.beginPath();drawGeometry(ctx,f.geometry);ctx.fillStyle=s.fillColor;ctx.fill('evenodd');ctx.strokeStyle=s.color;ctx.lineWidth=s.weight;ctx.setLineDash(s.dashArray?[4,3]:[]);ctx.stroke();}
    ctx.setLineDash([4,4]);ctx.lineWidth=.8;ctx.strokeStyle=P.disputed;for(const f of geography.disputed?.features||[]){ctx.beginPath();drawGeometry(ctx,f.geometry);ctx.stroke();}ctx.setLineDash([]);
    for(const [code]of microMarkers){const p=features.get(code).properties,pos=map.latLngToContainerPoint([p.LABEL_Y,p.LABEL_X]),s=styleFor(code),colours=stripeColours(code),size=markerSize(code,colours);ctx.beginPath();ctx.arc(pos.x,pos.y,size/2,0,Math.PI*2);ctx.fillStyle=colours.length>1?stripePattern(colours,(size-3)/colours.length):s.fillColor;ctx.fill();ctx.strokeStyle=s.color;ctx.lineWidth=1.4;ctx.setLineDash([]);ctx.stroke();}ctx.setLineDash([]);
    for(const label of labelSpecs()){ctx.font=label.fontSize+'px Atlas,Arial,sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.strokeStyle='#fff';ctx.lineWidth=2.5;ctx.strokeText(label.text,label.x,label.y);ctx.fillStyle='#52685e';ctx.fillText(label.text,label.x,label.y);}
    ctx.restore();ctx.textAlign='left';ctx.textBaseline='alphabetic';const y=head+height;
    ctx.fillStyle=P.ink;ctx.font='600 12px Atlas,Arial,sans-serif';ctx.fillText(current.colourBy==='coverage'?'Research coverage':current.colourBy==='mechanism'?'Mechanism of matching records':(current.series==='collective'?'Collective membership changes':'Office and authority handovers')+' in selection',20,y+23,width-40);
    const cell=(width-40)/cols;legend.forEach((item,i)=>{const x=20+(i%cols)*cell,cy=y+40+Math.floor(i/cols)*24;ctx.fillStyle=item.colours?stripePattern(item.colours,3):item.colour;ctx.fillRect(x,cy-10,14,10);ctx.strokeStyle='#8da397';ctx.lineWidth=.6;ctx.strokeRect(x,cy-10,14,10);ctx.fillStyle=P.text;ctx.font='11px Atlas,Arial,sans-serif';ctx.fillText(item.label,x+21,cy,cell-26);});
    const bottom=y+45+legendRows*24;ctx.fillStyle=P.muted;ctx.font='10px Atlas,Arial,sans-serif';
    if(stripeNote)ctx.fillText('Equal-width stripes show mechanisms present, not their proportions.',20,bottom+3,width-40);
    ctx.fillText('Coverage and evidence gaps are explained in country details. A zero is not proof of no transitions.',20,bottom+3+stripeNote,width-40);
    ctx.fillText(String(credit),20,bottom+20+stripeNote,width-40);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw Error('The map image could not be created.');
    const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='Political_Transitions_Atlas_map.png';document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);return {width:canvas.width,height:canvas.height,blob};
  }
  const api={init,update,setRegion,fitRecords,setLabels,invalidate,exportPNG,getMap:()=>map,getLegend:exportLegend,getColour:countColour,stripeGradient,mechanisms,countBins};
  root.AtlasMap=api;
})(window);
