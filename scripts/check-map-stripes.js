#!/usr/bin/env node
'use strict';
// Optional raster regression. Uses the managed runtime's @napi-rs/canvas;
// the website itself has no added dependency. Browser QA remains separate.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createCanvas}=require('@napi-rs/canvas');
const root=path.resolve(__dirname,'..'),C=require(path.join(root,'dist/core.js'));
const countries=['FRA','AND','DEU'].map(country_code=>({country_code,country:country_code,coverage_status:'partial_events_verified'}));
const feature=(code,x)=>({type:'Feature',properties:{ADM0_A3:code,NAME:code,LABEL_X:x+125,LABEL_Y:150},geometry:{type:'Polygon',coordinates:[[[x,20],[x+250,20],[x+250,280],[x,280],[x,20]]]}});
const geography={countries:{features:[feature('FRA',20),feature('AND',300),feature('DEU',580)]},disputed:{features:[]}};
const layers=new Map(),markers=new Map(),panes=new Map();let savedCanvas;
const container={clientWidth:880,clientHeight:360,style:{},getBoundingClientRect(){return {left:0,top:0,right:880,bottom:360,width:880,height:360};}};
const map={setView(){return this;},getContainer:()=>container,getSize:()=>({x:880,y:360}),fitBounds(){},invalidateSize(){},on(){},
  createPane(name){const pane={style:{},setAttribute(){},replaceChildren(){}};panes.set(name,pane);return pane;},getPane:name=>panes.get(name),
  latLngToContainerPoint:([y,x])=>({x,y}),attributionControl:{setPrefix(){},addAttribution(){}}};
const simpleLayer={addTo(){return this;}};
const L={map:()=>map,canvas:()=>({}),control:{zoom:()=>simpleLayer},layerGroup:()=>simpleLayer,divIcon:options=>options,
  geoJSON(data,options){
    const added=(data.features||[]).map(f=>{
      const layer={feature:f,options:options.style(f),setStyle(style){Object.assign(this.options,style);},bindTooltip(text){this.tooltip=text;},getTooltip(){return this.tooltip;},setTooltipContent(text){this.tooltip=text;},on(){}};
      options.onEachFeature?.(f,layer);layers.set(f.properties.ADM0_A3,layer);return layer;
    });
    return {addTo(){return this;},eachLayer(fn){added.forEach(fn);}};
  },
  marker(position,options){
    const element={style:{},attributes:{},setAttribute(k,v){this.attributes[k]=v;},addEventListener(){}};
    const marker={icon:options.icon,addTo(){return this;},bindTooltip(text){this.tooltip=text;},setTooltipContent(text){this.tooltip=text;},setIcon(icon){this.icon=icon;},on(){},getElement:()=>element};
    markers.set(options.title,marker);return marker;
  }};
const context={window:{matchMedia:()=>({matches:false}),addEventListener(){}},document:{fonts:{ready:Promise.resolve()},querySelectorAll:()=>[],body:{appendChild(){}},
  createElement(tag){
    if(tag==='canvas'){const canvas=createCanvas(1,1);canvas.toBlob=callback=>{savedCanvas=canvas;callback(new Blob([canvas.toBuffer('image/png')],{type:'image/png'}));};return canvas;}
    if(tag==='a')return {click(){},remove(){}};
    throw Error('Unexpected element: '+tag);
  }},L,fetch:async()=>({ok:true,json:async()=>geography}),requestAnimationFrame:()=>1,cancelAnimationFrame(){},setTimeout(){},URL:{createObjectURL:()=> 'blob:test',revokeObjectURL(){}}};
