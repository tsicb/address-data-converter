const assert = require('node:assert/strict');
const { createAddressEngine, normZip, hyphenZip } = require('../address-core.js');

const MUNICIPALITY_URL='https://raw.githubusercontent.com/tsicb/address-master/main/municipality_master.json';
const ZIP_URL='https://raw.githubusercontent.com/tsicb/address-master/main/zipcode_master.json';

async function getJson(url){
  const r=await fetch(url);
  if(!r.ok) throw new Error(`fetch failed: ${r.status} ${url}`);
  return r.json();
}

function checkOutput(actual, expected, label){
  for(const [key,val] of Object.entries(expected)){
    assert.equal(actual[key],val,`${label}: ${key}`);
  }
}

async function main(){
  const started=Date.now();
  const [muni,zip]=await Promise.all([getJson(MUNICIPALITY_URL),getJson(ZIP_URL)]);
  const engine=createAddressEngine(muni,zip);

  const cases=[
    {
      name:'01 全住所のみから浦安市舞浜を補完',
      input:{'全住所':'千葉県浦安市舞浜1-1'},
      expected:{'都道府県':'千葉県','市区町村':'浦安市','町域':'舞浜','郵便番号1':'2790031','標準地域コード':'12227','町域未指定郵便番号1':'2790000','補完判定':'補完あり'}
    },
    {
      name:'02 郵便番号のみから自治体と町域を補完',
      input:{'郵便番号1':'2790031'},
      expected:{'郵便番号（ハイフン）':'279-0031','都道府県':'千葉県','市区町村':'浦安市','町域':'舞浜','標準地域コード':'12227','補完判定':'補完あり'}
    },
    {
      name:'03 都道府県＋市区町村からコードと町域未指定郵便番号',
      input:{'都道府県':'千葉県','市区町村':'浦安市'},
      expected:{'県コード1':'12','市区町村コード1':'227','PrefCityコード':'12227','標準地域コード':'12227','町域未指定郵便番号1':'2790000','郵便番号1':'','補完判定':'補完あり'}
    },
    {
      name:'04 標準地域コードから北海道の先頭0を保持',
      input:{'標準地域コード':'01101'},
      expected:{'都道府県':'北海道','市区町村':'札幌市中央区','県コード1':'1','市区町村コード1':'101','PrefCityコード':'1101','標準地域コード':'01101','補完判定':'補完あり'}
    },
    {
      name:'05 PrefCityコードから標準地域コードを復元',
      input:{'PrefCityコード':'1101'},
      expected:{'都道府県':'北海道','市区町村':'札幌市中央区','標準地域コード':'01101','PrefCityコード':'1101','補完判定':'補完あり'}
    },
    {
      name:'06 県コード＋市区町村コードから千代田区を復元',
      input:{'県コード1':'13','市区町村コード1':'101'},
      expected:{'都道府県':'東京都','市区町村':'千代田区','PrefCityコード':'13101','標準地域コード':'13101','補完判定':'補完あり'}
    },
    {
      name:'07 全国一意の市区町村名だけで都道府県を補完',
      input:{'市区町村':'浦安市'},
      expected:{'都道府県':'千葉県','県コード1':'12','標準地域コード':'12227','補完判定':'補完あり'}
    },
    {
      name:'08 同名自治体の府中市は候補複数',
      input:{'市区町村':'府中市'},
      expected:{'補完判定':'要確認（候補複数）'}
    },
    {
      name:'09 郵便番号と全住所が一致',
      input:{'郵便番号1':'2790031','全住所':'千葉県浦安市舞浜1-1'},
      expected:{'市区町村':'浦安市','町域':'舞浜','郵便番号1':'2790031','補完判定':'補完あり'}
    },
    {
      name:'10 郵便番号と全住所が不一致',
      input:{'郵便番号1':'1600023','全住所':'千葉県浦安市舞浜1-1'},
      expected:{'郵便番号1':'1600023','補完判定':'要確認（不一致）'}
    },
    {
      name:'11 全住所と標準地域コードが不一致',
      input:{'全住所':'千葉県浦安市舞浜1-1','標準地域コード':'13104'},
      expected:{'標準地域コード':'13104','補完判定':'要確認（不一致）'}
    },
    {
      name:'12 同一自治体で複数町域を持つ郵便番号',
      input:{'郵便番号1':'0882686'},
      expected:{'都道府県':'北海道','市区町村':'標津郡中標津町','町域':'','補完判定':'要確認（候補複数）'}
    },
    {
      name:'13 複数自治体にまたがる郵便番号',
      input:{'郵便番号1':'0040000'},
      expected:{'都道府県':'','市区町村':'','補完判定':'要確認（候補複数）'}
    },
    {
      name:'14 全住所が市区町村まででも町域未指定郵便番号を生成',
      input:{'全住所':'千葉県浦安市'},
      expected:{'都道府県':'千葉県','市区町村':'浦安市','郵便番号1':'','町域未指定郵便番号1':'2790000','補完判定':'補完あり'}
    },
    {
      name:'15 町域以降から通常郵便番号を補完',
      input:{'都道府県':'千葉県','市区町村':'浦安市','町域以降':'舞浜1-1'},
      expected:{'全住所':'千葉県浦安市舞浜1-1','町域':'舞浜','郵便番号1':'2790031','補完判定':'補完あり'}
    },
    {
      name:'16 全角郵便番号を正規化',
      input:{'郵便番号（ハイフン）':'２７９－００３１'},
      expected:{'郵便番号（ハイフン）':'279-0031','郵便番号1':'2790031','市区町村':'浦安市','補完判定':'補完あり'}
    },
    {
      name:'17 全角標準地域コードを5桁固定で正規化',
      input:{'標準地域コード':'０１１０１'},
      expected:{'標準地域コード':'01101','PrefCityコード':'1101','都道府県':'北海道','補完判定':'補完あり'}
    },
    {
      name:'18 前回の診断列は再処理時に無視',
      input:{'全住所':'千葉県浦安市舞浜1-1','補完判定':'要確認（不一致）','確認メモ':'前回値'},
      expected:{'補完判定':'補完あり','確認メモ':''}
    },
    {
      name:'19 識別列しかない行は判定不可',
      input:{'仕事番号':'123','仕事名':'テスト求人'},
      expected:{'仕事番号':'123','仕事名':'テスト求人','補完判定':'判定不可'}
    },
    {
      name:'20 マスタにない郵便番号は判定不可',
      input:{'郵便番号1':'9999999'},
      expected:{'郵便番号1':'9999999','補完判定':'判定不可'}
    },
    {
      name:'21 マスタにない架空市は判定不可',
      input:{'全住所':'東京都架空市架空町1-1'},
      expected:{'全住所':'東京都架空市架空町1-1','補完判定':'判定不可'}
    },
    {
      name:'22 郡付き町名を住所用名称として維持',
      input:{'都道府県':'埼玉県','市区町村':'北足立郡伊奈町'},
      expected:{'県コード1':'11','市区町村コード1':'301','標準地域コード':'11301','市区町村':'北足立郡伊奈町','補完判定':'補完あり'}
    },
    {
      name:'23 郡付き全住所を自治体まで解析',
      input:{'全住所':'埼玉県北足立郡伊奈町'},
      expected:{'都道府県':'埼玉県','市区町村':'北足立郡伊奈町','標準地域コード':'11301','補完判定':'補完あり'}
    }
  ];

  let passed=0;
  for(const tc of cases){
    const result=engine.processOne(tc.input).out;
    try{
      checkOutput(result,tc.expected,tc.name);
      if(tc.name.startsWith('08 ')) assert.match(result['確認メモ'],/複数候補/);
      if(tc.name.startsWith('10 ')) assert.match(result['確認メモ'],/不一致/);
      if(tc.name.startsWith('20 ')) assert.match(result['確認メモ'],/郵便番号マスタに存在しません/);
      passed++;
      console.log('PASS',tc.name);
    }catch(err){
      console.error('FAIL',tc.name);
      console.error('INPUT ',tc.input);
      console.error('OUTPUT',result);
      throw err;
    }
  }

  assert.equal(normZip('〒０６０－０００１'),'0600001','utility: normZip');
  assert.equal(hyphenZip('0600001'),'060-0001','utility: hyphenZip');

  console.log(`\n${passed}/${cases.length} representative cases passed in ${Date.now()-started}ms`);
  console.log(`master: municipalities=${engine.stats.municipalities}, zipRows=${engine.stats.zipRows}`);
}

main().catch(err=>{console.error(err);process.exit(1);});
