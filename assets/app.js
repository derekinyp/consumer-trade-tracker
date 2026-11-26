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
function chart(el,def){
  const id='c'+Math.random().toString(36).slice(2,8);
  el.insertAdjacentHTML('beforeend',`<div class="card chart"><h3>${esc(def.title)}</h3><p class="sub">${esc(def.sub)}</p>
   ${def.labels?`<div class="labels">${def.labels.map(l=>`<span class="tag">${esc(l)}</span>`).join('')}</div>`:''}
   <div class="cv ${def.short?'short':''}"><canvas id="${id}"></canvas></div><div class="cap">${def.cap}</div></div>`);
  const labels=def.labels_x;
  charts[id]={el:document.getElementById(id),cfg:{type:def.type||'line',data:{labels,datasets:def.ds.map((d,i)=>({label:d.label,data:d.data,borderColor:d.color||C[i],backgroundColor:def.fill?(d.color||C[i])+'22':(d.color||C[i]),fill:!!def.fill,borderWidth:2,pointRadius:def.points?3:0,pointHoverRadius:4,spanGaps:false,tension:0}))},
   options:{responsive:true,maintainAspectRatio:false,animation:false,interaction:{mode:'index',intersect:false},
    plugins:{legend:{display:def.ds.length>1,position:'bottom',labels:{boxWidth:12,boxHeight:2}},tooltip:{callbacks:{label:c=>`${c.dataset.label}：${c.parsed.y==null?'官方無發布':fmt(c.parsed.y,def.dec??1)}${def.unit||''}`}}},
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
  chart(el,Object.assign({title,sub:'年增率（與前一年同期精確對齊）｜單位：%',unit:'%',labels_x:fq==='Q'?a.x.map(qlab):a.x,ds:L.map((s,i)=>({label:`${s.name}（${s.id}）`,data:a.data[i]})),
   cap:`來源：FRED ${ids.join('、')}；最新 ${L.map(s=>s.id+' '+ld(s)).join('、')}。去年同期缺值時年增率留白。${cap||''}`},extra));
}
function levelChart(el,ids,title,unit,cap,extra={}){
  const L=ids.filter(ok).map(i=>S[i]); if(!L.length) return;
  const a=align(L,'values'); const fq=L[0].freq;
  chart(el,Object.assign({title,sub:`原值｜單位：${L[0].unit}`,unit:unit,labels_x:fq==='Q'?a.x.map(qlab):a.x,ds:L.map((s,i)=>({label:`${s.name}（${s.id}）`,data:a.data[i]})),
   cap:`來源：FRED ${ids.join('、')}；最新 ${L.map(s=>s.id+' '+ld(s)).join('、')}。${cap||''}`},extra));
}
const lab=id=>ok(id)?[S[id].label]:[];
const t1=$('#t1'),t2=$('#t2'),t3=$('#t3'),t4=$('#t4'),t5=$('#t5');
// 分頁 1
t1.innerHTML='<div class="note">圖 1 原為雙軸，依設計規範拆成上下兩張、時間軸對齊。</div><div class="grid2" id="t1g"></div>';
yoyChart($('#t1g'),['DSPIC96'],'圖 1a　實質可支配所得年增率','',{labels:lab('DSPIC96'),short:true});
levelChart($('#t1g'),['PSAVERT'],'圖 1b　個人儲蓄率','%','低於 5% 代表家庭財務緩衝偏薄。',{labels:lab('PSAVERT'),short:true});
levelChart(t1,['MEHOINUSA672N'],'圖 2　實質家庭中位數所得（年）','','每年 9 月更新一次。',{labels:lab('MEHOINUSA672N'),fill:true,points:true,dec:0,ydec:0});
// 分頁 2
t2.innerHTML='<div class="grid2" id="t2g"></div>';
levelChart($('#t2g'),['WFRBST01134'],'圖 3a　頂層 1% 淨財富佔比','%','淨財富＝總資產－總負債；不含社會安全金未來領取權與人力資本。',{labels:lab('WFRBST01134'),short:true});
levelChart($('#t2g'),['WFRBSB50215'],'圖 3b　底層 50% 淨財富佔比','%','同上口徑。',{labels:lab('WFRBSB50215'),short:true});
levelChart(t2,['DRCCLACBS'],'圖 4　商業銀行信用卡違約率（季）','%','逾期 30 天以上，季調。',{labels:lab('DRCCLACBS'),dec:2});
// 分頁 3
yoyChart(t3,['PCEPI','PCEPILFE','CUSR0000SAH1'],'圖 5　整體 PCE、核心 PCE 與居住 CPI 年增率','',{labels:['PCE：聯準會基準','核心：剔除食品與能源','居住 CPI：房租等剛性成本']});
// 分頁 4
yoyChart(t4,['PCEDGC96','PCENDC96','PCESC96'],'圖 6　實質耐久財、非耐久財、服務消費年增率','',{labels:['皆已扣通膨（2017 連鎖美元）']});
const dr=D.derived;
t4.insertAdjacentHTML('beforeend','<div class="grid2" id="t4g"></div>');
chart($('#t4g'),{title:'圖 6b　耐久財減非耐久財 年增率差',sub:'百分點｜負值擴大＝推遲高單價決策',unit:' 個百分點',labels_x:dr.durable_minus_nondurable_yoy.dates,ds:[{label:'增速差',data:dr.durable_minus_nondurable_yoy.values,color:C[4]}],short:true,
 cap:`計算：YoY(PCEDGC96) − YoY(PCENDC96)。最新 ${esc(dr.durable_minus_nondurable_yoy.latest?.date)}。`});
chart($('#t4g'),{title:'圖 7a　外食 ÷ 超市零售比',sub:'倍數｜上升＝願意花錢買便利，下降＝回歸自煮',unit:'',dec:3,ydec:2,labels_x:dr.dining_grocery_ratio.dates,ds:[{label:'外食÷超市',data:dr.dining_grocery_ratio.values,color:C[0]}],short:true,
 cap:`計算：MRTSSM722USS ÷ RSGCS（皆名目、季調）。最新 ${esc(dr.dining_grocery_ratio.latest?.date)}。`});
levelChart($('#t4g'),['ECOMPCTSA'],'圖 7b　電商佔總零售比例（季）','%','原規格與圖 7a 共用雙軸，依設計規範拆開。',{short:true});
yoyChart($('#t4g'),['DFSARX1Q020SBEA'],'補充　實質餐飲與住宿服務年增率（季）','',{short:true});
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
