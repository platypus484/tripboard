import { useState, useRef, useEffect, Fragment } from "react";
import defaultData from "./defaultData.json";
import mobileGuide1 from "../f1.jpg";
import mobileGuide2 from "../f2.jpg";

let storageErrorListeners=[];
function notifyStorageError(message){storageErrorListeners.forEach(fn=>fn(message));}
function useStorageErrorBanner(){
  const [message,setMessage]=useState(null);
  useEffect(()=>{
    storageErrorListeners.push(setMessage);
    return()=>{storageErrorListeners=storageErrorListeners.filter(fn=>fn!==setMessage);};
  },[]);
  return[message,()=>setMessage(null)];
}
let idbConnPromise=null;
function idbOpen(){
  if(idbConnPromise)return idbConnPromise;
  idbConnPromise=new Promise((resolve,reject)=>{
    const req=indexedDB.open("tripboard-db",1);
    req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains("kv"))req.result.createObjectStore("kv");};
    req.onsuccess=()=>{req.result.onclose=()=>{idbConnPromise=null;};resolve(req.result);};
    req.onerror=()=>{idbConnPromise=null;reject(req.error);};
  });
  return idbConnPromise;
}
function idbGet(key){
  return idbOpen().then(db=>new Promise((resolve,reject)=>{
    const tx=db.transaction("kv","readonly");
    const req=tx.objectStore("kv").get(key);
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  }));
}
function idbSet(key,value){
  return idbOpen().then(db=>new Promise((resolve,reject)=>{
    const tx=db.transaction("kv","readwrite");
    tx.objectStore("kv").put(value,key);
    tx.oncomplete=()=>resolve();
    tx.onerror=()=>reject(tx.error);
  }));
}
function usePersistentState(key,initialValue){
  const [state,setState]=useState(()=>typeof initialValue==="function"?initialValue():initialValue);
  const [loaded,setLoaded]=useState(false);
  useEffect(()=>{
    let cancelled=false;
    (async()=>{
      try{
        const idbVal=await idbGet(key);
        if(idbVal!==undefined){
          if(!cancelled){setState(idbVal);setLoaded(true);}
          return;
        }
        const saved=localStorage.getItem(key);
        if(saved!==null){
          let parsed;
          try{parsed=JSON.parse(saved);}catch{parsed=undefined;}
          if(parsed!==undefined){
            if(!cancelled){setState(parsed);setLoaded(true);}
            await idbSet(key,parsed);
            try{localStorage.removeItem(key);}catch{}
            return;
          }
        }
        if(!cancelled)setLoaded(true);
      }catch(e){
        console.warn(`불러오기 실패 (${key})`,e);
        if(!cancelled)setLoaded(true);
      }
    })();
    return()=>{cancelled=true;};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[key]);
  useEffect(()=>{
    if(!loaded)return;
    idbSet(key,state).catch(e=>{
      console.warn(`저장 실패 (${key})`,e);
      notifyStorageError("저장에 실패했습니다! 저장 공간이 가득 찼을 수 있어요. 방금 한 변경사항이 저장되지 않았을 수 있으니, 오래된 카드나 사진을 정리한 뒤 다시 시도해주세요.");
    });
  },[key,state,loaded]);
  return[state,setState];
}
const BACKUP_KEYS=["tripboard_boardItems","tripboard_deckRouteIds","tripboard_deletedRouteDeckIds","tripboard_savedRoutes","tripboard_deckCommunityIds","tripboard_savedRouteMergedDays","tripboard_myCards","tripboard_myPosts","tripboard_savedBoards"];
async function exportBackup(){
  const data={};
  for(const k of BACKUP_KEYS){
    const v=await idbGet(k);
    if(v!==undefined)data[k]=v;
  }
  const payload={exportedAt:new Date().toISOString(),data};
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  const stamp=payload.exportedAt.slice(0,19).replace(/[:T]/g,"-");
  a.href=url;a.download=`tripboard-backup-${stamp}.json`;
  document.body.appendChild(a);a.click();document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
function readBackupFile(file){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>{
      try{resolve(JSON.parse(reader.result));}catch(e){reject(e);}
    };
    reader.onerror=()=>reject(reader.error);
    reader.readAsText(file);
  });
}
async function importBackup(file){
  const payload=await readBackupFile(file);
  const data=payload?.data||payload;
  for(const k of BACKUP_KEYS){
    if(data[k]!==undefined)await idbSet(k,data[k]);
  }
  window.location.reload();
}

function getPastedImageFile(e){
  const items=e.clipboardData?.items;
  if(!items)return null;
  for(let i=0;i<items.length;i++){
    if(items[i].type&&items[i].type.startsWith("image/"))return items[i].getAsFile();
  }
  return null;
}

function resizeImageFile(file,maxDim=900,quality=0.55){
  return new Promise((resolve)=>{
    const reader=new FileReader();
    reader.onload=()=>{
      const img=new Image();
      img.onload=()=>{
        let{width,height}=img;
        if(width>maxDim||height>maxDim){
          const scale=maxDim/Math.max(width,height);
          width=Math.round(width*scale);height=Math.round(height*scale);
        }
        const canvas=document.createElement("canvas");
        canvas.width=width;canvas.height=height;
        canvas.getContext("2d").drawImage(img,0,0,width,height);
        resolve(canvas.toDataURL("image/jpeg",quality));
      };
      img.onerror=()=>resolve(reader.result);
      img.src=reader.result;
    };
    reader.onerror=()=>resolve(null);
    reader.readAsDataURL(file);
  });
}

const C = {
  coral:"#FF5A5F", teal:"#00A699", purple:"#7B61FF", orange:"#FF8C00",
  blue:"#0066FF", green:"#00C48C", pink:"#FF4081", yellow:"#FFB800",
  bg:"#F7F7F7", white:"#FFFFFF", gray50:"#F8F9FA", gray100:"#F0F0F0",
  gray200:"#E0E0E0", gray400:"#9E9E9E", gray600:"#616161", gray900:"#212121",
  shadow:"0 2px 16px rgba(0,0,0,0.10)", shadowHover:"0 8px 32px rgba(0,0,0,0.16)",
};

