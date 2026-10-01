(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  else root.AddressCore=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const OUTPUT_COLUMNS=[
    '仕事番号','仕事名',
    '郵便番号（ハイフン）','郵便番号1',
    '町域未指定郵便番号（ハイフン）','町域未指定郵便番号1',
    '全住所','都道府県','市区町村','町域','町域以降',
    '県コード1','市区町村コード1','PrefCityコード','標準地域コード',
    '補完判定','補完項目','確認メモ'
  ];
  const INPUT_COLUMNS=OUTPUT_COLUMNS.filter(x=>![
    '補完判定','補完項目','確認メモ',
    '町域未指定郵便番号（ハイフン）','町域未指定郵便番号1'
  ].includes(x));

  function clean(v){
    if(v===null||v===undefined)return '';
    if(typeof v==='object'&&v.text!==undefined)v=v.text;
    return String(v).trim();
  }
  function norm(s){return clean(s).normalize('NFKC').replace(/[‐‑‒–—―ー−ｰ]/g,'-').replace(/[\s　]+/g,'');}
  function normZip(s){
    let x=norm(s).replace(/^〒/,'').replace(/[^0-9]/g,'');
    if(!x)return '';
    return x.length<=7?x.padStart(7,'0'):x.slice(0,7);
  }
  function hyphenZip(z){z=normZip(z);return z.length===7?z.slice(0,3)+'-'+z.slice(3):'';}
  function prefCodeNum(s){const n=parseInt(norm(s),10);return Number.isFinite(n)&&n>=1&&n<=47?String(n):'';}
  function cityCode3(s){
    let x=norm(s).replace(/\D/g,'');
    if(!x)return '';
    if(x.length>3)x=x.slice(-3);
    return x.padStart(3,'0');
  }
  function stdCode(s){
    let x=norm(s).replace(/\D/g,'');
    if(!x)return '';
    return x.padStart(5,'0').slice(-5);
  }
  function addMapList(map,key,val){if(!map.has(key))map.set(key,[]);map.get(key).push(val);}
  function unique(arr){return [...new Set(arr.filter(Boolean))];}

  function createAddressEngine(muniMaster,zipRows){
    if(!muniMaster||!zipRows)throw new Error('master data is required');

    const muniByStd=new Map(),muniByName=new Map(),muniByPrefAndName=new Map(),prefNameToCode=new Map();
    const zipByZip=new Map(),zipByStd=new Map(),unspecifiedByStd=new Map();
    const prefs=muniMaster.prefectures||{};

    Object.entries(prefs).forEach(([code,name])=>prefNameToCode.set(norm(name),code));
    Object.entries(muniMaster.municipalities||{}).forEach(([std,name])=>{
      std=stdCode(std);
      const p2=std.slice(0,2),pNum=String(parseInt(p2,10)),c3=std.slice(-3);
      const rec={std,prefCode:pNum,prefCode2:p2,cityCode:c3,prefCity:String(parseInt(std,10)),prefName:prefs[p2]||'',cityName:name};
      muniByStd.set(std,rec);
      addMapList(muniByName,norm(name),rec);
      muniByPrefAndName.set(norm(rec.prefName)+'|'+norm(name),rec);
    });
    zipRows.forEach(r=>{
      const pref2=String(parseInt(r.pref,10)).padStart(2,'0');
      const city3=String(r.city).slice(-3).padStart(3,'0');
      const std=pref2+city3;
      const rec={std,zip:normZip(r.zip),address:clean(r.address),addressN:norm(r.address)};
      addMapList(zipByZip,rec.zip,rec);
      addMapList(zipByStd,std,rec);
      if(!rec.addressN)addMapList(unspecifiedByStd,std,rec.zip);
    });
    for(const arr of zipByStd.values())arr.sort((a,b)=>b.addressN.length-a.addressN.length);

    const prefEntries=[...prefNameToCode.entries()].sort((a,b)=>b[0].length-a[0].length);
    const muniList=[...muniByStd.values()];

    function municipalityFromNames(prefName,cityName){
      const p=norm(prefName),c=norm(cityName);
      if(p&&c)return muniByPrefAndName.get(p+'|'+c)||null;
      if(c){
        const arr=muniByName.get(c)||[];
        if(arr.length===1)return arr[0];
      }
      return null;
    }

    function municipalityFromCodes(row){
      const candidates=[];
      const std=stdCode(row['標準地域コード']);
      if(std&&muniByStd.has(std))candidates.push({src:'標準地域コード',rec:muniByStd.get(std)});
      const pcRaw=norm(row['PrefCityコード']).replace(/\D/g,'');
      if(pcRaw){
        const pcStd=pcRaw.padStart(5,'0');
        if(muniByStd.has(pcStd))candidates.push({src:'PrefCityコード',rec:muniByStd.get(pcStd)});
      }
      const p=prefCodeNum(row['県コード1']),c=cityCode3(row['市区町村コード1']);
      if(p&&c){
        const x=String(parseInt(p,10)).padStart(2,'0')+c;
        if(muniByStd.has(x))candidates.push({src:'県コード1＋市区町村コード1',rec:muniByStd.get(x)});
      }
      return candidates;
    }

    function findTown(std,tail){
      const t=norm(tail);if(!t)return null;
      const arr=(zipByStd.get(std)||[]).filter(x=>x.addressN);
      const matched=arr.filter(x=>t.startsWith(x.addressN));
      if(!matched.length)return null;
      const maxLen=Math.max(...matched.map(x=>x.addressN.length));
      const top=matched.filter(x=>x.addressN.length===maxLen);
      const towns=unique(top.map(x=>x.address)),zips=unique(top.map(x=>x.zip));
      return {town:towns.length===1?towns[0]:'',zip:zips.length===1?zips[0]:'',ambiguous:towns.length>1||zips.length>1};
    }

    function parseFullAddress(full){
      const s=norm(full);
      if(!s)return null;
      let prefName='',prefCode2='',after=s;
      for(const [pn,pc] of prefEntries){
        if(s.startsWith(pn)){prefName=pn;prefCode2=pc;after=s.slice(pn.length);break;}
      }
      let candidates=[];
      if(prefName){
        candidates=muniList.filter(rec=>rec.prefCode2===prefCode2&&after.startsWith(norm(rec.cityName)));
      }else{
        candidates=muniList.filter(rec=>s.startsWith(norm(rec.cityName)));
      }
      if(!candidates.length)return prefName?{prefName,muni:null,tail:after,town:''}:null;
      candidates.sort((a,b)=>norm(b.cityName).length-norm(a.cityName).length);
      const muni=candidates[0];
      const head=(prefName?norm(muni.prefName):'')+norm(muni.cityName);
      const tail=s.slice(head.length);
      const townMatch=findTown(muni.std,tail);
      return {prefName:muni.prefName,muni,tail,town:townMatch?.town||'',zip:townMatch?.zip||'',ambiguousTown:townMatch?.ambiguous||false};
    }

    function parseZipEvidence(row){
      const z1=normZip(row['郵便番号（ハイフン）']),z2=normZip(row['郵便番号1']);
      const vals=unique([z1,z2]);
      return {z1,z2,values:vals,conflict:vals.length>1,zip:vals.length===1?vals[0]:''};
    }
    function postalMunicipalitySet(zip){
      if(!zip)return [];
      return unique((zipByZip.get(zip)||[]).map(x=>x.std)).filter(x=>muniByStd.has(x));
    }
    function postalTownInfo(zip,std){
      if(!zip)return {town:'',ambiguous:false};
      let arr=zipByZip.get(zip)||[];
      if(std)arr=arr.filter(x=>x.std===std);
      const towns=unique(arr.map(x=>x.address).filter(Boolean));
      return {town:towns.length===1?towns[0]:'',ambiguous:towns.length>1};
    }

    function processOne(input){
      const row={};INPUT_COLUMNS.forEach(c=>row[c]=clean(input?.[c]));
      const out={};OUTPUT_COLUMNS.forEach(c=>out[c]='');
      INPUT_COLUMNS.forEach(c=>out[c]=row[c]);

      const filled=new Set(),notes=[],conflicts=[],ambiguous=[],invalid=[];
      const fill=(col,val)=>{
        if(!out[col]&&val!==''&&val!==null&&val!==undefined){
          out[col]=String(val);filled.add(col);
        }
      };

      const zipEv=parseZipEvidence(row);
      if(zipEv.conflict)conflicts.push('郵便番号2列が不一致（'+zipEv.values.join(' / ')+'）');
      if(zipEv.zip && !(zipByZip.get(zipEv.zip)||[]).length){
        invalid.push('郵便番号「'+zipEv.zip+'」が郵便番号マスタに存在しません');
      }

      const rawStd=stdCode(row['標準地域コード']);
      if(row['標準地域コード'] && (!rawStd || !muniByStd.has(rawStd))){
        invalid.push('標準地域コード「'+row['標準地域コード']+'」が自治体マスタに存在しません');
      }
      const rawPc=norm(row['PrefCityコード']).replace(/\D/g,'');
      if(row['PrefCityコード']){
        const pcStd=rawPc.padStart(5,'0');
        if(!rawPc || !muniByStd.has(pcStd)) invalid.push('PrefCityコード「'+row['PrefCityコード']+'」が自治体マスタに存在しません');
      }
      const rawP=prefCodeNum(row['県コード1']), rawC=cityCode3(row['市区町村コード1']);
      if(row['県コード1'] && row['市区町村コード1']){
        const pairStd=rawP&&rawC ? String(parseInt(rawP,10)).padStart(2,'0')+rawC : '';
        if(!pairStd || !muniByStd.has(pairStd)) invalid.push('県コード1＋市区町村コード1が自治体マスタに存在しません');
      }

      const strong=[];
      municipalityFromCodes(row).forEach(x=>strong.push(x));
      const named=municipalityFromNames(row['都道府県'],row['市区町村']);
      if(named)strong.push({src:'都道府県＋市区町村',rec:named});
      else if(row['市区町村']&&!row['都道府県']){
        const arr=muniByName.get(norm(row['市区町村']))||[];
        if(arr.length===1)strong.push({src:'市区町村名（全国一意）',rec:arr[0]});
        else if(arr.length>1)ambiguous.push('市区町村名「'+row['市区町村']+'」が全国で複数候補');
      }

      const fullParsed=parseFullAddress(row['全住所']);
      if(fullParsed?.muni)strong.push({src:'全住所',rec:fullParsed.muni});

      const strongStds=unique(strong.map(x=>x.rec.std));
      let canonical=null;
      if(strongStds.length===1)canonical=muniByStd.get(strongStds[0]);
      else if(strongStds.length>1){
        conflicts.push('自治体情報が不一致（'+strong.map(x=>x.src+':'+x.rec.prefName+x.rec.cityName).join(' / ')+')');
      }

      const postalStds=postalMunicipalitySet(zipEv.zip);
      if(canonical&&postalStds.length&&!postalStds.includes(canonical.std)){
        conflicts.push('郵便番号「'+zipEv.zip+'」と自治体「'+canonical.prefName+canonical.cityName+'」が不一致');
      }
      if(!canonical&&!strongStds.length&&zipEv.zip){
        if(postalStds.length===1)canonical=muniByStd.get(postalStds[0]);
        else if(postalStds.length>1)ambiguous.push('郵便番号「'+zipEv.zip+'」が複数自治体に対応');
      }

      if(canonical){
        fill('都道府県',canonical.prefName);
        fill('市区町村',canonical.cityName);
        fill('県コード1',canonical.prefCode);
        fill('市区町村コード1',canonical.cityCode);
        fill('PrefCityコード',canonical.prefCity);
        fill('標準地域コード',canonical.std);
        const uz=unique(unspecifiedByStd.get(canonical.std)||[]);
        if(uz.length===1){
          fill('町域未指定郵便番号1',uz[0]);
          fill('町域未指定郵便番号（ハイフン）',hyphenZip(uz[0]));
        }else if(uz.length>1)ambiguous.push('町域未指定郵便番号が複数候補');
      }

      let town='',resolvedZip='';
      if(fullParsed?.muni&&canonical&&fullParsed.muni.std===canonical.std){
        if(fullParsed.tail)fill('町域以降',fullParsed.tail);
        if(fullParsed.town)town=fullParsed.town;
        if(fullParsed.zip)resolvedZip=fullParsed.zip;
        if(fullParsed.ambiguousTown)ambiguous.push('全住所からの町域・郵便番号候補が複数');
      }

      if(row['町域'])town=row['町域'];

      if(canonical&&row['町域以降']){
        const tm=findTown(canonical.std,row['町域以降']);
        if(tm){
          if(!town)town=tm.town;
          if(tm.zip)resolvedZip=tm.zip;
          if(tm.ambiguous)ambiguous.push('町域以降からの郵便番号候補が複数');
        }
      }

      if(canonical&&row['町域']){
        const target=norm(row['町域']);
        const matches=(zipByStd.get(canonical.std)||[]).filter(x=>x.addressN===target);
        const zips=unique(matches.map(x=>x.zip));
        if(zips.length===1)resolvedZip=resolvedZip||zips[0];
        else if(zips.length>1)ambiguous.push('町域「'+row['町域']+'」に対応する郵便番号が複数');
      }

      if(zipEv.zip&&canonical){
        const pti=postalTownInfo(zipEv.zip,canonical.std);
        if(!town&&pti.town)town=pti.town;
        if(pti.ambiguous)ambiguous.push('郵便番号「'+zipEv.zip+'」に対応する町域が複数');
        if(row['町域']&&pti.town&&norm(row['町域'])!==norm(pti.town)){
          conflicts.push('入力郵便番号「'+zipEv.zip+'」と入力町域「'+row['町域']+'」が不一致');
        }
      }
      fill('町域',town);

      if(!out['全住所']&&canonical&&out['町域以降'])fill('全住所',canonical.prefName+canonical.cityName+out['町域以降']);

      if(resolvedZip&&zipEv.zip&&resolvedZip!==zipEv.zip){
        conflicts.push('入力郵便番号「'+zipEv.zip+'」と住所から判定した郵便番号「'+resolvedZip+'」が不一致');
      }
      const normalZip=zipEv.conflict?'':(zipEv.zip||resolvedZip);
      if(normalZip){
        fill('郵便番号1',normalZip);
        fill('郵便番号（ハイフン）',hyphenZip(normalZip));
      }

      if(out['郵便番号1'])out['郵便番号1']=normZip(out['郵便番号1']);
      if(out['郵便番号（ハイフン）'])out['郵便番号（ハイフン）']=hyphenZip(out['郵便番号（ハイフン）']);
      if(out['県コード1'])out['県コード1']=prefCodeNum(out['県コード1'])||out['県コード1'];
      if(out['市区町村コード1'])out['市区町村コード1']=cityCode3(out['市区町村コード1'])||out['市区町村コード1'];
      if(out['標準地域コード'])out['標準地域コード']=stdCode(out['標準地域コード'])||out['標準地域コード'];
      if(out['PrefCityコード']){
        const n=parseInt(norm(out['PrefCityコード']).replace(/\D/g,''),10);
        if(Number.isFinite(n))out['PrefCityコード']=String(n);
      }

      if(conflicts.length){
        out['補完判定']='要確認（不一致）';notes.push(...conflicts);
      }else if(ambiguous.length){
        out['補完判定']='要確認（候補複数）';notes.push(...ambiguous);
      }else if(invalid.length){
        out['補完判定']='判定不可';notes.push(...invalid);
      }else if(!canonical&&!normalZip&&!row['全住所']){
        out['補完判定']='判定不可';notes.push('住所・郵便番号・自治体コードから自治体を特定できません');
      }else if(!canonical&&row['全住所']){
        out['補完判定']='判定不可';notes.push('全住所から市区町村を特定できません');
      }else{
        out['補完判定']=filled.size?'補完あり':'OK';
      }

      out['補完項目']=[...filled].join('::');
      out['確認メモ']=notes.join(' / ');
      return {out,filled};
    }

    return {
      processOne,
      processRows:rows=>rows.map(processOne),
      parseFullAddress,
      findTown,
      stats:{municipalities:muniByStd.size,zipRows:zipRows.length},
      maps:{muniByStd,muniByName,zipByZip,zipByStd,unspecifiedByStd}
    };
  }

  return {OUTPUT_COLUMNS,INPUT_COLUMNS,createAddressEngine,clean,norm,normZip,hyphenZip,prefCodeNum,cityCode3,stdCode};
});
