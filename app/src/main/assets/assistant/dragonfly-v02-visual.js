/* Dragonfly v0.2 visual identity marker — no network, no dependencies. */
(()=>{'use strict';
function apply(){
  const root=document.getElementById('uasd-root');
  if(!root)return false;
  root.classList.add('uasd-v02');
  const title=root.querySelector('.uasd-panel-head strong');
  const subtitle=root.querySelector('.uasd-subtitle');
  const orb=root.querySelector('.uasd-orb');
  if(title)title.textContent='Dragonfly';
  if(subtitle)subtitle.textContent='v0.2 Lite · IA local · sin conexión';
  if(orb&&!orb.querySelector('.uasd-version-chip')){
    const chip=document.createElement('span');
    chip.className='uasd-version-chip';
    chip.textContent='v0.2';
    orb.appendChild(chip);
  }
  if(!document.getElementById('uasd-v02-style')){
    const style=document.createElement('style');
    style.id='uasd-v02-style';
    style.textContent=`
      #uasd-root.uasd-v02 .uasd-orb{filter:drop-shadow(0 9px 22px rgba(0,224,255,.30)) drop-shadow(0 0 10px rgba(169,112,255,.16));}
      #uasd-root.uasd-v02 .uasd-orb::before{content:'';position:absolute;inset:13px;border-radius:50%;border:1px solid rgba(91,231,255,.22);box-shadow:0 0 18px rgba(67,234,255,.16),inset 0 0 18px rgba(169,112,255,.08);animation:uasd-v02-ring 3.2s ease-in-out infinite;pointer-events:none;}
      #uasd-root.uasd-v02 .uasd-panel{border-color:rgba(94,226,255,.32);box-shadow:0 22px 70px rgba(0,0,0,.5),0 0 28px rgba(80,210,255,.06),inset 0 1px 0 rgba(255,255,255,.05);}
      #uasd-root .uasd-version-chip{position:absolute;right:0;bottom:9px;padding:3px 6px;border-radius:999px;border:1px solid rgba(102,232,255,.38);background:rgba(7,20,38,.92);color:#7ef0ff;font:800 8px/1 Inter,system-ui,sans-serif;letter-spacing:.05em;box-shadow:0 0 12px rgba(67,234,255,.18);pointer-events:none;}
      @keyframes uasd-v02-ring{0%,100%{opacity:.45;transform:scale(.96)}50%{opacity:.95;transform:scale(1.04)}}
      @media(prefers-reduced-motion:reduce){#uasd-root.uasd-v02 .uasd-orb::before{animation:none}}
    `;
    document.head.appendChild(style);
  }
  return true;
}
if(!apply()){
  let tries=0;
  const t=setInterval(()=>{tries++;if(apply()||tries>80)clearInterval(t)},50);
}
})();
