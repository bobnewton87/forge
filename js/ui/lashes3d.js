const Y=(t,o,s)=>Math.max(o,Math.min(s,t)),G=(t,o,s)=>t+(o-t)*s,ht=.03937007874015748,ut=22,z=22,M=6,Z=new WeakMap,ct=(t,o)=>t[0]+o*(t[1]+o*(t[2]+o*t[3])),A=t=>{const o=Math.hypot(t[0],t[1],t[2])||1;return[t[0]/o,t[1]/o,t[2]/o]},lt=(t,o)=>[t[1]*o[2]-t[2]*o[1],t[2]*o[0]-t[0]*o[2],t[0]*o[1]-t[1]*o[0]],j=(t,o)=>t[0]*o[0]+t[1]*o[1]+t[2]*o[2],it=[{upper:!0,rows:[0,1,2],a0:8,a1:80},{upper:!1,rows:[0,1],a0:6,a1:40}],pt=(t,o)=>o.rows.slice(0,o.upper?t.density>4.5?3:2:t.density>4.5?2:1);function ft(t,o,s,y){const h=[];for(let l=0;l<t.nMesh;l++){if(t.part[l]!==1||t.base[l*3]*y<=0)continue;const p=[0,1,2].map(C=>(o[l*3+C]-s.c[C])/s.ext[C]),f=j(p,s.r),F=j(p,s.u),H=j(p,s.f);H>-.2&&Math.abs(f)<1.4&&Math.abs(F)<1.3&&h.push([f,F,H,l])}return h}function dt(t,o,s,y,h){if(!t||!o||!o.rest||!s||!y||!h||!(h.up>0))return null;let l=Z.get(o);if(l||Z.set(o,l=new Map),l.has(h.id))return l.get(h.id);const p=[],f=[],F=[],H=[],C=[],P=[],W={roots:[],rows:0};for(const q of[1,-1]){const i=y[q];if(!i)continue;const $=(i.ext[0]+i.ext[1]+i.ext[2])/3,I=ht/$,tt=ft(t,o.rest,i,q),V=n=>[0,1,2].map(d=>i.c[d]+(n[0]*i.r[d]+n[1]*i.u[d]+n[2]*i.f[d])*i.ext[d]),ot=n=>A([0,1,2].map(d=>n[0]*i.r[d]+n[1]*i.u[d]+n[2]*i.f[d])),et=s.x[0]+.05,st=s.x[1]-.04;for(const n of it){const d=n.upper?s.up:s.lo,b=n.upper?1:-1,v=[];for(let a=0;a<=z;a++){const m=G(et,st,a/z),e=ct(d,m);let r=null;for(const N of tt){const k=(N[1]-e)*b;Math.abs(N[0]-m)>.08||k<-.01||k>.12||(!r||N[2]>r[2])&&(r=N)}const w=Math.sqrt(Math.max(0,1-m*m-e*e)),L=r?Math.max(r[2]-.35*I,w+.02):w*1.06+.04;v.push({p:[m,e+b*.25*I,L],v:r?r[3]:-1})}W.roots.push(...v.map(a=>V(a.p)));const K=[0];for(let a=1;a<=z;a++){const m=v[a-1].p,e=v[a].p;K.push(K[a-1]+Math.hypot(e[0]-m[0],e[1]-m[1],e[2]-m[2])/I)}for(const a of pt(h,n)){const m=p.length/3;W.rows++;for(let e=0;e<=z;e++){const r=v[e],w=Y(e/z*2-1,-1,1),L=Y(1-((w-.2)/(w<.2?1.25:.95))**2,0,1),N=(n.upper?h.up:h.lo)*(.32+.68*L)*(1-.1*a)*I,k=A([.6*w+.06*(a-1),n.upper?-.05:0,1]),O=[0,b,0],J=A(O.map((x,u)=>x-k[u]*j(O,k))),Q=(n.a0+3*a)*Math.PI/180,T=(n.a1*(n.upper?.85+.15*h.thick:1)+4*a)*Math.PI/180;let g=[r.p[0],r.p[1],r.p[2]-a*.25*I];const at=e<z?v[e+1].p.map((x,u)=>x-v[e].p[u]):v[e].p.map((x,u)=>x-v[e-1].p[u]);for(let x=0;x<M;x++){const u=x/(M-1),X=G(Q,T,u*u*.4+u*.6),nt=A(k.map((c,S)=>c*Math.cos(X)+J[S]*Math.sin(X)));if(x>0){const c=G(Q,T,(u-.5/(M-1))**2*.4+(u-.5/(M-1))*.6),S=A(k.map((B,D)=>B*Math.cos(c)+J[D]*Math.sin(c)));g=g.map((B,D)=>B+S[D]*N/(M-1))}{const c=Math.hypot(g[0],g[1],g[2]);c<1.02&&(g=g.map(S=>S*1.02/c))}const R=A(lt(at,nt)),rt=j(R,[0,0,1])*b<0?R.map(c=>-c):R;p.push(...V(g)),f.push(...ot(rt)),F.push(K[e],u,a+(n.upper?0:4)+(q>0?0:.5));const E=r.v>=0?r.v:null;for(let c=0;c<4;c++)H.push(E!==null?t.skinIdx[E*4+c]:c===0?t.B.head:0),C.push(E!==null?t.skinW[E*4+c]:c===0?1:0)}}for(let e=0;e<z;e++)for(let r=0;r<M-1;r++){const w=m+e*M+r,L=w+M;P.push(w,L,w+1,w+1,L,L+1)}}}}const _=p.length/3,U=_?{n:_,pos:Float32Array.from(p),nrm:Float32Array.from(f),canon:Float32Array.from(F),joint:Uint8Array.from(H),weight:Float32Array.from(C),ao:new Float32Array(_).fill(1),idx:Uint16Array.from(P),info:W}:null;return l.set(h.id,U),U}function mt(t,o,s){if(!t||!o||t.n!==o.n)return s<.5?t:o;if(s<=0)return t;if(s>=1)return o;const y=(h,l)=>{const p=new Float32Array(h.length);for(let f=0;f<p.length;f++)p[f]=h[f]+(l[f]-h[f])*s;return p};return{...t,pos:y(t.pos,o.pos),nrm:y(t.nrm,o.nrm)}}const wt=`
float lashHash(float a, float b){ return fract(sin(a * 127.1 + b * 311.7) * 43758.5453); }
float lashMat(inout vec3 base, inout float rough, inout float f0s, inout float occK, inout vec3 N){
  float lower = step(3.5, vC.z), row = floor(vC.z - 4.0 * lower), side = fract(vC.z) > 0.25 ? 1.0 : 0.0;
  float rowsN = lower > 0.5 ? (uLash.x > 4.5 ? 2.0 : 1.0) : (uLash.x > 4.5 ? 3.0 : 2.0);
  float dens = uLash.x * (lower > 0.5 ? 0.45 : 1.0) / rowsN;   // strands a millimetre in this row
  float s = vC.x * dens + row * 0.37 + side * 0.21, t = vC.y;
  float aa = max(fwidth(vC.x), 1e-4);          // a pixel, in mm along the lid
  float cov = 0.0;
  for (int k = -1; k <= 1; k++) {
    float c = floor(s) + float(k), h1 = lashHash(c, row + 7.0 * lower + 13.0 * side), h2 = lashHash(c + 3.1, row), h3 = lashHash(c + 5.7, lower);
    float tEnd = 0.62 + 0.38 * h3;                                  // each strand ends at its own length
    if (t > tEnd) continue;
    float u = t / tEnd;
    float cx = (c + 0.5 + 0.6 * (h1 - 0.5)) / dens + (h2 - 0.5) * 0.9 * u;   // its root, then a slant across the card (mm)
    float hw = 0.05 * uLash.y * (1.0 - 0.88 * u);                   // half its width (mm), tapering to the tip
    float d = abs(vC.x - cx);
    float he = max(hw, 0.5 * aa);                                     // (drawn at least ≈ 1 px wide, its coverage shared out)
    float cv = clamp((he + 0.5 * aa - d) / aa, 0.0, 1.0) * pow(hw / he, 0.3);
    cov = 1.0 - (1.0 - cov) * (1.0 - cv);
  }
  // a pixel wider than a strand's spacing: the strands' expected share of it (each ≈ 0.1 mm thinning to its tip, ≈ 80 % of
  // them still there at t), so a far eye keeps the dark lash line instead of losing it
  float far = smoothstep(0.6, 2.0, aa * dens);
  cov = mix(cov, 1.0 - exp(-dens * 0.1 * uLash.y * (1.0 - 0.88 * t) * (1.0 - smoothstep(0.62, 1.0, t))), far);
  // the lash line: where the lashes leave the lid they stand two or three deep, so the first ≈ 15 % of their length is a
  // nearly solid dark line along the margin (the denser the style, the more solid)
  cov = max(cov, (1.0 - smoothstep(0.04, 0.16 + 0.04 * uLash.y, t)) * mix(0.55, 0.95, smoothstep(3.5, 6.0, uLash.x)) * (lower > 0.5 ? 0.5 : 1.0));
  base = mix(uBrow * 0.5, vec3(0.008, 0.006, 0.005), uLash.z);
  // a fibre, not a sheet: the card's normal turned most of the way to the viewer, so a card seen edge-on does not catch
  // the grazing Fresnel sheen of a surface (the lashes read dark, with a soft sheen)
  if (!gl_FrontFacing) N = -N;
  vec3 Vv = normalize(uEye - vW);
  N = normalize(mix(N, Vv, 0.8));
  rough = 0.55; f0s = 0.012; occK = 0.35;   // (dark, a faint sheen: more read as grey streaks on a dark lash)
  // (4× MSAA has five levels of coverage: a strand under half a pixel would read as a grey haze over the lid, so its
  // coverage is doubled, as a dark lash reads in a photograph at this size; design choice)
  return clamp(cov * 2.0, 0.0, 1.0);
}`;export{wt as LASH_GLSL,ut as LASH_ID,mt as blendLashes,dt as lashGeometry};