vm.runInNewContext(fs.readFileSync(path.join(root,'dist/map.js'),'utf8'),context,{filename:'map.js'});
const atlas=context.window.AtlasMap,checks=[];
function check(name,fn){fn();checks.push(name);}
function raster(fill,size=600){const canvas=createCanvas(size,size),ctx=canvas.getContext('2d');ctx.fillStyle=fill;ctx.fillRect(0,0,size,size);return ctx.getImageData(0,0,size,size).data;}
function colourCounts(pixels,colours){
  const counts=Object.fromEntries(colours.map(c=>[c,0])),rgb=colours.map(c=>[1,3,5].map(i=>parseInt(c.slice(i,i+2),16)));
  // Native canvas colour conversion can round an interior channel by 1.
  // Ignore blended edge pixels, but accept that harmless channel rounding.
  for(let i=0;i<pixels.length;i+=4){if(pixels[i+3]!==255)continue;const found=rgb.findIndex(c=>c.every((v,j)=>Math.abs(v-pixels[i+j])<=2));if(found!==-1)counts[colours[found]]++;}
  return counts;
}
function assertPresenceAndEqualBands(fill,colours){
  const pixels=raster(fill),counts=colourCounts(pixels,colours),total=Object.values(counts).reduce((a,b)=>a+b,0);
  assert(total>200000,'Most pattern pixels should retain the mechanism colours: '+JSON.stringify({counts,total}));
  for(const colour of colours){assert(counts[colour]>0,'Missing stripe colour '+colour);assert(Math.abs(counts[colour]/total-1/colours.length)<.035,'Unequal colour bands for '+colour);}
}
(async()=>{
  await atlas.init({countries});
  const mixed=['election_handover','interim_or_caretaker_succession','coup_or_military_takeover'];
  const colours=mixed.map(k=>C.mechanisms[k][1]);
  const records=[...Array.from({length:9},()=>({country_code:'FRA',mechanism:mixed[0]})),{country_code:'FRA',mechanism:mixed[2]},{country_code:'FRA',mechanism:mixed[1]},...mixed.slice().reverse().map(mechanism=>({country_code:'AND',mechanism})),{country_code:'DEU',mechanism:mixed[0]}];
  atlas.update({records,colourBy:'mechanism'});
  const first=layers.get('FRA').options.fillColor;
  check('Canvas pattern contains every selected mechanism in equal-width bands despite unequal record counts',()=>{
    assert.equal(typeof first,'object');assertPresenceAndEqualBands(first,colours);
  });
  check('Canonical ordering is independent of record order and frequency',()=>{
    const before=raster(first);atlas.update({records:records.slice().reverse().concat(records.filter(r=>r.mechanism===mixed[0]))});
    assert.deepEqual(raster(layers.get('FRA').options.fillColor),before);
    const tip=layers.get('FRA').tooltip;assert(tip.indexOf('Election')<tip.indexOf('Interim'));assert(tip.indexOf('Interim')<tip.indexOf('Coup'));
  });
  check('Small-state markers use ordered CSS stripes and name all mechanisms accessibly',()=>{
    const marker=markers.get('AND'),html=marker.icon.html;assert(html.includes('repeating-linear-gradient(135deg,'));
    for(const colour of colours)assert(html.includes(colour));
    assert(!html.includes('[object'));assert(html.indexOf(colours[0])<html.indexOf(colours[1]));
    assert(marker.getElement().attributes['aria-label'].includes('Interim / caretaker'));
  });
  check('Legend includes component mechanisms that appear only inside mixed countries',()=>{
    const legend=atlas.getLegend();for(const colour of colours)assert(legend.some(item=>item.colour===colour));
    assert(legend.some(item=>item.colours&&item.colours.length>1));
  });
  check('Filtered records remove obsolete stripes and the single-mechanism case stays solid',()=>{
    atlas.update({records:records.filter(r=>r.mechanism===mixed[0]),series:'collective'});
    assert.equal(layers.get('FRA').options.fillColor,colours[0]);assert(!markers.get('AND').icon.html.includes('gradient'));
    assert(layers.get('FRA').tooltip.includes('membership changes'));assert(!layers.get('FRA').tooltip.includes('Coup'));
    assert(!atlas.getLegend().some(item=>item.colours));
  });
  check('Count and coverage modes remain solid and coverage outlines remain absent',()=>{
    atlas.update({records,colourBy:'count'});assert.equal(typeof layers.get('FRA').options.fillColor,'string');
    atlas.update({colourBy:'coverage'});assert.equal(layers.get('FRA').options.fillColor,'#ead7b3');
    assert.equal(layers.get('FRA').options.dashArray,null);assert.equal(layers.get('FRA').options.color,'#b5c0b9');
  });
  check('Every supported mechanism survives in a many-colour canvas pattern',()=>{
    const keys=Object.keys(C.mechanisms);atlas.update({records:keys.map(mechanism=>({country_code:'FRA',mechanism})),colourBy:'mechanism'});
    assertPresenceAndEqualBands(layers.get('FRA').options.fillColor,keys.map(k=>C.mechanisms[k][1]));
  });
  atlas.update({records,colourBy:'mechanism',series:'handovers'});
  const exported=await atlas.exportPNG({title:'Stripe verification',subtitle:'Equal bands; mechanisms present, not proportions',credit:'Raster regression fixture'});
  check('PNG export renders actual stripes and preserves the colour components',()=>{
    assert(exported.blob.size>1000);assert(exported.width>0&&exported.height>0);
    const ctx=savedCanvas.getContext('2d'),pixels=ctx.getImageData(60,220,400,400).data,counts=colourCounts(pixels,colours);
    for(const colour of colours)assert(counts[colour]>1000,'PNG export omitted '+colour);
  });
  if(process.env.STRIPE_TEST_OUTPUT)fs.writeFileSync(process.env.STRIPE_TEST_OUTPUT,savedCanvas.toBuffer('image/png'));
  console.log(JSON.stringify({status:'passed',passed:checks.length,checks},null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
