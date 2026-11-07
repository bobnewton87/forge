import{hairRig as ce,hairlineJS as se,fadeJS as fe,baseLiftJS as ue}from"./hair3d.js";const ee=24,k=192,$=48,H={from:1.5,to:10.5,dv:.5},ve={1:1200,2:160},G={body:0,hair:1,hat:2,shoe:3,eye:4},X=17,B=(e,c,l)=>{const u=Math.min(1,Math.max(0,(l-e)/(c-e)));return u*u*(3-2*u)},W=(e,c,l)=>e+(c-e)*l;function he(e){const c=new Uint32Array(e,0,4),[l,u,f,p]=[c[0]*3,c[1]*3,c[2]*3,c[3]*3],r=16;return{1:new Uint16Array(e,r,l),2:new Uint16Array(e,r+l*2,u),shoes:{1:new Uint16Array(e,r+(l+u)*2,f),2:new Uint16Array(e,r+(l+u+f)*2,p)}}}const K=new Map;function Te(e){const c=e==="female"?"female":"male";return K.has(c)||K.set(c,fetch(new URL(`../../assets/body/lod-${c}.bin`,import.meta.url)).then(l=>{if(!l.ok)throw new Error(`lod ${l.status}`);return l.arrayBuffer()}).then(he).catch(l=>{throw K.delete(c),l})),K.get(c)}function be(e,c,l,u,f=null,p=0){let r=[1e9,1e9,1e9],i=[-1e9,-1e9,-1e9];for(let M=0;M<l;M++)for(let d=0;d<3;d++){const y=e[M*3+d];y<r[d]&&(r[d]=y),y>i[d]&&(i[d]=y)}let v=p||Math.max(i[0]-r[0],i[1]-r[1],i[2]-r[2])/28;for(let M=0;;M++){const d=new Map,y=new Int32Array(l),_=[];for(let F=0;F<l;F++){const L=Math.floor((e[F*3]-r[0])/v),P=Math.floor((e[F*3+1]-r[1])/v),D=Math.floor((e[F*3+2]-r[2])/v),s=((L*1024+P)*1024+D)*32+(f?f(F):0);let U=d.get(s);U===void 0&&(U=_.length,d.set(s,U),_.push(F)),y[F]=U}const A=[],w=new Set;for(let F=0;F<c.length;F+=3){const L=y[c[F]],P=y[c[F+1]],D=y[c[F+2]];if(L===P||P===D||L===D)continue;const s=Math.min(L,P,D),U=Math.max(L,P,D),V=s*1e10+(L+P+D-s-U)*1e5+U;w.has(V)||(w.add(V),A.push(L,P,D))}if(A.length/3<=u||M>24)return{map:y,n:_.length,idx:Uint32Array.from(A),first:_,cell:v};v*=1.22}}function J(e,c,l){let u=1e9,f=e,p=[0,1,0];const r=c.n,i=c.P,v=c.O,M=l?r:r-1;for(let d=0;d<M;d++){const y=l?d+1<r?d+1:0:d+1,_=[i[d*3],i[d*3+1],i[d*3+2]],A=[i[y*3]-_[0],i[y*3+1]-_[1],i[y*3+2]-_[2]],w=Math.min(1,Math.max(0,((e[0]-_[0])*A[0]+(e[1]-_[1])*A[1]+(e[2]-_[2])*A[2])/Math.max(A[0]*A[0]+A[1]*A[1]+A[2]*A[2],1e-6))),F=[_[0]+A[0]*w,_[1]+A[1]*w,_[2]+A[2]*w],L=Math.hypot(e[0]-F[0],e[1]-F[1],e[2]-F[2]);L<u&&(u=L,f=F,p=[W(v[d*3],v[y*3],w),W(v[d*3+1],v[y*3+1],w),W(v[d*3+2],v[y*3+2],w)])}return(e[0]-f[0])*p[0]+(e[1]-f[1])*p[1]+(e[2]-f[2])*p[2]>0?-u:u}function me(e,c,l){const{lk:u,wp:f,neck:p,arm:r}=l;if(u.topCode<2)return-1;const i=[Math.abs(e[0]),e[1],e[2]],v=e[1]-f.top[0];if(u.topCode===2)return Math.min(J(i,p,!1),J(i,r,!0),v,c>.3?.6-c:9);const M=f.sh,d=f.el,y=[d[0]-M[0],d[1]-M[1],d[2]-M[2]],_=Math.hypot(...y)||1,A=((i[0]-M[0])*y[0]+(i[1]-M[1])*y[1]+(i[2]-M[2])*y[2])/_;return Math.min(J(i,p,!1),f.top[3]-A*B(.12,.55,c),v)}function le(e,c,l,u){const{A:f,lk:p,wp:r,shortsCut:i}=u,v=f.base,M=f.lm,d=Math.abs(e[0]);let y=v[M.navelV*3+1]-.55-.12*B(0,1.2,d),_=v[M.crotchV*3+1]-i[0]+i[1]*B(.4,1.4,d),A=.15;return p.bottomCode>0&&(y+=r.leg[1],_=r.leg[0],A=r.leg[2]),{bot:Math.min(e[1]-_,y-e[1],c>.05?.2-c:9,l>.52?-1:9),band:e[1]-(y-A)}}function de(e,c,l,u){const f=Math.abs(e[0]),p=se(c,e,l),r=c.ey,i=c.ez,v=B(.66,.74,f)*B(i-1.15,i-1.05,e[2])*(1-B(i-.62,i-.52,e[2]))*B(r-.7,r-.6,e[1])*(1-B(r+.12,r+.2,e[1])),M=B(p-.06,p+.06,e[1])*(1-v)*u.hl3[3],d=fe(c,e,l)*(u.hl3[2]<.99?1:0);return M*W(1,Math.min(.85,Math.max(0,u.hl3[2]*1.6)),d)}function xe(e,c,l,u=null){const{A:f,surf:p,hair:r,shoes:i,su:v}=e,M=ce(f),d={hl:v.hl0,nape:v.hl1,lift:v.hl2,fade:v.hl3,part:v.hl4},y=new Map,_=[];for(const t of c)y.has(t)||(y.set(t,_.length),_.push(t));const A=r&&r.n?be(r.pos,r.idx,r.n,ve[l],t=>r.cav[t]<-10.5?1:0):null;let w=null;if(i&&i.n&&u){const t=new Int32Array(i.n).fill(-1),a=[],E=new Uint32Array(u.length);for(let m=0;m<u.length;m++){const T=u[m];t[T]<0&&(t[T]=a.length,a.push(T)),E[m]=t[T]}w={map:t,n:a.length,idx:E,first:a,subset:!0}}const F=_.length,L=w?w.n:0,P=A?A.n:0,D=F+L+P,s=new Float32Array(D*X),U=new Uint8Array(D*8),V=(t,a,E,m)=>{if(l===2){const T=[0,1,2,3].sort((b,N)=>E[m*4+N]-E[m*4+b]),o=E[m*4+T[0]],n=E[m*4+T[1]],S=o+n||1;U[t*8]=a[m*4+T[0]],U[t*8+1]=a[m*4+T[1]],U[t*8+4]=Math.round(255*o/S),U[t*8+5]=255-U[t*8+4]}else for(let T=0;T<4;T++)U[t*8+T]=a[m*4+T],U[t*8+4+T]=Math.round(255*E[m*4+T])};for(let t=0;t<F;t++){const a=_[t],E=[f.base[a*3],f.base[a*3+1],f.base[a*3+2]],m=t*X,T=f.part[a],o=T===6?3:T===1?1:T===2||T===3?2:0,n=Math.min(1,Math.max(0,f.grp[a*6+2]+f.grp[a*6+3])),S=p.nrm[a*3],b=p.nrm[a*3+1],N=p.nrm[a*3+2];let q=0,O=0;o===1&&(q=ue(M,E,d),O=de(E,M,d,v)),s[m]=p.pos[a*3]+S*q,s[m+1]=p.pos[a*3+1]+b*q,s[m+2]=p.pos[a*3+2]+N*q,s[m+3]=S,s[m+4]=b,s[m+5]=N,s[m+6]=E[0],s[m+7]=E[1],s[m+8]=E[2];const Y=E[0]>=0?1:-1,z=-Y*S,C=B(.02,.2,n)*Math.max(1-B(.6,.95,n),B(.2,.6,z)),Q=(1-B(.02,.2,n))*B(.45,.85,-z)*(o===0?1:0),j=p.cav[a]>1.5?0:Math.max(p.cav[a],0),re=W(p.ao[a],Math.max(p.ao[a],.9),Math.max(C,Q)*.6);s[m+9]=Math.pow(Math.min(1,Math.max(0,re)),1.15)*(1-.26*j*(o===1?1:.8)),s[m+10]=n,s[m+11]=o===3?G.eye:G.body;const ie=Math.min(1,B(2.55,1.55,E[1])*(o===2?1:0)+B(-6.85,-7.8,E[1]));if(s[m+12]=o===1?-1:ie,o!==3){s[m+13]=me(E,n,e);const g=le(E,n,o,e);s[m+14]=g.bot,s[m+15]=g.band}else s[m+13]=-1,s[m+14]=-1,s[m+15]=-1;s[m+16]=O,V(t,f.skinIdx,f.skinW,a)}const h=(t,a,E,m)=>{const T=new Float32Array(t.n);for(let o=0;o<a.n;o++){const n=t.map[o];if(n<0)continue;const S=(E+n)*X;T[n]++;for(let b=0;b<3;b++)s[S+b]+=a.pos[o*3+b],s[S+3+b]+=a.nrm[o*3+b],s[S+6+b]+=a.canon?a.canon[o*3+b]:0;s[S+9]+=a.ao?a.ao[o]:1}for(let o=0;o<t.n;o++){const n=(E+o)*X,S=T[o]||1;for(let N=0;N<3;N++)s[n+N]/=S,s[n+6+N]/=S;s[n+9]/=S;const b=Math.hypot(s[n+3],s[n+4],s[n+5])||1;s[n+3]/=b,s[n+4]/=b,s[n+5]/=b,V(E+o,a.joint,a.weight,t.first[o]),m(n,t.first[o],o)}};w&&h(w,i,F,(t,a)=>{s[t+11]=G.shoe,s[t+13]=i.canon[a*3+1]-i.fab[a*3],s[t+14]=i.canon[a*3+1],s[t+10]=0}),A&&h(A,r,F+L,(t,a)=>{s[t+11]=r.cav[a]<-10.5&&r.cav[a]>-11.5?G.hat:G.hair,s[t+9]=Math.min(1,s[t+9])});const R=c.length+(w?w.idx.length:0),x=new Uint16Array(R+(A?A.idx.length:0));for(let t=0;t<c.length;t++)x[t]=y.get(c[t]);if(w)for(let t=0;t<w.idx.length;t++)x[c.length+t]=F+w.idx[t];if(A)for(let t=0;t<A.idx.length;t++)x[R+t]=F+L+A.idx[t];return{v:s,b:U,idx:x,nCull:R,nAll:x.length,n:D}}const te=`#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNrm; layout(location=2) in vec3 aCanon;
layout(location=3) in vec4 aM0;   // ao, arm share, material, tone
layout(location=4) in vec4 aM1;   // the top's field, the bottoms' field, the band's field, the scalp hair's mask
layout(location=5) in vec4 aJoint; layout(location=6) in vec4 aWeight;
layout(location=7) in vec4 iPos;     // x, y, z (in), heading
layout(location=8) in vec4 iScale;   // height scale, girth scale, lean (rad), pitch (rad)
layout(location=9) in vec4 iRow;     // the bones' rows, A and B, how far from A to B, the bib's cell
layout(location=10) in vec4 iTop; layout(location=11) in vec4 iShorts; layout(location=12) in vec4 iSkin; layout(location=13) in vec4 iHair; layout(location=14) in vec4 iShoe;
uniform mat4 uVP; uniform sampler2D uBones;
out vec3 vW; out vec3 vN; out vec3 vC; out vec4 vM0; out vec4 vM1;
flat out vec4 vTop; flat out vec4 vShorts; flat out vec4 vSkin; flat out vec4 vHair; flat out vec4 vShoe; flat out vec2 vBibCell;
#ifdef FAR
mat3x4 boneAt(int b, int ra, int rb, float f) {
  return mat3x4(mix(texelFetch(uBones, ivec2(b * 3, ra), 0), texelFetch(uBones, ivec2(b * 3, rb), 0), f),
                mix(texelFetch(uBones, ivec2(b * 3 + 1, ra), 0), texelFetch(uBones, ivec2(b * 3 + 1, rb), 0), f),
                mix(texelFetch(uBones, ivec2(b * 3 + 2, ra), 0), texelFetch(uBones, ivec2(b * 3 + 2, rb), 0), f));
}
#else
mat3x4 boneAt(int b, int r) { return mat3x4(texelFetch(uBones, ivec2(b * 3, r), 0), texelFetch(uBones, ivec2(b * 3 + 1, r), 0), texelFetch(uBones, ivec2(b * 3 + 2, r), 0)); }
#endif
void main() {
  ivec4 j = ivec4(aJoint + 0.5);
#ifdef FAR
  int ra = int(iRow.x + 0.5), rb = int(iRow.y + 0.5);
  mat3x4 M = aWeight.x * boneAt(j.x, ra, rb, iRow.z) + aWeight.y * boneAt(j.y, ra, rb, iRow.z);
#else
  int ra = int(iRow.x + 0.5);
  mat3x4 M = aWeight.x * boneAt(j.x, ra) + aWeight.y * boneAt(j.y, ra) + aWeight.z * boneAt(j.z, ra) + aWeight.w * boneAt(j.w, ra);
#endif
  vec3 q = vec4(aPos, 1.0) * M, n = vec4(aNrm, 0.0) * M;
  q.y = max(q.y, 0.0);   // (a sole never under the floor, as the shader's shoeFloor)
  q.y *= iScale.x; q.xz *= iScale.y;
  float lc = cos(iScale.z), ls = sin(iScale.z); q = vec3(lc * q.x + ls * q.y, -ls * q.x + lc * q.y, q.z);
  if (iScale.w != 0.0) { float pc = cos(iScale.w), ps = sin(iScale.w); q = vec3(q.x, pc * q.y - ps * q.z, ps * q.y + pc * q.z); }
  float c = cos(iPos.w), s = sin(iPos.w);
  vec3 off = vec3(c * q.x + s * q.z, q.y, -s * q.x + c * q.z);
  off.y += iTop.w * off.x + iShorts.w * off.z;   // (the ground's slope, a shear: a planted foot stays on the surface up, down and across a hill)
  vW = off + iPos.xyz;
  vN = vec3(c * n.x + s * n.z, n.y, -s * n.x + c * n.z);
  vC = aCanon; vM0 = aM0; vM1 = aM1; vTop = iTop; vShorts = iShorts; vSkin = iSkin; vHair = iHair; vShoe = iShoe;
  vBibCell = vec2(mod(iRow.w, 16.0), floor(iRow.w / 16.0));
  if (iRow.w < 0.0) vBibCell = vec2(-1.0);
  gl_Position = uVP * vec4(vW, 1.0);
}`,pe=["float D_GGX(float NoH, float a){ float a2 = a*a; float d = (NoH*a2 - NoH)*NoH + 1.0; return a2/(PI*d*d + 1e-7); }","vec3 F_S(vec3 f0, float u){ return f0 + (1.0-f0)*pow(clamp(1.0-u, 0.0, 1.0), 5.0); }","vec3 wrapDiff(float nl, vec3 w){ return max((vec3(nl) + w)/((1.0+w)*(1.0+w)), vec3(0.0)); }","float sheenD(float NoH, float r){ float a = 1.0/max(r, 0.07); float c = NoH*NoH; return (2.0 + a)*pow(max(1.0-c, 0.0), a*0.5)/(2.0*PI); }","vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0., 1.); }","vec3 srgbEnc(vec3 c){ c = clamp(c, 0.0, 1.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }","vec3 aoMulti(float ao, vec3 alb){ vec3 a = 2.0404 * alb - 0.3324, b = -4.7951 * alb + 0.6417, c = 2.7552 * alb + 0.6903; return max(vec3(ao), ((ao * a + b) * ao + c) * ao); }"],oe=`#version 300 es
precision highp float; precision highp sampler2D;
in vec3 vW; in vec3 vN; in vec3 vC; in vec4 vM0; in vec4 vM1;
flat in vec4 vTop; flat in vec4 vShorts; flat in vec4 vSkin; flat in vec4 vHair; flat in vec4 vShoe; flat in vec2 vBibCell;
uniform vec3 uEye, uKey, uFill, uRim, uRim2, uLC[4], uSky, uGnd, uTone, uTrim, uFog;
uniform vec4 uBib; uniform float uBibZ, uFogD, uHairK; uniform sampler2D uAtlas; uniform vec2 uCell; uniform vec4 uFace;
#ifdef MID
// (the mid level takes the neckline and the armhole per pixel, the body shader's own curves: they are what shows of a singlet from
// behind, and a low mesh cannot follow a strap. Below the armhole the baked field is the same one.)
uniform vec3 uStrapP[20], uStrapO[20], uArmP[24], uArmO[24]; uniform int uStrapN, uArmN; uniform float uStrapY0;
float neckSD(vec3 q){
  float best = 1e9; vec3 bp = q, bo = vec3(0.0, 1.0, 0.0);
  for (int i = 0; i < 19; i++) {
    if (i + 1 >= uStrapN) break;
    vec3 a = uStrapP[i], ab = uStrapP[i + 1] - a;
    float t = clamp(dot(q - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
    vec3 cp = a + ab * t; float d = length(q - cp);
    if (d < best) { best = d; bp = cp; bo = mix(uStrapO[i], uStrapO[i + 1], t); }
  }
  return dot(q - bp, bo) > 0.0 ? -best : best;
}
float armSD(vec3 q){
  float best = 1e9; vec3 bp = q, bo = vec3(1.0, 0.0, 0.0);
  for (int i = 0; i < 24; i++) {
    if (i >= uArmN) break;
    int j = i + 1 < uArmN ? i + 1 : 0;
    vec3 a = uArmP[i], ab = uArmP[j] - a;
    float t = clamp(dot(q - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
    vec3 cp = a + ab * t; float d = length(q - cp);
    if (d < best) { best = d; bp = cp; bo = mix(uArmO[i], uArmO[j], t); }
  }
  return dot(q - bp, bo) > 0.0 ? -best : best;
}
#endif
out vec4 frag;
const float PI = 3.14159265;
${pe.join(`
`)}
float V_SIMPLE(float NoV, float NoL, float a){ float g = 0.5 * a; return 0.25 / max(mix(NoL * NoV * 2.0, NoL + NoV, g), 1e-3); }
float edge(float f){ return smoothstep(-1.0, 1.0, f / max(fwidth(f), 1e-6)); }
void main() {
  vec3 N = normalize(vN), V = normalize(uEye - vW);
  float mat = floor(vM0.z + 0.5), ao = vM0.x, rough = 0.46, f0s = 0.028, sheen = 0.0, occK = 1.0, skinM = 0.0;
  vec3 skin = vSkin.rgb, base = skin;
  if (mat < 0.5) {
    if (vM0.w < -0.5) { base *= vec3(1.045, 0.985, 0.97); rough = 0.41; }
    else if (vM0.w > 0.01) { base *= mix(vec3(1.0), mix(vec3(1.10, 0.925, 0.885), vec3(1.025, 0.99, 0.975), vSkin.w), vM0.w * 0.8); rough = mix(rough, 0.63, vM0.w); }
    rough += 0.05 * vSkin.w;
#ifdef MID
    float topF = vM1.x;
    if (vC.y > uStrapY0 && vM0.w > -0.5) { vec3 q = vec3(abs(vC.x), vC.y, vC.z); topF = min(min(neckSD(q), armSD(q)), vM0.y > 0.3 ? 0.6 - vM0.y : 9.0); }
#else
    float topF = vM1.x;
#endif
    float sh = edge(vM1.y), br = edge(topF), band = sh * edge(vM1.z) * (1.0 - br), fab = max(sh, br), onTop = step(sh, br);
    float hm = clamp(vM1.w, 0.0, 1.0);
    if (hm > 0.002) { base = mix(base, vHair.rgb * 0.62, hm); rough = mix(rough, 0.48, hm); f0s = mix(f0s, 0.046, hm); occK = mix(occK, 0.9, hm); }
    skinM = (1.0 - fab) * (1.0 - hm);
    if (vM0.w < -0.5 && vC.z > uFace.z - 0.45) {   // the face at this range: brows, the eyes' openings and the lips, as tints on the canonical head (design choice; a few pixels)
      float ax = abs(vC.x) - uFace.y, dy = vC.y - uFace.x;
      float brow = 1.0 - smoothstep(0.7, 1.3, length(vec2(ax, dy - 0.26) / vec2(0.2, 0.04)));
      float eye = 1.0 - smoothstep(0.65, 1.2, length(vec2(ax, dy) / vec2(0.15, 0.062)));
      float lip = 1.0 - smoothstep(0.6, 1.3, length(vec2(vC.x, vC.y - uFace.w) / vec2(0.23, 0.062)));
      base = mix(base, vHair.rgb * 0.5, brow * 0.85 * (1.0 - hm));
      base = mix(base, base * vec3(0.72, 0.42, 0.40), lip * 0.8);
      base = mix(base, mix(vec3(0.42, 0.38, 0.36), vec3(0.02), 1.0 - smoothstep(0.05, 0.1, abs(ax))), eye);
      skinM *= 1.0 - eye;
    }
    if (fab > 0.001) {
      vec3 cC = mix(mix(vShorts.rgb, vTop.rgb, onTop) * 0.9, uTrim, band);
      if (vBibCell.x >= 0.0 && br > 0.5 && vC.z > uBibZ && vM0.y < 0.3) {
        vec2 bq = (vC.xy - uBib.xy) / (2.0 * uBib.zw) + 0.5;
        if (bq.x > 0.0 && bq.x < 1.0 && bq.y > 0.0 && bq.y < 1.0) {
          vec4 bt = textureGrad(uAtlas, (vBibCell + vec2(0.04 + bq.x * 0.92, 0.04 + (1.0 - bq.y) * 0.92)) * uCell, dFdx(bq) * uCell, dFdy(bq) * uCell);
          vec3 lin = pow(bt.rgb, vec3(2.2));
          cC = mix(cC, lin, bt.a * br);
        }
      }
      base = mix(base, cC, fab); rough = mix(rough, 0.8, fab); f0s = mix(f0s, 0.042, fab); sheen = fab; occK = mix(occK, 0.75, fab);
    }
  } else if (mat < 1.5) {   // the hair's locks
    if (!gl_FrontFacing) N = -N;
    base = vHair.rgb * uHairK; rough = 0.5 + 0.3 * (1.0 - uHairK); f0s = 0.046;
  } else if (mat < 2.5) {   // a hat or headband
    if (!gl_FrontFacing) N = -N;
    base = vec3(0.8); rough = 0.8; f0s = 0.04;
  } else if (mat < 3.5) {   // the shoes: the upper above the sole's line
    base = mix(mix(vec3(vShoe.w), vec3(vHair.w), 1.0 - smoothstep(0.05, 0.15, vM1.y)), vShoe.rgb, smoothstep(-0.05, 0.05, vM1.x)); rough = 0.72; f0s = 0.04; ao = max(ao, 0.6);
  } else {                  // the eye: under a pixel or two here, a dark glint
    base = vec3(0.09, 0.075, 0.07); rough = 0.2; f0s = 0.04;
  }
  ao = clamp(ao * occK, 0.0, 1.0);
  float NoV = clamp(dot(N, V), 1e-4, 1.0), a = rough * rough, specOcc = clamp(ao + (NoV - 0.5) * 0.2, 0.0, 1.0);
  vec3 f0 = vec3(f0s), scatter = mix(vec3(0.015), min(mix(vec3(0.34, 0.165, 0.098), vec3(0.23, 0.145, 0.105), vSkin.w), vec3(0.6)), skinM);
  float fres = pow(1.0 - NoV, 3.0), aSoft = sqrt(a * a + 0.0081) * mix(1.0, 0.65, skinM);
  vec3 col = vec3(0.0), Ldir[4]; Ldir[0] = uKey; Ldir[1] = uFill; Ldir[2] = uRim; Ldir[3] = uRim2;
  for (int i = 0; i < 4; i++) {
    vec3 l = Ldir[i], H = normalize(l + V);
    float nl = dot(N, l), NoL = max(nl, 0.0), NoH = clamp(dot(N, H), 0.0, 1.0), LoH = clamp(dot(l, H), 0.0, 1.0), aL = i < 2 ? aSoft : a;
    vec3 diff = i < 2 ? wrapDiff(nl, scatter) : vec3(NoL * (0.2 + 0.8 * fres));
    vec3 S = F_S(f0, LoH) * D_GGX(NoH, aL) * V_SIMPLE(NoV, NoL, aL) * NoL;
    if (sheen > 0.002) S += vec3(sheenD(NoH, 0.42)) * 0.085 * NoL * sheen * (0.35 + 0.65 * fres);
    col += uLC[i] * (base * diff * (1.0 / PI) * mix(1.0, ao, 0.3) + S * mix(1.0, specOcc, 0.5));
  }
  col += base * mix(uGnd, uSky, N.y * 0.5 + 0.5) * aoMulti(ao, base);
  col += base * base * vec3(0.52, 0.12, 0.05) * (1.0 - ao) * skinM;
  vec3 R = reflect(-V, N);
  col += mix(uGnd, uSky, R.y * 0.5 + 0.5) * (f0 * (1.0 - rough * 0.6) + vec3(0.02 * (1.0 - rough))) * specOcc;
  col += vec3(0.62, 0.68, 0.80) * fres * uTone.y * mix(0.45, 1.0, skinM) * ao;
  col += vec3(0.055, 0.040, 0.034) * (1.0 - 0.6 * vSkin.w) * pow(1.0 - NoV, 4.5) * skinM * ao;
  col = srgbEnc(aces(col * uTone.x));
  // (the fog of a far course; none where a full body may stand, so the change of level does not show it)
  float dM = length(uEye - vW) * 0.0254, f = uFogD > 0.0 ? (1.0 - exp(-dM / uFogD)) * 0.85 * smoothstep(45.0, 130.0, dM) : 0.0;
  frag = vec4(mix(col, uFog, f), 1.0);
}`,Ae=`#version 300 es
precision highp float;
layout(location=0) in vec2 aQ; layout(location=7) in vec4 iPos; layout(location=8) in vec4 iScale; layout(location=10) in vec4 iTop; layout(location=11) in vec4 iShorts;
uniform mat4 uVP; uniform float uLift; out vec2 vQ;
void main() { vQ = aQ; float c = cos(iPos.w), s = sin(iPos.w); vec2 q = vec2(aQ.x * 17.0 * iScale.y, aQ.y * 30.0 * iScale.x), o = vec2(q.x * c + q.y * s, -q.x * s + q.y * c);
  gl_Position = uVP * vec4(iPos.x + o.x, iPos.y + uLift + iTop.w * o.x + iShorts.w * o.y, iPos.z + o.y, 1.0); }`,ye=`#version 300 es
precision mediump float;
in vec2 vQ; out vec4 o;
void main() { float r = dot(vQ, vQ); o = vec4(0.03, 0.016, 0.008, 0.36 * (1.0 - smoothstep(0.05, 1.0, r))); }`;function Z(e,c,l){const u=e.createProgram();for(const[r,i]of[[e.VERTEX_SHADER,c],[e.FRAGMENT_SHADER,l]]){const v=e.createShader(r);if(e.shaderSource(v,i),e.compileShader(v),!e.getShaderParameter(v,e.COMPILE_STATUS))throw new Error(`runnerlod shader: ${e.getShaderInfoLog(v)}`);e.attachShader(u,v),e.deleteShader(v)}if(e.linkProgram(u),!e.getProgramParameter(u,e.LINK_STATUS))throw new Error(`runnerlod link: ${e.getProgramInfoLog(u)}`);const f={},p=e.getProgramParameter(u,e.ACTIVE_UNIFORMS);for(let r=0;r<p;r++){const i=e.getActiveUniform(u,r),v=i.name.replace(/\[0\]$/,"");f[v]=e.getUniformLocation(u,i.name)}return{p:u,U:f}}const ae=()=>Math.round((H.to-H.from)/H.dv)+1,ne=()=>1+ee+ae()*ee,Se=e=>Math.max(0,Math.min(ae()-1,Math.round((e-H.from)/H.dv))),Me=e=>H.from+e*H.dv,I=32;function Fe(e){const c=Z(e,te,oe.replace("#version 300 es",`#version 300 es
#define MID`)),l=Z(e,te.replace("#version 300 es",`#version 300 es
#define FAR`),oe),u=Z(e,Ae,ye),f=e.createBuffer(),p=[];let r=e.createTexture(),i=null,v=null,M=0;const d=new Float32Array(k*4*$);e.bindTexture(e.TEXTURE_2D,r),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.NEAREST),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.NEAREST);const y=e.createVertexArray(),_=e.createBuffer();e.bindVertexArray(y),e.bindBuffer(e.ARRAY_BUFFER,_),e.bufferData(e.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,1,1,-1,-1,1,1,-1,1]),e.STATIC_DRAW),e.enableVertexAttribArray(0),e.vertexAttribPointer(0,2,e.FLOAT,!1,0,0),e.bindVertexArray(null);const A=(h,R)=>{e.enableVertexAttribArray(h),e.vertexAttribPointer(h,4,e.FLOAT,!1,I*4,R),e.vertexAttribDivisor(h,1)};function w(h,R){const x={levels:[],uni:null,bufs:[]},t=h.A,a=t.base,E=t.lm.navelV*3,m=t.lm.nippleV*3,T=a[m+1]-a[E+1];x.uni={bib:[0,a[E+1]+.52*T,Math.abs(a[m]),.42*T],bibZ:.3*a[m+2],hairK:/afro|curly/.test(h.lk.style||"")?.45:.92};const o=t.eye[0],n=a[t.lm.chinV*3+1];if(x.uni.face=[o,t.eye[1],t.eye[2],n+.34*(o-n)],h.neck&&h.arm){let S=1e9;for(let b=0;b<h.arm.n;b++)S=Math.min(S,h.arm.P[b*3+1]);x.uni.neck=h.neck,x.uni.arm=h.arm,x.uni.y0=S-.15}for(const S of[1,2]){const b=xe(h,R[S],S,R.shoes&&R.shoes[S]),N=e.createVertexArray(),q=e.createBuffer(),O=e.createBuffer(),Y=e.createBuffer();e.bindVertexArray(N),e.bindBuffer(e.ARRAY_BUFFER,q),e.bufferData(e.ARRAY_BUFFER,b.v,e.STATIC_DRAW);const z=X*4;for(const[C,Q,j]of[[0,3,0],[1,3,12],[2,3,24],[3,4,36]])e.enableVertexAttribArray(C),e.vertexAttribPointer(C,Q,e.FLOAT,!1,z,j);e.enableVertexAttribArray(4),e.vertexAttribPointer(4,4,e.FLOAT,!1,z,52),e.bindBuffer(e.ARRAY_BUFFER,O),e.bufferData(e.ARRAY_BUFFER,b.b,e.STATIC_DRAW),e.enableVertexAttribArray(5),e.vertexAttribPointer(5,4,e.UNSIGNED_BYTE,!1,8,0),e.enableVertexAttribArray(6),e.vertexAttribPointer(6,4,e.UNSIGNED_BYTE,!0,8,4),e.bindBuffer(e.ELEMENT_ARRAY_BUFFER,Y),e.bufferData(e.ELEMENT_ARRAY_BUFFER,b.idx,e.STATIC_DRAW),e.bindBuffer(e.ARRAY_BUFFER,f);for(let C=0;C<8;C++)A(7+C,C*16);e.bindVertexArray(null),x.levels[S]={vao:N,nCull:b.nCull,nAll:b.nAll,tris:b.nAll/3,verts:b.n,bytes:b.v.byteLength+b.b.byteLength+b.idx.byteLength},x.bufs.push(q,O,Y)}return p.push(x),x}function F(h){const R=$+h*ne();return i=new Float32Array(k*4*R),{rows:R,data:i,rowOf:(x,t)=>$+x*ne()+t,floatsPerRow:k*4}}async function L(h){const R=i.length/(k*4);e.bindTexture(e.TEXTURE_2D,r),e.texStorage2D(e.TEXTURE_2D,1,e.RGBA32F,k,R);for(let x=0;x<R;x+=96){const t=Math.min(96,R-x);e.bindTexture(e.TEXTURE_2D,r),e.texSubImage2D(e.TEXTURE_2D,0,0,x,k,t,e.RGBA,e.FLOAT,i,x*k*4),await h()}}function P(h,R,x,t){const a=k*4,E=h*a,m=R*a,T=t*a;for(let o=0;o<a;o++)d[T+o]=i[E+o]+(i[m+o]-i[E+o])*x}function D(h,R,x){v={t:e.createTexture(),cols:R,rows:x},e.bindTexture(e.TEXTURE_2D,v.t),e.pixelStorei(e.UNPACK_PREMULTIPLY_ALPHA_WEBGL,!1),e.texImage2D(e.TEXTURE_2D,0,e.RGBA,e.RGBA,e.UNSIGNED_BYTE,h),e.generateMipmap(e.TEXTURE_2D),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.LINEAR_MIPMAP_LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.CLAMP_TO_EDGE)}function s(h,R,x){let t=0;for(const o of R)t+=o.n;if(!t)return 0;t>M&&(M=Math.ceil(t*1.3),e.bindBuffer(e.ARRAY_BUFFER,f),e.bufferData(e.ARRAY_BUFFER,M*I*4,e.DYNAMIC_DRAW)),e.bindBuffer(e.ARRAY_BUFFER,f);let a=0;for(const o of R)o.off=a,o.n&&e.bufferSubData(e.ARRAY_BUFFER,a*I*4,o.data,0,o.n*I),a+=o.n;x>0&&(e.activeTexture(e.TEXTURE0),e.bindTexture(e.TEXTURE_2D,r),e.texSubImage2D(e.TEXTURE_2D,0,0,0,k,x,e.RGBA,e.FLOAT,d,0)),e.enable(e.DEPTH_TEST),e.depthFunc(e.LEQUAL),e.depthMask(!0),e.disable(e.BLEND),e.enable(e.CULL_FACE),e.cullFace(e.BACK),e.frontFace(e.CCW);const E=Ee(h.yaw),m=o=>{const n=o.U;e.useProgram(o.p),e.uniformMatrix4fv(n.uVP,!1,h.VP),e.uniform3fv(n.uEye,h.eye),e.uniform3fv(n.uKey,E.key),e.uniform3fv(n.uFill,E.fill),e.uniform3fv(n.uRim,E.rim),e.uniform3fv(n.uRim2,E.rim2),e.uniform3fv(n.uLC,h.rig.lights),e.uniform3fv(n.uSky,h.rig.sky),e.uniform3fv(n.uGnd,h.rig.gnd),e.uniform3f(n.uTone,h.rig.exposure,h.rig.rim,h.rig.t),e.uniform3fv(n.uTrim,h.trim),e.uniform3fv(n.uFog,h.fog||[0,0,0]),e.uniform1f(n.uFogD,h.fogD||0),e.activeTexture(e.TEXTURE0),e.bindTexture(e.TEXTURE_2D,r),e.uniform1i(n.uBones,0),e.activeTexture(e.TEXTURE1),e.bindTexture(e.TEXTURE_2D,v?v.t:null),e.uniform1i(n.uAtlas,1),v&&e.uniform2f(n.uCell,1/v.cols,1/v.rows),e.activeTexture(e.TEXTURE0)};let T=null;for(const o of R){if(!o.n)continue;const n=o.level===2?l:c;n!==T&&(m(n),T=n);const S=o.body.levels[o.level];if(e.uniform4fv(n.U.uBib,o.body.uni.bib),e.uniform1f(n.U.uBibZ,o.body.uni.bibZ),e.uniform1f(n.U.uHairK,o.body.uni.hairK),e.uniform4fv(n.U.uFace,o.body.uni.face),o.level===1){const b=o.body.uni,N=!!b.neck;e.uniform1f(n.U.uStrapY0,N?b.y0:1e6),N&&(e.uniform3fv(n.U.uStrapP,b.neck.P),e.uniform3fv(n.U.uStrapO,b.neck.O),e.uniform1i(n.U.uStrapN,b.neck.n),e.uniform3fv(n.U.uArmP,b.arm.P),e.uniform3fv(n.U.uArmO,b.arm.O),e.uniform1i(n.U.uArmN,b.arm.n))}e.bindVertexArray(S.vao),e.bindBuffer(e.ARRAY_BUFFER,f);for(let b=0;b<8;b++)e.vertexAttribPointer(7+b,4,e.FLOAT,!1,I*4,(o.off*I+b*4)*4);o.cov&&(e.enable(e.SAMPLE_COVERAGE),e.sampleCoverage(o.cov,!!o.inv)),e.drawElementsInstanced(e.TRIANGLES,S.nCull,e.UNSIGNED_SHORT,0,o.n),S.nAll>S.nCull&&(e.disable(e.CULL_FACE),e.drawElementsInstanced(e.TRIANGLES,S.nAll-S.nCull,e.UNSIGNED_SHORT,S.nCull*2,o.n),e.enable(e.CULL_FACE)),o.cov&&e.disable(e.SAMPLE_COVERAGE)}return e.bindVertexArray(null),t}function U(h,R,x,t){x&&(x>M&&(M=Math.ceil(x*1.3),e.bindBuffer(e.ARRAY_BUFFER,f),e.bufferData(e.ARRAY_BUFFER,M*I*4,e.DYNAMIC_DRAW)),e.bindBuffer(e.ARRAY_BUFFER,f),e.bufferSubData(e.ARRAY_BUFFER,0,R,0,x*I),e.useProgram(u.p),e.uniformMatrix4fv(u.U.uVP,!1,h),e.uniform1f(u.U.uLift,t),e.enable(e.DEPTH_TEST),e.depthFunc(e.LEQUAL),e.depthMask(!1),e.enable(e.BLEND),e.blendFunc(e.SRC_ALPHA,e.ONE_MINUS_SRC_ALPHA),e.disable(e.CULL_FACE),e.bindVertexArray(y),e.bindBuffer(e.ARRAY_BUFFER,f),A(7,0),A(8,16),A(10,48),A(11,64),e.drawArraysInstanced(e.TRIANGLES,0,6,x),e.bindVertexArray(null),e.depthMask(!0),e.disable(e.BLEND))}function V(){for(const h of p){for(const R of h.levels)R&&e.deleteVertexArray(R.vao);for(const R of h.bufs)e.deleteBuffer(R)}e.deleteBuffer(f),e.deleteBuffer(_),e.deleteVertexArray(y),e.deleteTexture(r),v&&e.deleteTexture(v.t);for(const h of[c,l,u])e.deleteProgram(h.p)}return{addBody:w,allocFits:F,uploadRows:L,blendRow:P,setAtlas:D,draw:s,shadows:U,dyn:d,free:V,stats:()=>({bodies:p.length,bonesBytes:i?i.byteLength:0,meshBytes:p.reduce((h,R)=>h+R.levels.reduce((x,t)=>x+(t?t.bytes:0),0),0)})}}function Ee(e){const c=Math.cos(e),l=Math.sin(e),u=f=>{const p=[f[0]*c+f[2]*l,f[1],-f[0]*l+f[2]*c],r=Math.hypot(...p);return p.map(i=>i/r)};return{key:u([-.55,.65,.75]),fill:u([.8,.05,.55]),rim:u([.75,.35,-.85]),rim2:u([-.85,.2,-.6])}}export{k as BONES_W,$ as DYN_ROWS,X as FLOATS,ve as HAIR_BUDGET,I as INST_FLOATS,pe as LIGHT_FUNCS,G as MATS,ee as PHASES,H as RUN_BUCKETS,le as bottomField,Me as bucketSpeed,be as clusterMesh,Fe as createLodRenderer,xe as levelMesh,Ee as lightsFor,Te as loadLod,he as parseLod,ne as rowsPerFit,ae as runBucketCount,Se as runBucketOf,me as topField};
