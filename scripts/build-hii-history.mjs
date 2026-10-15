import {readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';

export const HII_DATASET = 'https://data.hii.or.th/dataset/flood-area';
const META = 'https://data.hii.or.th/api/3/action/package_show?id=flood-area';
export function parseCsv(text) {
  const rows=[]; let row=[], value='', quoted=false;
  for (let i=0;i<text.length;i++) {
    const c=text[i];
    if(c==='"') { if(quoted && text[i+1]==='"'){value+='"';i++;}else quoted=!quoted; }
    else if(c===',' && !quoted){row.push(value);value='';}
    else if((c==='\n'||c==='\r') && !quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(value);if(row.some(Boolean))rows.push(row);row=[];value='';}
    else value+=c;
  }
  if(quoted)throw Error('Unclosed CSV quote');
  if(value||row.length){row.push(value);rows.push(row);}
  const header=rows.shift()?.map(v=>v.replace(/^\uFEFF/,''));
  if(!header?.includes('GEOCODE'))throw Error('HII CSV schema changed');
  return rows.map(r=>{assert.equal(r.length,header.length,'CSV column count');return Object.fromEntries(header.map((k,i)=>[k,r[i]]));});
}

export function summarize(rows, boundaries) {
  const bands={'เสี่ยงต่ำ':'low','เสี่ยงปานกลาง':'medium','เสี่ยงสูง':'high'};
  const bkk=rows.filter(r=>r.PROV_CODE==='10');
  const names=new Map(), districts=new Map(), seen=new Set();
  for(const r of bkk){
    assert.match(r.AMPHOE_CODE,/^10\d{2}$/);assert.match(r.GEOCODE,/^10\d{4}$/);
    assert.ok(Number(r.AMPHOE_CODE)>=1001&&Number(r.AMPHOE_CODE)<=1050,'unknown Bangkok district code');
    assert.ok(r.GEOCODE.startsWith(r.AMPHOE_CODE),'subdistrict-parent code mismatch');
    const month=Number(r.Month);assert.ok(Number.isInteger(month)&&month>=1&&month<=12);
    assert.ok(bands[r.RISK],'unknown HII risk band');
    const key=`${month}:${r.GEOCODE}`;assert.ok(!seen.has(key),'duplicate subdistrict-month');seen.add(key);
    const name=r.AMPHOE_T.trim();
    assert.ok(!names.has(name)||names.get(name)===r.AMPHOE_CODE,'ambiguous district name');names.set(name,r.AMPHOE_CODE);
    if(!districts.has(r.AMPHOE_CODE))districts.set(r.AMPHOE_CODE,{code:r.AMPHOE_CODE,nameTh:name,months:{}});
    const d=districts.get(r.AMPHOE_CODE);
    const m=d.months[month]??={low:0,medium:0,high:0,reportedSubdistricts:0};
    m[bands[r.RISK]]++;m.reportedSubdistricts++;
    m.maxReportedBand=m.high?'high':m.medium?'medium':'low';
  }
  assert.equal(boundaries.features.length,50,'Unexpected Bangkok boundary count');
  const joined=boundaries.features.map(f=>{
    // Exact Thai district-name bridge only; no transliteration or fuzzy matching.
    // Preserve OSM identity and geometry. The four-digit code comes from HII.
    const code=names.get(f.properties.name_th?.trim());
    assert.ok(code,`Unmatched district: ${f.properties.name_th}`);
    return {...districts.get(code),osmId:f.properties.id};
  });
  assert.equal(new Set(joined.map(d=>d.code)).size,50,'District bridge is not one-to-one');
  return {sourceRowCount:rows.length,bangkokRowCount:bkk.length,
    reportedSubdistrictCount:new Set(bkk.map(r=>r.GEOCODE)).size,
    months:[...new Set(bkk.map(r=>Number(r.Month)))].sort((a,b)=>a-b),districts:joined};
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const metaResponse=await fetch(META,{signal:AbortSignal.timeout(30000)});
  assert.ok(metaResponse.ok);const meta=await metaResponse.json();assert.ok(meta.success);
  const resource=meta.result.resources.find(r=>r.url.endsWith('/monthly-flood-risk-area.csv'));
  assert.ok(resource,'HII resource missing');
  const response=await fetch(resource.url,{signal:AbortSignal.timeout(30000)});assert.ok(response.ok);
  const raw=Buffer.from(await response.arrayBuffer());
  const boundaryPath=new URL('../public/bkk-districts.geojson',import.meta.url);
  let boundaryRaw=readFileSync(boundaryPath);
  if(process.argv.includes('--retire-legacy-labels')){
    const boundaries=JSON.parse(boundaryRaw);
    for(const f of boundaries.features)for(const key of ['hii_risk','hii_freq_17y','hii_freq_th','hii_source','hii_caveat'])delete f.properties[key];
    // Retire unverified, month-free legacy labels; preserve IDs and every coordinate.
    writeFileSync(boundaryPath,JSON.stringify(boundaries)+'\n');
    boundaryRaw=readFileSync(boundaryPath);
  }
  const result=summarize(parseCsv(raw.toString('utf8')),JSON.parse(boundaryRaw));
  const data={schema:1,tier:'reference',period:'2005–2021',source:HII_DATASET,resource:resource.url,
    publisher:'Hydro-Informatics Institute (HII), using GISTDA satellite flood history',
    sourceModified:meta.result.metadata_modified,retrievedAt:new Date().toISOString(),
    license:meta.result.license_title||meta.result.license_id,
    licenseUrl:meta.result.license_url||null,
    sha256:createHash('sha256').update(raw).digest('hex'),
    boundarySha256:createHash('sha256').update(boundaryRaw).digest('hex'),
    boundarySource:'OpenStreetMap, 50 khet; geometry unchanged, not an official DOPA boundary layer',
    join:'Exact Thai district name bridge, validated one-to-one; then HII AMPHOE_CODE, never TAMBON_T-to-khet',
    caveat:'Seasonal history, not live inundation, forecast, depth or road safety. District colour is the highest band among reported subdistricts for that month. Missing records are unassessed, not low risk; subdistrict coverage is incomplete.',
    ...result};
  writeFileSync(new URL('../public/bkk-hii-history.json',import.meta.url),JSON.stringify(data,null,2)+'\n');
  console.log(JSON.stringify({districts:data.districts.length,rows:data.bangkokRowCount,subdistricts:data.reportedSubdistrictCount,months:data.months,license:data.license}));
}
