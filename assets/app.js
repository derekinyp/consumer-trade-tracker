(async function(){
const C=['#6B4A2E','#2F6F7E','#A0527A','#6F7F3A','#5B6B8C','#7A6F64'];
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmt=(v,n=1)=>v==null?'—':Number(v).toLocaleString('zh-TW',{minimumFractionDigits:n,maximumFractionDigits:n});
const sg=v=>v==null?'—':(v>0?'+':v<0?'−':'')+fmt(Math.abs(v),1);
let D,V=null;
try{D=await (await fetch('data/dashboard.json',{cache:'no-store'})).json();}catch(e){$('#meta').textContent='資料載入失敗';return;}
try{V=await (await fetch('data/verdict.json',{cache:'no-store'})).json();}catch(e){}
const S=D.series;
const ld=s=>s&&s.latest_date?(s.freq==='A'?s.latest_date.slice(0,4):s.freq==='Q'?qlab(s.latest_date.slice(0,7)):s.latest_date.slice(0,7)):'—';
function qlab(ym){const [y,m]=ym.split('-').map(Number);return `${y} Q${Math.floor((m-1)/3)+1}`;}
$('#meta').innerHTML=`<span class="long">資料更新：</span>${esc(D.generated.slice(0,10))}<span class="long"> ${esc(D.generated.slice(11))}（台北時間）</span>`;

// KPI
function kpi(sid,mode,extra){
  const s=S[sid]; if(!s||!s.ok) return `<div class="card kpi"><div class="k-name">${esc(sid)}</div><div class="k-val">—</div><div class="k-sub">官方尚未發布或無數據</div></div>`;
  const v=mode==='yoy'?s.latest_yoy:s.latest, st=mode==='yoy'?s.stats_yoy:s.stats_level;
  const pos=st?st.percentile:null;
  return `<div class="card kpi"><div class="k-name">${esc(s.name)}${mode==='yoy'?' 年增率':''}</div>
  <div class="k-val">${mode==='yoy'?sg(v):fmt(v,sid==='DRCCLACBS'?2:1)}%</div>
  <div class="k-sub">${ld(s)}｜<code>${sid}</code>${st?`｜10 年分位 ${fmt(pos,0)}%`:''}</div>
  ${st?`<div class="bar" title="10 年最小 ${fmt(st.min,2)}／中位 ${fmt(st.median,2)}／最大 ${fmt(st.max,2)}"><i style="left:calc(${pos}% - 1px)"></i></div><div class="k-sub">10 年區間 ${fmt(st.min,1)}～${fmt(st.max,1)}，中位 ${fmt(st.median,1)}</div>`:''}
  <span class="tag">${esc(extra)}</span></div>`;
}
$('#kpis').innerHTML=kpi('DSPIC96','yoy','稅後｜含補助｜已扣通膨')+kpi('PSAVERT','level',(S.PSAVERT&&S.PSAVERT.latest<5)?'低於 5%：緩衝偏薄':'低於 5% 代表緩衝偏薄')+kpi('WFRBST01134','level','每季｜資產減負債')+kpi('DRCCLACBS','level','底層壓力領先指標');

// 判讀
const stCls={'正向':'s-ok','中性警戒':'s-watch','壓力升溫':'s-off'};
if(V){
  const m=V._meta||{};
  $('#verdict').innerHTML=`<h2>本期 AI 綜合判讀</h2>
  <p class="verdict-head">${esc(V.headline)}</p><p class="lead">${esc(V.executive_summary)}</p>
  <div class="vcards">${(V.cards||[]).map(c=>`<div class="card vcard"><h3>${esc(c.title)}</h3><span class="status ${stCls[c.status]||'s-watch'}">${esc(c.status)}</span><p>${esc(c.analysis)}</p></div>`).join('')}</div>
  <div class="card hsv"><h3>HS 3924 專項判讀</h3><p><b>材質替代：</b>${esc(V.hs3924_verdict?.summary)}</p><p><b>給製造商的啟示：</b>${esc(V.hs3924_verdict?.strategic_implication)}</p></div>
  <p class="small">判讀產生：${esc(m.generated)}（台北時間）｜${esc(m.engine)}｜輸入只含本站計算摘要；文中數字已逐一比對輸入，${(m.validation_flags||[]).length?`有 ${(m.validation_flags||[]).length} 句因數字無法對上已刪除`:'全部可對上'}。AI 判讀僅供參考。</p>`;
}else $('#verdict').innerHTML='<h2>本期 AI 綜合判讀</h2><p class="lead">本期判讀尚未產生。</p>';

// 圖表
Chart.defaults.font.family=getComputedStyle(document.body).fontFamily;
Chart.defaults.font.size=12;Chart.defaults.color='#54483D';
const charts={};
function makeRefs(labels, refs, seriesForMedian){
  const out=[];
  for(const it of refs||[]){
    let v=it.at;
    if(it.at==='median-level') v=seriesForMedian?.stats_level?.median;
    if(it.at==='median-yoy') v=seriesForMedian?.stats_yoy?.median;
    if(v==null || Number.isNaN(v)) continue;
    out.push({label:it.label||`10 年中位數（${fmt(v,it.dec??1)}）`, data:labels.map(()=>v), color:it.color||'#7A6F64', dash:[6,4], width:1.5, pointRadius:0, fill:false});
  }
  return out;
}
function chart(el,def){
  const id='c'+Math.random().toString(36).slice(2,8);
  el.insertAdjacentHTML('beforeend',`<div class="card chart"><h3>${esc(def.title)}</h3><p class="sub">${esc(def.sub)}</p>
   ${def.labels?`<div class="labels">${def.labels.map(l=>`<span class="tag">${esc(l)}</span>`).join('')}</div>`:''}
   <div class="cv ${def.short?'short':''}"><canvas id="${id}"></canvas></div><div class="cap">${def.cap}</div></div>`);
  const labels=def.labels_x;
  const all=[...def.ds, ...makeRefs(labels, def.refs, def.refSeries)];
  charts[id]={el:document.getElementById(id),cfg:{type:def.type||'line',data:{labels,datasets:all.map((d,i)=>({label:d.label,data:d.data,borderColor:d.color||C[i],backgroundColor:d.fill===false?'transparent':(def.fill?(d.color||C[i])+'22':(d.color||C[i])),fill:d.fill!=null?d.fill:!!def.fill,borderWidth:d.width||2,borderDash:d.dash||[],pointRadius:d.pointRadius!=null?d.pointRadius:(def.points?3:0),pointHoverRadius:d.pointRadius===0?0:4,spanGaps:false,tension:0}))},
   options:{responsive:true,maintainAspectRatio:false,animation:false,interaction:{mode:'index',intersect:false},
    plugins:{legend:{display:all.length>1,position:'bottom',labels:{boxWidth:12,boxHeight:2}},tooltip:{callbacks:{label:c=>`${c.dataset.label}：${c.parsed.y==null?'官方無發布':fmt(c.parsed.y,def.dec??1)}${def.unit||''}`}}},
    scales:{x:{grid:{display:false},ticks:{maxTicksLimit:8,maxRotation:0,autoSkip:true}},y:{grid:{color:'#ECEEF1'},border:{display:false},ticks:{callback:v=>fmt(v,def.ydec??1)+(def.unit||'')}}}}}};
}
function align(list,key){ // 合併多序列日期軸，缺值為 null
  const ds=[...new Set(list.flatMap(s=>s.dates))].sort();
  return {x:ds,data:list.map(s=>{const m=Object.fromEntries(s.dates.map((d,i)=>[d,s[key][i]]));return ds.map(d=>m[d]??null);})};
}
const ok=id=>S[id]&&S[id].ok;
function yoyChart(el,ids,title,cap,extra={}){
  const L=ids.filter(ok).map(i=>S[i]); if(!L.length) return;
  const a=align(L,'yoy'); const fq=L[0].freq;
  const {refs,refSeries,...rest}=extra;
  chart(el,Object.assign({title,sub:'年增率（與前一年同期精確對齊）｜單位：%',unit:'%',labels_x:fq==='Q'?a.x.map(qlab):a.x,ds:L.map((s,i)=>({label:`${s.name}（${s.id}）`,data:a.data[i]})),
   refs, refSeries:refSeries||L[0],
   cap:`來源：FRED ${ids.join('、')}；最新 ${L.map(s=>s.id+' '+ld(s)).join('、')}。去年同期缺值時年增率留白。${cap||''}`},rest));
}
function levelChart(el,ids,title,unit,cap,extra={}){
  const L=ids.filter(ok).map(i=>S[i]); if(!L.length) return;
  const a=align(L,'values'); const fq=L[0].freq;
  const {refs,refSeries,...rest}=extra;
  chart(el,Object.assign({title,sub:`原值｜單位：${L[0].unit}`,unit:unit,labels_x:fq==='Q'?a.x.map(qlab):a.x,ds:L.map((s,i)=>({label:`${s.name}（${s.id}）`,data:a.data[i]})),
   refs, refSeries:refSeries||L[0],
   cap:`來源：FRED ${ids.join('、')}；最新 ${L.map(s=>s.id+' '+ld(s)).join('、')}。${cap||''}`},rest));
}
const lab=id=>ok(id)?[S[id].label]:[];
const t1=$('#t1'),t2=$('#t2'),t3=$('#t3'),t4=$('#t4'),t5=$('#t5');
const med={at:'median-level'};
// 分頁 1：原值為主，年增率下置
levelChart(t1,['DSPIC96'],'圖 1　實質可支配所得（總額）','','2020–2021 年的高峰來自疫情補助金，屬暫時性拉抬，不是常態所得水準。虛線為近 10 年中位數。',{labels:lab('DSPIC96'),refs:[med],ydec:0,dec:1});
levelChart(t1,['A229RX0'],'圖 1 附　實質可支配所得（人均）','','與總額相同口徑（稅後、含補助、已扣通膨、不含資本利得），改以每人計算，避免人口成長把總額墊高。虛線為近 10 年中位數。',{labels:lab('A229RX0'),refs:[med],ydec:0,dec:0});
yoyChart(t1,['DSPIC96','A229RX0'],'圖 1 年增率　總額與人均','',{labels:lab('DSPIC96')});
levelChart(t1,['PSAVERT'],'圖 1b　個人儲蓄率','%','低於 5% 代表家庭財務緩衝偏薄。橙虛線為 5% 門檻，灰虛線為近 10 年中位數。',{labels:lab('PSAVERT'),refs:[{at:5,label:'5% 緩衝門檻',color:'#B37510'},med]});
levelChart(t1,['MEHOINUSA672N'],'圖 2　實質家庭中位數所得（年）','','每年 9 月更新一次。此圖本身即為原值（稅前、僅含現金補助、已扣通膨）。',{labels:lab('MEHOINUSA672N'),fill:true,points:true,dec:0,ydec:0});
// 分頁 2
t2.innerHTML='<div class="grid2" id="t2g"></div>';
levelChart($('#t2g'),['WFRBST01134'],'圖 3a　頂層 1% 淨財富佔比','%','淨財富＝總資產－總負債；不含社會安全金未來領取權與人力資本。虛線為近 10 年中位數。',{labels:lab('WFRBST01134'),short:true,refs:[med]});
levelChart($('#t2g'),['WFRBSB50215'],'圖 3b　底層 50% 淨財富佔比','%','同上口徑。虛線為近 10 年中位數。',{labels:lab('WFRBSB50215'),short:true,refs:[med]});
levelChart(t2,['DRCCLACBS'],'圖 4　商業銀行信用卡違約率（季）','%','逾期 30 天以上，季調。虛線為近 10 年中位數。',{labels:lab('DRCCLACBS'),dec:2,refs:[med]});
// 分頁 3：通膨以年增率為主（這才是通膨率），原值指數另圖；尺度不同故 PCE 與居住 CPI 分圖
yoyChart(t3,['PCEPI','PCEPILFE','CUSR0000SAH1'],'圖 5　整體 PCE、核心 PCE 與居住 CPI 年增率','橙虛線為聯準會長期通膨目標 2%。居住 CPI 的 2025-10 官方未發布，故 2026-10 年增率留白。',{labels:['PCE：聯準會基準','核心：剔除食品與能源','居住 CPI：房租等剛性成本'],refs:[{at:2,label:'聯準會 2% 目標',color:'#B37510'}]});
t3.insertAdjacentHTML('beforeend','<div class="grid2" id="t3g"></div>');
levelChart($('#t3g'),['PCEPI','PCEPILFE'],'圖 5 附　PCE 與核心 PCE 物價指數（原值）','','指數會隨時間上升；看漲幅請回上圖。兩序列尺度接近，可同軸。',{short:true,dec:1});
levelChart($('#t3g'),['CUSR0000SAH1'],'圖 5 附　居住類 CPI 指數（原值）','','2025-10 官方未發布，圖上斷開。尺度與 PCE 不同，故獨立成圖。',{short:true,dec:1,ydec:0});
// 分頁 4：消費量原值為主（三者尺度差大，分圖），年增率同軸對比
t4.insertAdjacentHTML('beforeend','<p class="note">耐久財、非耐久財、服務的絕對水準差很大，原值分三張圖、不共用軸；年增率單位相同，仍放在同一張對比。</p><div class="grid3" id="t4lv"></div>');
levelChart($('#t4lv'),['PCEDGC96'],'圖 6a　實質耐久財消費（原值）','','已扣通膨｜汽車、家電、家具。',{short:true,ydec:0,dec:1,labels:lab('PCEDGC96')});
levelChart($('#t4lv'),['PCENDC96'],'圖 6b　實質非耐久財消費（原值）','','已扣通膨｜食品、汽油、日用品。',{short:true,ydec:0,dec:1,labels:lab('PCENDC96')});
levelChart($('#t4lv'),['PCESC96'],'圖 6c　實質服務消費（原值）','','已扣通膨｜醫療、餐旅、金融。',{short:true,ydec:0,dec:1,labels:lab('PCESC96')});
yoyChart(t4,['PCEDGC96','PCENDC96','PCESC96'],'圖 6　實質耐久財、非耐久財、服務消費年增率','',{labels:['皆已扣通膨（2017 連鎖美元）']});
const dr=D.derived;
t4.insertAdjacentHTML('beforeend','<div class="grid2" id="t4g"></div>');
chart($('#t4g'),{title:'圖 6e　耐久財減非耐久財 年增率差',sub:'百分點｜負值擴大＝推遲高單價決策',unit:' 個百分點',labels_x:dr.durable_minus_nondurable_yoy.dates,ds:[{label:'增速差',data:dr.durable_minus_nondurable_yoy.values,color:C[4]}],refs:[{at:0,label:'零線',color:'#7A6F64'}],short:true,
 cap:`計算：YoY(PCEDGC96) − YoY(PCENDC96)。最新 ${esc(dr.durable_minus_nondurable_yoy.latest?.date)}。`});
chart($('#t4g'),{title:'圖 7a　外食 ÷ 超市零售比',sub:'倍數｜上升＝願意花錢買便利，下降＝回歸自煮',unit:'',dec:3,ydec:2,labels_x:dr.dining_grocery_ratio.dates,ds:[{label:'外食÷超市',data:dr.dining_grocery_ratio.values,color:C[0]}],
 refs:[{at:dr.dining_grocery_ratio.stats?.median,label:`10 年中位數（${fmt(dr.dining_grocery_ratio.stats?.median,2)}）`}],short:true,
 cap:`計算：MRTSSM722USS ÷ RSGCS（皆名目、季調）。最新 ${esc(dr.dining_grocery_ratio.latest?.date)}。`});
levelChart($('#t4g'),['ECOMPCTSA'],'圖 7b　電商佔總零售比例（季）','%','原規格與圖 7a 共用雙軸，依設計規範拆開。虛線為近 10 年中位數。',{short:true,refs:[med]});
levelChart($('#t4g'),['DFSARX1Q020SBEA'],'補充　實質餐飲與住宿服務（原值，季）','','已扣通膨｜體驗經濟溫度計。',{short:true,ydec:0,dec:1,labels:lab('DFSARX1Q020SBEA')});
yoyChart($('#t4g'),['DFSARX1Q020SBEA'],'補充　實質餐飲與住宿服務年增率（季）','',{short:true});
levelChart(t4,['RSGCS','MRTSSM722USS','MRTSSM452USS'],'補充　通路零售額（名目原值）','','名目金額未扣通膨；三序列單位同為百萬美元，可同軸。',{labels:['名目｜季調'],ydec:0,dec:0});
yoyChart(t4,['RSGCS','MRTSSM722USS','MRTSSM452USS'],'補充　通路零售額年增率（名目）','名目金額未扣通膨。',{labels:['名目｜季調']});

// 分頁 5
const H=D.hs;
t5.innerHTML=`<div class="warn"><b>⚠ 口徑提醒：</b>以下為美國海關進口資料，<b>不包含美國本土射出廠（如 Sterilite、Rubbermaid）在當地生產內銷的份額</b>；HS 歸類也混有非容器類廚具，只適合看長期趨勢與相對份額。金額為名目美元。</div>`;
const sh=H.items;
chart(t5,{title:'圖 8　塑膠、玻璃、不鏽鋼 12 個月滾動進口相對份額',sub:'三者合計＝100%｜單位：%｜12 個月內任一月缺值則該點留白',unit:'%',labels_x:H.dates,ds:sh.map((i,k)=>({label:`${i.material}（${i.code}）`,data:i.share,color:C[k]})),
 labels:['名目美元','僅美國進口端'],cap:`來源：${esc(H.source)}。最新 ${esc(sh[0].latest_share?.date)}。`});
t5.insertAdjacentHTML('beforeend','<div class="grid2" id="t5g"></div>');
chart($('#t5g'),{title:'補充　12 個月滾動進口額',sub:'單位：百萬美元（名目）',unit:'',dec:0,ydec:0,labels_x:H.dates,ds:sh.map((i,k)=>({label:`${i.material}（${i.code}）`,data:i.rolling12_musd,color:C[k]})),short:true,cap:'同上來源；用於看份額變化是總額縮小還是材質轉移。'});
chart($('#t5g'),{title:'補充　單月進口額',sub:'單位：百萬美元（名目）',unit:'',dec:1,ydec:0,labels_x:H.dates,ds:sh.map((i,k)=>({label:`${i.material}（${i.code}）`,data:i.monthly,color:C[k]})),short:true,cap:'含季節性，判讀請以 12 個月滾動為準。'});
t5.insertAdjacentHTML('beforeend',`<div class="note"><b>HTS 3924.10.4000（最貼近非一次性乾式食品容器）：</b>${esc(H.hs10_3924104000)}</div><div class="grid2" id="t5h"></div>`);
levelChart($('#t5h'),['DUTERX1A020NBEA'],'圖 9a　餐廚與玻璃器皿：實質消費量（年）','','已扣通膨；看真實需求量。',{points:true,short:true,dec:2});
levelChart($('#t5h'),['DUTERG3A086NBEA'],'圖 9b　餐廚與玻璃器皿：物價指數（年）','','2017=100；下跌代表通縮促銷。量升價跌＝價格戰，量價齊跌＝需求萎縮。',{points:true,short:true,dec:2});

// 方法論
const vnotes=(V&&V.methodology_notes)||[];
const res=r=>r.startsWith('相符')?'r-ok':r.startsWith('不符')?'r-bad':'r-na';
const rows=Object.values(S).map(s=>`<tr><td><code>${esc(s.id)}</code></td><td>${esc(s.name)}</td><td>${esc(s.label||'')}</td><td>${s.ok?ld(s):'—'}</td><td>${s.ok&&s.missing.length?esc(s.missing.slice(-4).join('、'))+(s.missing.length>4?' 等':''):'無'}</td><td>${esc(s.status)}</td></tr>`).join('');
$('#method').innerHTML=`<h2>方法論與口徑備忘</h2>
${vnotes.length?`<h3>本期 AI 標記</h3><ul class="notes">${vnotes.map(n=>`<li>${esc(n)}</li>`).join('')}</ul>`:''}
<h3>口徑對照</h3><div class="tbl"><table><tr><th>指標</th><th>扣稅</th><th>含政府補助</th><th>扣通膨</th><th>盲點</th></tr>
<tr><td>實質可支配個人所得 <code>DSPIC96</code></td><td>是（稅後）</td><td>是（全含）</td><td>是（PCE 平減）</td><td>不含資本利得；全美平均，看不出貧富差距</td></tr>
<tr><td>實質家庭中位數所得 <code>MEHOINUSA672N</code></td><td>否（稅前）</td><td>僅現金補助</td><td>是（CPI 調整）</td><td>不含 SNAP、Medicaid 等非現金福利；每年 9 月更新</td></tr>
<tr><td>淨財富佔比 <code>WFRBST01134</code>／<code>WFRBSB50215</code></td><td>不適用</td><td>不適用</td><td>名目佔比</td><td>淨財富＝資產－負債；不含社會安全金未來領取權與人力資本</td></tr>
<tr><td>海關進口 HS 392410／701349／732393</td><td>不適用</td><td>不適用</td><td>否（名目）</td><td>不含美國本土生產內銷；HS 混有非容器類廚具</td></tr></table></div>
<h3>計算規則</h3><ul class="notes"><li>年增率以實際日期往前推剛好一年對齊；去年同期缺值即留白，不用位移 12 期。</li><li>10 年分位數＝近 10 年有效值中小於等於最新值的比例。</li><li>官方未發布的月份在圖上斷開，不內插、不補值。</li><li>12 個月滾動需 12 個月全部有值才計算。</li></ul>
<h3>交接文件基準數字 vs 官方重算</h3><div class="tbl"><table><tr><th>項目</th><th>序列</th><th>文件值</th><th>官方重算</th><th>結果</th></tr>
${D.checks.map(c=>`<tr><td>${esc(c.claim)}</td><td><code>${esc(c.series)}</code></td><td>${esc(c.spec)}</td><td>${esc(c.official)}</td><td class="${res(c.result)}">${esc(c.result)}</td></tr>`).join('')}</table></div>
<h3>資料序列狀態</h3><div class="tbl"><table><tr><th>代碼</th><th>名稱</th><th>口徑</th><th>最新</th><th>近 10 年缺漏（最近）</th><th>抓取</th></tr>${rows}</table></div>`;

// 分頁與延遲繪圖
const drawn=new Set();
function draw(panel){panel.querySelectorAll('canvas').forEach(c=>{if(!drawn.has(c.id)){drawn.add(c.id);new Chart(c,charts[c.id].cfg);}});}
document.querySelectorAll('#tabs button').forEach(b=>b.onclick=()=>{
  document.querySelectorAll('#tabs button').forEach(x=>x.setAttribute('aria-selected',x===b));
  document.querySelectorAll('.panel').forEach(p=>p.hidden=p.id!==b.dataset.tab);
  draw(document.getElementById(b.dataset.tab)); history.replaceState(null,'','#'+b.dataset.tab);
});
const h=location.hash.slice(1); (document.querySelector(`#tabs button[data-tab="${h}"]`)||document.querySelector('#tabs button')).click();
})();
