const W=(o,l,h)=>Math.max(l,Math.min(h,o)),_=(o,l,h)=>o+(l-o)*h,j=(o,l,h)=>{const s=W((h-o)/(l-o),0,1);return s*s*(3-2*s)},ct=21,ht=24,it=28,ft=96,ut=10.4,Q={running:{sole:[.82,.5],collar:.64,throat:1,toe:.05,heel:.03,margin:.13,flare:.1,spring:.16},racing:{sole:[.5,.34],collar:.56,throat:.92,toe:.04,heel:.018,margin:.095,flare:.05,spring:.18},lifting:{sole:[1,.3],block:.36,collar:.74,throat:1.04,toe:.045,heel:.022,margin:.14,flare:.035,spring:.08},cross:{sole:[.62,.48],collar:.68,throat:1,toe:.045,heel:.025,margin:.13,flare:.07,spring:.12},casual:{sole:[.6,.56],collar:.7,throat:.98,toe:.055,heel:.025,margin:.12,flare:.05,spring:.1}};function $(o,l){const[h,s]=o.sole;return o.block?_(h,s,j(o.block-.05,o.block+.06,l)):_(h,s,j(.12,.68,l))}const R=(o,l,h)=>h*(_(o.collar,o.throat,j(.28,.42,l))+.06*(1-j(.03,.16,l)));function P(o){const l=o.slice().sort((n,i)=>n[0]-i[0]||n[1]-i[1]);if(l.length<3)return l;const h=(n,i,f)=>(i[0]-n[0])*(f[1]-n[1])-(i[1]-n[1])*(f[0]-n[0]),s=[],a=[];for(const n of l){for(;s.length>=2&&h(s[s.length-2],s[s.length-1],n)<=0;)s.pop();s.push(n)}for(let n=l.length-1;n>=0;n--){const i=l[n];for(;a.length>=2&&h(a[a.length-2],a[a.length-1],i)<=0;)a.pop();a.push(i)}return s.slice(0,-1).concat(a.slice(0,-1))}function D(o,l,h){let s=0;for(let a=0;a<o.length;a++){const n=o[a],i=o[(a+1)%o.length],f=i[0]-n[0],x=i[1]-n[1],u=h[0]*x-h[1]*f;if(Math.abs(u)<1e-12)continue;const S=((n[0]-l[0])*x-(n[1]-l[1])*f)/u,O=((n[0]-l[0])*h[1]-(n[1]-l[1])*h[0])/u;O>=-1e-9&&O<=1+1e-9&&S>s&&(s=S)}return s}function tt(o,l,h){const s=h==="L"?4:5,a=l.rest,n=o.wFoot,i=o.nMesh;let f=1/0;for(let t=0;t<i;t++)o.part[t]===s&&n[t]>.5&&(f=Math.min(f,a[t*3+1]));let x=0,u=0,S=0;for(let t=0;t<i;t++)o.part[t]===s&&n[t]>.5&&a[t*3+1]<f+.8&&(x+=a[t*3],u+=a[t*3+2],S++);x/=S,u/=S;let O=0,N=0,w=0;for(let t=0;t<i;t++)if(o.part[t]===s&&n[t]>.5&&a[t*3+1]<f+.8){const e=a[t*3]-x,c=a[t*3+2]-u;O+=e*e,N+=e*c,w+=c*c}const B=.5*Math.atan2(2*N,w-O),m=[Math.sin(B),0,Math.cos(B)],b=h==="L"?[m[2],0,-m[0]]:[-m[2],0,m[0]],y=t=>{const e=a[t*3]-x,c=a[t*3+2]-u;return[e*b[0]+c*b[2],a[t*3+1]-f,e*m[0]+c*m[2]]};let k=1/0,F=-1/0,A=0,E=0;for(let t=0;t<i;t++)if(o.part[t]===s&&n[t]>.5){const e=y(t);e[2]<k&&(k=e[2],A=e[0]),e[2]>F&&(F=e[2],E=e[0])}const Y=l.heads[o.B["foot"+h]],q=Y[1]-f,r=(Y[0]-x)*m[0]+(Y[2]-u)*m[2]-k,M=[];let p=0;for(let t=0;t<i;t++){if(o.part[t]!==s||a[t*3+1]>f+q*1.6)continue;const e=y(t);e[2]-=k,M.push([e[0],e[1],e[2],t]),n[t]>.5&&e[1]<.15&&(p=Math.max(p,e[2]))}const v=[x+m[0]*k,f,u+m[2]*k];return{side:h,origin:v,fwd:m,lat:b,floor:f,length:F-k,ay:q,ankleZ:r,pad:p,leg:M,heelX:A,tipX:E}}function ot(o,l,h,s){const a=tt(o,l,h),n=a.length,i=a.ay,f=n/10.4,x=s.margin,u=s.flare*f,S=.035*n,O=.965*n,N=Array.from({length:24},(r,M)=>{const p=M/23;return S+(O-S)*(.25*(1-Math.cos(Math.PI*p))+.5*p)}),w=[];for(let r=0;r<24;r++){const M=N[r],p=M/n,v=R(s,p,i),t=r===0?N[1]-N[0]:r===23?N[r]-N[r-1]:(N[r+1]-N[r-1])/2,e=Math.max(.16,.8*t),c=[];let g=1/0,d=-1/0;for(const X of a.leg)(r===0?X[2]-M>e:r===23?M-X[2]>e:Math.abs(X[2]-M)>e)||X[1]>v+.45||(c.push([X[0],X[1]]),X[1]<.9&&(g=Math.min(g,X[0]),d=Math.max(d,X[0])));M<=a.pad+.25&&g<d&&c.push([g,0],[d,0]);const z=c.length>=3?P(c):null;if(!z||z.length<3){w.push(null);continue}const L=[0,0];for(const X of z)L[0]+=X[0]/z.length,L[1]+=X[1]/z.length;const H=[];for(let X=0;X<96;X++){const U=-Math.PI/2+2*Math.PI*X/96,I=[Math.cos(U),Math.sin(U)],K=D(z,L,I)+x+.06*f*Math.max(0,I[1])**2;H.push([L[0]+I[0]*K,L[1]+I[1]*K])}w.push({z:M,u:p,c:L,dense:H,cap:v})}for(let r=0;r<24;r++)if(!w[r]){let M=1;for(;!w[r-M]&&!w[r+M]&&M<24;)M++;const p=w[r+M]||w[r-M],v=N[r];w[r]={...p,z:v,u:v/n,cap:R(s,v/n,i)}}const B=[];for(const r of w){const M=r.dense.map(e=>[e[0],Math.min(Math.max(e[1],0),r.cap)]);let p=1/0,v=-1/0;for(const e of M)p=Math.min(p,e[1]),v=Math.max(v,e[1]);const t=Math.min($(s,r.u)*f,.55*(v-p));B.push(et(M,r.c[0],p,t,r.z,r.u,r.cap,u))}for(let r=0;r<3;r++){const M=B.map(p=>p.pts.map(v=>[v.X,v.Y]));for(let p=1;p+1<B.length;p++){const v=B[p],t=v.cx;v.pts.forEach((e,c)=>{const g=.25*M[p-1][c][0]+.5*M[p][c][0]+.25*M[p+1][c][0],d=.25*M[p-1][c][1]+.5*M[p][c][1]+.25*M[p+1][c][1];Math.abs(g-t)>Math.abs(e.X-t)&&Math.sign(g-t)===Math.sign(e.X-t)&&(e.X=g),!e.lid&&e.Y>v.yb+.001&&d>e.Y&&Math.abs(e.a)<.75&&(e.Y=Math.min(d,R(s,v.u,i)),e.h=e.Y-v.yb)})}}const m=s.heel*n,b=s.toe*n,y=s.spring*f,k=Math.PI/180,F=(r,M,p,v,t)=>{const e=Math.cos(v*k),c=t?e:Math.sqrt(e),g=t?.5+.5*c:1,d=t?y*(1-c):0;return{...r,z:M,u:M/n,yb:r.yb+d,pts:r.pts.map(z=>({...z,X:p+(z.X-p)*c,Y:r.yb+d+(z.Y-r.yb)*g,h:z.h*g,sole:z.sole*g}))}},A=B[0],E=B[B.length-1],Y=S+m,q=n-O+b;for(const r of[35,60,78,90])B.unshift(F(A,S-Y*Math.sin(r*k),a.heelX,r,!1));for(const r of[22,42,60,76,90])B.push(F(E,O+q*Math.sin(r*k),a.tipX,r,!0));return{F:a,rows:B,L:n}}function et(o,l,h,s,a,n,i,f){const x=o.length,u=[0];for(let t=1;t<=x;t++){const e=o[t-1],c=o[t%x];u.push(u[t-1]+Math.hypot(c[0]-e[0],c[1]-e[1]))}const S=u[x],O=t=>{t=(t%S+S)%S;let e=0,c=x;for(;c-e>1;){const L=e+c>>1;u[L]<=t?e=L:c=L}const g=o[e],d=o[(e+1)%x],z=(t-u[e])/Math.max(u[e+1]-u[e],1e-9);return[_(g[0],d[0],z),_(g[1],d[1],z)]},N=(t,e)=>{for(let c=1;c<x/2;c++){const g=e>0?c-1:(x-c+1)%x,d=e>0?c:x-c;if(o[d][1]-h>=t&&o[g][1]-h<t){const z=(t-(o[g][1]-h))/Math.max(o[d][1]-o[g][1],1e-9);return e>0?_(u[g],u[d],z):_(g===0?S:u[g],u[d],z)}}return e>0?u[x/4]:u[3*x/4]},w=u[x/2],B=N(.02,1),m=Math.max(N(s,1),B+.02),b=N(.02,-1),y=Math.min(N(s,-1),b-.02),k=o.some(t=>t[1]>=i-1e-4);let F=w-.14*(w-m),A=w+.14*(y-w);if(k){for(let t=1;t<=x/2;t++)if(o[t][1]>=i-1e-4){F=u[t-1]+(u[t]-u[t-1])*W((i-o[t-1][1])/Math.max(o[t][1]-o[t-1][1],1e-9),0,1);break}for(let t=x-1;t>=x/2;t--)if(o[t][1]>=i-1e-4){const e=(t+1)%x,c=e===0?S:u[e];A=c+(u[t]-c)*W((i-o[e][1])/Math.max(o[t][1]-o[e][1],1e-9),0,1);break}F=W(F,m+.08,w-.01),A=W(A,w+.01,y-.08)}const E=.04,Y=[],q=[],r=(t,e)=>{Y.push(t),q.push(e)};r(0,0),r(B/2,0),r(B,0);for(let t=1;t<=2;t++)r(_(B,m,t/3),0);r(m,0),r(m+E,1);for(let t=1;t<=5;t++)r(_(m+E,F,t/6),1);r(F,2);for(let t=1;t<=3;t++)r(_(F,A,t/4),k?3:1);r(A,2);for(let t=1;t<=5;t++)r(_(A,y-E,t/6),1);r(y-E,1),r(y,0);for(let t=1;t<=2;t++)r(_(y,b,t/3),0);r(b,0),r((b+S)/2,0);let M=-1/0;const p=Y.map((t,e)=>{const[c,g]=O(t);M=Math.max(M,g);const d=t<=w?(w-t)/w:-(t-w)/(S-w);return{X:c,Y:g,a:d,h:g-h,sole:s,lid:q[e]===3?1:0,solePt:q[e]===0}}),v=p.map(()=>[0,0]);for(let t=0;t<Y.length;t++){const e=(t+1)%Y.length,c=Y[t],g=e?Y[e]:S,d=p[t],z=p[e],L=z.X-d.X,H=z.Y-d.Y,X=Math.hypot(L,H);if(X<1e-6)continue;const U=H/X,I=-L/X;let K=0;for(let C=0;C<x;C++)u[C]>c&&u[C]<g&&(K=Math.max(K,(o[C][0]-d.X)*U+(o[C][1]-d.Y)*I));if(K>0)for(const C of[v[t],v[e]])Math.abs(U*K)>Math.abs(C[0])&&(C[0]=U*K),Math.abs(I*K)>Math.abs(C[1])&&(C[1]=I*K)}return p.forEach((t,e)=>{t.X+=v[e][0],t.Y=Math.max(t.Y+v[e][1],0),t.h=t.Y-h}),p.forEach((t,e)=>{if(!t.solePt)return;const c=p[(e+p.length-1)%p.length],g=p[(e+1)%p.length],d=g.X-c.X,z=g.Y-c.Y,L=Math.hypot(d,z)||1;t.X+=f*(z/L)}),{pts:p,cx:l,yb:h,top:M,z:a,u:n}}const nt=(o,l,h,s)=>[o.origin[0]+o.lat[0]*l+o.fwd[0]*s,o.floor+h,o.origin[2]+o.lat[2]*l+o.fwd[2]*s],G=.6,Z=(o,l,h)=>((o+512)*1024+(l+512))*1024+(h+512);function st(o,l){if(l.grid)return l.grid;const h=o.rest,s=new Map;for(const a of l.leg){const n=a[3],i=Z(Math.floor(h[n*3]/G),Math.floor(h[n*3+1]/G),Math.floor(h[n*3+2]/G));let f=s.get(i);f||s.set(i,f=[]),f.push(n)}return l.grid=s}function at(o,l,h,s){const a=l.rest,n=[],i=st(l,h),f=Math.floor(s[0]/G),x=Math.floor(s[1]/G),u=Math.floor(s[2]/G),S=[];for(let m=1;m<=4&&S.length<6;m++){S.length=0;for(let b=f-m;b<=f+m;b++)for(let y=x-m;y<=x+m;y++)for(let k=u-m;k<=u+m;k++){const F=i.get(Z(b,y,k));if(F)for(const A of F)S.push(A)}}for(const m of S.length>=6?S:h.leg.map(b=>b[3])){const b=a[m*3]-s[0],y=a[m*3+1]-s[1],k=a[m*3+2]-s[2],F=b*b+y*y+k*k;(n.length<6||F<n[n.length-1][0])&&(n.push([F,m]),n.sort((A,E)=>A[0]-E[0]),n.length>6&&n.pop())}const O=Math.max(n[0][0],.04)*2,N=new Map;for(const[m,b]of n){const y=Math.exp(-m/O);for(let k=0;k<4;k++){const F=o.skinIdx[b*4+k],A=o.skinW[b*4+k]*y;A>0&&N.set(F,(N.get(F)||0)+A)}}const w=[...N.entries()].sort((m,b)=>b[1]-m[1]).slice(0,4),B=w.reduce((m,b)=>m+b[1],0)||1;return w.map(([m,b])=>[m,b/B])}const V=new WeakMap;function pt(o,l,h){const s=Q[h];if(!s||!l||!l.rest||!o||!o.wFoot)return null;let a=V.get(l);if(a||V.set(l,a=new Map),a.has(h))return a.get(h);const n=["L","R"].map(E=>ot(o,l,E,s)),i=n[0].rows.length*28,f=i*2,x=new Float32Array(f*3),u=new Float32Array(f*3),S=new Float32Array(f*3),O=new Float32Array(f),N=new Uint8Array(f*4),w=new Float32Array(f*4),B=new Float32Array(f).fill(-21),m=[],b={feet:[]};n.forEach((E,Y)=>{const{F:q,rows:r,L:M}=E,p=Y*i,v=(c,g,d,z,L,H,X,U,I)=>{const K=nt(q,g,d,z);x.set(K,c*3),u.set([L,H,X],c*3),S.set([U,I,d],c*3),O[c]=I?.42:1-.3*(1-j(0,.35,d)),at(o,l,q,K).forEach(([C,J],T)=>{N[c*4+T]=C,w[c*4+T]=J})};r.forEach((c,g)=>c.pts.forEach((d,z)=>v(p+g*28+z,d.X,d.Y,c.z,d.a,d.h,c.z/M,d.sole,d.lid)));const t=q.side==="R",e=(c,g,d)=>t?m.push(c,d,g):m.push(c,g,d);for(let c=0;c+1<r.length;c++)for(let g=0;g<28;g++){const d=p+c*28+g,z=p+c*28+(g+1)%28,L=p+(c+1)*28+g,H=p+(c+1)*28+(g+1)%28;e(d,L,z),e(z,L,H)}b.feet.push({side:q.side,length:M,ankle:q.ay,rows:r.length,frame:q})});let y=Uint16Array.from(m);if(lt(x,y)<0)for(let E=0;E<y.length;E+=3){const Y=y[E+1];y[E+1]=y[E+2],y[E+2]=Y}const F=rt(x,y,f),A={n:f,pos:x,nrm:F,canon:u,fab:S,ao:O,joint:N,weight:w,cav:B,idx:y,info:b,style:h,floor:(n[0].F.floor+n[1].F.floor)/2};return a.set(h,A),A}function lt(o,l){let h=0;for(let s=0;s<l.length;s+=3){const a=l[s]*3,n=l[s+1]*3,i=l[s+2]*3;h+=o[a]*(o[n+1]*o[i+2]-o[n+2]*o[i+1])-o[a+1]*(o[n]*o[i+2]-o[n+2]*o[i])+o[a+2]*(o[n]*o[i+1]-o[n+1]*o[i])}return h/6}function rt(o,l,h){const s=new Float32Array(h*3);for(let a=0;a<l.length;a+=3){const n=l[a]*3,i=l[a+1]*3,f=l[a+2]*3,x=o[i]-o[n],u=o[i+1]-o[n+1],S=o[i+2]-o[n+2],O=o[f]-o[n],N=o[f+1]-o[n+1],w=o[f+2]-o[n+2],B=u*w-S*N,m=S*O-x*w,b=x*N-u*O;for(const y of[n,i,f])s[y]+=B,s[y+1]+=m,s[y+2]+=b}for(let a=0;a<h;a++){const n=Math.hypot(s[a*3],s[a*3+1],s[a*3+2])||1;s[a*3]/=n,s[a*3+1]/=n,s[a*3+2]/=n}return s}function mt(o,l,h){if(!o||!l||o.n!==l.n)return h<.5?o:l;if(h<=0)return o;if(h>=1)return l;const s=(i,f)=>{const x=new Float32Array(i.length);for(let u=0;u<x.length;u++)x[u]=i[u]+(f[u]-i[u])*h;return x},a=s(o.nrm,l.nrm);for(let i=0;i<a.length;i+=3){const f=Math.hypot(a[i],a[i+1],a[i+2])||1;a[i]/=f,a[i+1]/=f,a[i+2]/=f}return{...h<.5?o:l,pos:s(o.pos,l.pos),nrm:a,canon:s(o.canon,l.canon),fab:s(o.fab,l.fab),ao:s(o.ao,l.ao),floor:_(o.floor,l.floor,h)}}const gt=`
uniform vec4 uShoeK;     // v7 shoes: x style (0 barefoot … 5), y foot length (in), z the feet's floor in the bind pose (in)
uniform ivec2 uFootB;    // the foot bones
vec3 shoeFloor(vec3 q, mat3x4 M, ivec4 j){
  if (aCav < -20.5 && aCav > -21.5) {
    vec3 up = normalize(vec4(0.0, 1.0, 0.0, 0.0) * M);
    float s = q.y - aFabN.z * up.y;
    if (s < 0.0) q.y -= s;
  } else if (uShoeK.x > 0.5 && aCav > -0.5) {
    float wf = 0.0;
    for (int k = 0; k < 4; k++) { if (j[k] == uFootB.x || j[k] == uFootB.y) wf += aWeight[k]; }
    if (wf > 0.3) {
      vec3 up = normalize(vec4(0.0, 1.0, 0.0, 0.0) * M);
      float s = q.y - (aPos.y - uShoeK.z) * up.y;
      if (s < 0.0) q.y -= s * smoothstep(0.3, 0.7, wf);
    }
  }
  return q;
}
`,xt=`
uniform vec4 uShoeK;
uniform vec3 uShoeU, uShoeS, uShoeO, uShoeA, uShoeL;
float sBand(float x, float a, float b, float w){ return smoothstep(a - w, a + w, x) * (1.0 - smoothstep(b - w, b + w, x)); }
void shoeMat(inout vec3 base, inout float rough, inout float f0s, inout vec3 N, inout float occK){
  float code = uShoeK.x, L = max(uShoeK.y, 6.0);
  float a = vC.x, h = vC.y, u = vC.z, sole = vFabN.x, lid = vFabN.y, ab = abs(a), zi = u * L;
  float w = 0.012 + 0.6 * max(fwidth(h), fwidth(zi) * 0.5);   // (edges a pixel wide at any size)
  float up = smoothstep(sole - w, sole + w, h);               // 1 on the upper, 0 on the sole
  float rub = 1.0 - smoothstep(0.075 - w, 0.075 + w, h);      // the outsole's rubber
  vec3 c = mix(mix(uShoeS, uShoeO, rub), uShoeU, up);
  rough = mix(mix(0.62, 0.8, rub), 0.72, up); f0s = 0.04; occK = 1.0;
  float side = sBand(ab, 0.24, 0.86, 0.03);                   // the side panels (not the top, not under)
  float lace = (1.0 - smoothstep(0.19 - 0.02, 0.19 + 0.02, ab)) * up;
  float l0 = 0.4, l1 = 0.71;
  if (code > 2.5 && code < 3.5) { l0 = 0.42; l1 = 0.66; }
  float lz = sBand(u, l0, l1, 0.008);
  float bar = sBand(fract(zi / 0.42), 0.12, 0.42, 0.04);      // laces across the tongue, 0.42 in apart
  float fine = sin(zi * 46.0) * sin(h * 46.0 + a * 9.0);      // a knit / mesh texture
  if (code < 1.5) {          // running
    c = mix(c, uShoeS * 0.82, sBand(h, sole * 0.52, sole * 0.52 + 0.035, w) * (1.0 - up) * side);   // the midsole's sculpted line
    float t = zi * 0.62 + (h - sole) * 1.0;
    float st = side * up * smoothstep(0.24, 0.3, u) * (1.0 - smoothstep(0.6, 0.66, u)) * smoothstep(sole + 0.12, sole + 0.2, h);
    c = mix(c, uShoeA, st * max(sBand(t, 3.25, 3.42, w), sBand(t, 3.62, 3.79, w)));
    c = mix(c, uShoeA, up * (1.0 - smoothstep(0.15, 0.17, u)) * smoothstep(sole + 0.05, sole + 0.1, h) * 0.9);   // the heel clip
    N = normalize(mix(N, bumpN(N, vW, fine * 0.004), up));
  } else if (code < 2.5) {   // racing flat
    float t = zi * 0.38 + (h - sole) * 1.25;
    c = mix(c, uShoeA, side * up * sBand(t, 2.05, 2.5, w) * smoothstep(0.1, 0.16, u) * (1.0 - smoothstep(0.7, 0.76, u)));
    c = mix(c, c * 0.8, up * 0.5 * (0.5 + 0.5 * fine));       // the sheer mesh's weave
    rough = mix(rough, 0.6, up);
  } else if (code < 3.5) {   // lifting: smooth leather, a strap, the solid heel
    rough = mix(rough, 0.42, up); f0s = mix(0.04, 0.05, up);
    float strap = up * sBand(u, 0.5, 0.63, 0.006) * (1.0 - smoothstep(0.8, 0.86, ab));
    c = mix(c, uShoeA, strap);
    c = mix(c, c * 0.55, up * sBand(u, 0.506, 0.512, 0.002) * (1.0 - smoothstep(0.8, 0.86, ab)));   // stitching at the strap's edges
    c = mix(c, c * 0.55, up * sBand(u, 0.618, 0.624, 0.002) * (1.0 - smoothstep(0.8, 0.86, ab)));
    c = mix(c, vec3(0.32), strap * sBand(a, 0.6, 0.72, 0.01) * sBand(u, 0.53, 0.6, 0.006));   // the buckle
    lz *= 1.0 - sBand(u, 0.5, 0.63, 0.006);
    c = mix(c, uShoeO, (1.0 - up) * smoothstep(0.4, 0.44, u));   // the forefoot's thin rubber sole
  } else if (code < 4.5) {   // cross-trainer
    float wrap = (1.0 - smoothstep(sole + 0.32 - w, sole + 0.32 + w, h)) * up;
    c = mix(c, uShoeO, wrap * smoothstep(0.86, 0.9, u));                                            // the toe bumper
    c = mix(c, uShoeO, wrap * step(a, -0.3) * sBand(u, 0.3, 0.74, 0.01));                           // the rope guard
    c = mix(c, uShoeA, up * (1.0 - smoothstep(0.2, 0.22, u)) * smoothstep(sole + 0.04, sole + 0.09, h));   // the heel cap
    c = mix(c, uShoeA, side * up * sBand(h - sole, 0.42, 0.52, w) * sBand(u, 0.28, 0.66, 0.01));     // a side band
    N = normalize(mix(N, bumpN(N, vW, fine * 0.003), up));
  } else {                   // casual
    c = mix(c, uShoeA, (1.0 - up) * sBand(h, sole * 0.55, sole * 0.55 + 0.05, w));                  // the sole's pinstripe
    c = mix(c, uShoeS, up * smoothstep(0.855, 0.875, u) * (1.0 - smoothstep(sole + 0.45, sole + 0.5, h)));   // the toe cap
    rough = mix(rough, 0.86, up);
    N = normalize(mix(N, bumpN(N, vW, sin(zi * 70.0) * sin(h * 70.0) * 0.003), up));
  }
  c = mix(c, uShoeU * 0.78, lace * lz);                       // the tongue between the laces
  c = mix(c, uShoeL, lace * lz * bar);
  c = mix(c, c * 0.6, up * lz * sBand(ab, 0.19, 0.235, 0.012));   // the eyelet rows
  if (lid > 0.5) { c = mix(uShoeU, vec3(0.02), 0.72); rough = 0.85; }   // the lining inside the collar
  base = c;
}
`;export{xt as SHOE_FRAG_GLSL,ct as SHOE_ID,Q as SHOE_SHAPE,gt as SHOE_VERT_GLSL,mt as blendShoes,R as capAt,tt as shoeFrame,pt as shoeGeometry};
