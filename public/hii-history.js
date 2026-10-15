export const HII_HISTORY_SOURCE='bkkx-hii-history';
export const HII_HISTORY_LAYER='bkkx-hii-history-fill';

export function historyFeatures(data,boundaries,month){
  if(!Number.isInteger(month)||month<1||month>12)throw Error('Invalid calendar month');
  const lookup=new Map(data.districts.map(d=>[String(d.osmId),d]));
  return {type:'FeatureCollection',features:boundaries.features.map(f=>{
    const d=lookup.get(String(f.properties.id));
    if(!d||d.nameTh!==f.properties.name_th)throw Error('HII district bridge mismatch');
    const m=d.months[month];
    return {...f,properties:{id:f.properties.id,nameTh:d.nameTh,districtCode:d.code,month,
      maxReportedBand:m?.maxReportedBand??'unassessed',reportedSubdistricts:m?.reportedSubdistricts??0,
      low:m?.low??0,medium:m?.medium??0,high:m?.high??0}};
  })};
}

export async function installHiiHistory(map,setStatus,skipClick=()=>false){
  const controls=document.getElementById('hii-history-controls');
  if(map.getSource(HII_HISTORY_SOURCE)){controls.hidden=false;return;}
  const [data,boundaries]=await Promise.all(['/bkk-hii-history.json','/bkk-districts.geojson'].map(async url=>{
    const r=await fetch(url,{signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error(`HII history HTTP ${r.status}`);return r.json();
  }));
  const select=document.getElementById('hii-history-month');
  select.value=new Intl.DateTimeFormat('en',{timeZone:'Asia/Bangkok',month:'numeric'}).format(new Date());
  const render=()=>{
    const month=Number(select.value),fc=historyFeatures(data,boundaries,month);
    if(map.getSource(HII_HISTORY_SOURCE))map.getSource(HII_HISTORY_SOURCE).setData(fc);
    const n=fc.features.reduce((sum,f)=>sum+f.properties.reportedSubdistricts,0);
    setStatus('hii-history',`Historical month ${month} · ${n} reported khwaeng records · 2005–2021, not live`);
    document.getElementById('hii-history-note').textContent=`${data.caveat} Licence: ${data.license}. Source modified: ${data.sourceModified}. Geometry: OSM, not official DOPA boundaries.`;
    return fc;
  };
  const fc=render();
  map.addSource(HII_HISTORY_SOURCE,{type:'geojson',data:fc,
    attribution:'HII / GISTDA 2005–2021 · non-commercial reference data · © OpenStreetMap contributors'});
  try{
    map.addLayer({id:HII_HISTORY_LAYER,type:'fill',source:HII_HISTORY_SOURCE,
      paint:{'fill-color':['match',['get','maxReportedBand'],'low','#88a9b5','medium','#c8a565','high','#a95b70','#666966'],
        'fill-opacity':0.28,'fill-outline-color':'#c0bdb1'}});
  }catch(error){map.removeSource(HII_HISTORY_SOURCE);throw error;}
  select.onchange=render;
  controls.hidden=false;
  map.on('click',HII_HISTORY_LAYER,event=>{
    if(skipClick(event))return;
    const p=event.features?.[0]?.properties;if(!p)return;
    const card=document.createElement('div');card.className='atlas-cctv-card';
    const title=document.createElement('strong');title.textContent=`${p.nameTh} · ${p.districtCode}`;
    const text=document.createElement('p');text.textContent=`Historical calendar month ${p.month}, 2005–2021. Highest band among reported khwaeng: ${p.maxReportedBand}. ${p.reportedSubdistricts} reported: low ${p.low}, medium ${p.medium}, high ${p.high}. Missing records are unassessed. Not live floodwater, depth, forecast or safe-route advice.`;
    const link=document.createElement('a');link.href=data.source;link.textContent='HII source · non-commercial licence';link.target='_blank';link.rel='noreferrer';
    card.append(title,text,link);
    new maplibregl.Popup({className:'atlas-cctv-popup',maxWidth:'310px'}).setLngLat(event.lngLat).setDOMContent(card).addTo(map);
  });
}