function PhotoLightbox({src,onClose}){
  return(
    <div onClick={onClose} style={{position:"fixed",inset:0,zIndex:9999999,background:"rgba(0,0,0,0.85)",display:"flex",alignItems:"center",justifyContent:"center",padding:24,cursor:"zoom-out"}}>
      <img src={src} alt="" style={{maxWidth:"92vw",maxHeight:"92vh",objectFit:"contain",borderRadius:8,boxShadow:"0 24px 64px rgba(0,0,0,0.5)"}}/>
      <button onClick={onClose} style={{position:"absolute",top:20,right:24,width:40,height:40,borderRadius:"50%",background:"rgba(255,255,255,0.15)",border:"1px solid rgba(255,255,255,0.3)",cursor:"pointer",fontSize:18,color:"#fff",display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
    </div>
  );
}
function PhotoStack({photos,accentColor,accentBg,onUpload,onPaste,onRemove,boxHeight=180,hidePhoto,onSetHidePhoto}){
  const list=photos||[];
  const [zoomedSrc,setZoomedSrc]=useState(null);
  if(!list.length&&hidePhoto){
    return <button onClick={()=>onSetHidePhoto(false)} style={{width:"100%",padding:"10px",borderRadius:12,border:`1.5px dashed ${C.gray200}`,background:"transparent",color:C.gray400,fontSize:13,fontWeight:600,cursor:"pointer",marginBottom:12}}>+ 사진 추가</button>;
  }
  if(list.length){
    return(
      <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:12}}>
        {list.map((p,pi)=>(
          <div key={pi} style={{position:"relative"}}>
            <div onClick={()=>setZoomedSrc(p.dataUrl)} title="클릭해서 크게 보기" style={{width:"100%",height:boxHeight,borderRadius:14,overflow:"hidden",border:`1.5px solid ${accentColor}`,background:accentBg,cursor:"zoom-in"}}>
              <img src={p.dataUrl} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/>
            </div>
            <button onClick={()=>onRemove(pi)} title="이 사진 삭제" style={{position:"absolute",top:8,right:8,width:24,height:24,borderRadius:"50%",background:"rgba(255,255,255,0.95)",border:`1px solid ${C.gray200}`,cursor:"pointer",fontSize:11,color:C.gray600,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
            {pi===list.length-1&&(
              <label tabIndex={0} onPaste={onPaste} title="사진 추가" style={{position:"absolute",bottom:8,left:8,width:32,height:32,borderRadius:"50%",background:"rgba(255,255,255,0.95)",border:`1.5px solid ${C.gray200}`,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",outline:"none"}}>
                <input type="file" accept="image/*" onChange={onUpload} style={{display:"none"}}/>
                <span style={{fontSize:16,fontWeight:700,color:C.gray600,lineHeight:1}}>+</span>
              </label>
            )}
          </div>
        ))}
        {zoomedSrc&&<PhotoLightbox src={zoomedSrc} onClose={()=>setZoomedSrc(null)}/>}
      </div>
    );
  }
  return(
    <div style={{position:"relative",marginBottom:12}}>
      <label tabIndex={0} onPaste={onPaste} style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",width:"100%",height:boxHeight,borderRadius:14,border:`1.5px dashed ${C.gray200}`,background:C.white,cursor:"pointer",outline:"none"}}>
        <input type="file" accept="image/*" onChange={onUpload} style={{display:"none"}}/>
        <span style={{fontSize:32}}>📷</span>
        <span style={{fontSize:13,color:C.gray400,marginTop:6}}>사진 추가</span>
        <span style={{fontSize:11,color:C.gray200,marginTop:2}}>사진 파일에서 가져오기 또는 Ctrl+V</span>
      </label>
      {onSetHidePhoto&&<button onClick={e=>{e.stopPropagation();onSetHidePhoto(true);}} title="사진 추가란 없애기" style={{position:"absolute",bottom:8,right:8,width:24,height:24,borderRadius:"50%",background:"rgba(255,255,255,0.95)",border:`1px solid ${C.gray200}`,cursor:"pointer",fontSize:11,color:C.gray600,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>}
    </div>
  );
}

const ROUTE_DECK = [
  {id:1,emoji:"🚃",title:"나리타 → 신주쿠",cost:"3,200원",duration:"80분",color:C.blue,bg:"#EEF4FF",region:"도쿄"},
  {id:2,emoji:"🍜",title:"신주쿠 맛집 골목",cost:"18,000원",duration:"3시간",color:C.orange,bg:"#FFF4E6",region:"도쿄"},
  {id:3,emoji:"⛩️",title:"아사쿠사 사원",cost:"무료",duration:"2시간",color:C.purple,bg:"#F3F0FF",region:"도쿄"},
  {id:4,emoji:"🛍️",title:"하라주쿠 쇼핑",cost:"자유",duration:"4시간",color:C.pink,bg:"#FFF0F5",region:"도쿄"},
  {id:5,emoji:"🌃",title:"시부야 야경",cost:"2,000원",duration:"2시간",color:C.blue,bg:"#EEF4FF",region:"도쿄"},
  {id:6,emoji:"🏨",title:"숙소 체크인",cost:"별도",duration:"30분",color:C.teal,bg:"#E6FAF8",region:"도쿄"},
  {id:7,emoji:"🎎",title:"아키하바라",cost:"자유",duration:"3시간",color:C.coral,bg:"#FFF0F0",region:"도쿄"},
  {id:8,emoji:"🌸",title:"우에노 공원",cost:"무료",duration:"1.5시간",color:C.pink,bg:"#FFF0F5",region:"도쿄"},
  {id:9,emoji:"🗼",title:"도쿄타워",cost:"3,000원",duration:"1시간",color:C.orange,bg:"#FFF4E6",region:"도쿄"},
  {id:10,emoji:"🚄",title:"간사이공항 → 난바",cost:"1,300원",duration:"45분",color:C.blue,bg:"#EEF4FF",region:"오사카"},
  {id:11,emoji:"🍣",title:"구로몬 시장",cost:"15,000원",duration:"2시간",color:C.orange,bg:"#FFF4E6",region:"오사카"},
  {id:12,emoji:"🏮",title:"도톤보리 야경",cost:"무료",duration:"1시간",color:C.coral,bg:"#FFF0F0",region:"오사카"},
  {id:13,emoji:"🚗",title:"렌터카 픽업",cost:"자유",duration:"30분",color:C.teal,bg:"#E6FAF8",region:"제주"},
  {id:14,emoji:"🌊",title:"협재 해수욕장",cost:"무료",duration:"2시간",color:C.blue,bg:"#EEF4FF",region:"제주"},
  {id:15,emoji:"🌅",title:"성산일출봉",cost:"2,000원",duration:"1시간",color:C.orange,bg:"#FFF4E6",region:"제주"},
  {id:16,emoji:"🗼",title:"에펠탑 야경",cost:"무료",duration:"1시간",color:C.pink,bg:"#FFF0F5",region:"파리"},
  {id:17,emoji:"🎨",title:"루브르 박물관",cost:"17유로",duration:"3시간",color:C.purple,bg:"#F3F0FF",region:"파리"},
  {id:18,emoji:"🥐",title:"몽마르트르 빵집",cost:"5유로",duration:"1시간",color:C.coral,bg:"#FFF0F0",region:"파리"},
  {id:19,emoji:"🗽",title:"자유의 여신상",cost:"24달러",duration:"2시간",color:C.blue,bg:"#EEF4FF",region:"뉴욕"},
  {id:20,emoji:"🌆",title:"타임스퀘어",cost:"무료",duration:"1시간",color:C.orange,bg:"#FFF4E6",region:"뉴욕"},
  {id:21,emoji:"🌉",title:"브루클린 브릿지",cost:"무료",duration:"1시간",color:C.purple,bg:"#F3F0FF",region:"뉴욕"},
  {id:22,emoji:"🌴",title:"꾸따 해변",cost:"무료",duration:"2시간",color:C.green,bg:"#E6FAF2",region:"발리"},
  {id:23,emoji:"🛕",title:"탄아롯 사원",cost:"6만루피아",duration:"1시간",color:C.teal,bg:"#E6FAF8",region:"발리"},
  {id:24,emoji:"💆",title:"우붓 마사지",cost:"8달러",duration:"1시간",color:C.pink,bg:"#FFF0F5",region:"발리"},
];
function groupByRegion(items,regionOf){
  const groups=[];const idx={};
  items.forEach(item=>{
    const region=regionOf(item)||"기타";
    if(!(region in idx)){idx[region]=groups.length;groups.push({region,items:[]});}
    groups[idx[region]].items.push(item);
  });
  return groups;
}
const ARROW_DECK = [
  {id:"a1",type:"arrow",dir:"right",label:"→",color:C.gray600,bg:C.gray100},
  {id:"a2",type:"arrow",dir:"down",label:"↓",color:C.gray600,bg:C.gray100},
  {id:"a3",type:"arrow",dir:"left",label:"←",color:C.gray600,bg:C.gray100},
  {id:"a4",type:"arrow",dir:"up",label:"↑",color:C.gray600,bg:C.gray100},
  {id:"a5",type:"arrow",dir:"rd",label:"↘",color:C.orange,bg:"#FFF4E6"},
  {id:"a6",type:"arrow",dir:"ru",label:"↗",color:C.orange,bg:"#FFF4E6"},
  {id:"a7",type:"arrow",dir:"then",label:"THEN",color:C.blue,bg:"#EEF4FF"},
  {id:"a8",type:"arrow",dir:"next",label:"NEXT",color:C.teal,bg:"#E6FAF8"},
];
const TEXT_DECK = [
  {id:"t1",type:"text",label:"메모",icon:"📝",text:"",color:C.yellow,bg:"#FFFAE6"},
  {id:"t2",type:"text",label:"주의",icon:"⚠️",text:"",color:C.coral,bg:"#FFF0F0"},
  {id:"t3",type:"text",label:"체크",icon:"✓",text:"",color:C.green,bg:"#E6FAF2"},
  {id:"t4",type:"text",label:"팁",icon:"💡",text:"",color:C.purple,bg:"#F3F0FF"},
];
const MISC_DECK = [
  {id:"o1",type:"misc",label:"준비물",icon:"🎒",text:"",photo:null,color:C.blue,bg:"#EEF4FF"},
  {id:"o2",type:"misc",label:"이야기",icon:"📖",text:"",photo:null,color:C.purple,bg:"#F3F0FF"},
  {id:"o3",type:"misc",label:"기타",icon:"📌",text:"",photo:null,color:C.orange,bg:"#FFF4E6"},
];
const REGION_OPTIONS = [
  {label:"일본",icon:"🗼"},{label:"한국",icon:"🌊"},{label:"프랑스",icon:"🥐"},
  {label:"미국",icon:"🗽"},{label:"인도네시아",icon:"🌴"},
  {label:"기타",icon:"📍"},
];
const SAMPLE_PHOTOS = [
  {id:"p1",emoji:"🚃",label:"교통"},{id:"p2",emoji:"🍜",label:"음식"},
  {id:"p3",emoji:"⛩️",label:"사원"},{id:"p4",emoji:"🛍️",label:"쇼핑"},
  {id:"p5",emoji:"🌃",label:"야경"},{id:"p6",emoji:"🏖️",label:"해변"},
  {id:"p7",emoji:"☕",label:"카페"},{id:"p8",emoji:"🎭",label:"공연"},
  {id:"p9",emoji:"🗼",label:"랜드마크"},{id:"p10",emoji:"🚤",label:"크루즈"},
  {id:"p11",emoji:"🌸",label:"공원"},{id:"p12",emoji:"🍺",label:"나이트"},
];
const CARD_COLORS = [
  {color:C.coral,bg:"#FFF0F0"},{color:C.teal,bg:"#E6FAF8"},
  {color:C.purple,bg:"#F3F0FF"},{color:C.orange,bg:"#FFF4E6"},
  {color:C.blue,bg:"#EEF4FF"},{color:C.green,bg:"#E6FAF2"},
  {color:C.pink,bg:"#FFF0F5"},{color:C.yellow,bg:"#FFFAE6"},
];
const COMMUNITY_ROUTES = [
  {id:"c1",author:"김지수",avatar:"J",avatarBg:C.coral,region:"도쿄 · 3박4일",title:"도쿄 첫 여행 완전 가이드",likes:1842,rating:4.9,tags:["감성","맛집"],totalCost:"42만원",color:C.blue,bg:"#EEF4FF",coverEmoji:"🗼",desc:"나리타 공항부터 신주쿠, 아사쿠사, 시부야까지. 처음 도쿄에서 헤매지 않는 법.",
    steps:[{emoji:"🚃",title:"나리타 → 신주쿠"},{emoji:"🍜",title:"신주쿠 맛집"},{emoji:"⛩️",title:"아사쿠사"},{emoji:"🛍️",title:"하라주쿠"},{emoji:"🌃",title:"시부야 야경"}],
    dayPlans:[
      {day:1,label:"1일차",theme:"공항 도착 · 신주쿠",steps:[{emoji:"✈️",title:"나리타 공항",desc:"입국 후 JR 표지판 따라 직진. 익스프레스 탑승구까지 표지판대로.",tip:"수하물 3번 컨베이어"},{emoji:"🚃",title:"신주쿠역 도착",desc:"南口 출구로 나오면 바로 번화가.",tip:"Suica 카드 공항에서 구입 추천"},{emoji:"🍜",title:"신주쿠 맛집",desc:"동쪽 출구 오른쪽 골목. 이치란 또는 이자카야.",tip:"저녁 6시 이후 분위기 최고"}]},
      {day:2,label:"2일차",theme:"아사쿠사 · 하라주쿠",steps:[{emoji:"⛩️",title:"아사쿠사 센소지",desc:"긴자선 1번 출구. 나카미세 상점가 직진.",tip:"아침 8시 전이 한산"},{emoji:"🛍️",title:"하라주쿠",desc:"다케시타 거리. 마리온 크레이프 필수.",tip:"오모테산도 힐즈 지하 추천"}]},
      {day:3,label:"3일차",theme:"시부야 · 귀국",steps:[{emoji:"🌃",title:"시부야 스크램블",desc:"저녁 7시 이후. 스타벅스 2층 창가 뷰.",tip:"SHIBUYA SKY 사전 예매"},{emoji:"✈️",title:"귀국",desc:"남구 출구 → 나리타 익스프레스.",tip:"출발 2시간 전 도착"}]}
    ]
  },
  {id:"c2",author:"박민준",avatar:"M",avatarBg:C.orange,region:"오사카 · 2박3일",title:"오사카 먹방 완전 정복",likes:2310,rating:4.8,tags:["먹방","가성비"],totalCost:"28만원",color:C.orange,bg:"#FFF4E6",coverEmoji:"🍣",desc:"도톤보리 골목부터 구로몬 시장까지. 먹는 게 목적인 2박3일.",
    steps:[{emoji:"🍣",title:"구로몬 시장"},{emoji:"🏮",title:"도톤보리"},{emoji:"🎡",title:"덴포잔"},{emoji:"🌉",title:"야경"}],
    dayPlans:[
      {day:1,label:"1일차",theme:"도착 · 도톤보리",steps:[{emoji:"✈️",title:"간사이 공항",desc:"난카이 라피트 → 난바역. 오렌지색 열차.",tip:"이코카 공항에서 구입"},{emoji:"🏮",title:"도톤보리",desc:"글리코 간판 인증샷. 강변 산책.",tip:"밤 9시 이후 조명 예쁨"}]},
      {day:2,label:"2일차",theme:"시장 · 쇼핑",steps:[{emoji:"🍣",title:"구로몬 시장",desc:"난바 도보 10분. 신선 해산물.",tip:"오전 10시 개장 직후"},{emoji:"🛍️",title:"신사이바시",desc:"돈키호테 기념품.",tip:"면세 신청 잊지 말기"}]}
    ]
  },
  {id:"c3",author:"이서연",avatar:"S",avatarBg:C.teal,region:"제주 · 2박3일",title:"제주 현지인 숨은 스팟",likes:1567,rating:4.9,tags:["자연","카페"],totalCost:"15만원",color:C.teal,bg:"#E6FAF8",coverEmoji:"🌊",desc:"현지인이 찾아낸 진짜 제주. 관광객 없는 해변과 로컬 카페.",
    steps:[{emoji:"🌊",title:"협재 해수욕장"},{emoji:"🚗",title:"산방산 드라이브"},{emoji:"☕",title:"감성 카페"},{emoji:"🌅",title:"성산일출봉"}],
    dayPlans:[
      {day:1,label:"1일차",theme:"서쪽 해안",steps:[{emoji:"🚗",title:"렌터카",desc:"카카오맵 추천.",tip:"경차도 충분"},{emoji:"🌊",title:"협재 해수욕장",desc:"에메랄드 바다. 비양도 뷰.",tip:"오전 일찍"},{emoji:"☕",title:"한림 카페",desc:"읍내 골목 소규모 카페.",tip:"주인장 꿀팁"}]},
      {day:2,label:"2일차",theme:"동쪽 · 성산",steps:[{emoji:"🌅",title:"성산일출봉",desc:"일출 새벽 5시 30분.",tip:"전날 성산 숙소"},{emoji:"🐎",title:"우도",desc:"배 15분. 전기자전거.",tip:"땅콩 아이스크림"}]}
    ]
  },
  {id:"c4",author:"최다은",avatar:"D",avatarBg:C.pink,region:"파리 · 5박6일",title:"파리 낭만 감성 루트",likes:3204,rating:5.0,tags:["감성","미술관"],totalCost:"180만원",color:C.pink,bg:"#FFF0F5",coverEmoji:"🗼",desc:"에펠탑 사진보다 중요한 것들. 현지인 카페와 숨겨진 골목.",
    steps:[{emoji:"🗼",title:"에펠탑"},{emoji:"🎨",title:"루브르"},{emoji:"☕",title:"몽마르트르"},{emoji:"🥐",title:"빵집"}],
    dayPlans:[
      {day:1,label:"1일차",theme:"도착 · 에펠탑",steps:[{emoji:"✈️",title:"CDG 공항",desc:"RER B → 파리 북역.",tip:"나비고 카드 추천"},{emoji:"🗼",title:"에펠탑 야경",desc:"트로카데로 광장. 매시 정각 조명쇼.",tip:"꼭대기 사전 예매"}]},
      {day:2,label:"2일차",theme:"루브르 · 마레",steps:[{emoji:"🎨",title:"루브르",desc:"수·금 야간 개장 시 대기 짧음.",tip:"드농관 1층 모나리자"},{emoji:"☕",title:"마레지구",desc:"빈티지 숍과 로컬 카페.",tip:"소규모 카페"}]},
      {day:3,label:"3일차",theme:"몽마르트르",steps:[{emoji:"🎨",title:"몽마르트르",desc:"12호선 아베스역. 좁은 골목.",tip:"케이블카보다 계단"},{emoji:"🥐",title:"동네 빵집",desc:"크루아상 1유로. 아침 7시.",tip:"갓 구운 게 최고"}]}
    ]
  },
  {id:"c5",author:"김현우",avatar:"H",avatarBg:C.purple,region:"뉴욕 · 6박7일",title:"뉴욕 교포가 알려주는 찐 루트",likes:4521,rating:4.8,tags:["도시","쇼핑"],totalCost:"250만원",color:C.purple,bg:"#F3F0FF",coverEmoji:"🗽",desc:"10년 살면서 쌓은 찐 꿀팁. 타임스퀘어부터 브루클린까지.",
    steps:[{emoji:"🗽",title:"자유의 여신상"},{emoji:"🌆",title:"엠파이어 야경"},{emoji:"🍔",title:"브런치 맛집"},{emoji:"🎭",title:"브로드웨이"}],
    dayPlans:[
      {day:1,label:"1일차",theme:"도착 · 맨해튼",steps:[{emoji:"✈️",title:"JFK 공항",desc:"AirTrain → E선 지하철.",tip:"택시보다 5배 저렴"},{emoji:"🌆",title:"타임스퀘어",desc:"밤에 더 화려해요.",tip:"계단 위에서 사진"}]},
      {day:2,label:"2일차",theme:"자유의 여신상",steps:[{emoji:"🗽",title:"여신상",desc:"배터리 파크 페리 탑승.",tip:"스태튼 아일랜드 무료 페리"},{emoji:"🌉",title:"브루클린 브리지",desc:"맨해튼 쪽에서 걸으면 1km.",tip:"일출 직후 추천"}]},
      {day:3,label:"3일차",theme:"미술관 · 브런치",steps:[{emoji:"🎨",title:"MoMA",desc:"목요일 저녁 무료 입장.",tip:"고흐 별이 빛나는 밤"},{emoji:"🍳",title:"에그슬럿 브런치",desc:"첼시마켓 내부.",tip:"오전 11시 전 방문"}]}
    ]
  },
  {id:"c6",author:"정아름",avatar:"A",avatarBg:C.green,region:"발리 · 4박5일",title:"발리 힐링 완전 가이드",likes:2890,rating:4.7,tags:["자연","힐링"],totalCost:"55만원",color:C.green,bg:"#E6FAF2",coverEmoji:"🌴",desc:"우붓의 논밭부터 꾸따 해변까지. 완벽한 발리 힐링.",
    steps:[{emoji:"🌴",title:"꾸따 해변"},{emoji:"🛕",title:"탄아롯 사원"},{emoji:"🌿",title:"우붓 논밭"},{emoji:"💆",title:"발리 마사지"}],
    dayPlans:[
      {day:1,label:"1일차",theme:"꾸따 · 해변",steps:[{emoji:"🌴",title:"꾸따 해변",desc:"서핑 레슨 추천. 오전 일찍.",tip:"선크림 필수"},{emoji:"🛕",title:"탄아롯 사원",desc:"일몰 30분 전 도착.",tip:"조수 빠지면 걸어가요"}]},
      {day:2,label:"2일차",theme:"우붓",steps:[{emoji:"🌿",title:"우붓 논밭",desc:"이른 아침 트레킹 추천.",tip:"가이드 투어 10달러"},{emoji:"💆",title:"발리 마사지",desc:"우붓 중심가 마사지샵.",tip:"60분 8달러"}]}
    ]
  },
  {id:"c7",author:"윤서준",avatar:"Y",avatarBg:C.purple,region:"교토 · 2박3일",title:"교토 고즈넉한 사찰 여행",likes:1978,rating:4.9,tags:["감성","전통"],totalCost:"35만원",color:C.purple,bg:"#F3F0FF",coverEmoji:"⛩️",desc:"기요미즈데라부터 아라시야마 대나무숲까지. 천년 고도의 여유를 걷다.",
    steps:[{emoji:"⛩️",title:"기요미즈데라"},{emoji:"🎋",title:"아라시야마"},{emoji:"🍵",title:"말차 카페"},{emoji:"🏯",title:"금각사"}],
    dayPlans:[
      {day:1,label:"1일차",theme:"기요미즈데라 · 기온",steps:[
        {emoji:"🚄",title:"신칸센 도착",desc:"교토역 하차 후 중앙 출구로 나와 100번 버스 정류장을 찾으세요. 버스는 배차 간격이 짧고 관광객이 많아 줄이 길 수 있으니 여유를 두고 이동하는 게 좋아요. 창밖으로 교토 시내의 낮은 건물들이 지나가는 걸 보는 것만으로도 여행 기분이 납니다.",tip:"버스 1일권(600엔)을 교토역 관광안내소에서 미리 구매하면 하루 종일 훨씬 저렴해요"},
        {emoji:"⛩️",title:"기요미즈데라",desc:"청수의 무대(기요미즈노부타이)에 올라서면 교토 시내가 한눈에 내려다보여요. 절벽 위에 못 하나 없이 지어진 목조 구조물이라는 설명을 들으면 더 감탄하게 됩니다. 오토와 폭포에서 세 줄기 물 중 하나를 골라 마시면 각각 학업·연애·장수의 소원이 이뤄진다는 이야기가 전해져요.",tip:"오전 8시 개장 직후 방문하면 단체 관광객 없이 조용하게 사진을 찍을 수 있어요"},
        {emoji:"🍵",title:"기온 말차 카페",desc:"산넨자카·니넨자카 골목을 따라 내려오면 나오는 작은 찻집으로, 진한 우지 말차를 직접 갈아 내려줍니다. 말차 파르페는 아이스크림과 팥, 시라타마 경단이 층층이 쌓여 나와서 보기만 해도 배부르지만 다 먹게 되는 맛이에요.",tip:"오후 2~4시 사이는 골목 자체가 인파로 붐비니 오전 방문을 추천해요"}
      ]},
      {day:2,label:"2일차",theme:"아라시야마 · 금각사",steps:[
        {emoji:"🎋",title:"아라시야마 대나무숲",desc:"하늘을 가릴 정도로 빽빽하게 뻗은 대나무 사이로 걷다 보면 바람이 불 때마다 사각거리는 소리가 들려요. 낮에는 인력거와 단체 관광객으로 가득 차지만, 이른 아침에는 숲 전체를 거의 혼자 걷는 듯한 고요함을 느낄 수 있습니다.",tip:"오전 7시 전에 도착하면 사람 없는 사진을 찍을 수 있어요, 근처 텐류지 정원도 아침이 한산합니다"},
        {emoji:"🏯",title:"금각사",desc:"연못(쿄코치)에 비친 금박 누각의 반영이 이 절의 하이라이트예요. 날씨가 맑은 날 오전에 가면 물결이 잔잔해서 반영이 훨씬 선명하게 보입니다. 관람 동선이 정해져 있어 한 방향으로만 걷게 되는데, 그만큼 붐벼도 사진 찍을 타이밍은 꼭 옵니다.",tip:"버스보다 택시나 자전거가 이동이 편하고, 정문 근처 말차 소프트아이스크림 노점도 놓치지 마세요"}
      ]}
    ]
  },
  {id:"c8",author:"강태희",avatar:"T",avatarBg:C.blue,region:"부산 · 2박3일",title:"부산 바다 앞 맛집 투어",likes:2145,rating:4.8,tags:["맛집","바다"],totalCost:"20만원",color:C.blue,bg:"#EEF4FF",coverEmoji:"🌊",desc:"해운대 앞바다부터 자갈치시장까지. 먹고 걷고 또 먹는 부산 코스.",
    steps:[{emoji:"🌊",title:"해운대"},{emoji:"🐟",title:"자갈치시장"},{emoji:"🎡",title:"감천문화마을"},{emoji:"🌉",title:"광안대교 야경"}],
    dayPlans:[
      {day:1,label:"1일차",theme:"해운대 · 광안리",steps:[
        {emoji:"🌊",title:"해운대 해수욕장",desc:"넓은 백사장을 따라 산책하다 보면 바로 뒤편으로 카페 거리가 이어져요. 통유리 통창으로 바다가 보이는 카페들이 많아서, 커피 한 잔 시켜놓고 파도 소리를 들으며 쉬기 좋습니다. 저녁에는 해변을 따라 조깅하거나 자전거 타는 사람들도 많아요.",tip:"주말과 여름 성수기엔 사람이 정말 많으니 평일 오전 방문을 추천해요"},
        {emoji:"🌉",title:"광안대교 야경",desc:"광안리 해변 백사장에 앉아서 보는 다리 조명이 부산 야경 중에서도 손꼽힙니다. 다리 전체가 무지개색으로 바뀌는 조명쇼가 매일 저녁 진행되고, 해변가 포장마차에서 파는 곱창전골이나 어묵을 먹으면서 구경하면 더 좋아요.",tip:"저녁 8시 이후, 특히 불꽃축제 시즌이 아니어도 조명이 예쁘니 꼭 챙겨 보세요"}
      ]},
      {day:2,label:"2일차",theme:"자갈치 · 감천마을",steps:[
        {emoji:"🐟",title:"자갈치시장",desc:"입구부터 활어 수조가 줄지어 있고, 상인분들이 힘차게 호객하는 소리로 활기가 넘쳐요. 원하는 생선을 골라 2층 식당으로 올라가면 바로 회를 떠서 내주는 시스템이라 신선도가 남다릅니다. 시장 골목 노점에서 파는 씨앗호떡은 꼭 먹어봐야 할 간식이에요.",tip:"카드보다 현금을 선호하는 상점이 많으니 미리 준비하면 편해요"},
        {emoji:"🎡",title:"감천문화마을",desc:"산비탈을 따라 알록달록한 집들이 계단식으로 늘어선 모습이 마치 그림 같아요. 골목마다 벽화와 작은 조형물이 숨어있어서 지도를 보며 하나씩 찾아다니는 재미가 있습니다. 전망대에서 내려다보는 마을 전경이 이곳의 대표 포토스팟이에요.",tip:"경사가 있는 계단길이 많으니 편한 운동화를 신고 가세요"}
      ]}
    ]
  },
  {id:"c9",author:"한소미",avatar:"S",avatarBg:C.pink,region:"니스 · 4박5일",title:"니스 코트다쥐르 힐링 로드",likes:1523,rating:4.9,tags:["감성","바다"],totalCost:"150만원",color:C.pink,bg:"#FFF0F5",coverEmoji:"🏖️",desc:"지중해를 따라 걷는 프랑스 남부의 여유. 니스부터 에즈 마을까지.",
    steps:[{emoji:"🏖️",title:"니스 해변"},{emoji:"🏘️",title:"에즈 마을"},{emoji:"🎨",title:"마티스 미술관"},{emoji:"🚂",title:"모나코"}],
    dayPlans:[
      {day:1,label:"1일차",theme:"니스 구시가",steps:[
        {emoji:"✈️",title:"니스 공항 도착",desc:"공항에서 트램 2호선을 타면 환승 없이 시내 중심가까지 약 20분이면 도착해요. 창밖으로 지중해가 살짝 보이기 시작하면 여행이 시작됐다는 게 실감 납니다. 트램역 근처에 짐 보관소도 있어서 체크인 전에 가볍게 시내 구경을 할 수도 있어요.",tip:"공항 자동판매기에서 1일 교통권을 미리 구매하면 트램·버스를 하루 종일 자유롭게 탈 수 있어요"},
        {emoji:"🏖️",title:"니스 해변 산책",desc:"프롬나드 데 장글레라는 이름의 해안 산책로를 따라 걷다 보면 자갈 해변 특유의 파도 소리가 발밑에서 들려요. 벤치에 앉아 아이스크림 하나 먹으면서 노을을 보는 것만으로도 하루의 피로가 풀리는 기분이 듭니다.",tip:"일몰 시간대(저녁 7~8시)에 가면 하늘과 바다가 분홍빛으로 물드는 걸 볼 수 있어요"}
      ]},
      {day:2,label:"2일차",theme:"에즈 · 모나코",steps:[{emoji:"🏘️",title:"에즈 마을",desc:"버스로 30분 정도 이동하면 절벽 위에 자리한 중세 마을이 나와요. 좁은 돌길을 따라 계속 오르면 정상 정원에서 지중해를 360도로 내려다볼 수 있어 그 자체로 감동적입니다.",tip:"오르막이 많으니 편한 신발 필수, 정상 카페에서 마시는 커피값이 조금 비싸도 뷰 값이라 생각하세요"},{emoji:"🚂",title:"모나코 몬테카를로",desc:"기차로 20분이면 도착하는 세계에서 두 번째로 작은 나라예요. 카지노 앞 광장의 화려한 자동차들을 구경하는 것도, 항구에 정박된 요트들을 보는 것도 눈이 즐거운 코스입니다.",tip:"오후 방문이 오전보다 붐비는 사람이 적어서 사진 찍기 좋아요"}]}
    ]
  },
];

const ROUTE_DETAIL = {
  1:{steps:[{icon:"✈️",place:"나리타 공항",photo:"🏛️",desc:"입국 후 수하물 3번 → JR 파란 표지판 직진 50m.",tip:"수하물은 3번 컨베이어",time:"30분",cost:"무료"},{icon:"🎫",place:"익스프레스 발권",photo:"🎫",desc:"자동발매기 Shinjuku → IC카드 또는 현금.",tip:"Suica 있으면 편함",time:"5분",cost:"3,200원"},{icon:"🚉",place:"5번 플랫폼",photo:"🚃",desc:"에스컬레이터 내려가면 5번 플랫폼. 노란 기둥 옆.",tip:"짐 선반 미리 확인",time:"출발 10분 전",cost:"포함"},{icon:"🏙️",place:"신주쿠 도착",photo:"🗼",desc:"南口 출구로 나오면 번화가.",tip:"남구 출구가 편함",time:"80분",cost:"무료"}]},
};

function isInDeck(x,y){const el=document.getElementById("card-deck");if(!el)return false;const r=el.getBoundingClientRect();return x>=r.left&&x<=r.right&&y>=r.top&&y<=r.bottom;}

function handleDeckRowMouseDown(e){
  if(e.target!==e.currentTarget)return;
  const el=e.currentTarget;
  const startX=e.clientX,scrollStart=el.scrollLeft;
  function onMove(ev){el.scrollLeft=scrollStart-(ev.clientX-startX);}
  function onUp(){window.removeEventListener("mousemove",onMove);window.removeEventListener("mouseup",onUp);}
  window.addEventListener("mousemove",onMove);
  window.addEventListener("mouseup",onUp);
}

function RouteDetailModal({card,onClose}){
  const [tab,setTab]=useState("photos");
  const detail=ROUTE_DETAIL[card.id];
  const steps=detail?.steps||[{icon:"📍",place:"출발지",photo:"🗺️",desc:"현장 사진과 함께 안내해요.",tip:"현장 확인 필수",time:"출발",cost:"무료"}];
  const TABS=[{k:"photos",l:"사진"},{k:"desc",l:"설명"},{k:"summary",l:"요약"}];
  return(
    <div style={{position:"fixed",inset:0,zIndex:99999,background:"rgba(0,0,0,0.5)",backdropFilter:"blur(6px)",display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={onClose}>
      <div style={{background:C.white,borderRadius:24,width:"min(660px,100%)",maxHeight:"90vh",overflow:"hidden",boxShadow:"0 24px 64px rgba(0,0,0,0.2)",display:"flex",flexDirection:"column"}} onClick={e=>e.stopPropagation()}>
        <div style={{padding:"20px 24px",borderBottom:`1px solid ${C.gray100}`,display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            <div style={{width:44,height:44,borderRadius:12,background:card.bg||"#EEF4FF",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22}}>{card.emoji}</div>
            <div><div style={{fontSize:16,fontWeight:700,color:C.gray900}}>{card.title}</div><div style={{fontSize:12,color:C.gray400,marginTop:2}}>{card.duration} · {card.cost}</div></div>
          </div>
          <button onClick={onClose} style={{width:32,height:32,borderRadius:"50%",border:`1px solid ${C.gray200}`,background:C.white,cursor:"pointer",fontSize:16,color:C.gray400,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
        </div>
        <div style={{display:"flex",borderBottom:`1px solid ${C.gray100}`,flexShrink:0}}>
          {TABS.map(t=><button key={t.k} onClick={()=>setTab(t.k)} style={{flex:1,padding:"12px",border:"none",background:"transparent",cursor:"pointer",fontSize:13,fontWeight:600,color:tab===t.k?card.color||C.coral:C.gray400,borderBottom:tab===t.k?`2px solid ${card.color||C.coral}`:"2px solid transparent",marginBottom:-1,transition:"all 0.15s"}}>{t.l}</button>)}
        </div>
        <div style={{overflowY:"auto",flex:1,padding:"20px 24px"}}>
          {steps.map((step,i)=>(
            <div key={i} style={{marginBottom:i<steps.length-1?28:0}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
                <span style={{fontSize:11,fontWeight:700,color:card.color||C.coral,background:card.bg||"#FFF0F0",borderRadius:20,padding:"3px 10px"}}>STEP {i+1}</span>
                <span style={{fontSize:14,fontWeight:700,color:C.gray900}}>{tab==="summary"?step.place:step.place}</span>
              </div>
              {tab!=="summary"&&<div style={{width:"100%",aspectRatio:"16/9",borderRadius:16,background:card.bg||"#F7F7F7",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:8,marginBottom:12,border:`1px solid ${C.gray100}`}}>
                <span style={{fontSize:72}}>{step.photo}</span>
                <span style={{fontSize:12,color:C.gray400}}>현장 사진</span>
              </div>}
              <div style={{background:C.gray50,borderRadius:14,padding:"14px"}}>
                <p style={{fontSize:13,color:C.gray600,lineHeight:1.7,margin:"0 0 8px"}}>{step.desc}</p>
                <div style={{fontSize:12,color:C.gray400}}>💡 {step.tip}</div>
                <div style={{display:"flex",gap:12,marginTop:10,paddingTop:10,borderTop:`1px solid ${C.gray100}`}}>
                  <span style={{fontSize:12,color:C.gray400}}>⏱ {step.time}</span>
                  <span style={{fontSize:12,color:C.gray400}}>💰 {step.cost}</span>
                </div>
              </div>
              {i<steps.length-1&&<div style={{textAlign:"center",marginTop:16,color:C.gray200,fontSize:18}}>↓</div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MiscDetailModal({card,onClose,onUpdate}){
  function applyPhotoFile(file){
    if(!file)return;
    resizeImageFile(file).then(dataUrl=>{if(dataUrl)onUpdate(card.uid,{photo:{dataUrl}});});
  }
  function handlePhotoUpload(e){applyPhotoFile(e.target.files?.[0]);e.target.value="";}
  function handlePhotoPaste(e){const f=getPastedImageFile(e);if(f){e.preventDefault();applyPhotoFile(f);}}
  function addCardPhotoFile(file){
    if(!file)return;
    resizeImageFile(file).then(dataUrl=>{if(dataUrl)onUpdate(card.uid,{photos:[...(card.photos||[]),{dataUrl}]});});
  }
  function removeCardPhoto(pi){onUpdate(card.uid,{photos:(card.photos||[]).filter((_,i)=>i!==pi)});}
  function handleCardPhotosUpload(e){addCardPhotoFile(e.target.files?.[0]);e.target.value="";}
  function handleCardPhotosPaste(e){const f=getPastedImageFile(e);if(f){e.preventDefault();addCardPhotoFile(f);}}
  function updateStepField(si,field,value){
    const steps=card.steps.map((s,i)=>i===si?{...s,[field]:value}:s);
    onUpdate(card.uid,{steps});
  }
  function addStepPhotoFile(si,file){
    if(!file)return;
    resizeImageFile(file).then(dataUrl=>{if(dataUrl)updateStepField(si,"photos",[...(card.steps[si].photos||[]),{dataUrl}]);});
  }
  function removeStepPhoto(si,pi){updateStepField(si,"photos",(card.steps[si].photos||[]).filter((_,i)=>i!==pi));}
  function handleStepPhotoUpload(si,e){addStepPhotoFile(si,e.target.files?.[0]);e.target.value="";}
  function handleStepPhotoPaste(si,e){const f=getPastedImageFile(e);if(f){e.preventDefault();addStepPhotoFile(si,f);}}
  const hasSteps=card.steps&&card.steps.length>0;
  return(
    <div style={{position:"fixed",inset:0,zIndex:99999,background:"rgba(0,0,0,0.5)",backdropFilter:"blur(6px)",display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={onClose}>
      <div style={{background:C.white,borderRadius:24,width:"min(520px,100%)",maxHeight:"90vh",overflow:"hidden",boxShadow:"0 24px 64px rgba(0,0,0,0.2)",display:"flex",flexDirection:"column"}} onClick={e=>e.stopPropagation()}>
        <div style={{padding:"20px 24px",borderBottom:`1px solid ${C.gray100}`,display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <div style={{width:40,height:40,borderRadius:12,background:card.bg||"#EEF4FF",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20}}>{card.icon}</div>
            <span style={{fontSize:16,fontWeight:700,color:card.color||C.gray900}}>{card.label}</span>
          </div>
          <button onClick={onClose} style={{width:32,height:32,borderRadius:"50%",border:`1px solid ${C.gray200}`,background:C.white,cursor:"pointer",fontSize:16,color:C.gray400,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
        </div>
        <div style={{overflowY:"auto",flex:1,padding:"20px 24px"}}>
          {hasSteps?card.steps.map((step,si)=>(
            <div key={si} style={{marginBottom:si<card.steps.length-1?24:0}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
                <span style={{fontSize:11,fontWeight:700,color:card.color,background:card.bg,borderRadius:20,padding:"3px 10px"}}>STEP {si+1}</span>
              </div>
              <PhotoStack photos={step.photos} accentColor={card.color} accentBg={card.bg}
                onUpload={e=>handleStepPhotoUpload(si,e)} onPaste={e=>handleStepPhotoPaste(si,e)} onRemove={pi=>removeStepPhoto(si,pi)}
                hidePhoto={step.hidePhoto} onSetHidePhoto={hp=>updateStepField(si,"hidePhoto",hp)}/>
              {step.hideText?(
                <button onClick={()=>updateStepField(si,"hideText",false)} style={{width:"100%",padding:"10px",borderRadius:12,border:`1.5px dashed ${C.gray200}`,background:"transparent",color:C.gray400,fontSize:13,fontWeight:600,cursor:"pointer"}}>+ 글 추가</button>
              ):(
              <div style={{position:"relative"}}>
                <textarea value={step.desc||""} onChange={e=>updateStepField(si,"desc",e.target.value)} placeholder="이 활동에 대한 글을 남겨보세요" rows={3}
                  style={{width:"100%",padding:"12px 40px 12px 14px",borderRadius:12,border:`1px solid ${C.gray200}`,background:C.gray50,color:C.gray900,fontSize:15,lineHeight:1.7,outline:"none",resize:"vertical",boxSizing:"border-box",fontFamily:"inherit"}}/>
                <button onClick={()=>{if(step.desc){updateStepField(si,"desc","");}else{updateStepField(si,"hideText",true);}}} title="글 칸 없애기" style={{position:"absolute",top:8,right:8,width:24,height:24,borderRadius:"50%",background:C.white,border:`1px solid ${C.gray200}`,cursor:"pointer",fontSize:11,color:C.gray400,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
              </div>
              )}
              {si<card.steps.length-1&&<div style={{textAlign:"center",marginTop:16,color:C.gray200,fontSize:18}}>↓</div>}
            </div>
          )):(<>
            {card.photos!==undefined?(
              <PhotoStack photos={card.photos} accentColor={card.color} accentBg={card.bg} boxHeight={220}
                onUpload={handleCardPhotosUpload} onPaste={handleCardPhotosPaste} onRemove={removeCardPhoto}
                hidePhoto={card.hidePhoto} onSetHidePhoto={hp=>onUpdate(card.uid,{hidePhoto:hp})}/>
            ):card.hidePhoto?(
              <button onClick={()=>onUpdate(card.uid,{hidePhoto:false})} style={{width:"100%",padding:"10px",borderRadius:12,border:`1.5px dashed ${C.gray200}`,background:"transparent",color:C.gray400,fontSize:13,fontWeight:600,cursor:"pointer",marginBottom:16}}>+ 사진 추가</button>
            ):(
            <div style={{position:"relative",marginBottom:16}}>
              <label tabIndex={0} onPaste={handlePhotoPaste} style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",width:"100%",aspectRatio:"4/3",borderRadius:16,border:`1.5px dashed ${card.photo?.dataUrl?card.color:C.gray200}`,background:card.photo?.dataUrl?card.bg:C.gray50,cursor:"pointer",overflow:"hidden",outline:"none"}}>
                <input type="file" accept="image/*" onChange={handlePhotoUpload} style={{display:"none"}}/>
                {card.photo?.dataUrl?<img src={card.photo.dataUrl} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/>:<><span style={{fontSize:32}}>📷</span><span style={{fontSize:13,color:C.gray400,marginTop:8}}>사진 추가</span><span style={{fontSize:11,color:C.gray200,marginTop:2}}>사진 파일에서 가져오기 또는 Ctrl+V</span></>}
              </label>
              <button onClick={e=>{e.stopPropagation();if(card.photo?.dataUrl){onUpdate(card.uid,{photo:null});}else{onUpdate(card.uid,{hidePhoto:true});}}} title="사진 칸 없애기" style={{position:"absolute",bottom:8,right:8,width:24,height:24,borderRadius:"50%",background:"rgba(255,255,255,0.95)",border:`1px solid ${C.gray200}`,cursor:"pointer",fontSize:11,color:C.gray600,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
            </div>
            )}
            {card.hideText?(
              <button onClick={()=>onUpdate(card.uid,{hideText:false})} style={{width:"100%",padding:"10px",borderRadius:12,border:`1.5px dashed ${C.gray200}`,background:"transparent",color:C.gray400,fontSize:13,fontWeight:600,cursor:"pointer"}}>+ 글 추가</button>
            ):(
            <div style={{position:"relative"}}>
              <textarea value={card.text||""} onChange={e=>onUpdate(card.uid,{text:e.target.value})} placeholder="준비물, 참고할 이야기 등을 적어보세요..." rows={6}
                style={{width:"100%",padding:"14px 40px 14px 16px",borderRadius:14,border:`1px solid ${C.gray200}`,background:C.gray50,color:C.gray900,fontSize:15,lineHeight:1.8,outline:"none",resize:"vertical",boxSizing:"border-box",fontFamily:"inherit"}}/>
              <button onClick={()=>{if(card.text){onUpdate(card.uid,{text:""});}else{onUpdate(card.uid,{hideText:true});}}} title="글 칸 없애기" style={{position:"absolute",top:12,right:12,width:26,height:26,borderRadius:"50%",background:C.white,border:`1px solid ${C.gray200}`,cursor:"pointer",fontSize:12,color:C.gray400,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
            </div>
            )}
          </>)}
        </div>
      </div>
    </div>
  );
}

function CommunityDetailModal({route,savedIds,onSave,onClose,onImportPhoto,onSaveStep,onImportBoard}){
  const days=route.dayPlans||[];
  const [dayIdx,setDayIdx]=useState(0);
  const [savedStepKeys,setSavedStepKeys]=useState([]);
  const cur=days[dayIdx];
  return(
    <div style={{position:"fixed",inset:0,zIndex:99999,background:"rgba(0,0,0,0.5)",backdropFilter:"blur(6px)",display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={onClose}>
      <div style={{background:C.white,borderRadius:24,width:"min(660px,100%)",maxHeight:"90vh",overflow:"hidden",boxShadow:"0 24px 64px rgba(0,0,0,0.2)",display:"flex",flexDirection:"column"}} onClick={e=>e.stopPropagation()}>
        <div style={{background:route.bg,padding:"20px 24px",borderBottom:`3px solid ${route.color}20`,flexShrink:0}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
            <div>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                <div style={{width:28,height:28,borderRadius:"50%",background:route.avatarBg||route.color,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700,color:"#fff"}}>{route.avatar}</div>
                <span style={{fontSize:13,fontWeight:600,color:route.color}}>{route.author}</span>
                <span style={{fontSize:12,color:C.gray400}}>· {route.region} · ★{route.rating}</span>
              </div>
              <div style={{fontSize:18,fontWeight:800,color:C.gray900,marginBottom:8}}>{route.title}</div>
              <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                {route.tags.map(t=><span key={t} style={{fontSize:11,fontWeight:600,color:route.color,background:C.white,borderRadius:20,padding:"3px 10px",border:`1px solid ${route.color}30`}}>#{t}</span>)}
                <span style={{fontSize:11,fontWeight:600,color:C.gray600,background:C.white,borderRadius:20,padding:"3px 10px",border:`1px solid ${C.gray200}`}}>💰 {route.totalCost}</span>
              </div>
            </div>
            <button onClick={onClose} style={{width:32,height:32,borderRadius:"50%",border:`1px solid ${route.color}30`,background:C.white,cursor:"pointer",fontSize:14,color:C.gray400,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>✕</button>
          </div>
        </div>
        {route.isBoardLayout&&(
          <div style={{padding:"20px 24px 0",flexShrink:0}}>
            <div style={{background:C.gray50,borderRadius:16,padding:20,marginBottom:16,display:"flex",alignItems:"center",gap:16}}>
              <div style={{fontSize:40,flexShrink:0}}>🗺️</div>
              <div>
                <div style={{fontSize:14,color:C.gray600,lineHeight:1.6}}>{route.desc}</div>
                <div style={{fontSize:12,color:C.gray400,marginTop:6}}>
                  카드 {route.boardSnapshot.filter(i=>i.type!=="arrow"&&i.type!=="text").length}개 · 화살표 {route.boardSnapshot.filter(i=>i.type==="arrow").length}개
                </div>
              </div>
            </div>
            {onImportBoard&&<button onClick={()=>{onImportBoard(route);onClose();}} style={{width:"100%",padding:"14px",borderRadius:14,border:"none",background:route.color,color:"#fff",fontSize:14,fontWeight:700,cursor:"pointer",boxShadow:`0 4px 16px ${route.color}40`,marginBottom:days.length>0?16:0}}>
              보드판에 가져오기
            </button>}
          </div>
        )}
        {days.length>0&&(<>
        <div style={{display:"flex",borderBottom:`1px solid ${C.gray100}`,overflowX:"auto",flexShrink:0,background:C.white}}>
          {days.map((d,i)=><button key={i} onClick={()=>setDayIdx(i)} style={{flexShrink:0,padding:"12px 20px",border:"none",background:"transparent",cursor:"pointer",fontSize:13,fontWeight:600,color:dayIdx===i?route.color:C.gray400,borderBottom:dayIdx===i?`2px solid ${route.color}`:"2px solid transparent",marginBottom:-1,whiteSpace:"nowrap",transition:"all 0.15s"}}>{d.label}</button>)}
        </div>
        {cur&&<div style={{padding:"8px 24px",borderBottom:`1px solid ${C.gray100}`,background:C.gray50,flexShrink:0}}><span style={{fontSize:12,color:C.gray400}}>{cur.theme}</span></div>}
        <div style={{overflowY:"auto",flex:1,padding:"20px 24px"}}>
          {cur?.steps.map((step,i)=>(
            <div key={i} style={{marginBottom:i<cur.steps.length-1?28:0}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
                <span style={{fontSize:11,fontWeight:700,color:route.color,background:route.bg,borderRadius:20,padding:"3px 10px"}}>STEP {i+1}</span>
              </div>
              {(step.photoDataUrl||!route.isMine)&&<div style={{position:"relative",marginBottom:12}}>
                <div style={{width:"100%",aspectRatio:"16/9",borderRadius:16,background:route.bg,border:`1px solid ${route.color}20`,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:8,overflow:"hidden"}}>
                  {step.photoDataUrl?<img src={step.photoDataUrl} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/>:<><span style={{fontSize:72}}>{step.emoji}</span>
                  <span style={{fontSize:12,color:route.color,opacity:0.7}}>현장 사진</span></>}
                </div>
                {onImportPhoto&&<button onClick={()=>onImportPhoto(step)} style={{position:"absolute",top:12,right:12,background:C.white,border:`1px solid ${C.gray200}`,borderRadius:20,padding:"6px 14px",color:C.gray600,fontSize:12,fontWeight:600,cursor:"pointer",boxShadow:C.shadow}}>사진 가져오기</button>}
              </div>}
              <div style={{background:C.gray50,borderRadius:14,padding:"14px"}}>
                <p style={{fontSize:13,color:C.gray600,lineHeight:1.7,margin:step.tip?"0 0 8px":0}}>{step.desc}</p>
                {step.tip&&<div style={{fontSize:12,color:C.gray400}}>💡 {step.tip}</div>}
              </div>
              {onSaveStep&&(()=>{const key=`${dayIdx}-${i}`;const saved=savedStepKeys.includes(key);return(
                <button onClick={()=>{onSaveStep(step,route);setSavedStepKeys(prev=>[...prev,key]);}} disabled={saved} style={{width:"100%",marginTop:10,padding:"9px",borderRadius:10,border:`1px solid ${saved?C.gray200:route.color+"40"}`,background:saved?C.gray50:route.bg,color:saved?C.gray400:route.color,fontSize:12,fontWeight:600,cursor:saved?"default":"pointer"}}>{saved?"✓ 이 스텝 카드로 저장됨":"이 스텝만 카드로 저장"}</button>
              );})()}
              {i<cur.steps.length-1&&<div style={{textAlign:"center",marginTop:16,color:C.gray200,fontSize:18}}>↓</div>}
            </div>
          ))}
          {!route.isBoardLayout&&<button onClick={()=>{onSave(route);onClose();}} style={{width:"100%",padding:"14px",borderRadius:14,border:"none",background:savedIds.includes(route.id)?C.green:route.color,color:"#fff",fontSize:14,fontWeight:700,cursor:"pointer",marginTop:20,boxShadow:`0 4px 16px ${route.color}40`}}>
            {savedIds.includes(route.id)?"✓ 저장됨":"덱 관리에 저장하기"}
          </button>}
        </div>
        </>)}
      </div>
    </div>
  );
}

function useDragFromDeck(item,onDrop,zoom=1){
  const [isDragging,setIsDragging]=useState(false);
  const [ghost,setGhost]=useState(null);
  const [overBoard,setOverBoard]=useState(false);
  function onPointerDown(e){
    e.preventDefault();setIsDragging(true);setGhost({x:e.clientX,y:e.clientY});
    function onMove(ev){setGhost({x:ev.clientX,y:ev.clientY});const b=document.getElementById("game-board");const r=b.getBoundingClientRect();setOverBoard(ev.clientX>=r.left&&ev.clientX<=r.right&&ev.clientY>=r.top&&ev.clientY<=r.bottom);}
    function onUp(ev){
      setIsDragging(false);setGhost(null);setOverBoard(false);
      const b=document.getElementById("game-board");const r=b.getBoundingClientRect();
      if(ev.clientX>=r.left&&ev.clientX<=r.right&&ev.clientY>=r.top&&ev.clientY<=r.bottom){
        const halfW=item.type==="misc"?66:item.type==="text"?70:item.type==="arrow"?32:95;
        const halfH=item.type==="misc"?66:item.type==="text"?55:item.type==="arrow"?32:115;
        onDrop(item,{x:Math.max(0,(ev.clientX-r.left)/zoom-halfW),y:Math.max(0,(ev.clientY-r.top)/zoom-halfH)});
      }
      window.removeEventListener("pointermove",onMove);window.removeEventListener("pointerup",onUp);
    }
    window.addEventListener("pointermove",onMove);window.addEventListener("pointerup",onUp);
  }
  return{isDragging,ghost,overBoard,onPointerDown};
}

function useBoardDrag(card,onRemove,cardW,cardH,scale=1,onPosChange,groupDrag,zoom=1){
  const [hovered,setHovered]=useState(false);const [isDragging,setIsDragging]=useState(false);
  const [overDeck,setOverDeck]=useState(false);const [ghostPos,setGhostPos]=useState(null);
  const pos=useRef(card.pos);const[,forceRender]=useState(0);const hasMoved=useRef(false);
  const justDraggedRef=useRef(false);
  const isSelected=!!groupDrag?.selectedUids?.includes(card.uid);
  const selectedCount=groupDrag?.selectedUids?.length||0;
  useEffect(()=>{
    if(card.pos&&(card.pos.x!==pos.current.x||card.pos.y!==pos.current.y)){
      pos.current=card.pos;
      forceRender(n=>n+1);
    }
  },[card.pos]);
  function onPointerDown(e){
    if(e.target.closest(".rm-btn")||e.target.closest(".resize-handle"))return;e.preventDefault();e.stopPropagation();hasMoved.current=false;
    if(isSelected&&selectedCount>1){
      const sx=e.clientX,sy=e.clientY;
      groupDrag.onGroupStart();
      function onMoveG(ev){if(Math.abs(ev.clientX-sx)>4||Math.abs(ev.clientY-sy)>4){hasMoved.current=true;setIsDragging(true);}if(!hasMoved.current)return;groupDrag.onGroupMove((ev.clientX-sx)/zoom,(ev.clientY-sy)/zoom);}
      function onUpG(ev){
        const moved=hasMoved.current;
        setIsDragging(false);hasMoved.current=false;
        if(moved){
          justDraggedRef.current=true;setTimeout(()=>{justDraggedRef.current=false;},0);
          if(isInDeck(ev.clientX,ev.clientY)){groupDrag.onGroupCancel();}
          else{groupDrag.onGroupEnd();}
        }else{
          groupDrag.onGroupEnd();
        }
        window.removeEventListener("pointermove",onMoveG);window.removeEventListener("pointerup",onUpG);
      }
      window.addEventListener("pointermove",onMoveG);window.addEventListener("pointerup",onUpG);
      return;
    }
    const sx=e.clientX,sy=e.clientY,startX=pos.current.x,startY=pos.current.y;
    function onMove(ev){if(Math.abs(ev.clientX-sx)>4||Math.abs(ev.clientY-sy)>4){hasMoved.current=true;setIsDragging(true);}if(!hasMoved.current)return;const ink=isInDeck(ev.clientX,ev.clientY);setOverDeck(ink);if(ink){setGhostPos({x:ev.clientX,y:ev.clientY});}else{setGhostPos(null);const b=document.getElementById("game-board");const r=b.getBoundingClientRect();const dx=(ev.clientX-sx)/zoom,dy=(ev.clientY-sy)/zoom;const boardW=r.width/zoom,boardH=r.height/zoom;pos.current={x:Math.max(0,Math.min(startX+dx,boardW-cardW*scale)),y:Math.max(0,Math.min(startY+dy,boardH-cardH*scale))};forceRender(n=>n+1);}}
    function onUp(ev){
      const moved=hasMoved.current;
      setIsDragging(false);setOverDeck(false);setGhostPos(null);hasMoved.current=false;
      if(moved){
        justDraggedRef.current=true;setTimeout(()=>{justDraggedRef.current=false;},0);
        if(!isInDeck(ev.clientX,ev.clientY))onPosChange?.(card.uid,pos.current);
      }
      if(moved&&isInDeck(ev.clientX,ev.clientY))onRemove(card.uid);
      window.removeEventListener("pointermove",onMove);window.removeEventListener("pointerup",onUp);
    }
    window.addEventListener("pointermove",onMove);window.addEventListener("pointerup",onUp);
  }
  return{hovered,setHovered,isDragging,overDeck,ghostPos,pos,onPointerDown,justDraggedRef,isSelected};
}

function useCardResize(card,onResize,pos,onPosChange,zoom=1){
  const [isResizing,setIsResizing]=useState(false);
  const [,forceRender]=useState(0);
  const resizedRef=useRef(false);
  function startResize(handle,e){
    e.preventDefault();e.stopPropagation();
    const cardEl=e.currentTarget.parentElement;
    const rect=cardEl.getBoundingClientRect();
    const boardRect=document.getElementById("game-board").getBoundingClientRect();
    const startScale=card.scale||1;
    const baseW=rect.width/startScale,baseH=rect.height/startScale;
    const anchorScreen=
      handle.includes("l")&&handle.includes("t")?{x:rect.left+rect.width,y:rect.top+rect.height}
      :handle.includes("r")&&handle.includes("t")?{x:rect.left,y:rect.top+rect.height}
      :handle.includes("l")&&handle.includes("b")?{x:rect.left+rect.width,y:rect.top}
      :{x:rect.left,y:rect.top};
    const anchorBoard={x:(anchorScreen.x-boardRect.left)/zoom,y:(anchorScreen.y-boardRect.top)/zoom};
    setIsResizing(true);resizedRef.current=true;
    function onMove(ev){
      const effW=Math.abs(ev.clientX-anchorScreen.x);
      const effH=Math.abs(ev.clientY-anchorScreen.y);
      const newScale=Math.min(2.4,Math.max(0.5,Math.max(effW/baseW,effH/baseH)));
      const newW=(baseW/zoom)*newScale,newH=(baseH/zoom)*newScale;
      pos.current={
        x:handle.includes("l")?anchorBoard.x-newW:anchorBoard.x,
        y:handle.includes("t")?anchorBoard.y-newH:anchorBoard.y,
      };
      forceRender(n=>n+1);
      onResize(card.uid,newScale);
    }
    function onUp(){
      setIsResizing(false);
      window.removeEventListener("pointermove",onMove);
      window.removeEventListener("pointerup",onUp);
      onPosChange?.(card.uid,pos.current);
      setTimeout(()=>{resizedRef.current=false;},0);
    }
    window.addEventListener("pointermove",onMove);window.addEventListener("pointerup",onUp);
  }
  return{isResizing,resizedRef,startResize};
}

function RouteDeckCard({route,onDrop,onRemoveFromDeck,zoom}){
  const [hov,setHov]=useState(false);
  const {isDragging,ghost,overBoard,onPointerDown}=useDragFromDeck(route,onDrop,zoom);
  return(
    <>
      <div style={{position:"relative",flexShrink:0}}>
        <div onPointerDown={onPointerDown} onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)}
          style={{width:152,background:hov&&!isDragging?route.bg:C.white,border:`1.5px solid ${hov&&!isDragging?route.color:C.gray200}`,borderRadius:18,padding:"18px 12px",cursor:isDragging?"grabbing":"grab",transform:hov&&!isDragging?"translateY(-6px)":"translateY(0)",transition:"all 0.18s",textAlign:"center",opacity:isDragging?0.3:1,userSelect:"none",touchAction:"none",boxShadow:hov&&!isDragging?`0 8px 20px ${route.color}30`:C.shadow}}>
          {route.photo?.dataUrl?<img src={route.photo.dataUrl} alt="" style={{width:44,height:44,borderRadius:10,objectFit:"cover",marginBottom:8}}/>:<div style={{fontSize:44,marginBottom:8}}>{route.emoji}</div>}
          <div style={{fontSize:14,fontWeight:600,color:C.gray600,lineHeight:1.3,marginBottom:4}}>{route.title}</div>
          <div style={{fontSize:14,color:route.color,fontWeight:500}}>{route.cost}</div>
        </div>
        {onRemoveFromDeck&&<button onClick={()=>onRemoveFromDeck(route.id)} style={{position:"absolute",top:-6,right:-6,width:24,height:24,borderRadius:"50%",background:C.white,border:`1px solid ${C.gray200}`,cursor:"pointer",fontSize:13,color:C.gray400,display:"flex",alignItems:"center",justifyContent:"center",boxShadow:C.shadow}}>✕</button>}
      </div>
      {isDragging&&ghost&&<div style={{position:"fixed",left:ghost.x-95,top:ghost.y-118,width:190,background:overBoard?route.bg:C.white,border:`2px solid ${overBoard?route.color:C.gray200}`,borderRadius:18,padding:"18px 14px",pointerEvents:"none",zIndex:9999,opacity:0.95,transform:"scale(1.05) rotate(2deg)",textAlign:"center",boxShadow:"0 16px 40px rgba(0,0,0,0.2)"}}>
        <div style={{fontSize:50,marginBottom:9}}>{route.emoji}</div>
        <div style={{fontSize:16,fontWeight:600,color:C.gray900}}>{route.title}</div>
        {overBoard&&<div style={{fontSize:13,color:route.color,marginTop:5,fontWeight:600}}>놓으면 추가</div>}
      </div>}
    </>
  );
}

function ArrowDeckCard({arrow,onDrop,zoom}){
  const [hov,setHov]=useState(false);
  const {isDragging,ghost,overBoard,onPointerDown}=useDragFromDeck(arrow,onDrop,zoom);
  const isTxt=arrow.dir==="then"||arrow.dir==="next";
  return(
    <>
      <div onPointerDown={onPointerDown} onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)}
        style={{width:96,height:96,flexShrink:0,background:hov&&!isDragging?arrow.bg:C.white,border:`1.5px solid ${hov&&!isDragging?arrow.color:C.gray200}`,borderRadius:16,display:"flex",alignItems:"center",justifyContent:"center",cursor:isDragging?"grabbing":"grab",transform:hov&&!isDragging?"translateY(-4px)":"translateY(0)",transition:"all 0.18s",opacity:isDragging?0.3:1,userSelect:"none",touchAction:"none",boxShadow:hov&&!isDragging?`0 6px 16px ${arrow.color}30`:C.shadow}}>
        <span style={{fontSize:isTxt?18:38,fontWeight:700,color:hov?arrow.color:C.gray400}}>{arrow.label}</span>
      </div>
      {isDragging&&ghost&&<div style={{position:"fixed",left:ghost.x-64,top:ghost.y-64,width:128,height:128,background:overBoard?arrow.bg:C.white,border:`2px solid ${overBoard?arrow.color:C.gray200}`,borderRadius:16,pointerEvents:"none",zIndex:9999,opacity:0.95,transform:"scale(1.1) rotate(4deg)",display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 12px 32px rgba(0,0,0,0.2)"}}>
        <span style={{fontSize:isTxt?24:42,fontWeight:700,color:arrow.color}}>{arrow.label}</span>
      </div>}
    </>
  );
}

function TextDeckCard({template,onDrop,zoom}){
  const [hov,setHov]=useState(false);
  const {isDragging,ghost,overBoard,onPointerDown}=useDragFromDeck({...template},onDrop,zoom);
  return(
    <>
      <div onPointerDown={onPointerDown} onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)}
        style={{width:100,height:100,flexShrink:0,background:hov&&!isDragging?template.bg:C.white,border:`1.5px solid ${hov&&!isDragging?template.color:C.gray200}`,borderRadius:16,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:5,cursor:isDragging?"grabbing":"grab",transform:hov&&!isDragging?"translateY(-4px)":"translateY(0)",transition:"all 0.18s",opacity:isDragging?0.3:1,userSelect:"none",touchAction:"none",boxShadow:hov&&!isDragging?`0 6px 16px ${template.color}30`:C.shadow}}>
        <span style={{fontSize:32}}>{template.icon}</span>
        <span style={{fontSize:13,fontWeight:600,color:C.gray400}}>{template.label}</span>
      </div>
      {isDragging&&ghost&&<div style={{position:"fixed",left:ghost.x-64,top:ghost.y-64,width:128,height:128,background:overBoard?template.bg:C.white,border:`2px solid ${overBoard?template.color:C.gray200}`,borderRadius:16,pointerEvents:"none",zIndex:9999,opacity:0.95,transform:"scale(1.1) rotate(3deg)",display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 12px 32px rgba(0,0,0,0.2)"}}>
        <span style={{fontSize:44}}>{template.icon}</span>
      </div>}
    </>
  );
}

function MiscDeckCard({template,onDrop,onRemoveFromDeck,zoom}){
  const [hov,setHov]=useState(false);
  const {isDragging,ghost,overBoard,onPointerDown}=useDragFromDeck({...template},onDrop,zoom);
  return(
    <>
      <div style={{position:"relative",flexShrink:0}}>
        <div onPointerDown={onPointerDown} onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)}
          style={{width:100,height:100,background:hov&&!isDragging?template.bg:C.white,border:`1.5px solid ${hov&&!isDragging?template.color:C.gray200}`,borderRadius:16,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:5,cursor:isDragging?"grabbing":"grab",transform:hov&&!isDragging?"translateY(-4px)":"translateY(0)",transition:"all 0.18s",opacity:isDragging?0.3:1,userSelect:"none",touchAction:"none",boxShadow:hov&&!isDragging?`0 6px 16px ${template.color}30`:C.shadow,overflow:"hidden"}}>
          {template.photo?.dataUrl?<img src={template.photo.dataUrl} alt="" style={{width:44,height:44,borderRadius:10,objectFit:"cover"}}/>:<span style={{fontSize:32}}>{template.icon}</span>}
          <span style={{fontSize:11,fontWeight:600,color:C.gray400,padding:"0 4px",textAlign:"center",lineHeight:1.3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:"100%"}}>{template.label}</span>
        </div>
        {onRemoveFromDeck&&<button onClick={()=>onRemoveFromDeck(template.id)} style={{position:"absolute",top:-6,right:-6,width:20,height:20,borderRadius:"50%",background:C.white,border:`1px solid ${C.gray200}`,cursor:"pointer",fontSize:11,color:C.gray400,display:"flex",alignItems:"center",justifyContent:"center",boxShadow:C.shadow}}>✕</button>}
      </div>
      {isDragging&&ghost&&<div style={{position:"fixed",left:ghost.x-64,top:ghost.y-64,width:128,height:128,background:overBoard?template.bg:C.white,border:`2px solid ${overBoard?template.color:C.gray200}`,borderRadius:16,pointerEvents:"none",zIndex:9999,opacity:0.95,transform:"scale(1.1) rotate(3deg)",display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 12px 32px rgba(0,0,0,0.2)"}}>
        <span style={{fontSize:44}}>{template.icon}</span>
      </div>}
    </>
  );
}

function BoardRouteCard({card,onRemove,onOpen,onResize,onPosChange,groupDrag,zoom}){
  const scale=card.scale||1;
  const {hovered,setHovered,isDragging,overDeck,ghostPos,pos,onPointerDown,justDraggedRef,isSelected}=useBoardDrag(card,onRemove,196,244,scale,onPosChange,groupDrag,zoom);
  const {isResizing,resizedRef,startResize}=useCardResize(card,onResize,pos,onPosChange,zoom);
  const HANDLES=[["tl","nwse-resize",{top:6,left:6}],["tr","nesw-resize",{top:6,right:6}],["bl","nesw-resize",{bottom:6,left:6}],["br","nwse-resize",{bottom:6,right:6}]];
  return(
    <>
      <div data-carduid={card.uid} onPointerDown={onPointerDown} onMouseEnter={()=>setHovered(true)} onMouseLeave={()=>setHovered(false)} onClick={()=>{if(!isDragging&&!resizedRef.current&&!justDraggedRef.current)onOpen(card);}}
        style={{position:"absolute",left:pos.current.x,top:pos.current.y,width:190,transform:`scale(${scale})`,transformOrigin:"top left",background:C.white,border:`1.5px solid ${overDeck?C.coral:hovered&&!isDragging?card.color:C.gray200}`,borderRadius:20,overflow:"hidden",cursor:isDragging?"grabbing":"grab",transition:isDragging||isResizing?"none":"border-color 0.15s,box-shadow 0.15s",boxShadow:overDeck?"none":isDragging?"0 20px 48px rgba(0,0,0,0.2)":hovered?C.shadowHover:C.shadow,zIndex:isDragging||isResizing?999:hovered?100:10,userSelect:"none",touchAction:"none",opacity:overDeck?0.4:1,outline:isSelected?`3px solid #2F6FED`:"none",outlineOffset:2}}>
        <div style={{height:130,background:card.bg||"#EEF4FF",display:"flex",alignItems:"center",justifyContent:"center",fontSize:48,position:"relative",overflow:"hidden"}}>
          {card.photo?.dataUrl?<img src={card.photo.dataUrl} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/>:card.emoji}
          {hovered&&!isDragging&&<button className="rm-btn" onClick={e=>{e.stopPropagation();onRemove(card.uid);}} style={{position:"absolute",top:8,right:8,width:26,height:26,borderRadius:"50%",background:"rgba(255,255,255,0.9)",border:"none",cursor:"pointer",fontSize:13,color:C.gray400,display:"flex",alignItems:"center",justifyContent:"center",zIndex:20}}>✕</button>}
        </div>
        <div style={{padding:"14px 14px 16px"}}>
          <div style={{fontSize:15,fontWeight:700,color:C.gray900,lineHeight:1.4,marginBottom:6}}>{card.title}</div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:6}}>
            <span style={{fontSize:12,color:card.color||C.coral,background:card.bg||"#FFF0F0",borderRadius:8,padding:"3px 8px",fontWeight:600}}>{card.duration}</span>
            <span style={{fontSize:12,color:C.gray400}}>{card.cost}</span>
          </div>
          {hovered&&!isDragging&&<div style={{fontSize:12,color:card.color||C.coral,fontWeight:600}}>탭해서 경로 보기</div>}
        </div>
        {onResize&&(hovered||isResizing)&&!isDragging&&HANDLES.map(([handle,cursor,posStyle])=>(
          <div key={handle} className="resize-handle" onPointerDown={e=>startResize(handle,e)}
            style={{position:"absolute",...posStyle,width:20,height:20,cursor,zIndex:10,background:"transparent",touchAction:"none"}}/>
        ))}
      </div>
      {isDragging&&ghostPos&&overDeck&&<div style={{position:"fixed",left:ghostPos.x-95,top:ghostPos.y-122,width:190,background:C.white,border:`2px solid ${C.coral}`,borderRadius:20,overflow:"hidden",pointerEvents:"none",zIndex:9999,opacity:0.85,transform:"scale(1.03) rotate(-2deg)",boxShadow:"0 16px 40px rgba(0,0,0,0.2)"}}>
        <div style={{height:130,background:card.bg||"#FFF0F0",display:"flex",alignItems:"center",justifyContent:"center",fontSize:48}}>{card.emoji}</div>
        <div style={{padding:"10px 12px"}}><div style={{fontSize:13,color:C.coral,fontWeight:600,textAlign:"center"}}>덱으로 되돌리기</div></div>
      </div>}
    </>
  );
}

function BoardArrowCard({card,onRemove,onPosChange,groupDrag,zoom}){
  const isTxt=card.dir==="then"||card.dir==="next";
  const {hovered,setHovered,isDragging,overDeck,ghostPos,pos,onPointerDown,isSelected}=useBoardDrag(card,onRemove,80,80,1,onPosChange,groupDrag,zoom);
  return(
    <>
      <div data-carduid={card.uid} onPointerDown={onPointerDown} onMouseEnter={()=>setHovered(true)} onMouseLeave={()=>setHovered(false)}
        style={{position:"absolute",left:pos.current.x,top:pos.current.y,width:64,height:64,background:hovered&&!isDragging?card.bg:C.white,border:`1.5px solid ${overDeck?C.coral:hovered&&!isDragging?card.color:C.gray200}`,borderRadius:14,display:"flex",alignItems:"center",justifyContent:"center",cursor:isDragging?"grabbing":"grab",transition:isDragging?"none":"all 0.15s",boxShadow:hovered&&!isDragging?C.shadowHover:C.shadow,zIndex:isDragging?999:hovered?100:15,userSelect:"none",touchAction:"none",opacity:overDeck?0.4:1,outline:isSelected?`3px solid #2F6FED`:"none",outlineOffset:2}}>
        {hovered&&!isDragging&&<button className="rm-btn" onClick={()=>onRemove(card.uid)} style={{position:"absolute",top:3,right:3,background:"none",border:"none",cursor:"pointer",fontSize:9,color:C.gray400,lineHeight:1}}>✕</button>}
        <span style={{fontSize:isTxt?12:24,fontWeight:700,color:overDeck?C.coral:card.color}}>{card.label}</span>
      </div>
      {isDragging&&ghostPos&&overDeck&&<div style={{position:"fixed",left:ghostPos.x-36,top:ghostPos.y-36,width:72,height:72,background:"#FFF0F0",border:`2px solid ${C.coral}`,borderRadius:14,display:"flex",alignItems:"center",justifyContent:"center",pointerEvents:"none",zIndex:9999,opacity:0.85}}>
        <span style={{fontSize:isTxt?12:20,fontWeight:700,color:C.coral}}>{card.label}</span>
      </div>}
    </>
  );
}


function BoardMiscCard({card,onRemove,onOpen,onPosChange,groupDrag,zoom}){
  const {hovered,setHovered,isDragging,overDeck,ghostPos,pos,onPointerDown,justDraggedRef,isSelected}=useBoardDrag(card,onRemove,132,132,1,onPosChange,groupDrag,zoom);
  return(
    <>
      <div data-carduid={card.uid} onPointerDown={onPointerDown} onMouseEnter={()=>setHovered(true)} onMouseLeave={()=>setHovered(false)} onClick={()=>{if(!isDragging&&!justDraggedRef.current)onOpen(card);}}
        style={{position:"absolute",left:pos.current.x,top:pos.current.y,width:132,background:C.white,border:`1.5px solid ${overDeck?C.coral:hovered&&!isDragging?card.color:C.gray200}`,borderRadius:18,padding:"18px 12px",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:8,cursor:isDragging?"grabbing":"grab",transition:isDragging?"none":"all 0.15s",boxShadow:hovered&&!isDragging?C.shadowHover:C.shadow,zIndex:isDragging?999:hovered?100:10,userSelect:"none",touchAction:"none",opacity:overDeck?0.4:1,outline:isSelected?`3px solid #2F6FED`:"none",outlineOffset:2}}>
        {hovered&&!isDragging&&<button className="rm-btn" onClick={e=>{e.stopPropagation();onRemove(card.uid);}} style={{position:"absolute",top:6,right:6,width:20,height:20,borderRadius:"50%",background:"rgba(255,255,255,0.9)",border:"none",cursor:"pointer",fontSize:10,color:C.gray400,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>}
        <span style={{fontSize:32}}>{card.icon}</span>
        <span style={{fontSize:13,fontWeight:700,color:card.color}}>{card.label}</span>
        {hovered&&!isDragging&&<div style={{fontSize:10,color:card.color,fontWeight:600}}>탭해서 자세히 보기</div>}
      </div>
      {isDragging&&ghostPos&&overDeck&&<div style={{position:"fixed",left:ghostPos.x-66,top:ghostPos.y-66,width:132,background:"#FFF0F0",border:`2px solid ${C.coral}`,borderRadius:18,padding:"12px",pointerEvents:"none",zIndex:9999,opacity:0.85,textAlign:"center"}}>
        <div style={{fontSize:11,color:C.coral,fontWeight:600}}>덱으로 되돌리기</div>
      </div>}
    </>
  );
}

function DeckRouteManager({deckRouteIds,setDeckRouteIds,onAddRegionToBoard,deletedIds,onDeleteForever,savedRoutes,deckCommunityIds,setDeckCommunityIds,onAddRouteToBoard,onAddRouteDayToBoard,onRemoveRouteDayFromBoard,onDeleteSavedRoute,onAddSingleRouteToBoard,onRemoveSingleRouteFromBoard,myCards,isMyCardOnBoard,onAddMyCardToBoard,onRemoveMyCardFromBoard,isSavedDayMerged,onToggleSavedDayMerge}){
  function setMyCardBoard(card,on){
    const isIn=isMyCardOnBoard?isMyCardOnBoard(card.id):false;
    if(on&&!isIn){onAddMyCardToBoard&&onAddMyCardToBoard(card);}
    else if(!on&&isIn){onRemoveMyCardFromBoard&&onRemoveMyCardFromBoard(card.id);}
  }
  function idsForDayMode(route,di,merged){
    if(merged)return[`${route.id}_d${di}`];
    return((route.dayPlans||[])[di]?.steps||[]).map((_,si)=>`${route.id}_d${di}_s${si}`);
  }
  function dayStepIds(route,di){return idsForDayMode(route,di,isSavedDayMerged&&isSavedDayMerged(route.id,di));}
  function isDayInDeck(route,di){const ids=dayStepIds(route,di);return ids.length>0&&ids.every(id=>deckCommunityIds.includes(id));}
  function setSavedRouteDayBoard(route,di,on){
    const ids=dayStepIds(route,di);
    const isIn=isDayInDeck(route,di);
    if(on&&!isIn){
      setDeckCommunityIds(prev=>[...new Set([...prev,...ids])]);
      onAddRouteDayToBoard&&onAddRouteDayToBoard(route,di);
    }else if(!on&&isIn){
      setDeckCommunityIds(prev=>prev.filter(id=>!ids.includes(id)));
      onRemoveRouteDayFromBoard&&onRemoveRouteDayFromBoard(route,di);
    }
  }
  function toggleDayMergeMode(route,di){
    const wasMerged=isSavedDayMerged?isSavedDayMerged(route.id,di):false;
    const nowMerged=!wasMerged;
    const wasIn=isDayInDeck(route,di);
    if(wasIn){
      const oldIds=idsForDayMode(route,di,wasMerged);
      setDeckCommunityIds(prev=>prev.filter(id=>!oldIds.includes(id)));
      onRemoveRouteDayFromBoard&&onRemoveRouteDayFromBoard(route,di);
    }
    onToggleSavedDayMerge&&onToggleSavedDayMerge(route.id,di);
    if(wasIn){
      const newIds=idsForDayMode(route,di,nowMerged);
      setDeckCommunityIds(prev=>[...new Set([...prev,...newIds])]);
      onAddRouteDayToBoard&&onAddRouteDayToBoard(route,di,nowMerged);
    }
  }
  function addWholeSavedRouteToBoard(route){
    const days=route.dayPlans||[];
    const ids=days.flatMap((d,di)=>dayStepIds(route,di));
    setDeckCommunityIds(prev=>[...new Set([...prev,...ids])]);
    onAddRouteToBoard&&onAddRouteToBoard(route);
  }
  function setDeckRouteBoard(route,on){
    const isIn=deckRouteIds.includes(route.id);
    if(on&&!isIn){
      setDeckRouteIds(prev=>[...prev,route.id]);
      onAddSingleRouteToBoard&&onAddSingleRouteToBoard(route);
    }else if(!on&&isIn){
      setDeckRouteIds(prev=>prev.filter(i=>i!==route.id));
      onRemoveSingleRouteFromBoard&&onRemoveSingleRouteFromBoard(route.id);
    }
  }
  const visibleRouteDeck=ROUTE_DECK.filter(r=>!(deletedIds||[]).includes(r.id));
  const containerRef=useRef();
  const [selecting,setSelecting]=useState(false);
  const [mode,setMode]=useState("remove");
  const [selBox,setSelBox]=useState(null);
  const [hoveredIds,setHoveredIds]=useState([]);
  const startPt=useRef(null);
  const draggedRef=useRef(false);
  function getRect(x1,y1,x2,y2){return{left:Math.min(x1,x2),top:Math.min(y1,y2),right:Math.max(x1,x2),bottom:Math.max(y1,y2)};}
  function getSelectedIds(box){
    if(!containerRef.current||!box)return[];
    const sel=getRect(box.x1,box.y1,box.x2,box.y2);
    const found=[];
    containerRef.current.querySelectorAll("[data-routeid]").forEach(el=>{
      const r=el.getBoundingClientRect();const cr=containerRef.current.getBoundingClientRect();
      const l=r.left-cr.left,t=r.top-cr.top,ri=l+r.width,b=t+r.height;
      if(ri>sel.left&&l<sel.right&&b>sel.top&&t<sel.bottom){
        const kind=el.dataset.kind;
        found.push({kind,id:kind==="deck"?Number(el.dataset.routeid):el.dataset.routeid});
      }
    });
    return found;
  }
  function onMouseDown(e){
    if(e.button!==0&&e.button!==2)return;
    const cr=containerRef.current.getBoundingClientRect();
    const x=e.clientX-cr.left,y=e.clientY-cr.top;
    startPt.current={x,y};
    draggedRef.current=false;
    const idsRef={current:[]};
    const thisButton=e.button;
    const thisMode=thisButton===2?"add":"remove";
    setMode(thisMode);setSelBox({x1:x,y1:y,x2:x,y2:y});setHoveredIds([]);
    function onMove(ev){
      const x2=ev.clientX-cr.left,y2=ev.clientY-cr.top;
      if(!draggedRef.current&&(Math.abs(x2-startPt.current.x)>4||Math.abs(y2-startPt.current.y)>4)){draggedRef.current=true;setSelecting(true);}
      if(!draggedRef.current)return;
      const box={x1:startPt.current.x,y1:startPt.current.y,x2,y2};setSelBox(box);
      idsRef.current=getSelectedIds(box);
      setHoveredIds(idsRef.current);
    }
    function onUp(ev){
      if(ev.button!==thisButton)return;
      setSelecting(false);setSelBox(null);setHoveredIds([]);
      if(draggedRef.current&&idsRef.current.length>0){
        const on=thisMode==="add";
        idsRef.current.forEach(({kind,id})=>{
          if(kind==="deck"){const route=visibleRouteDeck.find(r=>r.id===id);if(route)setDeckRouteBoard(route,on);}
          else if(kind==="savedDay"){
            const[routeId,diStr]=id.split("::");
            const route=(savedRoutes||[]).find(r=>String(r.id)===routeId);
            if(route)setSavedRouteDayBoard(route,Number(diStr),on);
          }
          else if(kind==="myCard"){const card=(myCards||[]).find(c=>c.id===id);if(card)setMyCardBoard(card,on);}
        });
      }
      window.removeEventListener("mousemove",onMove);
      window.removeEventListener("mouseup",onUp);
    }
    window.addEventListener("mousemove",onMove);
    window.addEventListener("mouseup",onUp);
    e.preventDefault();
  }
  function onContextMenu(e){e.preventDefault();}
  const selRect=selBox?getRect(selBox.x1,selBox.y1,selBox.x2,selBox.y2):null;
  const selColor=mode==="add"?C.green:C.coral;
  return(
    <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16,flexWrap:"wrap",gap:6}}>
        <div style={{fontSize:15,fontWeight:700,color:C.gray900}}>기본 루트 카드 <span style={{color:C.gray400,fontWeight:500,fontSize:12}}>{deckRouteIds.length}/{visibleRouteDeck.length}</span></div>
        <div style={{fontSize:11,color:C.gray400}}>클릭 → 보드판 추가/제거 · 드래그로 여러 개 선택(좌클릭 보드판에서 제거·우클릭 보드판에 추가) · 모서리 ✕ → 완전히 삭제 · 저장한 루트의 "합침/분리"로 일차 스텝을 한 카드로 묶거나 나눌 수 있음</div>
      </div>
      <div ref={containerRef} onMouseDown={onMouseDown} onContextMenu={onContextMenu}
        style={{position:"relative",display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))",gap:14,alignContent:"start",padding:"20px",background:C.gray50,borderRadius:16,border:`1.5px solid ${selecting?selColor+"60":C.gray200}`,userSelect:"none",cursor:selecting?"crosshair":"default",flex:1,minHeight:200,transition:"border-color 0.15s"}}>
        {savedRoutes&&savedRoutes.length>0&&(
          <div style={{gridColumn:"1 / -1",display:"contents"}}>
            <div style={{gridColumn:"1 / -1",display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,paddingBottom:2,borderBottom:`1px solid ${C.gray200}`}}>
              <div style={{fontSize:12,fontWeight:700,color:C.gray400}}>저장한 루트 <span style={{fontWeight:500,color:C.gray400}}>{savedRoutes.length}개</span></div>
            </div>
            {savedRoutes.map(route=>{
              const days=route.dayPlans||[];
              return(
                <div key={route.id} style={{position:"relative",gridColumn:"span 1",display:"flex",flexDirection:"column",gap:6,background:C.white,border:`1.5px solid ${C.gray200}`,borderRadius:14,padding:14}}>
                  <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:2}}>
                    <div style={{width:52,height:52,flexShrink:0,borderRadius:12,background:route.bg,display:"flex",alignItems:"center",justifyContent:"center",fontSize:26}}>{route.coverEmoji||"🗺️"}</div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:13,fontWeight:700,color:C.gray900,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{route.title}</div>
                      <div style={{fontSize:11,color:C.gray400}}>{route.region}</div>
                    </div>
                  </div>
                  <button onMouseDown={e=>e.stopPropagation()} onContextMenu={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();addWholeSavedRouteToBoard(route);}}
                    style={{padding:"5px 10px",borderRadius:20,border:"none",background:C.coral,color:"#fff",fontSize:11,fontWeight:700,cursor:"pointer"}}>
                    보드판에 순서대로 추가
                  </button>
                  <div style={{display:"flex",flexDirection:"column",gap:6,marginTop:4}}>
                    {days.map((day,di)=>{
                      const inDeck=isDayInDeck(route,di);
                      const isH=hoveredIds.some(h=>h.kind==="savedDay"&&h.id===`${route.id}::${di}`);
                      const hc=mode==="add"?C.green:C.coral;
                      const merged=isSavedDayMerged?isSavedDayMerged(route.id,di):false;
                      return(
                        <div key={di} data-kind="savedDay" data-routeid={`${route.id}::${di}`}
                          onClick={()=>{if(!draggedRef.current)setSavedRouteDayBoard(route,di,!inDeck);}}
                          style={{cursor:"pointer",display:"flex",alignItems:"center",gap:8,padding:"7px 12px",borderRadius:20,background:isH?`${hc}12`:inDeck?route.bg:C.gray100,border:`1.5px solid ${isH?hc:inDeck?route.color+"40":"transparent"}`,opacity:inDeck?1:0.4,transition:"all 0.12s"}}>
                          <span style={{flex:1,minWidth:0,fontSize:12,fontWeight:600,color:isH?hc:inDeck?C.gray900:C.gray400,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{day.label}</span>
                          <button onMouseDown={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();toggleDayMergeMode(route,di);}}
                            title={merged?"분리 형식으로 바꾸기":"합친 형식으로 바꾸기"}
                            style={{flexShrink:0,padding:"3px 8px",borderRadius:20,border:`1px solid ${merged?route.color+"50":C.gray200}`,background:merged?route.bg:C.white,color:merged?route.color:C.gray400,fontSize:10,fontWeight:700,cursor:"pointer"}}>
                            {merged?"합침":"분리"}
                          </button>
                          <button onMouseDown={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();setSavedRouteDayBoard(route,di,!inDeck);}}
                            style={{background:"none",border:"none",cursor:"pointer",fontSize:14,color:inDeck?C.coral:C.green,fontWeight:700,flexShrink:0}}>
                            {inDeck?"✕":"+"}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                  {onDeleteSavedRoute&&<button onMouseDown={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();onDeleteSavedRoute(route.id);}}
                    title="저장한 루트 완전히 삭제"
                    style={{position:"absolute",top:-8,right:-8,width:22,height:22,borderRadius:"50%",background:C.white,border:`1px solid ${C.gray200}`,cursor:"pointer",fontSize:11,color:C.gray400,display:"flex",alignItems:"center",justifyContent:"center",boxShadow:C.shadow}}
                    onMouseEnter={e=>{e.currentTarget.style.background=C.coral;e.currentTarget.style.color="#fff";e.currentTarget.style.borderColor=C.coral;}}
                    onMouseLeave={e=>{e.currentTarget.style.background=C.white;e.currentTarget.style.color=C.gray400;e.currentTarget.style.borderColor=C.gray200;}}>
                    ✕
                  </button>}
                </div>
              );
            })}
          </div>
        )}
        {myCards&&myCards.length>0&&(
          <div style={{gridColumn:"1 / -1",display:"contents"}}>
            <div style={{gridColumn:"1 / -1",display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,marginTop:8,paddingBottom:2,borderBottom:`1px solid ${C.gray200}`}}>
              <div style={{fontSize:12,fontWeight:700,color:C.gray400}}>내가 만든 카드 <span style={{fontWeight:500,color:C.gray400}}>{myCards.length}개</span></div>
            </div>
            {myCards.map(card=>{
              const isMisc=card.type==="misc";
              const inDeck=isMyCardOnBoard?isMyCardOnBoard(card.id):false;
              const isH=hoveredIds.some(h=>h.kind==="myCard"&&h.id===card.id);
              const hc=mode==="add"?C.green:C.coral;
              const label=isMisc?card.label:card.title;
              const icon=isMisc?card.icon:(card.photo?.emoji||"📍");
              const color=card.color||C.coral;
              return(
                <div key={card.id} data-kind="myCard" data-routeid={card.id} onClick={()=>{if(!draggedRef.current)setMyCardBoard(card,!inDeck);}}
                  style={{position:"relative",cursor:"pointer",background:isH?`${hc}12`:inDeck?C.white:C.gray100,border:`1.5px solid ${isH?hc:inDeck?C.gray200:"transparent"}`,borderRadius:14,padding:"14px 16px",display:"flex",alignItems:"center",gap:12,opacity:inDeck?1:0.4,transition:"all 0.12s",boxShadow:inDeck&&!isH?C.shadow:"none"}}>
                  <span style={{fontSize:28,filter:inDeck?"none":"grayscale(1)"}}>{icon}</span>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:13,fontWeight:600,color:isH?hc:inDeck?C.gray900:C.gray400,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{label||"제목 없음"}</div>
                  </div>
                  <button onMouseDown={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();setMyCardBoard(card,!inDeck);}}
                    style={{background:"none",border:"none",cursor:"pointer",fontSize:15,color:inDeck?C.coral:C.green,marginLeft:"auto",fontWeight:700}}>
                    {inDeck?"✕":"+"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
        {groupByRegion(visibleRouteDeck,r=>r.region).map(({region,items})=>(
          <div key={region} style={{gridColumn:"1 / -1",display:"contents"}}>
            <div style={{gridColumn:"1 / -1",display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,marginTop:8,paddingBottom:2,borderBottom:`1px solid ${C.gray200}`}}>
              <div style={{fontSize:12,fontWeight:700,color:C.gray400}}>{region} <span style={{fontWeight:500,color:C.gray400}}>{items.filter(r=>deckRouteIds.includes(r.id)).length}/{items.length}</span></div>
              <button onMouseDown={e=>e.stopPropagation()} onContextMenu={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();onAddRegionToBoard&&onAddRegionToBoard(region);}}
                style={{flexShrink:0,padding:"3px 10px",borderRadius:20,border:"none",background:C.coral,color:"#fff",fontSize:11,fontWeight:700,cursor:"pointer"}}>
                보드판에 순서대로 추가
              </button>
            </div>
            {items.map(route=>{
              const inDeck=deckRouteIds.includes(route.id);
              const isH=hoveredIds.some(h=>h.kind==="deck"&&h.id===route.id);
              const hc=mode==="add"?C.green:C.coral;
              function toggleThis(){setDeckRouteBoard(route,!inDeck);}
              return(
                <div key={route.id} data-kind="deck" data-routeid={route.id} onClick={()=>{if(!draggedRef.current)toggleThis();}}
                  style={{position:"relative",cursor:"pointer",background:isH?`${hc}12`:inDeck?C.white:C.gray100,border:`1.5px solid ${isH?hc:inDeck?C.gray200:"transparent"}`,borderRadius:14,padding:"14px 16px",display:"flex",alignItems:"center",gap:12,opacity:inDeck?1:0.4,transition:"all 0.12s",boxShadow:inDeck&&!isH?C.shadow:"none"}}>
                  <span style={{fontSize:28,filter:inDeck?"none":"grayscale(1)"}}>{route.emoji}</span>
                  <div>
                    <div style={{fontSize:13,fontWeight:600,color:isH?hc:inDeck?C.gray900:C.gray400}}>{route.title}</div>
                    <div style={{fontSize:12,color:isH?hc:C.gray400}}>{route.cost}</div>
                  </div>
                  <button onMouseDown={e=>e.stopPropagation()} onContextMenu={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();toggleThis();}}
                    style={{background:"none",border:"none",cursor:"pointer",fontSize:15,color:inDeck?C.coral:C.green,marginLeft:"auto",fontWeight:700}}>
                    {inDeck?"✕":"+"}
                  </button>
                  {onDeleteForever&&<button onMouseDown={e=>e.stopPropagation()} onContextMenu={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();onDeleteForever(route.id);}}
                    title="이 카드덱 완전히 삭제"
                    style={{position:"absolute",top:-8,right:-8,width:22,height:22,borderRadius:"50%",background:C.white,border:`1px solid ${C.gray200}`,cursor:"pointer",fontSize:11,color:C.gray400,display:"flex",alignItems:"center",justifyContent:"center",boxShadow:C.shadow}}
                    onMouseEnter={e=>{e.currentTarget.style.background=C.coral;e.currentTarget.style.color="#fff";e.currentTarget.style.borderColor=C.coral;}}
                    onMouseLeave={e=>{e.currentTarget.style.background=C.white;e.currentTarget.style.color=C.gray400;e.currentTarget.style.borderColor=C.gray200;}}>
                    ✕
                  </button>}
                </div>
              );
            })}
          </div>
        ))}
        {selecting&&selRect&&selRect.right-selRect.left>4&&<div style={{position:"absolute",left:selRect.left,top:selRect.top,width:selRect.right-selRect.left,height:selRect.bottom-selRect.top,border:`1.5px solid ${selColor}`,background:`${selColor}10`,borderRadius:8,pointerEvents:"none",zIndex:100}}/>}
      </div>
      {hoveredIds.length>0&&<div style={{marginTop:8,fontSize:12,color:selColor,fontWeight:600,textAlign:"right"}}>{hoveredIds.length}개 선택 · 놓으면 보드판에 {mode==="add"?"추가":"제거"}</div>}
    </div>
  );
}

function makeStep(){return{id:`s_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,title:"",desc:"",photos:[]};}
function normalizeStepPhotos(step){return step.photos?step:{...step,photos:step.photo?[step.photo]:[]};}
function makeDay(kind="day"){return{id:`d_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,kind,theme:"",steps:[makeStep()],merge:false};}

const DRAW_COLORS=["#1A1A1A","#FF5A5A","#FF9F43","#2F6FED","#22C08C","#8B5CF6","#FFFFFF"];
function DrawCanvasModal({onSave,onClose}){
  const canvasRef=useRef(null);
  const drawingRef=useRef(false);
  const lastPt=useRef(null);
  const [color,setColor]=useState(DRAW_COLORS[0]);
  const [brush,setBrush]=useState(6);
  const [text,setText]=useState("");
  useEffect(()=>{
    const canvas=canvasRef.current;
    const ctx=canvas.getContext("2d");
    ctx.fillStyle="#FFFFFF";
    ctx.fillRect(0,0,canvas.width,canvas.height);
  },[]);
  function getPos(e){
    const rect=canvasRef.current.getBoundingClientRect();
    return{x:(e.clientX-rect.left)*(canvasRef.current.width/rect.width),y:(e.clientY-rect.top)*(canvasRef.current.height/rect.height)};
  }
  function onDown(e){drawingRef.current=true;lastPt.current=getPos(e);}
  function onMove(e){
    if(!drawingRef.current)return;
    const p=getPos(e);
    const ctx=canvasRef.current.getContext("2d");
    ctx.strokeStyle=color;ctx.lineWidth=brush;ctx.lineCap="round";ctx.lineJoin="round";
    ctx.beginPath();ctx.moveTo(lastPt.current.x,lastPt.current.y);ctx.lineTo(p.x,p.y);ctx.stroke();
    lastPt.current=p;
  }
  function onUp(){drawingRef.current=false;lastPt.current=null;}
  function clearCanvas(){
    const canvas=canvasRef.current;const ctx=canvas.getContext("2d");
    ctx.fillStyle="#FFFFFF";ctx.fillRect(0,0,canvas.width,canvas.height);
  }
  function addText(){
    if(!text.trim())return;
    const canvas=canvasRef.current;const ctx=canvas.getContext("2d");
    ctx.fillStyle=color;ctx.font="bold 36px 'Pretendard',sans-serif";ctx.textAlign="center";ctx.textBaseline="middle";
    ctx.fillText(text.trim(),canvas.width/2,canvas.height/2);
    setText("");
  }
  function finish(){onSave(canvasRef.current.toDataURL("image/png"));}
  return(
    <div style={{position:"fixed",inset:0,zIndex:99999,background:"rgba(0,0,0,0.5)",backdropFilter:"blur(6px)",display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={onClose}>
      <div style={{background:C.white,borderRadius:24,width:"min(560px,100%)",boxShadow:"0 24px 64px rgba(0,0,0,0.2)",padding:24}} onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
          <div style={{fontSize:18,fontWeight:800,color:C.gray900}}>직접 그리기</div>
          <button onClick={onClose} style={{width:32,height:32,borderRadius:"50%",border:`1px solid ${C.gray200}`,background:C.white,cursor:"pointer",fontSize:16,color:C.gray400}}>✕</button>
        </div>
        <canvas ref={canvasRef} width={480} height={320} onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp}
          style={{width:"100%",aspectRatio:"480/320",borderRadius:14,border:`1.5px solid ${C.gray200}`,cursor:"crosshair",touchAction:"none"}}/>
        <div style={{display:"flex",alignItems:"center",gap:8,marginTop:14,flexWrap:"wrap"}}>
          {DRAW_COLORS.map(c=>(
            <button key={c} onClick={()=>setColor(c)} style={{width:28,height:28,borderRadius:"50%",background:c,border:color===c?`3px solid ${C.coral}`:`1.5px solid ${C.gray200}`,cursor:"pointer"}}/>
          ))}
          <div style={{width:1,height:20,background:C.gray200,margin:"0 4px"}}/>
          {[3,6,12].map(b=>(
            <button key={b} onClick={()=>setBrush(b)} style={{width:32,height:32,borderRadius:9,border:`1.5px solid ${brush===b?C.coral:C.gray200}`,background:brush===b?"#FFF0F0":C.white,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>
              <span style={{width:b,height:b,borderRadius:"50%",background:brush===b?C.coral:C.gray400}}/>
            </button>
          ))}
          <button onClick={clearCanvas} style={{marginLeft:"auto",padding:"7px 14px",borderRadius:10,border:`1px solid ${C.gray200}`,background:C.white,color:C.gray600,fontSize:12,fontWeight:600,cursor:"pointer"}}>지우기</button>
        </div>
        <div style={{display:"flex",gap:8,marginTop:12}}>
          <input value={text} onChange={e=>setText(e.target.value)} placeholder="캔버스에 넣을 텍스트" maxLength={20}
            style={{flex:1,padding:"11px 14px",borderRadius:10,border:`1px solid ${C.gray200}`,background:C.white,color:C.gray900,fontSize:14,outline:"none",boxSizing:"border-box"}}/>
          <button onClick={addText} style={{padding:"0 16px",borderRadius:10,border:"none",background:C.gray900,color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer"}}>텍스트 넣기</button>
        </div>
        <button onClick={finish} style={{width:"100%",padding:"16px",borderRadius:14,border:"none",background:C.coral,color:"#fff",fontSize:15,fontWeight:700,cursor:"pointer",marginTop:16,boxShadow:`0 4px 16px ${C.coral}40`}}>완성</button>
      </div>
    </div>
  );
}

function StepTitleInput({title,defaultLabel,onChange}){
  return(
    <input value={title||defaultLabel}
      onFocus={()=>{if(!title)onChange(defaultLabel);}}
      onChange={e=>onChange(e.target.value)}
      style={{width:"100%",marginBottom:10,padding:"6px 10px",borderRadius:8,border:`1px solid ${C.gray200}`,fontSize:13,fontWeight:800,color:C.gray900,outline:"none",boxSizing:"border-box"}}/>
  );
}

function CreateCardTab({myCards,setMyCards,onAddToBoard,onAddDaysToBoard,boardCardIds,onRemoveFromBoard,importedPhoto,clearImportedPhoto,publishedIds,onPublish,onUnpublish,onGoExplore,onSaveToBoardAndPublish,onSyncToBoard}){
  const [mode,setMode]=useState(importedPhoto?"new":"list");
  const [editId,setEditId]=useState(null);
  const [cardKind,setCardKind]=useState("route");
  const [miscCategory,setMiscCategory]=useState(MISC_DECK[0]);
  const [miscText,setMiscText]=useState("");
  const [miscPhotos,setMiscPhotos]=useState([]);
  const [miscHideText,setMiscHideText]=useState(false);
  const [miscHidePhoto,setMiscHidePhoto]=useState(false);
  const [drawOpen,setDrawOpen]=useState(false);
  const [showCreateHelp,setShowCreateHelp]=useState(false);
  const [showFormHelp,setShowFormHelp]=useState(false);
  function handleAddToBoard(card){
    const hasDays=(card.days||[]).some(d=>d.steps.some(s=>(s.desc&&s.desc.trim())||(s.photos&&s.photos.length>0)));
    if(hasDays&&onAddDaysToBoard){onAddDaysToBoard(card);}
    else{onAddToBoard({...card},null);}
  }
  const [collapsedDays,setCollapsedDays]=useState([]);
  function toggleDayCollapse(dayId){setCollapsedDays(prev=>prev.includes(dayId)?prev.filter(id=>id!==dayId):[...prev,dayId]);}
  const REGION_LABELS=REGION_OPTIONS.map(r=>r.label).filter(l=>l!=="기타");
  const [form,setForm]=useState(()=>{
    if(importedPhoto){const mp=SAMPLE_PHOTOS.find(p=>p.emoji===importedPhoto.emoji)||{id:"imp",emoji:importedPhoto.emoji,label:importedPhoto.label};return{title:importedPhoto.step?.title||"",desc:importedPhoto.step?.desc||"",tip:importedPhoto.step?.tip||"",cost:"",duration:"",photo:mp,color:CARD_COLORS[0],days:[makeDay()],region:"",customRegion:""};}
    return{title:"",desc:"",tip:"",cost:"",duration:"",photo:null,color:CARD_COLORS[0],days:[makeDay()],region:"",customRegion:""};
  });
  useState(()=>{if(importedPhoto&&clearImportedPhoto)clearImportedPhoto();});
  function openNew(){setForm({title:"",desc:"",tip:"",cost:"",duration:"",photo:null,color:CARD_COLORS[0],days:[makeDay()],region:"",customRegion:""});setCardKind("route");setMiscCategory(MISC_DECK[0]);setMiscText("");setMiscPhotos([]);setMiscHideText(false);setMiscHidePhoto(false);setEditId(null);setMode("new");}
  function openEdit(card){
    if(card.type==="misc"){
      setCardKind("misc");
      setMiscCategory({id:card.id,label:card.label,icon:card.icon,color:card.color,bg:card.bg});
      setMiscText(card.text||"");
      setMiscPhotos(card.photos||(card.photo?[card.photo]:[]));
      setMiscHideText(!!card.hideText);
      setMiscHidePhoto(!!card.hidePhoto);
    }else{
      setCardKind("route");
      const isKnown=REGION_LABELS.includes(card.region);
      setForm({title:card.title,desc:card.desc||"",tip:card.tip||"",cost:card.cost,duration:card.duration,photo:card.photo,color:CARD_COLORS.find(c=>c.color===card.color)||CARD_COLORS[0],days:card.days&&card.days.length?card.days.map(d=>({...d,steps:d.steps.map(normalizeStepPhotos)})):[makeDay()],region:isKnown?card.region:(card.region?"기타":""),customRegion:isKnown?"":(card.region||"")});
    }
    setEditId(card.id);setMode("edit");
  }
  function saveCard(){
    if(cardKind==="misc"){
      const card={id:editId||`my_${Date.now()}`,type:"misc",label:miscCategory.label,icon:miscCategory.icon,color:miscCategory.color,bg:miscCategory.bg,text:miscText,hideText:miscHideText,photos:miscPhotos,hidePhoto:miscHidePhoto,isCustom:true};
      const isNew=!editId;
      if(editId)setMyCards(prev=>prev.map(c=>c.id===editId?card:c));else setMyCards(prev=>[...prev,card]);
      setMode("list");
      if(isNew)onSaveToBoardAndPublish?.(card);
      return;
    }
    if(!form.title.trim())return;
    const region=form.region==="기타"?(form.customRegion.trim()||"기타"):form.region;
    const card={id:editId||`my_${Date.now()}`,title:form.title,desc:form.desc,tip:form.tip,cost:form.cost||"미정",duration:form.duration||"미정",photo:form.photo,emoji:form.photo?.emoji||"📍",color:form.color.color,bg:form.color.bg,isCustom:true,days:form.days,region};
    const isNew=!editId;
    if(editId)setMyCards(prev=>prev.map(c=>c.id===editId?card:c));else setMyCards(prev=>[...prev,card]);
    setMode("list");
    if(isNew)onSaveToBoardAndPublish?.(card);
    else onSyncToBoard?.(card);
  }
  function deleteCard(id){setMyCards(prev=>prev.filter(c=>c.id!==id));onUnpublish(id);}
  function handleCancel(){
    const hasContent=cardKind==="misc"
      ?!!(miscText.trim()||miscPhotos.length)
      :!!(form.title.trim()||form.desc.trim()||form.photo||form.days.some(d=>d.steps.some(s=>(s.desc&&s.desc.trim())||(s.photos&&s.photos.length>0))));
    if(hasContent&&!window.confirm("변경사항을 취소하고 나가시겠습니까? 저장하지 않은 내용은 사라집니다."))return;
    setMode("list");
  }
  function applyPhotoFile(file){
    if(!file)return;
    resizeImageFile(file).then(dataUrl=>{
      if(!dataUrl)return;
      setForm(f=>({...f,photo:{id:`upload_${Date.now()}`,emoji:"📷",label:"내 사진",dataUrl}}));
      setTimeout(()=>document.getElementById("ci-title")?.focus(),80);
    });
  }
  function handlePhotoUpload(e){applyPhotoFile(e.target.files?.[0]);e.target.value="";}
  function handlePhotoPaste(e){const f=getPastedImageFile(e);if(f){e.preventDefault();applyPhotoFile(f);}}
  function addMiscPhotoFile(file){
    if(!file)return;
    resizeImageFile(file).then(dataUrl=>{if(dataUrl)setMiscPhotos(prev=>[...prev,{dataUrl}]);});
  }
  function removeMiscPhoto(pi){setMiscPhotos(prev=>prev.filter((_,i)=>i!==pi));}
  function handleMiscPhotosUpload(e){addMiscPhotoFile(e.target.files?.[0]);e.target.value="";}
  function handleMiscPhotosPaste(e){const f=getPastedImageFile(e);if(f){e.preventDefault();addMiscPhotoFile(f);}}
  function addDay(kind="day"){setForm(f=>({...f,days:[...f.days,makeDay(kind)]}));}
  function removeDay(dayId){setForm(f=>f.days.length<=1?f:{...f,days:f.days.filter(d=>d.id!==dayId)});}
  function updateDay(dayId,field,value){setForm(f=>({...f,days:f.days.map(d=>d.id===dayId?{...d,[field]:value}:d)}));}
  function moveDay(dayId,dir){
    setForm(f=>{
      const idx=f.days.findIndex(d=>d.id===dayId);
      const target=idx+dir;
      if(idx<0||target<0||target>=f.days.length)return f;
      const days=[...f.days];
      [days[idx],days[target]]=[days[target],days[idx]];
      return{...f,days};
    });
  }
  function addStep(dayId,atIndex){
    setForm(f=>({...f,days:f.days.map(d=>{
      if(d.id!==dayId)return d;
      const steps=[...d.steps];
      steps.splice(atIndex===undefined?steps.length:atIndex,0,makeStep());
      return{...d,steps};
    })}));
  }
  function removeStep(dayId,stepId){setForm(f=>({...f,days:f.days.map(d=>d.id===dayId?{...d,steps:d.steps.length<=1?d.steps:d.steps.filter(s=>s.id!==stepId)}:d)}));}
  function updateStep(dayId,stepId,field,value){setForm(f=>({...f,days:f.days.map(d=>d.id===dayId?{...d,steps:d.steps.map(s=>s.id===stepId?{...s,[field]:value}:s)}:d)}));}
  function moveStep(dayId,from,to){
    setForm(f=>({...f,days:f.days.map(d=>{
      if(d.id!==dayId||from===to)return d;
      const steps=[...d.steps];
      const[item]=steps.splice(from,1);
      steps.splice(to,0,item);
      return{...d,steps};
    })}));
  }
  const [dragStep,setDragStep]=useState(null);
  function addStepPhotoFile(dayId,stepId,file){
    if(!file)return;
    resizeImageFile(file).then(dataUrl=>{
      if(!dataUrl)return;
      setForm(f=>({...f,days:f.days.map(d=>d.id===dayId?{...d,steps:d.steps.map(s=>s.id===stepId?{...s,photos:[...(s.photos||[]),{dataUrl}]}:s)}:d)}));
    });
  }
  function removeStepPhoto(dayId,stepId,pi){
    setForm(f=>({...f,days:f.days.map(d=>d.id===dayId?{...d,steps:d.steps.map(s=>s.id===stepId?{...s,photos:(s.photos||[]).filter((_,i)=>i!==pi)}:s)}:d)}));
  }
  function handleStepPhotoUpload(dayId,stepId,e){addStepPhotoFile(dayId,stepId,e.target.files?.[0]);e.target.value="";}
  function handleStepPhotoPaste(dayId,stepId,e){const f=getPastedImageFile(e);if(f){e.preventDefault();addStepPhotoFile(dayId,stepId,f);}}

  if(mode==="list")return(
    <div style={{flex:1,overflowY:"auto",padding:"24px 28px"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:24}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <div>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:20,fontWeight:800,color:C.gray900}}>내 카드 제작</span>
              <div style={{position:"relative"}} onMouseEnter={()=>setShowCreateHelp(true)} onMouseLeave={()=>setShowCreateHelp(false)}>
                <button style={{height:26,padding:"0 12px 0 10px",borderRadius:20,border:"none",background:`linear-gradient(135deg,${C.coral},${C.orange})`,color:"#fff",fontSize:11,fontWeight:800,cursor:"pointer",display:"flex",alignItems:"center",gap:5,boxShadow:`0 4px 12px ${C.coral}50`}}>
                  <span style={{width:15,height:15,borderRadius:"50%",background:"rgba(255,255,255,0.3)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10}}>?</span>
                  도움말
                </button>
                {showCreateHelp&&<div style={{position:"absolute",top:30,left:0,width:330,background:C.white,borderRadius:14,padding:"18px 20px",boxShadow:"0 16px 40px rgba(0,0,0,0.18)",border:`1px solid ${C.gray100}`,zIndex:200}}>
                  <div style={{display:"flex",flexDirection:"column",gap:14}}>
                    <div>
                      <div style={{fontSize:13,fontWeight:800,color:C.coral,marginBottom:4}}>✏️ 카드 제작</div>
                      <div style={{fontSize:13,color:C.gray600,lineHeight:1.6}}>루트 카드나 기타 카드를 직접 만들어요. 사진·직접 그리기·일차별 스텝을 넣을 수 있어요.</div>
                    </div>
                    <div>
                      <div style={{fontSize:13,fontWeight:800,color:C.coral,marginBottom:4}}>🗺️ 카드 제작 → 보드판</div>
                      <div style={{fontSize:13,color:C.gray600,lineHeight:1.6}}>새 카드를 저장하면 자동으로 보드판에 추가돼요. 목록의 "보드 추가"로 언제든 넣거나 뺄 수 있어요.</div>
                    </div>
                    <div>
                      <div style={{fontSize:13,fontWeight:800,color:C.coral,marginBottom:4}}>🔍 카드 제작 → 탐색</div>
                      <div style={{fontSize:13,color:C.gray600,lineHeight:1.6}}>새 루트 카드는 저장과 동시에 탐색에도 자동으로 게시돼요. "게시 취소"로 내릴 수 있어요.</div>
                    </div>
                    <div>
                      <div style={{fontSize:13,fontWeight:800,color:C.coral,marginBottom:4}}>📋 카드 제작 → 덱 관리</div>
                      <div style={{fontSize:13,color:C.gray600,lineHeight:1.6}}>만든 카드는 덱 관리의 "내가 만든 카드"에도 나타나서 보드판 추가/제거·완전 삭제를 거기서도 할 수 있어요.</div>
                    </div>
                  </div>
                </div>}
              </div>
            </div>
            <div style={{fontSize:13,color:C.gray400,marginTop:3}}>나만의 여행 루트 카드를 만들어보세요</div>
          </div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <button onClick={exportBackup} title="지금까지 만든 카드·보드판·탐색 게시물을 파일로 저장해요" style={{padding:"10px 16px",borderRadius:24,border:`1.5px solid ${C.gray200}`,background:C.white,color:C.gray600,fontSize:13,fontWeight:700,cursor:"pointer"}}>💾 백업 내보내기</button>
          <label title="백업 파일을 불러와서 복원해요 (현재 내용을 덮어씁니다)" style={{padding:"10px 16px",borderRadius:24,border:`1.5px solid ${C.gray200}`,background:C.white,color:C.gray600,fontSize:13,fontWeight:700,cursor:"pointer"}}>
            <input type="file" accept="application/json" style={{display:"none"}} onChange={e=>{
              const f=e.target.files?.[0];e.target.value="";
              if(!f)return;
              if(!window.confirm("백업 파일을 가져오면 지금 저장된 카드·보드판 내용을 덮어씁니다. 계속할까요?"))return;
              importBackup(f).catch(()=>window.alert("백업 파일을 읽는 데 실패했어요. 파일이 손상되지 않았는지 확인해주세요."));
            }}/>
            📂 백업 가져오기
          </label>
          <button onClick={openNew} style={{padding:"10px 22px",borderRadius:24,border:"none",background:C.coral,color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer",boxShadow:`0 4px 16px ${C.coral}40`}}>+ 새 카드</button>
        </div>
      </div>
      {myCards.length===0?<div style={{background:C.white,borderRadius:20,padding:"56px 32px",textAlign:"center",border:`1.5px dashed ${C.gray200}`,boxShadow:C.shadow}}>
        <div style={{fontSize:40,marginBottom:16}}>✏️</div>
        <div style={{fontSize:14,color:C.gray400,marginBottom:20}}>아직 만든 카드가 없어요</div>
        <button onClick={openNew} style={{padding:"12px 28px",borderRadius:24,border:"none",background:C.coral,color:"#fff",fontSize:14,fontWeight:700,cursor:"pointer"}}>첫 카드 만들기</button>
      </div>:<div style={{columns:2,columnGap:16}}>
        {myCards.map(card=>{
          const isPublished=(publishedIds||[]).includes(card.id);
          const isMisc=card.type==="misc";
          const onBoard=(boardCardIds||[]).some(id=>id===card.id||(typeof id==="string"&&id.startsWith(card.id+"_d")));
          return(
          <div key={card.id} style={{breakInside:"avoid",marginBottom:16,background:C.white,borderRadius:20,overflow:"hidden",border:`1px solid ${C.gray100}`,boxShadow:C.shadow}}>
            <div style={{height:120,background:card.bg||"#FFF0F0",display:"flex",alignItems:"center",justifyContent:"center",fontSize:52,overflow:"hidden",position:"relative"}}>
              {card.photo?.dataUrl?<img src={card.photo.dataUrl} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/>:(isMisc?card.icon:card.photo?.emoji||"📍")}
              {isPublished&&<div style={{position:"absolute",top:8,left:8,fontSize:10,color:"#fff",background:card.color||C.coral,borderRadius:20,padding:"3px 9px",fontWeight:700}}>탐색에 게시됨</div>}
            </div>
            <div style={{padding:"14px"}}>
              {isMisc?<>
                <div style={{fontSize:13,fontWeight:700,color:card.color,marginBottom:4}}>{card.icon} {card.label}</div>
                <div style={{fontSize:11,color:card.text?C.gray400:C.gray200,marginBottom:12,lineHeight:1.5,display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden"}}>{card.text||"내용 없음"}</div>
              </>:<>
                <div style={{fontSize:13,fontWeight:700,color:C.gray900,marginBottom:4}}>{card.title}</div>
                {card.desc&&<div style={{fontSize:11,color:C.gray400,marginBottom:8,lineHeight:1.5}}>{card.desc}</div>}
                <div style={{display:"flex",gap:8,marginBottom:12}}>
                  <span style={{fontSize:10,color:C.gray400}}>⏱ {card.duration}</span>
                  <span style={{fontSize:10,color:C.gray400}}>💰 {card.cost}</span>
                </div>
              </>}
              <div style={{display:"flex",gap:6,marginBottom:isMisc?0:6}}>
                <button onClick={()=>openEdit(card)} style={{flex:1,padding:"7px",borderRadius:10,border:`1px solid ${C.gray200}`,background:C.white,color:C.gray600,fontSize:11,fontWeight:600,cursor:"pointer"}}>수정</button>
                <button onClick={()=>onBoard?onRemoveFromBoard(card.id):handleAddToBoard(card)} style={{flex:1,padding:"7px",borderRadius:10,border:onBoard?`1px solid ${C.gray200}`:"none",background:onBoard?C.white:card.color||C.coral,color:onBoard?C.coral:"#fff",fontSize:11,fontWeight:600,cursor:"pointer",transition:"all 0.2s"}}>{onBoard?"보드판에서 제거":"보드 추가"}</button>
                <button onClick={()=>deleteCard(card.id)} style={{padding:"7px 10px",borderRadius:10,border:`1px solid ${C.coral}30`,background:"#FFF0F0",color:C.coral,fontSize:11,fontWeight:600,cursor:"pointer"}}>✕</button>
              </div>
              {!isMisc&&<div style={{display:"flex",gap:6,marginTop:6}}>
                <button onClick={()=>isPublished?onUnpublish(card.id):onPublish(card)} style={{flex:1,padding:"7px",borderRadius:10,border:isPublished?`1px solid ${C.gray200}`:"none",background:isPublished?C.white:C.green,color:isPublished?C.gray600:"#fff",fontSize:11,fontWeight:700,cursor:"pointer"}}>{isPublished?"게시 취소":"탐색에 올리기"}</button>
                {isPublished&&<button onClick={onGoExplore} style={{padding:"7px 10px",borderRadius:10,border:`1px solid ${C.green}40`,background:"#E6FAF2",color:C.green,fontSize:11,fontWeight:600,cursor:"pointer"}}>탐색 보기</button>}
              </div>}
            </div>
          </div>
        );})}
      </div>}
    </div>
  );

  return(
    <div style={{flex:1,overflowY:"auto",padding:"28px 32px"}}>
      {drawOpen&&<DrawCanvasModal onClose={()=>setDrawOpen(false)} onSave={dataUrl=>{setForm(f=>({...f,photo:{id:`draw_${Date.now()}`,emoji:"✏️",label:"직접 그린 이미지",dataUrl}}));setDrawOpen(false);setTimeout(()=>document.getElementById("ci-title")?.focus(),80);}}/>}
      <div style={{position:"fixed",bottom:32,left:36,zIndex:9000}}
        onMouseEnter={()=>setShowFormHelp(true)} onMouseLeave={()=>setShowFormHelp(false)}>
        <button style={{height:44,padding:"0 18px 0 14px",borderRadius:22,background:`linear-gradient(135deg,${C.coral},${C.orange})`,border:"none",boxShadow:"0 12px 28px rgba(255,90,90,0.45)",cursor:"pointer",fontSize:14,fontWeight:800,color:"#fff",display:"flex",alignItems:"center",gap:7}}>
          <span style={{width:22,height:22,borderRadius:"50%",background:"rgba(255,255,255,0.3)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13}}>?</span>
          <span>어떻게 만들어요?</span>
        </button>
        {showFormHelp&&<div style={{position:"absolute",bottom:52,left:0,width:320,background:C.white,borderRadius:14,padding:"18px 20px",boxShadow:"0 16px 40px rgba(0,0,0,0.18)",border:`1px solid ${C.gray100}`}}>
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            <div style={{display:"flex",gap:8}}><span style={{fontSize:11,fontWeight:800,color:C.coral,flexShrink:0}}>1</span><span style={{fontSize:11,color:C.gray600,lineHeight:1.6}}>여행지 선택 — 목록에 없으면 "기타"로 직접 이름을 입력해요.</span></div>
            <div style={{display:"flex",gap:8}}><span style={{fontSize:11,fontWeight:800,color:C.coral,flexShrink:0}}>2</span><span style={{fontSize:11,color:C.gray600,lineHeight:1.6}}>사진 선택 — 내 사진 업로드, 직접 그리기, 샘플 아이콘 중 하나를 골라요.</span></div>
            <div style={{display:"flex",gap:8}}><span style={{fontSize:11,fontWeight:800,color:C.coral,flexShrink:0}}>3</span><span style={{fontSize:11,color:C.gray600,lineHeight:1.6}}>제목·설명·팁·소요 시간·예상 비용을 입력해요.</span></div>
            <div style={{display:"flex",gap:8}}><span style={{fontSize:11,fontWeight:800,color:C.coral,flexShrink:0}}>4</span><span style={{fontSize:11,color:C.gray600,lineHeight:1.6}}>"+ 일차 추가"로 날짜별 스텝을 만들고, 각 스텝에 사진과 글을 남겨요.</span></div>
            <div style={{display:"flex",gap:8}}><span style={{fontSize:11,fontWeight:800,color:C.coral,flexShrink:0}}>5</span><span style={{fontSize:11,color:C.gray600,lineHeight:1.6}}>각 일차마다 "합치기"(스텝을 한 카드로) / "분리하기"(스텝별로 나누기)를 골라요.</span></div>
            <div style={{display:"flex",gap:8}}><span style={{fontSize:11,fontWeight:800,color:C.coral,flexShrink:0}}>6</span><span style={{fontSize:11,color:C.gray600,lineHeight:1.6}}>"카드 완성!"을 누르면 저장되고, 자동으로 보드판에 추가·탐색에 게시돼요.</span></div>
          </div>
        </div>}
      </div>
      <div style={{maxWidth:800,margin:"0 auto"}}>
      <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:34}}>
        <button onClick={handleCancel} style={{padding:"11px 24px",borderRadius:22,border:`1px solid ${C.gray200}`,background:C.white,color:C.gray600,fontSize:15,fontWeight:600,cursor:"pointer"}}>← 취소하고 나가기</button>
        <div style={{fontSize:28,fontWeight:800,color:C.gray900}}>{editId?"카드 수정":"새 카드 만들기"}</div>
      </div>
      {!editId&&<div style={{display:"flex",gap:10,marginBottom:32}}>
        {[["route","루트 카드"],["misc","기타 카드"]].map(([k,l])=>(
          <button key={k} onClick={()=>setCardKind(k)} style={{flex:1,padding:"13px",borderRadius:14,border:`1.5px solid ${cardKind===k?C.coral:C.gray200}`,background:cardKind===k?"#FFF0F0":C.white,color:cardKind===k?C.coral:C.gray600,fontSize:14,fontWeight:700,cursor:"pointer",transition:"all 0.15s"}}>{l}</button>
        ))}
      </div>}
      {cardKind==="misc"?(
        <div style={{display:"flex",flexDirection:"column",gap:28}}>
          <div>
            <div style={{fontSize:16,fontWeight:600,color:C.gray600,marginBottom:14}}>종류 선택</div>
            <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
              {MISC_DECK.map(m=>(
                <button key={m.id} onClick={()=>setMiscCategory(m)} style={{padding:"14px 20px",borderRadius:14,border:`1.5px solid ${miscCategory.label===m.label?m.color:C.gray200}`,background:miscCategory.label===m.label?m.bg:C.white,cursor:"pointer",display:"flex",alignItems:"center",gap:8,transition:"all 0.15s",boxShadow:miscCategory.label===m.label?`0 4px 12px ${m.color}30`:C.shadow}}>
                  <span style={{fontSize:22}}>{m.icon}</span>
                  <span style={{fontSize:14,fontWeight:600,color:miscCategory.label===m.label?m.color:C.gray600}}>{m.label}</span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <div style={{fontSize:16,fontWeight:600,color:C.gray600,marginBottom:14}}>사진 <span style={{color:C.gray400,fontWeight:400,fontSize:13}}>(선택)</span></div>
            <PhotoStack photos={miscPhotos} accentColor={miscCategory.color} accentBg={miscCategory.bg} boxHeight={220}
              onUpload={handleMiscPhotosUpload} onPaste={handleMiscPhotosPaste} onRemove={removeMiscPhoto}
              hidePhoto={miscHidePhoto} onSetHidePhoto={setMiscHidePhoto}/>
          </div>
          <div>
            <div style={{fontSize:16,fontWeight:600,color:C.gray600,marginBottom:14}}>내용</div>
            {miscHideText?(
              <button onClick={()=>setMiscHideText(false)} style={{width:"100%",padding:"10px",borderRadius:12,border:`1.5px dashed ${C.gray200}`,background:"transparent",color:C.gray400,fontSize:13,fontWeight:600,cursor:"pointer"}}>+ 글 추가</button>
            ):(
            <div style={{position:"relative"}}>
              <textarea value={miscText} onChange={e=>setMiscText(e.target.value)} placeholder="준비물, 참고할 이야기 등을 적어보세요..." rows={6}
                style={{width:"100%",padding:"16px 44px 16px 20px",borderRadius:14,border:`1px solid ${C.gray200}`,background:C.white,color:C.gray900,fontSize:16,lineHeight:1.8,outline:"none",resize:"vertical",boxSizing:"border-box",fontFamily:"inherit"}}/>
              <button onClick={()=>{if(miscText){setMiscText("");}else{setMiscHideText(true);}}} title="글 칸 없애기" style={{position:"absolute",top:12,right:12,width:26,height:26,borderRadius:"50%",background:C.white,border:`1px solid ${C.gray200}`,cursor:"pointer",fontSize:12,color:C.gray400,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
            </div>
            )}
          </div>
          <button onClick={saveCard} style={{width:"100%",padding:"22px",borderRadius:18,border:"none",background:C.coral,color:"#fff",fontSize:18,fontWeight:700,cursor:"pointer",transition:"all 0.2s",boxShadow:`0 4px 16px ${C.coral}40`}}>
            {editId?"수정 완료":"저장하고 보드판·탐색에 올리기"}
          </button>
        </div>
      ):(
      <div style={{display:"flex",flexDirection:"column",gap:40}}>
        <div>
          <div style={{fontSize:15,fontWeight:600,color:C.gray400,marginBottom:16,textTransform:"uppercase",letterSpacing:0.5}}>미리보기</div>
          <div style={{background:C.white,borderRadius:28,overflow:"hidden",border:`1px solid ${C.gray200}`,boxShadow:C.shadowHover}}>
            <div style={{height:320,background:form.color.bg,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:10,overflow:"hidden"}}>
              {form.photo?.dataUrl?<img src={form.photo.dataUrl} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/>
                :form.photo?<><span style={{fontSize:110}}>{form.photo.emoji}</span><span style={{fontSize:18,color:form.color.color,fontWeight:600}}>{form.photo.label}</span></>
                :<span style={{fontSize:44,color:C.gray200}}>사진 선택</span>}
            </div>
            <div style={{padding:"30px"}}>
              <div style={{fontSize:26,fontWeight:700,color:C.gray900,marginBottom:10}}>{form.title||"카드 제목"}</div>
              {form.desc&&<div style={{fontSize:16,color:C.gray400,lineHeight:1.6,marginBottom:12}}>{form.desc}</div>}
              {form.tip&&<div style={{fontSize:15,color:C.orange,marginBottom:10}}>💡 {form.tip}</div>}
              <div style={{display:"flex",gap:20,marginTop:12}}>
                <span style={{fontSize:15,color:C.gray400}}>⏱ {form.duration||"미정"}</span>
                <span style={{fontSize:15,color:C.gray400}}>💰 {form.cost||"미정"}</span>
              </div>
            </div>
          </div>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:28}}>
          <div>
            <div style={{fontSize:16,fontWeight:600,color:C.gray600,marginBottom:14}}>여행지 선택</div>
            <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
              {REGION_OPTIONS.map(r=>(
                <button key={r.label} onClick={()=>setForm(f=>({...f,region:r.label}))} style={{padding:"12px 18px",borderRadius:14,border:`1.5px solid ${form.region===r.label?C.coral:C.gray200}`,background:form.region===r.label?"#FFF0F0":C.white,cursor:"pointer",display:"flex",alignItems:"center",gap:8,transition:"all 0.15s",boxShadow:form.region===r.label?`0 4px 12px ${C.coral}30`:C.shadow}}>
                  <span style={{fontSize:20}}>{r.icon}</span>
                  <span style={{fontSize:14,fontWeight:600,color:form.region===r.label?C.coral:C.gray600}}>{r.label}</span>
                </button>
              ))}
            </div>
            {form.region==="기타"&&
              <input value={form.customRegion} onChange={e=>setForm(f=>({...f,customRegion:e.target.value}))} placeholder="여행지 이름을 입력하세요 (예: 방콕)" maxLength={20}
                style={{marginTop:12,width:"100%",padding:"14px 18px",borderRadius:12,border:`1px solid ${C.gray200}`,background:C.white,color:C.gray900,fontSize:15,outline:"none",boxSizing:"border-box"}}/>
            }
          </div>
          <div>
            <div style={{fontSize:16,fontWeight:600,color:C.gray600,marginBottom:14}}>사진 선택 <span style={{color:C.gray400,fontWeight:400,fontSize:14}}>(클릭 → 바로 입력)</span></div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:16}}>
              <label tabIndex={0} onPaste={handlePhotoPaste} title="사진 파일에서 가져오기 또는 Ctrl+V" style={{padding:"22px 10px",borderRadius:16,border:`1.5px dashed ${form.photo?.dataUrl?form.color.color:C.gray200}`,background:form.photo?.dataUrl?form.color.bg:C.white,cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:8,transition:"all 0.15s",boxShadow:form.photo?.dataUrl?`0 4px 12px ${form.color.color}30`:C.shadow,outline:"none"}}>
                <input type="file" accept="image/*" onChange={handlePhotoUpload} style={{display:"none"}}/>
                <span style={{fontSize:40}}>📁</span>
                <span style={{fontSize:14,color:form.photo?.dataUrl?form.color.color:C.gray400,fontWeight:600}}>내 사진</span>
              </label>
              <button onClick={()=>setDrawOpen(true)}
                style={{padding:"22px 10px",borderRadius:16,border:`1.5px dashed ${C.gray200}`,background:C.white,cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:8,transition:"all 0.15s",boxShadow:C.shadow}}>
                <span style={{fontSize:40}}>✏️</span>
                <span style={{fontSize:14,color:C.gray400,fontWeight:600}}>직접 그리기</span>
              </button>
              {SAMPLE_PHOTOS.map(p=>(
                <button key={p.id} onClick={()=>{setForm(f=>({...f,photo:p}));setTimeout(()=>document.getElementById("ci-title")?.focus(),80);}}
                  style={{padding:"22px 10px",borderRadius:16,border:`1.5px solid ${form.photo?.id===p.id?form.color.color:C.gray200}`,background:form.photo?.id===p.id?form.color.bg:C.white,cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:8,transition:"all 0.15s",boxShadow:form.photo?.id===p.id?`0 4px 12px ${form.color.color}30`:C.shadow}}>
                  <span style={{fontSize:40}}>{p.emoji}</span>
                  <span style={{fontSize:14,color:form.photo?.id===p.id?form.color.color:C.gray400,fontWeight:600}}>{p.label}</span>
                </button>
              ))}
            </div>
            {form.photo&&<div style={{marginTop:20,background:C.gray50,borderRadius:18,padding:"24px",border:`1px solid ${C.gray200}`}}>
              <div style={{fontSize:15,color:C.gray400,marginBottom:14}}>{form.photo.emoji} 선택됨 — 설명 입력</div>
              <input id="ci-title" value={form.title} onChange={e=>setForm(f=>({...f,title:e.target.value}))} placeholder="제목" maxLength={30}
                style={{width:"100%",padding:"15px 18px",borderRadius:12,border:`1px solid ${C.gray200}`,background:C.white,color:C.gray900,fontSize:16,outline:"none",boxSizing:"border-box",marginBottom:12}}/>
              <textarea value={form.desc} onChange={e=>setForm(f=>({...f,desc:e.target.value}))} placeholder="설명" rows={2} maxLength={150}
                style={{width:"100%",padding:"15px 18px",borderRadius:12,border:`1px solid ${C.gray200}`,background:C.white,color:C.gray900,fontSize:16,outline:"none",resize:"none",boxSizing:"border-box",fontFamily:"inherit",marginBottom:12}}/>
              <input value={form.tip} onChange={e=>setForm(f=>({...f,tip:e.target.value}))} placeholder="팁" maxLength={60}
                style={{width:"100%",padding:"15px 18px",borderRadius:12,border:`1px solid ${C.gray200}`,background:C.white,color:C.gray900,fontSize:16,outline:"none",boxSizing:"border-box"}}/>
            </div>}
          </div>
          <div>
            <div style={{fontSize:16,fontWeight:600,color:C.gray600,marginBottom:12}}>색상</div>
            <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
              {CARD_COLORS.map(c=><button key={c.color} onClick={()=>setForm(f=>({...f,color:c}))} style={{width:46,height:46,borderRadius:"50%",background:c.color,border:form.color.color===c.color?"3px solid #333":"3px solid transparent",cursor:"pointer",transition:"all 0.15s"}}/>)}
            </div>
          </div>
          {!form.photo&&<>
            {[["ci-title","제목",form.title,v=>setForm(f=>({...f,title:v})),30],["","설명",form.desc,v=>setForm(f=>({...f,desc:v})),200],["","팁",form.tip,v=>setForm(f=>({...f,tip:v})),60]].map(([id,label,val,onChange,max],idx)=>(
              <div key={idx}>
                <div style={{fontSize:16,fontWeight:600,color:C.gray600,marginBottom:10}}>{label}</div>
                {label==="설명"?<textarea id={id||undefined} value={val} onChange={e=>onChange(e.target.value)} placeholder={label} rows={3} maxLength={max}
                  style={{width:"100%",padding:"16px 20px",borderRadius:14,border:`1px solid ${C.gray200}`,background:C.white,color:C.gray900,fontSize:16,outline:"none",resize:"none",boxSizing:"border-box",fontFamily:"inherit"}}/>
                :<input id={id||undefined} value={val} onChange={e=>onChange(e.target.value)} placeholder={label} maxLength={max}
                  style={{width:"100%",padding:"16px 20px",borderRadius:14,border:`1px solid ${C.gray200}`,background:C.white,color:C.gray900,fontSize:16,outline:"none",boxSizing:"border-box"}}/>}
              </div>
            ))}
          </>}
          <div style={{display:"flex",gap:18}}>
            {[["소요 시간",form.duration,v=>setForm(f=>({...f,duration:v})),"예: 2시간"],["예상 비용",form.cost,v=>setForm(f=>({...f,cost:v})),"예: 15,000원"]].map(([label,val,onChange,ph],idx)=>(
              <div key={idx} style={{flex:1}}>
                <div style={{fontSize:16,fontWeight:600,color:C.gray600,marginBottom:10}}>{label}</div>
                <input value={val} onChange={e=>onChange(e.target.value)} placeholder={ph} maxLength={15}
                  style={{width:"100%",padding:"15px 20px",borderRadius:14,border:`1px solid ${C.gray200}`,background:C.white,color:C.gray900,fontSize:16,outline:"none",boxSizing:"border-box"}}/>
              </div>
            ))}
          </div>
          <div>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14,position:"sticky",top:0,zIndex:50,background:C.bg,padding:"10px 0"}}>
              <div style={{fontSize:16,fontWeight:600,color:C.gray600}}>일정 <span style={{color:C.gray400,fontWeight:400,fontSize:13}}>(1일차, 2일차··· 또는 기타 메모를 원하는 순서로 추가)</span></div>
              <div style={{display:"flex",gap:8}}>
                <button onClick={()=>addDay("misc")} style={{padding:"8px 16px",borderRadius:20,border:`1.5px solid ${C.gray200}`,background:C.white,color:C.gray600,fontSize:13,fontWeight:700,cursor:"pointer"}}>+ 기타 추가</button>
                <button onClick={()=>addDay("day")} style={{padding:"8px 16px",borderRadius:20,border:"none",background:C.coral,color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer",boxShadow:C.shadow}}>+ 일차 추가</button>
              </div>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:16}}>
              {(()=>{let dayCounter=0;return form.days.map((day,di)=>{
                const collapsed=collapsedDays.includes(day.id);
                const isMisc=day.kind==="misc";
                if(!isMisc)dayCounter++;
                const label=isMisc?"기타":`${dayCounter}일차`;
                return(
                <div key={day.id} style={{background:C.white,borderRadius:18,border:`1.5px solid ${isMisc?C.gray200:C.gray200}`}}>
                  <div style={{width:"100%",padding:"12px 12px 10px 20px",background:isMisc?"#F3F0FF":C.gray50,borderTopLeftRadius:16,borderTopRightRadius:16,borderBottomLeftRadius:collapsed?16:0,borderBottomRightRadius:collapsed?16:0,boxSizing:"border-box"}}>
                    <button onClick={()=>toggleDayCollapse(day.id)} style={{width:"100%",display:"flex",alignItems:"center",gap:8,border:"none",background:"transparent",cursor:"pointer",textAlign:"left",padding:0}}>
                      <span style={{fontSize:13,color:C.gray400,flexShrink:0,transform:collapsed?"rotate(-90deg)":"rotate(0)",transition:"transform 0.15s"}}>▽</span>
                      <span style={{fontSize:17,fontWeight:800,color:isMisc?"#7B61FF":C.gray900,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{isMisc?"📌 ":""}{label}</span>
                    </button>
                    <div style={{display:"flex",alignItems:"center",gap:6,marginTop:8}}>
                      <span style={{fontSize:11,color:C.gray400,marginRight:"auto"}}>순서 이동</span>
                      <button onClick={()=>moveDay(day.id,-1)} disabled={di===0} style={{width:30,height:30,borderRadius:8,border:`1.5px solid ${di===0?C.gray200:C.gray900}`,background:di===0?C.gray100:C.white,color:di===0?C.gray400:C.gray900,cursor:di===0?"default":"pointer",fontSize:14,fontWeight:800}}>▲</button>
                      <button onClick={()=>moveDay(day.id,1)} disabled={di===form.days.length-1} style={{width:30,height:30,borderRadius:8,border:`1.5px solid ${di===form.days.length-1?C.gray200:C.gray900}`,background:di===form.days.length-1?C.gray100:C.white,color:di===form.days.length-1?C.gray400:C.gray900,cursor:di===form.days.length-1?"default":"pointer",fontSize:14,fontWeight:800}}>▼</button>
                    </div>
                  </div>
                  {!collapsed&&<div style={{padding:20}}>
                    <div style={{display:"flex",gap:10,marginBottom:16,alignItems:"center"}}>
                      <input value={day.theme} onChange={e=>updateDay(day.id,"theme",e.target.value)} placeholder={isMisc?"메모 제목 (예: 준비물)":"테마 (예: 공항 도착 · 신주쿠)"}
                        style={{flex:1,padding:"10px 12px",borderRadius:10,border:`1px solid ${C.gray200}`,background:C.white,color:C.gray900,fontSize:15,outline:"none",boxSizing:"border-box"}}/>
                      {form.days.length>1&&<button onClick={()=>removeDay(day.id)} style={{padding:"10px 14px",borderRadius:10,border:`1px solid ${C.coral}30`,background:"#FFF0F0",color:C.coral,fontSize:13,fontWeight:600,cursor:"pointer",flexShrink:0}}>{isMisc?"삭제":"이 일차 삭제"}</button>}
                    </div>
                    {day.steps.length>1&&<div style={{display:"flex",alignItems:"center",gap:8,marginBottom:16}}>
                      <span style={{fontSize:12,color:C.gray400,marginRight:2}}>보드판에 추가할 때</span>
                      <div style={{display:"flex",borderRadius:10,border:`1px solid ${C.gray200}`,overflow:"hidden"}}>
                        <button onClick={()=>updateDay(day.id,"merge",false)} style={{padding:"7px 12px",border:"none",background:!day.merge?C.coral:C.white,color:!day.merge?"#fff":C.gray600,fontSize:12,fontWeight:600,cursor:"pointer"}}>분리하기</button>
                        <button onClick={()=>updateDay(day.id,"merge",true)} style={{padding:"7px 12px",border:"none",background:day.merge?C.coral:C.white,color:day.merge?"#fff":C.gray600,fontSize:12,fontWeight:600,cursor:"pointer"}}>합치기</button>
                      </div>
                    </div>}
                    <div style={{display:"flex",flexDirection:"column",gap:20}}>
                      {day.steps.map((step,si)=>(
                        <Fragment key={step.id}>
                        <div
                          onDragOver={e=>{if(dragStep&&dragStep.dayId===day.id)e.preventDefault();}}
                          onDrop={e=>{e.preventDefault();if(dragStep&&dragStep.dayId===day.id&&dragStep.index!==si){moveStep(day.id,dragStep.index,si);}setDragStep(null);}}
                          style={{background:C.gray50,borderRadius:16,padding:16,position:"relative",opacity:dragStep&&dragStep.dayId===day.id&&dragStep.index===si?0.4:1}}>
                          {day.steps.length>1&&<button onClick={()=>removeStep(day.id,step.id)} title="이 활동 삭제" style={{position:"absolute",top:-10,right:-10,width:28,height:28,borderRadius:"50%",background:C.white,border:`1.5px solid ${C.gray200}`,cursor:"pointer",fontSize:13,color:C.gray600,display:"flex",alignItems:"center",justifyContent:"center",zIndex:2,boxShadow:C.shadow}}>✕</button>}
                          {day.steps.length>1&&<div draggable onDragStart={()=>setDragStep({dayId:day.id,index:si})} onDragEnd={()=>setDragStep(null)}
                            title="드래그해서 순서 바꾸기"
                            style={{position:"absolute",top:-10,left:-10,width:28,height:28,borderRadius:"50%",background:C.white,border:`1.5px solid ${C.gray200}`,cursor:"grab",fontSize:14,color:C.gray400,display:"flex",alignItems:"center",justifyContent:"center",zIndex:2,boxShadow:C.shadow,letterSpacing:-1}}>⠿</div>}
                          <StepTitleInput title={step.title||""} defaultLabel={`STEP ${si+1}`} onChange={v=>updateStep(day.id,step.id,"title",v)}/>
                          <PhotoStack photos={step.photos} accentColor={form.color.color} accentBg={form.color.bg} boxHeight={180}
                            onUpload={e=>handleStepPhotoUpload(day.id,step.id,e)} onPaste={e=>handleStepPhotoPaste(day.id,step.id,e)} onRemove={pi=>removeStepPhoto(day.id,step.id,pi)}
                            hidePhoto={step.hidePhoto} onSetHidePhoto={hp=>updateStep(day.id,step.id,"hidePhoto",hp)}/>
                          {step.hideText?(
                            <button onClick={()=>updateStep(day.id,step.id,"hideText",false)} style={{width:"100%",padding:"10px",borderRadius:12,border:`1.5px dashed ${C.gray200}`,background:"transparent",color:C.gray400,fontSize:13,fontWeight:600,cursor:"pointer"}}>+ 글 추가</button>
                          ):(
                          <div style={{position:"relative"}}>
                            <textarea value={step.desc} onChange={e=>updateStep(day.id,step.id,"desc",e.target.value)} placeholder="이 활동에 대한 글을 남겨보세요" rows={3}
                              style={{width:"100%",padding:"12px 40px 12px 14px",borderRadius:12,border:`1px solid ${C.gray200}`,background:C.white,color:C.gray900,fontSize:15,outline:"none",resize:"vertical",boxSizing:"border-box",fontFamily:"inherit"}}/>
                            <button onClick={()=>{if(step.desc){updateStep(day.id,step.id,"desc","");}else{updateStep(day.id,step.id,"hideText",true);}}} title="글 칸 없애기" style={{position:"absolute",top:8,right:8,width:24,height:24,borderRadius:"50%",background:C.white,border:`1px solid ${C.gray200}`,cursor:"pointer",fontSize:11,color:C.gray400,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
                          </div>
                          )}
                        </div>
                        <button onClick={()=>addStep(day.id,si+1)} style={{width:"100%",padding:"4px",border:"none",background:"transparent",color:C.gray200,fontSize:11,fontWeight:600,cursor:"pointer",display:"flex",alignItems:"center",gap:8}}
                          onMouseEnter={e=>e.currentTarget.style.color=C.coral} onMouseLeave={e=>e.currentTarget.style.color=C.gray200}>
                          <span style={{flex:1,height:1,background:"currentColor"}}></span>+ {si<day.steps.length-1?"이 사이에":"여기에"} 활동 추가<span style={{flex:1,height:1,background:"currentColor"}}></span>
                        </button>
                        </Fragment>
                      ))}
                    </div>
                    <button onClick={()=>addStep(day.id)} style={{marginTop:16,width:"100%",padding:"12px",borderRadius:12,border:`1.5px dashed ${C.gray200}`,background:C.white,color:C.gray600,fontSize:14,fontWeight:600,cursor:"pointer"}}>+ 활동 추가</button>
                  </div>}
                </div>
              );});})()}
            </div>
          </div>
          <button onClick={saveCard} disabled={!form.title.trim()} style={{width:"100%",padding:"22px",borderRadius:18,border:"none",background:form.title.trim()?C.coral:"#eee",color:form.title.trim()?"#fff":C.gray400,fontSize:18,fontWeight:700,cursor:form.title.trim()?"pointer":"default",transition:"all 0.2s",boxShadow:form.title.trim()?`0 4px 16px ${C.coral}40`:"none"}}>
            {editId?"수정 완료":"저장하고 보드판·탐색에 올리기"}
          </button>
        </div>
      </div>
      )}
      </div>
    </div>
  );
}

export default function App(){
  const [storageError,dismissStorageError]=useStorageErrorBanner();
  const [page,setPage]=useState("explore");
  const [showMobileGuide,setShowMobileGuide]=useState(false);
  useEffect(()=>{
    if(window.innerWidth>640)return;
    if(localStorage.getItem("tripboard_hideMobileGuide")==="1")return;
    setShowMobileGuide(true);
  },[]);
  function dismissMobileGuide(dontShowAgain){
    setShowMobileGuide(false);
    if(dontShowAgain)localStorage.setItem("tripboard_hideMobileGuide","1");
  }
  const [boardItems,setBoardItems]=usePersistentState("tripboard_boardItems",defaultData.tripboard_boardItems??[]);
  const [deckTab,setDeckTab]=useState("route");
  const [selectedDeckRegion,setSelectedDeckRegion]=useState(null);
  const [deckRegionMenuOpen,setDeckRegionMenuOpen]=useState(false);
  const [detailCard,setDetailCard]=useState(null);
  const [miscDetailCard,setMiscDetailCard]=useState(null);
  const [communityModal,setCommunityModal]=useState(null);
  const [deckRouteIds,setDeckRouteIds]=usePersistentState("tripboard_deckRouteIds",defaultData.tripboard_deckRouteIds??(()=>ROUTE_DECK.map(r=>r.id)));
  const [deletedRouteDeckIds,setDeletedRouteDeckIds]=usePersistentState("tripboard_deletedRouteDeckIds",defaultData.tripboard_deletedRouteDeckIds??[]);
  const [savedRoutes,setSavedRoutes]=usePersistentState("tripboard_savedRoutes",defaultData.tripboard_savedRoutes??[]);
  const [deckCommunityIds,setDeckCommunityIds]=usePersistentState("tripboard_deckCommunityIds",defaultData.tripboard_deckCommunityIds??[]);
  const [savedRouteMergedDays,setSavedRouteMergedDays]=usePersistentState("tripboard_savedRouteMergedDays",defaultData.tripboard_savedRouteMergedDays??[]);
  function isSavedDayMerged(routeId,di){return savedRouteMergedDays.includes(`${routeId}::${di}`);}
  function toggleSavedDayMergePref(routeId,di){
    const key=`${routeId}::${di}`;
    setSavedRouteMergedDays(prev=>prev.includes(key)?prev.filter(k=>k!==key):[...prev,key]);
  }
  const [exploreFilter,setExploreFilter]=useState("전체");
  const [categoryOpen,setCategoryOpen]=useState(false);
  const [myCards,setMyCards]=usePersistentState("tripboard_myCards",defaultData.tripboard_myCards??[]);
  const [importedPhoto,setImportedPhoto]=useState(null);
  const [myPosts,setMyPosts]=usePersistentState("tripboard_myPosts",defaultData.tripboard_myPosts??[]);
  const [savedBoards,setSavedBoards]=usePersistentState("tripboard_savedBoards",defaultData.tripboard_savedBoards??[]);
  const [selectedUids,setSelectedUids]=useState([]);
  const [selBox,setSelBox]=useState(null);
  const [boardZoom,setBoardZoom]=useState(1);
  const [costBoxOpen,setCostBoxOpen]=useState(true);
  const [showBoardHelp,setShowBoardHelp]=useState(false);
  const [showManageHelp,setShowManageHelp]=useState(false);
  const [showExploreHelp,setShowExploreHelp]=useState(false);
  const groupBaselineRef=useRef(null);
  const boardRef=useRef();
  const BOARD_BASE_W=1800,BOARD_BASE_H=1300;

  const totalCost=boardItems.filter(i=>i.type!=="arrow"&&i.type!=="text").reduce((s,c)=>{const n=parseInt((c.cost||"").replace(/[^0-9]/g,""));return s+(isNaN(n)?0:n);},0);
  const routeCount=boardItems.filter(i=>i.type!=="arrow"&&i.type!=="text").length;
  const selectedItems=boardItems.filter(i=>selectedUids.includes(i.uid));
  let groupBounds=null;
  if(selectedItems.length>1){
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    selectedItems.forEach(i=>{
      const sz=cardSize(i.type);
      const w=sz.w*(i.scale||1),h=sz.h*(i.scale||1);
      minX=Math.min(minX,i.pos.x);minY=Math.min(minY,i.pos.y);
      maxX=Math.max(maxX,i.pos.x+w);maxY=Math.max(maxY,i.pos.y+h);
    });
    groupBounds={left:minX-12,top:minY-12,width:maxX-minX+24,height:maxY-minY+24};
  }
  const deckRegionGroups=groupByRegion(ROUTE_DECK.filter(r=>deckRouteIds.includes(r.id)),r=>r.region);
  const deckActiveItems=selectedDeckRegion?(deckRegionGroups.find(g=>g.region===selectedDeckRegion)?.items||[]):deckRegionGroups.flatMap(g=>g.items);

  function cardSize(type){
    if(type==="misc")return{w:132,h:132};
    if(type==="text")return{w:140,h:110};
    if(type==="arrow")return{w:64,h:64};
    return{w:190,h:230};
  }
  const boardW=Math.max(BOARD_BASE_W,...boardItems.map(i=>{const sz=cardSize(i.type);return i.pos.x+sz.w*(i.scale||1)+200;}));
  const boardH=Math.max(BOARD_BASE_H,...boardItems.map(i=>{const sz=cardSize(i.type);return i.pos.y+sz.h*(i.scale||1)+200;}));
  function findFreeOrigin(){
    const marginTop=180,marginLeft=60,colWidth=260,rowGap=40,maxY=BOARD_BASE_H-40;
    const cards=boardItems.filter(i=>i.type!=="arrow");
    const bandOf=x=>Math.round((x-marginLeft)/colWidth);
    for(let col=0;col<50;col++){
      const x=marginLeft+col*colWidth;
      const inCol=cards.filter(i=>bandOf(i.pos.x)===col);
      if(!inCol.length)return{x,y:marginTop};
      const bottom=Math.max(...inCol.map(i=>i.pos.y+cardSize(i.type).h*(i.scale||1)))+rowGap;
      if(bottom<=maxY)return{x,y:bottom};
    }
    return{x:marginLeft,y:marginTop};
  }
  function findAttachTarget(pos,items,excludeUid){
    const ARROW_SIZE=64,GAP=10;
    let best=null,bestDist=Infinity;
    items.forEach(b=>{
      if(b.uid===excludeUid||b.type==="arrow"||b.type==="text")return;
      const sz=cardSize(b.type);
      const w=sz.w*(b.scale||1),h=sz.h*(b.scale||1);
      const candidates=[
        {x:b.pos.x+w+GAP,y:b.pos.y+h/2-ARROW_SIZE/2},
        {x:b.pos.x-ARROW_SIZE-GAP,y:b.pos.y+h/2-ARROW_SIZE/2},
        {x:b.pos.x+w/2-ARROW_SIZE/2,y:b.pos.y-ARROW_SIZE-GAP},
        {x:b.pos.x+w/2-ARROW_SIZE/2,y:b.pos.y+h+GAP},
      ];
      candidates.forEach(c=>{
        const d=Math.hypot(c.x-pos.x,c.y-pos.y);
        if(d<80&&d<bestDist){bestDist=d;best=b;}
      });
    });
    return best;
  }
  function computeDropResult(item,pos,prev){
    const p=pos||{x:40+Math.random()*380,y:30+Math.random()*200};
    const newItem={...item,uid:String(Date.now()+Math.random()),pos:p,scale:item.scale||1};
    let next=[...prev,newItem];
    if(item.type==="arrow"){
      const best=findAttachTarget(p,prev,null);
      if(best)next=next.map(b=>b.uid===newItem.uid?{...b,linkedTo:best.uid,offset:{dx:p.x-best.pos.x,dy:p.y-best.pos.y}}:b);
    }else if(item.type!=="text"){
      const sz=cardSize(item.type);
      const arrowTemplate=ARROW_DECK.find(a=>a.dir==="right");
      const offset={dx:sz.w+10,dy:sz.h/2-32};
      next.push({...arrowTemplate,uid:String(Date.now()+Math.random()+0.0001),pos:{x:p.x+offset.dx,y:p.y+offset.dy},scale:1,linkedTo:newItem.uid,offset});
    }
    return next;
  }
  function handleDrop(item,pos){
    setBoardItems(prev=>computeDropResult(item,pos,prev));
  }
  function removeItem(uid){setBoardItems(prev=>prev.filter(i=>i.uid!==uid&&i.linkedTo!==uid));}
  function removeFromBoardBySourceId(cardId){
    setBoardItems(prev=>{
      const removedUids=new Set(prev.filter(i=>i.id===cardId||(typeof i.id==="string"&&i.id.startsWith(cardId+"_d"))).map(i=>i.uid));
      return prev.filter(i=>!removedUids.has(i.uid)&&!removedUids.has(i.linkedTo));
    });
  }
  function addSingleRouteToBoard(route){handleDrop({...route},null);}
  function deleteRouteDeckForever(id){
    setDeletedRouteDeckIds(prev=>prev.includes(id)?prev:[...prev,id]);
    setDeckRouteIds(prev=>prev.filter(i=>i!==id));
  }
  function routeDayRowGap(){return cardSize("misc").h+30;}
  function buildRouteDayItems(route,di,merged){
    const day=(route.dayPlans||[])[di];
    if(!day||!day.steps.length)return[];
    if(merged){
      const withPhoto=day.steps.find(s=>s.photoDataUrl);
      return[{
        id:`${route.id}_d${di}`,
        type:"misc",
        label:day.label,
        icon:withPhoto?.emoji||route.coverEmoji||"📍",
        color:route.color,
        bg:route.bg,
        steps:day.steps.map(s=>({desc:[s.desc,s.tip?`💡 ${s.tip}`:null].filter(Boolean).join("\n\n"),photo:s.photoDataUrl?{dataUrl:s.photoDataUrl}:null})),
      }];
    }
    return day.steps.map((step,si)=>({
      id:`${route.id}_d${di}_s${si}`,
      type:"misc",
      label:`${day.label} ${step.title||`STEP ${si+1}`}`,
      icon:step.emoji||route.coverEmoji||"📍",
      color:route.color,
      bg:route.bg,
      text:[step.desc,step.tip?`💡 ${step.tip}`:null].filter(Boolean).join("\n\n"),
      photo:step.photoDataUrl?{dataUrl:step.photoDataUrl}:null,
    }));
  }
  function addRouteStepsToBoard(route){
    const days=route.dayPlans||[];
    if(!days.length)return;
    const origin=findFreeOrigin();
    const maxY=BOARD_BASE_H-cardSize("misc").h-20;
    const idealGap=routeDayRowGap();
    const gap=days.length>1?Math.max(0,Math.min(idealGap,(maxY-origin.y)/(days.length-1))):idealGap;
    const stepGapX=cardSize("misc").w+10+64+10;
    days.forEach((day,di)=>{
      const items=buildRouteDayItems(route,di,isSavedDayMerged(route.id,di));
      const startY=origin.y+di*gap;
      items.forEach((item,i)=>handleDrop(item,{x:origin.x+i*stepGapX,y:startY}));
    });
  }
  function computeCardDaysItems(card,prevItems){
    const days=(card.days||[]).map(d=>({...d,steps:d.steps.filter(s=>(s.desc&&s.desc.trim())||(s.photos&&s.photos.length>0))})).filter(d=>d.steps.length>0);
    if(!days.length)return prevItems;
    const miscSize=cardSize("misc");
    const stepGapX=miscSize.w+10+64+10;
    const origin=findFreeOrigin();
    const startX=origin.x,startY=origin.y;
    let idx=0,dayCounter=0,items=prevItems;
    days.forEach((day,di)=>{
      if(day.kind!=="misc")dayCounter++;
      const dayLabel=day.kind==="misc"?"기타":`${dayCounter}일차`;
      if(day.merge){
        const item={
          id:`${card.id}_d${di}`,
          type:"misc",
          label:dayLabel,
          icon:"📍",
          color:card.color||C.coral,
          bg:card.bg||"#FFF0F0",
          steps:day.steps.map(s=>({desc:s.desc||"",photos:s.photos||[],hideText:!!s.hideText,hidePhoto:!!s.hidePhoto})),
        };
        items=computeDropResult(item,{x:startX+idx*stepGapX,y:startY},items);
        idx++;
      }else{
        day.steps.forEach((step,si)=>{
          const item={
            id:`${card.id}_d${di}_s${si}`,
            type:"misc",
            label:`${dayLabel} ${step.title||`STEP ${si+1}`}`,
            icon:"📍",
            color:card.color||C.coral,
            bg:card.bg||"#FFF0F0",
            text:step.desc||"",
            photos:step.photos||[],
            hideText:!!step.hideText,
            hidePhoto:!!step.hidePhoto,
          };
          items=computeDropResult(item,{x:startX+idx*stepGapX,y:startY},items);
          idx++;
        });
      }
    });
    return items;
  }
  function addCardDaysToBoard(card){
    const hasContent=(card.days||[]).some(d=>d.steps.some(s=>(s.desc&&s.desc.trim())||(s.photos&&s.photos.length>0)));
    if(!hasContent)return false;
    setBoardItems(prev=>computeCardDaysItems(card,prev));
    return true;
  }
  function addRouteDayToBoard(route,di,mergedOverride){
    const merged=mergedOverride!==undefined?mergedOverride:isSavedDayMerged(route.id,di);
    const items=buildRouteDayItems(route,di,merged);
    if(!items.length)return;
    const origin=findFreeOrigin();
    const stepGapX=cardSize("misc").w+10+64+10;
    items.forEach((item,i)=>handleDrop(item,{x:origin.x+i*stepGapX,y:origin.y}));
  }
  function removeRouteDayFromBoard(route,di){
    const stepCount=(((route.dayPlans||[])[di])?.steps||[]).length;
    const ids=new Set([`${route.id}_d${di}`,...Array.from({length:stepCount},(_,si)=>`${route.id}_d${di}_s${si}`)]);
    setBoardItems(prev=>{
      const removedUids=new Set(prev.filter(i=>ids.has(i.id)).map(i=>i.uid));
      return prev.filter(i=>!removedUids.has(i.uid)&&!removedUids.has(i.linkedTo));
    });
  }
  function addRegionRouteCardsToBoard(region){
    const items=ROUTE_DECK.filter(r=>r.region===region&&deckRouteIds.includes(r.id));
    if(!items.length)return;
    const routeSize=cardSize("route");
    const stepGapX=routeSize.w+10+64+10;
    const origin=findFreeOrigin();
    const startX=origin.x,startY=origin.y;
    items.forEach((route,idx)=>{
      handleDrop({...route},{x:startX+idx*stepGapX,y:startY});
    });
  }
  function resizeItem(uid,scale){setBoardItems(prev=>prev.map(i=>i.uid===uid?{...i,scale}:i));}
  function moveItem(uid,pos){
    setBoardItems(prev=>{
      const moved=prev.find(i=>i.uid===uid);
      if(!moved)return prev;
      if(moved.type==="arrow"){
        const best=findAttachTarget(pos,prev,uid);
        return prev.map(i=>{
          if(i.uid!==uid)return i;
          if(best)return{...i,pos,linkedTo:best.uid,offset:{dx:pos.x-best.pos.x,dy:pos.y-best.pos.y}};
          const{linkedTo,offset,...rest}=i;
          return{...rest,pos};
        });
      }
      return prev.map(i=>{
        if(i.uid===uid)return{...i,pos};
        if(i.linkedTo===uid)return{...i,pos:{x:pos.x+i.offset.dx,y:pos.y+i.offset.dy}};
        return i;
      });
    });
  }
  function saveCurrentBoardSnapshot(){
    if(boardItems.length===0){alert("저장할 카드가 보드판에 없어요.");return;}
    const name=window.prompt("이 보드를 어떤 이름으로 저장할까요?","");
    if(name===null)return;
    const trimmed=name.trim()||`보드 ${savedBoards.length+1}`;
    const cards=boardItems.filter(i=>i.type!=="arrow"&&i.type!=="text");
    const cost=cards.reduce((s,c)=>{const n=parseInt((c.cost||"").replace(/[^0-9]/g,""));return s+(isNaN(n)?0:n);},0);
    const snapshot={
      id:`savedboard_${Date.now()}`,
      name:trimmed,
      savedAt:new Date().toISOString(),
      items:boardItems.map(i=>({...i,pos:{...i.pos}})),
      cardCount:cards.length,
      totalCost:cost,
    };
    setSavedBoards(prev=>[snapshot,...prev]);
  }
  function loadSavedBoardToBoard(snapshot){
    if(boardItems.length>0&&!window.confirm(`지금 보드판 내용을 지우고 "${snapshot.name}"을(를) 불러올까요?`))return;
    const idMap={};
    snapshot.items.forEach(item=>{idMap[item.uid]=`${Date.now()}_${Math.random().toString(36).slice(2,8)}`;});
    const restored=snapshot.items.map(item=>({
      ...item,
      uid:idMap[item.uid],
      linkedTo:item.linkedTo&&idMap[item.linkedTo]?idMap[item.linkedTo]:undefined,
    }));
    setBoardItems(restored);
    setPage("board");
  }
  function deleteSavedBoard(id){
    if(!window.confirm("이 저장된 보드를 삭제할까요? 되돌릴 수 없어요."))return;
    setSavedBoards(prev=>prev.filter(s=>s.id!==id));
  }
  function startGroupDrag(){
    const ids=new Set(selectedUids);
    boardItems.forEach(i=>{if(i.linkedTo&&ids.has(i.linkedTo))ids.add(i.uid);});
    const baseline=new Map();
    boardItems.forEach(i=>{if(ids.has(i.uid))baseline.set(i.uid,i.pos);});
    groupBaselineRef.current=baseline;
  }
  function groupDragMove(dx,dy){
    const baseline=groupBaselineRef.current;
    if(!baseline)return;
    setBoardItems(prev=>prev.map(i=>{
      const base=baseline.get(i.uid);
      if(!base)return i;
      return{...i,pos:{x:base.x+dx,y:base.y+dy}};
    }));
  }
  function endGroupDrag(){groupBaselineRef.current=null;}
  function cancelGroupToDeck(){
    const baseline=groupBaselineRef.current;
    const ids=baseline?new Set(baseline.keys()):new Set(selectedUids);
    setBoardItems(prev=>prev.filter(i=>!ids.has(i.uid)));
    setSelectedUids([]);
    groupBaselineRef.current=null;
  }
  const groupDrag={selectedUids,onGroupStart:startGroupDrag,onGroupMove:groupDragMove,onGroupEnd:endGroupDrag,onGroupCancel:cancelGroupToDeck};
  function onBoardMouseDown(e){
    if(e.target.closest(".resize-handle"))return;
    if(!e.shiftKey){
      const scrollEl=boardRef.current;
      if(!scrollEl)return;
      const startX=e.clientX,startY=e.clientY;
      const scrollLeft=scrollEl.scrollLeft,scrollTop=scrollEl.scrollTop;
      function onPanMove(ev){
        scrollEl.scrollLeft=scrollLeft-(ev.clientX-startX);
        scrollEl.scrollTop=scrollTop-(ev.clientY-startY);
      }
      function onPanUp(){
        window.removeEventListener("mousemove",onPanMove);
        window.removeEventListener("mouseup",onPanUp);
      }
      window.addEventListener("mousemove",onPanMove);
      window.addEventListener("mouseup",onPanUp);
      return;
    }
    const boardEl=document.getElementById("game-board");
    const r=boardEl.getBoundingClientRect();
    const x=(e.clientX-r.left)/boardZoom,y=(e.clientY-r.top)/boardZoom;
    const start={x,y};
    let hitIds=[];
    setSelBox({x1:x,y1:y,x2:x,y2:y});
    function computeHits(box){
      const sel={left:Math.min(box.x1,box.x2),top:Math.min(box.y1,box.y2),right:Math.max(box.x1,box.x2),bottom:Math.max(box.y1,box.y2)};
      const ids=[];
      boardEl.querySelectorAll("[data-carduid]").forEach(el=>{
        const cr=el.getBoundingClientRect();
        const l=(cr.left-r.left)/boardZoom,t=(cr.top-r.top)/boardZoom,ri=l+cr.width/boardZoom,b=t+cr.height/boardZoom;
        if(ri>sel.left&&l<sel.right&&b>sel.top&&t<sel.bottom)ids.push(el.dataset.carduid);
      });
      return ids;
    }
    function onMove(ev){
      const x2=(ev.clientX-r.left)/boardZoom,y2=(ev.clientY-r.top)/boardZoom;
      const box={x1:start.x,y1:start.y,x2,y2};
      setSelBox(box);
      hitIds=computeHits(box);
    }
    function onUp(){
      setSelBox(null);
      setSelectedUids(hitIds);
      window.removeEventListener("mousemove",onMove);
      window.removeEventListener("mouseup",onUp);
    }
    window.addEventListener("mousemove",onMove);
    window.addEventListener("mouseup",onUp);
  }
  function updateMiscCard(uid,patch){
    setBoardItems(prev=>prev.map(i=>i.uid===uid?{...i,...patch}:i));
    setMiscDetailCard(prev=>prev&&prev.uid===uid?{...prev,...patch}:prev);
  }
  function saveRoute(route){setSavedRoutes(prev=>prev.find(r=>r.id===route.id)?prev:[...prev,route]);}
  function addPhotoToCreate(step,route){setImportedPhoto({emoji:step.emoji,label:step.title,routeColor:route.color,routeBg:route.bg,step});setPage("create");}
  function saveStepAsCard(step,route){
    const card={
      id:`my_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
      type:"misc",
      label:step.title||route.title||"장소",
      icon:step.emoji||"📍",
      color:route.color||C.coral,
      bg:route.bg||"#FFF0F0",
      text:[step.desc,step.tip?`💡 ${step.tip}`:null].filter(Boolean).join("\n\n"),
      photo:step.photoDataUrl?{dataUrl:step.photoDataUrl}:null,
      isCustom:true,
    };
    setMyCards(prev=>[...prev,card]);
  }
  function publishCardToExplore(card){
    const emoji=card.photo?.emoji||card.emoji||"📍";
    const photoDataUrl=card.photo?.dataUrl;
    const builtDayPlans=buildDayPlansFromCard(card);
    const dayPlans=builtDayPlans.length?builtDayPlans:[{day:1,label:"1일차",theme:card.title,steps:[{emoji,title:card.title,desc:card.desc||"",tip:card.tip||"",photoDataUrl}]}];
    const steps=dayPlans[0].steps.map(s=>({emoji:s.emoji,title:s.title}));
    const post={
      id:`mine_${card.id}`,sourceId:card.id,isMine:true,
      author:"나의 여행",avatar:"나",avatarBg:card.color||C.coral,region:card.region||"내 루트",
      title:card.title,likes:0,rating:5.0,tags:["내 카드"],totalCost:card.cost||"미정",
      color:card.color||C.coral,bg:card.bg||"#FFF0F0",coverEmoji:emoji,photoDataUrl,desc:card.desc||"",
      steps,dayPlans,
    };
    setMyPosts(prev=>prev.some(p=>p.sourceId===card.id)?prev.map(p=>p.sourceId===card.id?post:p):[post,...prev]);
  }
  function unpublishCard(cardId){setMyPosts(prev=>prev.filter(p=>p.sourceId!==cardId&&p.sourceCardId!==cardId));}
  function removeMyPost(postId){setMyPosts(prev=>prev.filter(p=>p.id!==postId));}
  function isMyCardOnBoard(cardId){return boardItems.some(i=>i.id===cardId||(typeof i.id==="string"&&i.id.startsWith(cardId+"_d")));}
  function addMyCardToBoard(card){
    const hasDays=(card.days||[]).some(d=>d.steps.some(s=>(s.desc&&s.desc.trim())||(s.photos&&s.photos.length>0)));
    if(hasDays)addCardDaysToBoard(card);else handleDrop({...card},null);
  }
  function buildDayPlansFromCard(card){
    const filledDays=(card.days||[]).map(d=>({...d,steps:d.steps.filter(s=>(s.desc&&s.desc.trim())||(s.photos&&s.photos.length>0))})).filter(d=>d.steps.length>0);
    let dayCounter=0;
    return filledDays.map(d=>{
      const label=d.kind==="misc"?"기타":`${++dayCounter}일차`;
      return{
        day:dayCounter,label,theme:d.theme||"",
        steps:d.steps.map((s,si)=>({emoji:"📍",title:s.title?.trim()||`STEP ${si+1}`,desc:s.desc||"",tip:"",photoDataUrl:s.photos?.[0]?.dataUrl})),
      };
    });
  }
  function publishBoardToExploreWithItems(items,dayPlans=[],sourceCard=null){
    if(items.length===0)return;
    const cards=items.filter(i=>i.type!=="arrow"&&i.type!=="text");
    const cost=cards.reduce((s,c)=>{const n=parseInt((c.cost||"").replace(/[^0-9]/g,""));return s+(isNaN(n)?0:n);},0);
    const snapshot=items.map(i=>({...i,pos:{...i.pos}}));
    const emoji=sourceCard?.photo?.emoji||sourceCard?.emoji||"🗺️";
    const photoDataUrl=sourceCard?.photo?.dataUrl;
    const post={
      id:`board_${Date.now()}`,isMine:true,isBoardLayout:true,boardSnapshot:snapshot,
      sourceCardId:sourceCard?.id,
      author:"나의 여행",avatar:"나",avatarBg:sourceCard?.color||C.coral,region:sourceCard?.region||"내 보드",
      title:sourceCard?.title||"나의 여행 보드",likes:0,rating:5.0,tags:["내 보드"],totalCost:cost>0?`${cost.toLocaleString()}원`:"미정",
      color:sourceCard?.color||C.coral,bg:sourceCard?.bg||"#FFF0F0",coverEmoji:emoji,photoDataUrl,
      desc:sourceCard?.desc||`카드 ${cards.length}개로 구성한 보드판이에요. 순서 그대로 가져가서 써보세요.`,
      steps:[],dayPlans,
    };
    setMyPosts(prev=>[post,...prev]);
  }
  function saveCardToBoardAndPublish(card){
    const hasDays=(card.days||[]).some(d=>d.steps.some(s=>(s.desc&&s.desc.trim())||(s.photos&&s.photos.length>0)));
    const items=hasDays?computeCardDaysItems(card,boardItems):computeDropResult(card,null,boardItems);
    if(items===boardItems)return;
    const dayPlans=hasDays?buildDayPlansFromCard(card):[];
    setBoardItems(items);
    publishBoardToExploreWithItems(items,dayPlans,card);
  }
  function syncCardToBoard(card){
    const days=(card.days||[]).map(d=>({...d,steps:d.steps.filter(s=>(s.desc&&s.desc.trim())||(s.photos&&s.photos.length>0))})).filter(d=>d.steps.length>0);
    const newItemsById={};
    let dayCounter=0;
    days.forEach((day,di)=>{
      if(day.kind!=="misc")dayCounter++;
      const dayLabel=day.kind==="misc"?"기타":`${dayCounter}일차`;
      if(day.merge){
        const id=`${card.id}_d${di}`;
        newItemsById[id]={
          id,type:"misc",label:dayLabel,icon:"📍",color:card.color||C.coral,bg:card.bg||"#FFF0F0",
          steps:day.steps.map(s=>({desc:s.desc||"",photos:s.photos||[],hideText:!!s.hideText,hidePhoto:!!s.hidePhoto})),
        };
      }else{
        day.steps.forEach((step,si)=>{
          const id=`${card.id}_d${di}_s${si}`;
          newItemsById[id]={
            id,type:"misc",label:`${dayLabel} ${step.title||`STEP ${si+1}`}`,icon:"📍",color:card.color||C.coral,bg:card.bg||"#FFF0F0",
            text:step.desc||"",photos:step.photos||[],hideText:!!step.hideText,hidePhoto:!!step.hidePhoto,
          };
        });
      }
    });
    const prefix=`${card.id}_`;
    const newIds=new Set(Object.keys(newItemsById));
    const existingIds=new Set(boardItems.filter(i=>i.id&&i.id.startsWith(prefix)).map(i=>i.id));
    let next=boardItems
      .filter(i=>!(i.id&&i.id.startsWith(prefix))||newIds.has(i.id))
      .map(i=>newItemsById[i.id]?{...i,...newItemsById[i.id]}:i);
    const toAddIds=[...newIds].filter(id=>!existingIds.has(id));
    if(toAddIds.length){
      const stepGapX=cardSize("misc").w+10+64+10;
      const origin=findFreeOrigin();
      toAddIds.forEach((id,idx)=>{next=computeDropResult(newItemsById[id],{x:origin.x+idx*stepGapX,y:origin.y},next);});
    }
    const liveUids=new Set(next.filter(i=>i.type!=="arrow").map(i=>i.uid));
    next=next.filter(i=>i.type!=="arrow"||!i.linkedTo||liveUids.has(i.linkedTo));
    setBoardItems(next);
    if(Object.keys(newItemsById).length===0)return;
    const dayPlans=buildDayPlansFromCard(card);
    const emoji=card.photo?.emoji||card.emoji||"🗺️";
    setMyPosts(prev=>prev.map(p=>(p.sourceCardId===card.id||p.sourceId===card.id)?{...p,title:card.title||p.title,desc:card.desc||p.desc,region:card.region||p.region,color:card.color||p.color,bg:card.bg||p.bg,coverEmoji:emoji,photoDataUrl:card.photo?.dataUrl,dayPlans}:p));
  }
  function importBoardFromPost(route){
    if(!route.boardSnapshot)return;
    const idMap={};
    route.boardSnapshot.forEach(item=>{idMap[item.uid]=`${Date.now()}_${Math.random().toString(36).slice(2,8)}`;});
    const imported=route.boardSnapshot.map(item=>({
      ...item,
      uid:idMap[item.uid],
      linkedTo:item.linkedTo&&idMap[item.linkedTo]?idMap[item.linkedTo]:undefined,
    }));
    setBoardItems(prev=>[...prev,...imported]);
    setPage("board");
  }

  const COUNTRY_REGIONS={"일본":["도쿄","오사카","교토"],"한국":["제주","부산"],"프랑스":["파리","니스"],"미국":["뉴욕"],"인도네시아":["발리"]};
  const META_FILTERS=["전체","내 게시물"];
  const DEST_FILTERS=[...Object.keys(COUNTRY_REGIONS),"기타"];
  const THEME_FILTERS=["감성","먹방"];
  const KNOWN_REGION_CITIES=Object.values(COUNTRY_REGIONS).flat();
  const filterBtnStyle=f=>({padding:"7px 16px",borderRadius:20,border:`1.5px solid ${exploreFilter===f?C.coral:C.gray200}`,background:exploreFilter===f?C.coral:C.white,color:exploreFilter===f?"#fff":C.gray600,fontSize:12,fontWeight:600,cursor:"pointer",transition:"all 0.15s",boxShadow:exploreFilter===f?`0 4px 12px ${C.coral}30`:C.shadow});
  const allRoutes=[...myPosts,...COMMUNITY_ROUTES];
  const filteredRoutes=exploreFilter==="전체"?allRoutes
    :exploreFilter==="내 게시물"?allRoutes.filter(r=>r.isMine)
    :exploreFilter==="기타"?allRoutes.filter(r=>!KNOWN_REGION_CITIES.some(k=>(r.region||"").includes(k)))
    :COUNTRY_REGIONS[exploreFilter]?allRoutes.filter(r=>COUNTRY_REGIONS[exploreFilter].some(c=>(r.region||"").includes(c)))
    :allRoutes.filter(r=>(r.region||"").includes(exploreFilter)||(r.tags||[]).includes(exploreFilter));
  const savedIds=savedRoutes.map(r=>r.id);
  const NAV=[["explore","탐색"],["board","보드판"],["manage","덱 관리"],["create","카드 제작"],["savedboards","저장한 보드"]];

  return(
    <div style={{background:"#EDEDEF",height:"100vh",overflow:"hidden",display:"flex",justifyContent:"center"}}>
    <div style={{fontFamily:"-apple-system,'Pretendard',sans-serif",background:C.bg,height:"100vh",overflow:"hidden",width:"100%",maxWidth:1280,display:"flex",flexDirection:"column",boxShadow:"0 0 40px rgba(0,0,0,0.08)"}}>
      <style>{`
        @media (max-width: 640px) {
          .tb-header{padding:0 10px !important;height:52px !important;gap:10px !important;justify-content:flex-start !important;}
          .tb-logo-icon{width:28px !important;height:28px !important;font-size:15px !important;}
          .tb-logo-text{display:none !important;}
          .tb-nav{gap:1px !important;padding:3px !important;}
          .tb-navbtn{padding:6px 9px !important;font-size:11px !important;}
          .tb-header-meta{display:none !important;}
          .tb-decktabs{flex-wrap:nowrap !important;}
          .tb-deckhint{display:none !important;}
          .tb-board-costbox{top:10px !important;right:10px !important;padding:8px 12px 8px 10px !important;gap:8px !important;border-radius:14px !important;}
          .tb-board-costbox .tb-cost-icon{width:32px !important;height:32px !important;font-size:16px !important;}
          .tb-board-costbox .tb-cost-label{font-size:9px !important;}
          .tb-board-costbox .tb-cost-amount{font-size:17px !important;}
          .tb-board-costbox .tb-cost-count{font-size:9px !important;}
          .tb-cost-collapsed{top:10px !important;right:10px !important;height:36px !important;padding:0 12px !important;font-size:12px !important;}
          .tb-board-help-wrap{bottom:16px !important;left:16px !important;}
          .tb-board-help{height:38px !important;padding:0 12px 0 10px !important;font-size:12px !important;}
          .tb-help-icon{width:18px !important;height:18px !important;font-size:11px !important;}
          .tb-zoom-wrap{bottom:16px !important;right:16px !important;}
          .tb-zoom-cluster button{height:28px !important;font-size:12px !important;}
          .tb-clear-btn{height:38px !important;padding:0 12px !important;font-size:11px !important;}
        }
      `}</style>
      {detailCard&&<RouteDetailModal card={detailCard} onClose={()=>setDetailCard(null)}/>}
      {miscDetailCard&&<MiscDetailModal card={miscDetailCard} onClose={()=>setMiscDetailCard(null)} onUpdate={updateMiscCard}/>}
      {communityModal&&<CommunityDetailModal route={communityModal} savedIds={savedIds} onSave={saveRoute} onClose={()=>setCommunityModal(null)} onImportPhoto={(step)=>{addPhotoToCreate(step,communityModal);setCommunityModal(null);}} onSaveStep={saveStepAsCard} onImportBoard={importBoardFromPost}/>}
      {showMobileGuide&&(
        <div style={{position:"fixed",inset:0,zIndex:999999,background:"rgba(0,0,0,0.55)",display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={()=>dismissMobileGuide(false)}>
          <div style={{background:C.white,borderRadius:20,width:"min(360px,100%)",maxHeight:"88vh",overflowY:"auto",boxShadow:"0 24px 64px rgba(0,0,0,0.3)"}} onClick={e=>e.stopPropagation()}>
            <div style={{padding:"20px 20px 4px"}}>
              <div style={{fontSize:17,fontWeight:800,color:C.gray900,marginBottom:6}}>📱 PC 화면으로 더 편하게 보기</div>
              <div style={{fontSize:13,color:C.gray600,lineHeight:1.6,marginBottom:14}}>브라우저 메뉴에서 <b>"데스크톱 사이트"</b>를 켜면 화면을 더 편하게 볼 수 있어요.</div>
            </div>
            <div style={{padding:"0 20px",display:"flex",flexDirection:"column",gap:10}}>
              <div>
                <div style={{fontSize:11,fontWeight:700,color:C.coral,marginBottom:4}}>1. 브라우저 메뉴(⋮) 누르기</div>
                <img src={mobileGuide1} alt="브라우저 메뉴 버튼 위치" style={{width:"100%",borderRadius:12,border:`1px solid ${C.gray100}`}}/>
              </div>
              <div>
                <div style={{fontSize:11,fontWeight:700,color:C.coral,marginBottom:4}}>2. "데스크톱 사이트" 켜기</div>
                <img src={mobileGuide2} alt="데스크톱 사이트 메뉴 항목 위치" style={{width:"100%",borderRadius:12,border:`1px solid ${C.gray100}`}}/>
              </div>
            </div>
            <div style={{padding:20,display:"flex",flexDirection:"column",gap:8}}>
              <button onClick={()=>dismissMobileGuide(false)} style={{width:"100%",padding:"13px",borderRadius:12,border:"none",background:C.coral,color:"#fff",fontSize:14,fontWeight:700,cursor:"pointer"}}>확인했어요</button>
              <button onClick={()=>dismissMobileGuide(true)} style={{width:"100%",padding:"10px",borderRadius:12,border:"none",background:"transparent",color:C.gray400,fontSize:12,fontWeight:600,cursor:"pointer"}}>다시 보지 않기</button>
            </div>
          </div>
        </div>
      )}
      {storageError&&(
        <div style={{position:"fixed",top:76,left:"50%",transform:"translateX(-50%)",zIndex:999999,maxWidth:"min(520px,90vw)",background:"#FFF0F0",border:`1.5px solid ${C.coral}`,borderRadius:14,padding:"14px 18px",boxShadow:"0 12px 32px rgba(0,0,0,0.18)",display:"flex",alignItems:"flex-start",gap:12}}>
          <span style={{fontSize:20,flexShrink:0}}>⚠️</span>
          <div style={{fontSize:13,color:C.gray900,lineHeight:1.6,flex:1}}>{storageError}</div>
          <button onClick={dismissStorageError} style={{width:24,height:24,borderRadius:"50%",border:"none",background:"transparent",cursor:"pointer",fontSize:14,color:C.gray400,flexShrink:0}}>✕</button>
        </div>
      )}

      <div className="tb-header" style={{height:60,background:C.white,padding:"0 24px",display:"flex",alignItems:"center",justifyContent:"space-between",borderBottom:`1px solid ${C.gray100}`,boxShadow:"0 1px 8px rgba(0,0,0,0.06)",flexShrink:0,position:"sticky",top:0,zIndex:1000}}>
        <div onClick={()=>setPage("explore")} style={{display:"flex",alignItems:"center",gap:10,cursor:"pointer"}}>
          <div className="tb-logo-icon" style={{width:34,height:34,borderRadius:10,background:`linear-gradient(135deg,${C.coral},${C.orange})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>🗺️</div>
          <span className="tb-logo-text" style={{fontSize:18,fontWeight:800,color:C.gray900,letterSpacing:-0.5}}>TRIPBOARD</span>
        </div>
        <nav className="tb-nav" style={{display:"flex",gap:2,background:C.gray50,borderRadius:12,padding:4}}>
          {NAV.map(([key,label])=>(
            <button key={key} className="tb-navbtn" onClick={()=>setPage(key)} style={{padding:"7px 18px",borderRadius:9,border:"none",cursor:"pointer",fontSize:12,fontWeight:600,background:page===key?C.white:"transparent",color:page===key?C.gray900:C.gray400,boxShadow:page===key?C.shadow:"none",transition:"all 0.15s",whiteSpace:"nowrap"}}>
              {label}
            </button>
          ))}
        </nav>
        <div className="tb-header-meta" style={{display:"flex",alignItems:"center",gap:12}}>
          {totalCost>0&&<span style={{fontSize:13,fontWeight:700,color:C.coral}}>예상 {totalCost.toLocaleString()}원</span>}
          <span style={{fontSize:11,color:C.gray400}}>{routeCount}개 보드</span>
        </div>
      </div>

      {page==="explore"&&(
        <div style={{flex:1,overflowY:"auto",padding:"24px"}}>
          <div style={{position:"fixed",bottom:32,left:36,zIndex:9000}}
            onMouseEnter={()=>setShowExploreHelp(true)} onMouseLeave={()=>setShowExploreHelp(false)}>
            <button style={{height:44,padding:"0 18px 0 14px",borderRadius:22,background:`linear-gradient(135deg,${C.coral},${C.orange})`,border:"none",boxShadow:"0 12px 28px rgba(255,90,90,0.45)",cursor:"pointer",fontSize:14,fontWeight:800,color:"#fff",display:"flex",alignItems:"center",gap:7}}>
              <span style={{width:22,height:22,borderRadius:"50%",background:"rgba(255,255,255,0.3)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13}}>?</span>
              <span>도움말</span>
            </button>
            {showExploreHelp&&<div style={{position:"absolute",bottom:52,left:0,width:330,background:C.white,borderRadius:14,padding:"18px 20px",boxShadow:"0 16px 40px rgba(0,0,0,0.18)",border:`1px solid ${C.gray100}`}}>
              <div style={{display:"flex",flexDirection:"column",gap:14}}>
                <div>
                  <div style={{fontSize:13,fontWeight:800,color:C.coral,marginBottom:4}}>🔍 탐색</div>
                  <div style={{fontSize:13,color:C.gray600,lineHeight:1.6}}>다른 여행자의 루트를 구경해요. "카테고리"로 나라·테마별로 찾아볼 수 있어요.</div>
                </div>
                <div>
                  <div style={{fontSize:13,fontWeight:800,color:C.coral,marginBottom:4}}>📋 탐색 → 덱 관리</div>
                  <div style={{fontSize:13,color:C.gray600,lineHeight:1.6}}>마음에 드는 루트를 "저장하기"하면 덱 관리의 "저장한 루트"에 나타나서 보드판에 추가할 수 있어요.</div>
                </div>
                <div>
                  <div style={{fontSize:13,fontWeight:800,color:C.coral,marginBottom:4}}>✏️ 카드 제작 → 탐색</div>
                  <div style={{fontSize:13,color:C.gray600,lineHeight:1.6}}>카드 제작에서 만든 루트 카드는 자동으로 여기에 게시돼요. 카드 제작에서 "게시 취소"로 내릴 수 있어요.</div>
                </div>
              </div>
            </div>}
          </div>
          <div style={{marginBottom:20}}>
            <h1 style={{fontSize:24,fontWeight:800,color:C.gray900,margin:"0 0 4px"}}>어디로 떠나볼까요?</h1>
            <p style={{fontSize:13,color:C.gray400,margin:"0 0 16px"}}>다른 여행자의 루트를 따라가거나 나만의 루트로 수정해보세요</p>
            <button onClick={()=>setCategoryOpen(o=>!o)} style={{display:"flex",alignItems:"center",gap:6,padding:"7px 16px",borderRadius:20,border:`1.5px solid ${categoryOpen||exploreFilter!=="전체"?C.coral:C.gray200}`,background:categoryOpen||exploreFilter!=="전체"?"#FFF0F0":C.white,color:categoryOpen||exploreFilter!=="전체"?C.coral:C.gray600,fontSize:12,fontWeight:600,cursor:"pointer",transition:"all 0.15s"}}>
              카테고리{exploreFilter!=="전체"?` · ${exploreFilter}`:""}
              <span style={{fontSize:22,transform:categoryOpen?"rotate(180deg)":"rotate(0)",transition:"transform 0.15s"}}>▾</span>
            </button>
            {categoryOpen&&<div style={{display:"flex",flexDirection:"column",gap:12,marginTop:10}}>
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                {META_FILTERS.map(f=><button key={f} onClick={()=>{setExploreFilter(f);setCategoryOpen(false);}} style={filterBtnStyle(f)}>{f}</button>)}
              </div>
              <div>
                <div style={{fontSize:11,fontWeight:700,color:C.gray400,marginBottom:6,letterSpacing:0.3}}>여행지</div>
                <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                  {DEST_FILTERS.map(f=><button key={f} onClick={()=>{setExploreFilter(f);setCategoryOpen(false);}} style={filterBtnStyle(f)}>{f}</button>)}
                </div>
              </div>
              <div>
                <div style={{fontSize:11,fontWeight:700,color:C.gray400,marginBottom:6,letterSpacing:0.3}}>테마</div>
                <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                  {THEME_FILTERS.map(f=><button key={f} onClick={()=>{setExploreFilter(f);setCategoryOpen(false);}} style={filterBtnStyle(f)}>{f}</button>)}
                </div>
              </div>
            </div>}
          </div>
          <div style={{columns:"2 280px",columnGap:16}}>
            {filteredRoutes.filter(route=>route&&route.title).map((route,idx)=>(
              <div key={route.id} style={{breakInside:"avoid",marginBottom:16,background:C.white,borderRadius:20,overflow:"hidden",border:`1px solid ${C.gray100}`,boxShadow:C.shadow,transition:"box-shadow 0.18s,transform 0.18s"}}
                onMouseEnter={e=>{e.currentTarget.style.boxShadow=C.shadowHover;e.currentTarget.style.transform="translateY(-3px)";}}
                onMouseLeave={e=>{e.currentTarget.style.boxShadow=C.shadow;e.currentTarget.style.transform="translateY(0)";}}>
                <div style={{background:`linear-gradient(135deg,${route.bg},${route.color}18)`,padding:"28px 20px 20px",textAlign:"center",position:"relative"}}>
                  {route.isMine&&<div style={{position:"absolute",top:10,left:10,fontSize:10,color:"#fff",background:route.color,borderRadius:20,padding:"3px 9px",fontWeight:700}}>내가 만든 카드</div>}
                  {route.isMine&&<button onClick={ev=>{ev.stopPropagation();if(window.confirm("이 게시물을 탐색에서 내릴까요?"))removeMyPost(route.id);}} title="탐색에서 내리기" style={{position:"absolute",top:8,right:8,width:24,height:24,borderRadius:"50%",background:"rgba(255,255,255,0.9)",border:`1px solid ${C.gray200}`,cursor:"pointer",fontSize:11,color:C.gray600,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>}
                  {route.photoDataUrl?<img src={route.photoDataUrl} alt="" style={{width:88,height:88,borderRadius:16,objectFit:"cover",marginBottom:12}}/>
                    :<div style={{fontSize:idx%3===0?72:idx%3===1?60:68,lineHeight:1,marginBottom:12}}>{route.coverEmoji||((route.preview||[])[0])||"🗺️"}</div>}
                  <div style={{display:"flex",gap:6,justifyContent:"center",flexWrap:"wrap"}}>
                    {(route.preview||[]).slice(1).map((e,i)=>(
                      <div key={i} onClick={ev=>{ev.stopPropagation();addPhotoToCreate({emoji:e,title:(route.steps&&route.steps[i+1]?.title)||route.title,desc:"",tip:""},route);}}
                        style={{width:38,height:38,background:"rgba(255,255,255,0.88)",borderRadius:10,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,cursor:"pointer",border:`1px solid ${route.color}25`,transition:"all 0.15s"}}
                        onMouseEnter={e=>{e.currentTarget.style.background=C.white;e.currentTarget.style.transform="scale(1.1)";}}
                        onMouseLeave={e=>{e.currentTarget.style.background="rgba(255,255,255,0.88)";e.currentTarget.style.transform="scale(1)";}}>
                        {e}
                      </div>
                    ))}
                  </div>
                  <div style={{position:"absolute",top:10,right:route.isMine?42:10,fontSize:10,color:route.color,background:"rgba(255,255,255,0.88)",borderRadius:20,padding:"3px 8px",fontWeight:600}}>사진 클릭 → 가져오기</div>
                </div>
                <div style={{padding:"16px 18px"}}>
                  <div style={{display:"flex",gap:5,marginBottom:8}}>{route.tags.map(t=><span key={t} style={{fontSize:10,fontWeight:700,color:route.color,background:route.bg,borderRadius:20,padding:"3px 9px"}}>{t}</span>)}</div>
                  <div style={{fontSize:15,fontWeight:800,color:C.gray900,marginBottom:5,lineHeight:1.3}}>{route.title}</div>
                  <div style={{fontSize:12,color:C.gray400,lineHeight:1.5,marginBottom:12}}>{route.desc}</div>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
                    <div style={{display:"flex",alignItems:"center",gap:7}}>
                      <div style={{width:26,height:26,borderRadius:"50%",background:route.avatarBg||route.color,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:800,color:"#fff"}}>{route.avatar}</div>
                      <div><div style={{fontSize:12,fontWeight:600,color:C.gray900}}>{route.author}</div><div style={{fontSize:10,color:C.gray400}}>{route.region}</div></div>
                    </div>
                    <div style={{display:"flex",gap:8,alignItems:"center"}}>
                      <span style={{fontSize:11,color:C.gray400}}>♡ {route.likes.toLocaleString()}</span>
                      <span style={{fontSize:11,color:C.yellow,fontWeight:600}}>★ {route.rating}</span>
                      <span style={{fontSize:11,fontWeight:700,color:route.color}}>{route.totalCost}</span>
                    </div>
                  </div>
                  <div style={{display:"flex",gap:8}}>
                    <button onClick={()=>setCommunityModal(route)} style={{flex:1,padding:"9px",borderRadius:10,border:`1px solid ${C.gray200}`,background:C.white,color:C.gray600,fontSize:12,fontWeight:600,cursor:"pointer",transition:"all 0.15s"}}
                      onMouseEnter={e=>{e.currentTarget.style.borderColor=route.color;e.currentTarget.style.color=route.color;}}
                      onMouseLeave={e=>{e.currentTarget.style.borderColor=C.gray200;e.currentTarget.style.color=C.gray600;}}>
                      자세히 보기
                    </button>
                    <button onClick={()=>saveRoute(route)} style={{flex:1,padding:"9px",borderRadius:10,border:"none",background:savedIds.includes(route.id)?C.green:route.color,color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer",transition:"background 0.18s",boxShadow:`0 3px 10px ${route.color}40`}}>
                      {savedIds.includes(route.id)?"✓ 저장됨":"저장하기"}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {page==="manage"&&(
        <div style={{flex:1,overflowY:"auto",padding:"24px 28px"}}>
          <div style={{maxWidth:1160,margin:"0 auto"}}>
          <div style={{display:"flex",alignItems:"center",gap:10,margin:"0 0 4px"}}>
            <h2 style={{fontSize:20,fontWeight:800,color:C.gray900,margin:0}}>덱 관리</h2>
            <div style={{position:"relative"}} onMouseEnter={()=>setShowManageHelp(true)} onMouseLeave={()=>setShowManageHelp(false)}>
              <button style={{height:26,padding:"0 12px 0 10px",borderRadius:20,border:"none",background:`linear-gradient(135deg,${C.coral},${C.orange})`,color:"#fff",fontSize:11,fontWeight:800,cursor:"pointer",display:"flex",alignItems:"center",gap:5,boxShadow:`0 4px 12px ${C.coral}50`}}>
                <span style={{width:15,height:15,borderRadius:"50%",background:"rgba(255,255,255,0.3)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10}}>?</span>
                도움말
              </button>
              {showManageHelp&&<div style={{position:"absolute",top:32,left:0,width:330,background:C.white,borderRadius:14,padding:"18px 20px",boxShadow:"0 16px 40px rgba(0,0,0,0.18)",border:`1px solid ${C.gray100}`,zIndex:200}}>
                <div style={{display:"flex",flexDirection:"column",gap:14}}>
                  <div>
                    <div style={{fontSize:13,fontWeight:800,color:C.coral,marginBottom:4}}>🔍 탐색 → 덱 관리</div>
                    <div style={{fontSize:13,color:C.gray600,lineHeight:1.6}}>탐색에서 "저장하기"한 루트가 여기 "저장한 루트"에 나타나요.</div>
                  </div>
                  <div>
                    <div style={{fontSize:13,fontWeight:800,color:C.coral,marginBottom:4}}>📋 덱 관리</div>
                    <div style={{fontSize:13,color:C.gray600,lineHeight:1.6}}>기본 루트 카드·저장한 루트·내가 만든 카드를 한 곳에서 관리해요. 클릭이나 드래그로 켜고 끄고, 저장한 루트는 일차별로 합침/분리도 고를 수 있어요. 모서리 ✕는 완전히 삭제예요.</div>
                  </div>
                  <div>
                    <div style={{fontSize:13,fontWeight:800,color:C.coral,marginBottom:4}}>🗺️ 덱 관리 → 보드판</div>
                    <div style={{fontSize:13,color:C.gray600,lineHeight:1.6}}>여기서 켠(✕ 표시) 카드는 그대로 보드판에 올라가고, 끄면 보드판에서 빠져요.</div>
                  </div>
                </div>
              </div>}
            </div>
          </div>
          <p style={{fontSize:13,color:C.gray400,margin:"0 0 24px"}}>하단 덱에 표시할 카드를 골라요</p>
          <div style={{background:C.white,borderRadius:20,border:`1px solid ${C.gray100}`,boxShadow:C.shadow,padding:24,minHeight:"calc(100vh - 330px)"}}>
            <DeckRouteManager deckRouteIds={deckRouteIds} setDeckRouteIds={setDeckRouteIds} onAddRegionToBoard={addRegionRouteCardsToBoard} deletedIds={deletedRouteDeckIds} onDeleteForever={deleteRouteDeckForever}
              savedRoutes={savedRoutes} deckCommunityIds={deckCommunityIds} setDeckCommunityIds={setDeckCommunityIds} onAddRouteToBoard={addRouteStepsToBoard} onAddRouteDayToBoard={addRouteDayToBoard} onRemoveRouteDayFromBoard={removeRouteDayFromBoard} onDeleteSavedRoute={id=>setSavedRoutes(prev=>prev.filter(r=>r.id!==id))}
              onAddSingleRouteToBoard={addSingleRouteToBoard} onRemoveSingleRouteFromBoard={removeFromBoardBySourceId}
              myCards={myCards} isMyCardOnBoard={isMyCardOnBoard} onAddMyCardToBoard={addMyCardToBoard} onRemoveMyCardFromBoard={removeFromBoardBySourceId}
              isSavedDayMerged={isSavedDayMerged} onToggleSavedDayMerge={toggleSavedDayMergePref}/>
          </div>
          <button onClick={()=>setPage("board")} style={{width:"100%",padding:"14px",borderRadius:14,border:"none",background:`linear-gradient(135deg,${C.coral},${C.orange})`,color:"#fff",fontSize:14,fontWeight:700,cursor:"pointer",boxShadow:`0 4px 20px ${C.coral}40`,marginTop:24}}>보드판으로 이동 →</button>
          </div>
        </div>
      )}

      {page==="create"&&<CreateCardTab myCards={myCards} setMyCards={setMyCards} onAddToBoard={handleDrop} onAddDaysToBoard={addCardDaysToBoard} boardCardIds={boardItems.map(i=>i.id)} onRemoveFromBoard={removeFromBoardBySourceId} importedPhoto={importedPhoto} clearImportedPhoto={()=>setImportedPhoto(null)} publishedIds={[...myPosts.map(p=>p.sourceId),...myPosts.map(p=>p.sourceCardId)].filter(Boolean)} onPublish={publishCardToExplore} onUnpublish={unpublishCard} onGoExplore={()=>setPage("explore")} onSaveToBoardAndPublish={saveCardToBoardAndPublish} onSyncToBoard={syncCardToBoard}/>}

      {page==="savedboards"&&(
        <div style={{flex:1,overflowY:"auto",padding:"24px 28px"}}>
          <div style={{marginBottom:20}}>
            <div style={{fontSize:20,fontWeight:800,color:C.gray900,marginBottom:4}}>저장한 보드</div>
            <div style={{fontSize:13,color:C.gray400}}>보드판에서 "이 보드 저장하기"로 저장해둔 구성을 여기서 다시 보고 불러올 수 있어요</div>
          </div>
          {savedBoards.length===0?(
            <div style={{background:C.white,borderRadius:20,border:`1px solid ${C.gray100}`,padding:"60px 24px",textAlign:"center",color:C.gray400,fontSize:14}}>
              아직 저장한 보드가 없어요. 보드판에서 원하는 대로 배치한 뒤 "이 보드 저장하기"를 눌러보세요.
            </div>
          ):(
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:16}}>
              {savedBoards.map(sb=>{
                const cards=sb.items.filter(i=>i.type!=="arrow"&&i.type!=="text");
                return(
                  <div key={sb.id} style={{background:C.white,borderRadius:20,border:`1px solid ${C.gray100}`,boxShadow:C.shadow,padding:20}}>
                    <div style={{fontSize:16,fontWeight:800,color:C.gray900,marginBottom:4}}>{sb.name}</div>
                    <div style={{fontSize:12,color:C.gray400,marginBottom:12}}>{new Date(sb.savedAt).toLocaleString()}</div>
                    <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:14}}>
                      {cards.slice(0,6).map((c,i)=>(
                        <div key={i} style={{width:32,height:32,borderRadius:8,background:c.bg||"#F7F7F7",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,overflow:"hidden",flexShrink:0}}>
                          {c.photo?.dataUrl?<img src={c.photo.dataUrl} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/>:(c.emoji||c.icon||"📍")}
                        </div>
                      ))}
                      {cards.length>6&&<div style={{width:32,height:32,borderRadius:8,background:C.gray50,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:C.gray400,flexShrink:0}}>+{cards.length-6}</div>}
                    </div>
                    <div style={{display:"flex",gap:12,marginBottom:14,fontSize:12,color:C.gray600}}>
                      <span>카드 {sb.cardCount}개</span>
                      <span>{sb.totalCost>0?`${sb.totalCost.toLocaleString()}원`:"비용 미정"}</span>
                    </div>
                    <div style={{display:"flex",gap:8}}>
                      <button onClick={()=>loadSavedBoardToBoard(sb)} style={{flex:1,padding:"9px",borderRadius:10,border:"none",background:C.coral,color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer"}}>보드판에 불러오기</button>
                      <button onClick={()=>deleteSavedBoard(sb.id)} style={{padding:"9px 12px",borderRadius:10,border:`1px solid ${C.gray200}`,background:C.white,color:C.gray400,fontSize:12,fontWeight:600,cursor:"pointer"}}>삭제</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {page==="board"&&(
        <div style={{flex:1,minHeight:0,padding:"12px 16px 0",position:"relative",display:"flex",flexDirection:"column"}}>
          <div ref={boardRef} style={{width:"100%",flex:1,minHeight:0,background:C.white,borderRadius:20,border:`1px solid ${C.gray200}`,position:"relative",overflow:"auto",boxShadow:C.shadow}}>
            <div style={{position:"relative",width:Math.max(boardRef.current?.clientWidth||0,boardW*boardZoom),height:Math.max(boardRef.current?.clientHeight||0,boardH*boardZoom)}}>
              <div id="game-board" onMouseDown={onBoardMouseDown} style={{position:"absolute",top:0,left:0,width:boardW,height:boardH,transform:`scale(${boardZoom})`,transformOrigin:"top left"}}>
                <div style={{position:"absolute",inset:0,backgroundImage:`radial-gradient(circle,${C.gray100} 1px,transparent 1px)`,backgroundSize:"24px 24px",pointerEvents:"none"}}/>
                {boardItems.length===0&&(
                  <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",pointerEvents:"none",gap:8}}>
                    <div style={{fontSize:40}}>🗺️</div>
                    <div style={{fontSize:14,fontWeight:600,color:C.gray400}}>아래 카드를 드래그해서 올려보세요</div>
                    <div style={{fontSize:12,color:C.gray200}}>카드 클릭 → 경로 상세 보기 · 빈 곳 드래그 → 화면 이동 · Shift+드래그 → 여러 카드 선택</div>
                  </div>
                )}
                {boardItems.map(item=>
                  item.type==="arrow"?<BoardArrowCard key={item.uid} card={item} onRemove={removeItem} onPosChange={moveItem} groupDrag={groupDrag} zoom={boardZoom}/>
                  :item.type==="misc"||item.type==="text"?<BoardMiscCard key={item.uid} card={item} onRemove={removeItem} onOpen={setMiscDetailCard} onPosChange={moveItem} groupDrag={groupDrag} zoom={boardZoom}/>
                  :<BoardRouteCard key={item.uid} card={item} onRemove={removeItem} onOpen={setDetailCard} onResize={resizeItem} onPosChange={moveItem} groupDrag={groupDrag} zoom={boardZoom}/>
                )}
                {selBox&&<div style={{position:"absolute",left:Math.min(selBox.x1,selBox.x2),top:Math.min(selBox.y1,selBox.y2),width:Math.abs(selBox.x2-selBox.x1),height:Math.abs(selBox.y2-selBox.y1),border:`1.5px solid ${C.coral}`,background:`${C.coral}10`,borderRadius:6,pointerEvents:"none",zIndex:9999}}/>}
                {groupBounds&&<div style={{position:"absolute",left:groupBounds.left,top:groupBounds.top,width:groupBounds.width,height:groupBounds.height,border:"2px dashed #2F6FED",borderRadius:14,background:"#2F6FED08",pointerEvents:"none",zIndex:5}}>
                  <div style={{position:"absolute",top:-13,left:12,background:"#2F6FED",color:"#fff",fontSize:11,fontWeight:700,padding:"3px 10px",borderRadius:20,boxShadow:C.shadow}}>{selectedItems.length}개 묶음</div>
                </div>}
              </div>
            </div>
          </div>
          <div className="tb-zoom-wrap" style={{position:"absolute",bottom:32,right:36,zIndex:60,display:"flex",alignItems:"center",gap:8}}>
            {boardItems.length>0&&<button className="tb-clear-btn" onClick={saveCurrentBoardSnapshot}
              style={{height:44,padding:"0 16px",borderRadius:14,border:"none",background:C.coral,color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer",boxShadow:"0 12px 32px rgba(0,0,0,0.14)"}}>
              이 보드 저장하기
            </button>}
            {boardItems.length>0&&<button className="tb-clear-btn" onClick={()=>{if(window.confirm("보드판의 모든 카드를 지울까요? 되돌릴 수 없어요."))setBoardItems([]);}}
              style={{height:44,padding:"0 16px",borderRadius:14,border:`1px solid ${C.gray200}`,background:C.white,color:C.gray600,fontSize:12,fontWeight:700,cursor:"pointer",boxShadow:"0 12px 32px rgba(0,0,0,0.14)"}}>
              보드판 비우기
            </button>}
            <div className="tb-zoom-cluster" style={{display:"flex",alignItems:"center",gap:2,background:C.white,borderRadius:14,padding:6,boxShadow:"0 12px 32px rgba(0,0,0,0.14)",border:`1px solid ${C.gray100}`}}>
              <button onClick={()=>setBoardZoom(z=>Math.max(0.5,Math.round((z-0.1)*10)/10))} style={{width:32,height:32,borderRadius:9,border:"none",background:C.gray50,color:C.gray600,fontSize:16,fontWeight:700,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>−</button>
              <button onClick={()=>setBoardZoom(1)} style={{minWidth:50,height:32,borderRadius:9,border:"none",background:"transparent",color:C.gray600,fontSize:12,fontWeight:600,cursor:"pointer"}}>{Math.round(boardZoom*100)}%</button>
              <button onClick={()=>setBoardZoom(z=>Math.min(2,Math.round((z+0.1)*10)/10))} style={{width:32,height:32,borderRadius:9,border:"none",background:C.gray50,color:C.gray600,fontSize:16,fontWeight:700,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>+</button>
            </div>
          </div>
          <div className="tb-board-help-wrap" style={{position:"absolute",bottom:32,left:36,zIndex:60}}
            onMouseEnter={()=>setShowBoardHelp(true)} onMouseLeave={()=>setShowBoardHelp(false)}>
            <button className="tb-board-help" style={{height:44,padding:"0 18px 0 14px",borderRadius:22,background:`linear-gradient(135deg,${C.coral},${C.orange})`,border:"none",boxShadow:"0 12px 28px rgba(255,90,90,0.45)",cursor:"pointer",fontSize:14,fontWeight:800,color:"#fff",display:"flex",alignItems:"center",gap:7}}>
              <span className="tb-help-icon" style={{width:22,height:22,borderRadius:"50%",background:"rgba(255,255,255,0.3)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13}}>?</span>
              <span>사용법 보기</span>
            </button>
            {showBoardHelp&&<div style={{position:"absolute",bottom:44,left:0,width:280,background:C.white,borderRadius:14,padding:"16px 18px",boxShadow:"0 16px 40px rgba(0,0,0,0.18)",border:`1px solid ${C.gray100}`}}>
              <div style={{fontSize:14,fontWeight:800,color:C.gray900,marginBottom:10}}>보드판 사용법</div>
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                <div style={{display:"flex",gap:8,fontSize:13,color:C.gray600,lineHeight:1.5}}><span>🖱️</span><span>카드 클릭 → 자세히 보기</span></div>
                <div style={{display:"flex",gap:8,fontSize:13,color:C.gray600,lineHeight:1.5}}><span>✋</span><span>빈 곳 드래그 → 화면 이동</span></div>
                <div style={{display:"flex",gap:8,fontSize:13,color:C.gray600,lineHeight:1.5}}><span>⇧</span><span>Shift + 드래그 → 여러 카드 선택 후 함께 이동</span></div>
                <div style={{display:"flex",gap:8,fontSize:13,color:C.gray600,lineHeight:1.5}}><span>🗑️</span><span>카드를 하단 덱 쪽으로 드래그 → 삭제</span></div>
                <div style={{display:"flex",gap:8,fontSize:13,color:C.gray600,lineHeight:1.5}}><span>🧲</span><span>카드 옆에 화살표를 붙이면 카드를 옮길 때 같이 따라감</span></div>
                <div style={{display:"flex",gap:8,fontSize:13,color:C.gray600,lineHeight:1.5}}><span>🔍</span><span>모서리 드래그로 카드 크기 조절 · +/− 로 전체 화면 확대·축소</span></div>
                <div style={{display:"flex",gap:8,fontSize:13,color:C.gray600,lineHeight:1.5}}><span>🔗</span><span>덱 관리 &gt; 저장한 루트에서 일차별로 "합침"(스텝을 한 카드로 묶기)·"분리"(스텝별로 나누기)를 고를 수 있음</span></div>
              </div>
            </div>}
          </div>
          {routeCount>0&&(costBoxOpen?(
            <div className="tb-board-costbox" style={{position:"absolute",top:32,right:36,zIndex:60,display:"flex",alignItems:"center",gap:14,background:C.white,borderRadius:18,padding:"14px 22px 14px 16px",boxShadow:"0 12px 32px rgba(0,0,0,0.14)",border:`1px solid ${C.gray100}`}}>
              <div className="tb-cost-icon" style={{width:46,height:46,borderRadius:14,flexShrink:0,background:`linear-gradient(135deg,${C.coral}22,${C.orange}22)`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22}}>💰</div>
              <div>
                <div className="tb-cost-label" style={{fontSize:11,fontWeight:700,color:C.gray400,letterSpacing:0.3,marginBottom:3}}>예상 총 비용</div>
                <div className="tb-cost-amount" style={{fontSize:26,fontWeight:800,color:C.coral,lineHeight:1.05,letterSpacing:-0.5}}>
                  {totalCost>0?`${totalCost.toLocaleString()}원`:"0원"}
                </div>
                <div className="tb-cost-count" style={{fontSize:11,color:C.gray400,marginTop:4,fontWeight:500}}>카드 {routeCount}개 담김</div>
              </div>
              <button onClick={()=>setCostBoxOpen(false)} title="접기" style={{position:"absolute",top:-8,right:-8,width:24,height:24,borderRadius:"50%",background:C.white,border:`1px solid ${C.gray200}`,cursor:"pointer",fontSize:12,color:C.gray400,display:"flex",alignItems:"center",justifyContent:"center",boxShadow:C.shadow}}>✕</button>
            </div>
          ):(
            <button className="tb-cost-collapsed" onClick={()=>setCostBoxOpen(true)} title="예상 총 비용 펼치기"
              style={{position:"absolute",top:32,right:36,zIndex:60,height:44,padding:"0 16px",borderRadius:22,border:`1px solid ${C.gray200}`,background:C.white,color:C.coral,fontSize:13,fontWeight:700,cursor:"pointer",boxShadow:"0 12px 32px rgba(0,0,0,0.14)",display:"flex",alignItems:"center",gap:6}}>
              💰 {totalCost>0?`${totalCost.toLocaleString()}원`:"0원"}
            </button>
          ))}
        </div>
      )}

      {page==="board"&&(
        <div id="card-deck" style={{padding:"14px 16px 20px",flexShrink:0,background:C.white,borderTop:`1px solid ${C.gray100}`}}>
          <div className="tb-decktabs" style={{display:"flex",gap:6,marginBottom:10,overflowX:"auto"}}>
            {[["route","루트 카드"],["arrow","화살표"],["text","텍스트"],["misc","기타"],["saved","저장한 카드"]].map(([key,label])=>(
              <button key={key} onClick={()=>setDeckTab(key)} style={{padding:"5px 14px",borderRadius:20,border:`1.5px solid ${deckTab===key?C.coral:C.gray200}`,background:deckTab===key?"#FFF0F0":C.white,color:deckTab===key?C.coral:C.gray400,fontSize:11,fontWeight:600,cursor:"pointer",transition:"all 0.15s",whiteSpace:"nowrap",flexShrink:0}}>{label}</button>
            ))}
            <div style={{flex:1}}/>
            <span className="tb-deckhint" style={{fontSize:10,color:C.gray400,alignSelf:"center",whiteSpace:"nowrap"}}>드래그 → 보드 · 보드 카드 → 덱으로 드래그 시 제거</span>
          </div>
          {deckTab==="route"&&<div data-deck-row="true" onMouseDown={handleDeckRowMouseDown} style={{display:"flex",gap:8,alignItems:"flex-start",overflowX:"auto",paddingBottom:2,cursor:"grab"}}>
            <div style={{position:"relative",flexShrink:0}}>
              <button onClick={()=>setDeckRegionMenuOpen(o=>!o)}
                style={{flexShrink:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:4,width:28,height:152,borderRadius:14,border:`1.5px dashed ${deckRegionMenuOpen?C.coral:C.gray200}`,background:deckRegionMenuOpen?"#FFF0F0":C.gray50,cursor:"pointer",color:deckRegionMenuOpen?C.coral:C.gray400,transition:"all 0.15s"}}>
                <span style={{fontSize:12,fontWeight:700,writingMode:"vertical-rl",letterSpacing:0.5}}>{selectedDeckRegion||"전체"}</span>
                <span style={{fontSize:10}}>{deckActiveItems.length}</span>
                <span style={{fontSize:11}}>{deckRegionMenuOpen?"▲":"▼"}</span>
              </button>
              {deckRegionMenuOpen&&<div style={{position:"fixed",inset:0,zIndex:99999,background:"rgba(0,0,0,0.5)",backdropFilter:"blur(6px)",display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={()=>setDeckRegionMenuOpen(false)}>
                <div style={{background:C.white,borderRadius:24,width:"min(480px,100%)",maxHeight:"80vh",overflow:"hidden",boxShadow:"0 24px 64px rgba(0,0,0,0.2)",display:"flex",flexDirection:"column"}} onClick={e=>e.stopPropagation()}>
                  <div style={{padding:"22px 24px 18px",borderBottom:`1px solid ${C.gray100}`,display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
                    <div>
                      <div style={{fontSize:19,fontWeight:800,color:C.gray900,display:"flex",alignItems:"center",gap:8}}><span>🗺️</span>여행지 선택</div>
                      <div style={{fontSize:12,color:C.gray400,marginTop:4}}>보고 싶은 지역을 골라보세요</div>
                    </div>
                    <button onClick={()=>setDeckRegionMenuOpen(false)} style={{width:32,height:32,borderRadius:"50%",border:`1px solid ${C.gray200}`,background:C.white,cursor:"pointer",fontSize:16,color:C.gray400,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>✕</button>
                  </div>
                  <div style={{overflowY:"auto",padding:24,background:C.gray50}}>
                    {(()=>{
                      const REGION_EMOJI={"도쿄":"🗼","오사카":"🍣","제주":"🌊","파리":"🥐","뉴욕":"🗽","발리":"🌴"};
                      const allCount=deckRegionGroups.reduce((s,g)=>s+g.items.length,0);
                      const allActive=selectedDeckRegion==null;
                      const selectAll=()=>{setSelectedDeckRegion(null);setDeckRegionMenuOpen(false);};
                      return(<>
                        <div onClick={selectAll}
                          style={{display:"flex",alignItems:"center",justifyContent:"center",gap:10,padding:"16px",borderRadius:16,cursor:"pointer",marginBottom:12,background:allActive?C.coral:C.white,border:`1.5px solid ${allActive?C.coral:C.gray200}`,boxShadow:allActive?`0 8px 20px ${C.coral}40`:C.shadow,transition:"all 0.15s"}}>
                          <span style={{fontSize:20}}>✨</span>
                          <span style={{fontSize:17,fontWeight:800,color:allActive?"#fff":C.gray900}}>전체</span>
                          <span style={{fontSize:12,fontWeight:700,color:allActive?"#fff":C.gray400,background:allActive?"rgba(255,255,255,0.25)":C.gray100,borderRadius:20,padding:"2px 10px"}}>{allCount}개</span>
                        </div>
                        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                          {deckRegionGroups.map(g=>{
                            const active=selectedDeckRegion===g.region;
                            const select=()=>{setSelectedDeckRegion(g.region);setDeckRegionMenuOpen(false);};
                            return(
                              <div key={g.region} onClick={select}
                                style={{padding:"18px 14px",borderRadius:16,textAlign:"center",cursor:"pointer",background:active?C.coral:C.white,border:`1.5px solid ${active?C.coral:C.gray200}`,boxShadow:active?`0 8px 20px ${C.coral}40`:C.shadow,transition:"all 0.15s"}}
                                onMouseEnter={e=>{if(!active)e.currentTarget.style.borderColor=C.coral;}}
                                onMouseLeave={e=>{if(!active)e.currentTarget.style.borderColor=C.gray200;}}>
                                <div style={{fontSize:24,marginBottom:6}}>{REGION_EMOJI[g.region]||"📍"}</div>
                                <div style={{fontSize:16,fontWeight:800,color:active?"#fff":C.gray900,marginBottom:6}}>{g.region}</div>
                                <span style={{fontSize:11,fontWeight:700,color:active?"#fff":C.gray400,background:active?"rgba(255,255,255,0.25)":C.gray100,borderRadius:20,padding:"2px 10px"}}>{g.items.length}개</span>
                              </div>
                            );
                          })}
                        </div>
                      </>);
                    })()}
                  </div>
                </div>
              </div>}
            </div>
            {deckActiveItems.map(r=><RouteDeckCard key={r.id} route={r} onDrop={handleDrop} onRemoveFromDeck={id=>setDeckRouteIds(prev=>prev.filter(i=>i!==id))} zoom={boardZoom}/>)}
            {savedRoutes.flatMap(route=>(route.dayPlans||[]).flatMap((day,di)=>day.steps.map((step,si)=>{
              const stepId=`${route.id}_d${di}_s${si}`;
              if(!deckCommunityIds.includes(stepId))return null;
              const dc={id:stepId,type:"misc",label:`${day.label} · ${step.title||`STEP ${si+1}`}`,icon:step.emoji||route.coverEmoji||"📍",color:route.color,bg:route.bg,text:[step.desc,step.tip?`💡 ${step.tip}`:null].filter(Boolean).join("\n\n"),photo:step.photoDataUrl?{dataUrl:step.photoDataUrl}:null};
              return<MiscDeckCard key={stepId} template={dc} onDrop={handleDrop} onRemoveFromDeck={id=>setDeckCommunityIds(prev=>prev.filter(i=>i!==id))} zoom={boardZoom}/>;
            })).filter(Boolean))}
            <button onClick={()=>setPage("manage")} style={{flexShrink:0,width:92,height:152,borderRadius:18,border:`1.5px dashed ${C.gray200}`,background:C.gray50,cursor:"pointer",color:C.gray400,fontSize:14,fontWeight:600,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:5}}>
              <span style={{fontSize:24}}>⚙️</span>관리
            </button>
          </div>}
          {deckTab==="arrow"&&<div data-deck-row="true" onMouseDown={handleDeckRowMouseDown} style={{display:"flex",gap:8,alignItems:"center",paddingBottom:2,overflowX:"auto",cursor:"grab"}}>
            {ARROW_DECK.map(a=><ArrowDeckCard key={a.id} arrow={a} onDrop={handleDrop} zoom={boardZoom}/>)}
            <span style={{fontSize:10,color:C.gray400,marginLeft:8,lineHeight:1.7}}>화살표로<br/>순서 표시</span>
          </div>}
          {deckTab==="text"&&<div data-deck-row="true" onMouseDown={handleDeckRowMouseDown} style={{display:"flex",gap:8,alignItems:"center",paddingBottom:2,overflowX:"auto",cursor:"grab"}}>
            {TEXT_DECK.map(t=><TextDeckCard key={t.id} template={t} onDrop={handleDrop} zoom={boardZoom}/>)}
            <span style={{fontSize:10,color:C.gray400,marginLeft:8,lineHeight:1.7}}>보드판에 올려<br/>메모 남기기</span>
          </div>}
          {deckTab==="misc"&&<div data-deck-row="true" onMouseDown={handleDeckRowMouseDown} style={{display:"flex",gap:8,alignItems:"center",paddingBottom:2,overflowX:"auto",cursor:"grab"}}>
            {MISC_DECK.map(m=><MiscDeckCard key={m.id} template={m} onDrop={handleDrop} zoom={boardZoom}/>)}
            <span style={{fontSize:10,color:C.gray400,marginLeft:8,lineHeight:1.7}}>준비물, 이야기 등<br/>사진과 함께 기록</span>
          </div>}
          {deckTab==="saved"&&<div data-deck-row="true" onMouseDown={handleDeckRowMouseDown} style={{display:"flex",gap:8,overflowX:"auto",paddingBottom:2,cursor:"grab"}}>
            {myCards.length===0&&savedRoutes.length===0?
              <div style={{fontSize:11,color:C.gray400,alignSelf:"center"}}>카드 제작에서 만들거나, 탐색에서 루트를 저장하면 여기에 모여요</div>
            :<>
              {savedRoutes.map(route=>(
                <div key={route.id} onClick={()=>addRouteStepsToBoard(route)} title="보드판에 순서대로 추가"
                  style={{width:100,flexShrink:0,background:C.white,border:`1.5px solid ${C.gray200}`,borderRadius:16,padding:"14px 10px",cursor:"pointer",textAlign:"center",userSelect:"none"}}>
                  <div style={{fontSize:32,marginBottom:6}}>{route.coverEmoji||"🗺️"}</div>
                  <div style={{fontSize:11,fontWeight:600,color:C.gray600,lineHeight:1.3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{route.title}</div>
                  <div style={{fontSize:10,color:route.color||C.coral,fontWeight:700,marginTop:4}}>+ 전체 추가</div>
                </div>
              ))}
              {myCards.map(card=>card.type==="misc"
                ?<MiscDeckCard key={card.id} template={card} onDrop={handleDrop} zoom={boardZoom}/>
                :<RouteDeckCard key={card.id} route={{...card,cost:card.cost||"미정",duration:card.duration||"미정"}} onDrop={handleDrop} zoom={boardZoom}/>
              )}
            </>}
          </div>}
        </div>
      )}
    </div>
    </div>
  );
}