const Z=(t,l,c)=>Math.max(l,Math.min(c,t)),H=(t,l,c)=>t+(l-t)*c,j=(t,l,c)=>{const s=Z((c-t)/(l-t),0,1);return s*s*(3-2*s)},f0=21,p0=24,m0=28,d0=96,g0=10.4,D={running:{sole:[.82,.5],collar:.64,throat:1,toe:.05,heel:.03,margin:.13,flare:.1,spring:.16},racing:{sole:[.5,.34],collar:.56,throat:.92,toe:.04,heel:.018,margin:.095,flare:.05,spring:.18},lifting:{sole:[1,.3],block:.36,collar:.74,throat:1.04,toe:.045,heel:.022,margin:.14,flare:.035,spring:.08},cross:{sole:[.62,.48],collar:.68,throat:1,toe:.045,heel:.025,margin:.13,flare:.07,spring:.12},casual:{sole:[.6,.56],collar:.7,throat:.98,toe:.055,heel:.025,margin:.12,flare:.05,spring:.1},oxford:{sole:[.95,.32],block:.27,collar:.58,throat:.9,toe:.075,heel:.02,margin:.075,flare:.06,spring:.12},loafer:{sole:[.5,.26],block:.24,collar:.5,throat:.84,toe:.055,heel:.02,margin:.07,flare:.03,spring:.1},trail:{sole:[.86,.56],collar:.66,throat:1,toe:.055,heel:.03,margin:.135,flare:.09,spring:.16},maxcush:{sole:[1.01,.73],collar:.66,throat:1,toe:.055,heel:.04,margin:.13,flare:.15,spring:.24},minimal:{sole:[.16,.16],collar:.55,throat:.94,toe:.035,heel:.012,margin:.08,flare:.015,spring:.04},hightop:{sole:[.6,.56],collar:1.75,throat:1.8,toe:.055,heel:.025,margin:.12,flare:.05,spring:.1},slide:{sole:[.42,.34],collar:.62,throat:.95,toe:.03,heel:.02,margin:.1,flare:.09,spring:.05,slide:[.4,.66]}};function o0(t,l){const[c,s]=t.sole;return t.block?H(c,s,j(t.block-.05,t.block+.06,l)):H(c,s,j(.12,.68,l))}const J=(t,l,c)=>c*(H(t.collar,t.throat,j(.28,.42,l))+.06*(1-j(.03,.16,l)));function t0(t){const l=t.slice().sort((e,h)=>e[0]-h[0]||e[1]-h[1]);if(l.length<3)return l;const c=(e,h,p)=>(h[0]-e[0])*(p[1]-e[1])-(h[1]-e[1])*(p[0]-e[0]),s=[],a=[];for(const e of l){for(;s.length>=2&&c(s[s.length-2],s[s.length-1],e)<=0;)s.pop();s.push(e)}for(let e=l.length-1;e>=0;e--){const h=l[e];for(;a.length>=2&&c(a[a.length-2],a[a.length-1],h)<=0;)a.pop();a.push(h)}return s.slice(0,-1).concat(a.slice(0,-1))}function e0(t,l,c){let s=0;for(let a=0;a<t.length;a++){const e=t[a],h=t[(a+1)%t.length],p=h[0]-e[0],i=h[1]-e[1],u=c[0]*i-c[1]*p;if(Math.abs(u)<1e-12)continue;const v=((e[0]-l[0])*i-(e[1]-l[1])*p)/u,L=((e[0]-l[0])*c[1]-(e[1]-l[1])*c[0])/u;L>=-1e-9&&L<=1+1e-9&&v>s&&(s=v)}return s}function s0(t,l,c){const s=c==="L"?4:5,a=l.rest,e=t.wFoot,h=t.nMesh;let p=1/0;for(let o=0;o<h;o++)t.part[o]===s&&e[o]>.5&&(p=Math.min(p,a[o*3+1]));let i=0,u=0,v=0;for(let o=0;o<h;o++)t.part[o]===s&&e[o]>.5&&a[o*3+1]<p+.8&&(i+=a[o*3],u+=a[o*3+2],v++);i/=v,u/=v;let L=0,A=0,z=0;for(let o=0;o<h;o++)if(t.part[o]===s&&e[o]>.5&&a[o*3+1]<p+.8){const n=a[o*3]-i,g=a[o*3+2]-u;L+=n*n,A+=n*g,z+=g*g}const Y=.5*Math.atan2(2*A,z-L),x=[Math.sin(Y),0,Math.cos(Y)],M=c==="L"?[x[2],0,-x[0]]:[-x[2],0,x[0]],X=o=>{const n=a[o*3]-i,g=a[o*3+2]-u;return[n*M[0]+g*M[2],a[o*3+1]-p,n*x[0]+g*x[2]]};let N=1/0,O=-1/0,U=0,W=0;for(let o=0;o<h;o++)if(t.part[o]===s&&e[o]>.5){const n=X(o);n[2]<N&&(N=n[2],U=n[0]),n[2]>O&&(O=n[2],W=n[0])}const E=l.heads[t.B["foot"+c]],R=E[1]-p,r=(E[0]-i)*x[0]+(E[2]-u)*x[2]-N,S=[];let b=0;for(let o=0;o<h;o++){if(t.part[o]!==s||a[o*3+1]>p+R*2.2)continue;const n=X(o);n[2]-=N,S.push([n[0],n[1],n[2],o]),e[o]>.5&&n[1]<.15&&(b=Math.max(b,n[2]))}const B=[i+x[0]*N,p,u+x[2]*N];return{side:c,origin:B,fwd:x,lat:M,floor:p,length:O-N,ay:R,ankleZ:r,pad:b,leg:S,heelX:U,tipX:W}}function n0(t,l,c,s){const a=s0(t,l,c),e=a.length,h=a.ay,p=e/10.4,i=s.margin,u=s.flare*p,v=.035*e,L=.965*e,A=Array.from({length:24},(r,S)=>{const b=S/23;return v+(L-v)*(.25*(1-Math.cos(Math.PI*b))+.5*b)}),z=[];for(let r=0;r<24;r++){const S=A[r],b=S/e,B=J(s,b,h),o=r===0?A[1]-A[0]:r===23?A[r]-A[r-1]:(A[r+1]-A[r-1])/2,n=Math.max(.16,.8*o),g=[];let m=1/0,w=-1/0;for(const d of a.leg)(r===0?d[2]-S>n:r===23?S-d[2]>n:Math.abs(d[2]-S)>n)||d[1]>B+.45||(g.push([d[0],d[1]]),d[1]<.9&&(m=Math.min(m,d[0]),w=Math.max(w,d[0])));S<=a.pad+.25&&m<w&&g.push([m,0],[w,0]);const f=g.length>=3?t0(g):null;if(!f||f.length<3){z.push(null);continue}const F=[0,0];for(const d of f)F[0]+=d[0]/f.length,F[1]+=d[1]/f.length;const C=[];for(let d=0;d<96;d++){const k=-Math.PI/2+2*Math.PI*d/96,y=[Math.cos(k),Math.sin(k)],K=e0(f,F,y)+i+.06*p*Math.max(0,y[1])**2;C.push([F[0]+y[0]*K,F[1]+y[1]*K])}z.push({z:S,u:b,c:F,dense:C,cap:B})}for(let r=0;r<24;r++)if(!z[r]){let S=1;for(;!z[r-S]&&!z[r+S]&&S<24;)S++;const b=z[r+S]||z[r-S],B=A[r];z[r]={...b,z:B,u:B/e,cap:J(s,B/e,h)}}const Y=[];for(const r of z){const S=r.dense.map(n=>[n[0],Math.min(Math.max(n[1],0),r.cap)]);let b=1/0,B=-1/0;for(const n of S)b=Math.min(b,n[1]),B=Math.max(B,n[1]);const o=Math.min(o0(s,r.u)*p,.55*(B-b));Y.push(a0(S,r.c[0],b,o,r.z,r.u,r.cap,u))}for(let r=0;r<3;r++){const S=Y.map(b=>b.pts.map(B=>[B.X,B.Y]));for(let b=1;b+1<Y.length;b++){const B=Y[b],o=B.cx;B.pts.forEach((n,g)=>{const m=.25*S[b-1][g][0]+.5*S[b][g][0]+.25*S[b+1][g][0],w=.25*S[b-1][g][1]+.5*S[b][g][1]+.25*S[b+1][g][1];Math.abs(m-o)>Math.abs(n.X-o)&&Math.sign(m-o)===Math.sign(n.X-o)&&(n.X=m),!n.lid&&n.Y>B.yb+.001&&w>n.Y&&Math.abs(n.a)<.75&&(n.Y=Math.min(w,J(s,B.u,h)),n.h=n.Y-B.yb)})}}const x=s.heel*e,M=s.toe*e,X=s.spring*p,N=Math.PI/180,O=(r,S,b,B,o)=>{const n=Math.cos(B*N),g=o?n:Math.sqrt(n),m=o?.5+.5*g:1,w=o?X*(1-g):0;return{...r,z:S,u:S/e,yb:r.yb+w,pts:r.pts.map(f=>({...f,X:b+(f.X-b)*g,Y:r.yb+w+(f.Y-r.yb)*m,h:f.h*m,sole:f.sole*m}))}},U=Y[0],W=Y[Y.length-1],E=v+x,R=e-L+M;for(const r of[35,60,78,90])Y.unshift(O(U,v-E*Math.sin(r*N),a.heelX,r,!1));for(const r of[22,42,60,76,90])Y.push(O(W,L+R*Math.sin(r*N),a.tipX,r,!0));return{F:a,rows:Y,L:e}}function a0(t,l,c,s,a,e,h,p){const i=t.length,u=[0];for(let o=1;o<=i;o++){const n=t[o-1],g=t[o%i];u.push(u[o-1]+Math.hypot(g[0]-n[0],g[1]-n[1]))}const v=u[i],L=o=>{o=(o%v+v)%v;let n=0,g=i;for(;g-n>1;){const F=n+g>>1;u[F]<=o?n=F:g=F}const m=t[n],w=t[(n+1)%i],f=(o-u[n])/Math.max(u[n+1]-u[n],1e-9);return[H(m[0],w[0],f),H(m[1],w[1],f)]},A=(o,n)=>{for(let g=1;g<i/2;g++){const m=n>0?g-1:(i-g+1)%i,w=n>0?g:i-g;if(t[w][1]-c>=o&&t[m][1]-c<o){const f=(o-(t[m][1]-c))/Math.max(t[w][1]-t[m][1],1e-9);return n>0?H(u[m],u[w],f):H(m===0?v:u[m],u[w],f)}}return n>0?u[i/4]:u[3*i/4]},z=u[i/2],Y=A(.02,1),x=Math.max(A(s,1),Y+.02),M=A(.02,-1),X=Math.min(A(s,-1),M-.02),N=t.some(o=>o[1]>=h-1e-4);let O=z-.14*(z-x),U=z+.14*(X-z);if(N){for(let o=1;o<=i/2;o++)if(t[o][1]>=h-1e-4){O=u[o-1]+(u[o]-u[o-1])*Z((h-t[o-1][1])/Math.max(t[o][1]-t[o-1][1],1e-9),0,1);break}for(let o=i-1;o>=i/2;o--)if(t[o][1]>=h-1e-4){const n=(o+1)%i,g=n===0?v:u[n];U=g+(u[o]-g)*Z((h-t[n][1])/Math.max(t[o][1]-t[n][1],1e-9),0,1);break}O=Z(O,x+.08,z-.01),U=Z(U,z+.01,X-.08)}const W=.04,E=[],R=[],r=(o,n)=>{E.push(o),R.push(n)};r(0,0),r(Y/2,0),r(Y,0);for(let o=1;o<=2;o++)r(H(Y,x,o/3),0);r(x,0),r(x+W,1);for(let o=1;o<=5;o++)r(H(x+W,O,o/6),1);r(O,2);for(let o=1;o<=3;o++)r(H(O,U,o/4),N?3:1);r(U,2);for(let o=1;o<=5;o++)r(H(U,X-W,o/6),1);r(X-W,1),r(X,0);for(let o=1;o<=2;o++)r(H(X,M,o/3),0);r(M,0),r((M+v)/2,0);let S=-1/0;const b=E.map((o,n)=>{const[g,m]=L(o);S=Math.max(S,m);const w=o<=z?(z-o)/z:-(o-z)/(v-z);return{X:g,Y:m,a:w,h:m-c,sole:s,lid:R[n]===3?1:0,solePt:R[n]===0}}),B=b.map(()=>[0,0]);for(let o=0;o<E.length;o++){const n=(o+1)%E.length,g=E[o],m=n?E[n]:v,w=b[o],f=b[n],F=f.X-w.X,C=f.Y-w.Y,d=Math.hypot(F,C);if(d<1e-6)continue;const k=C/d,y=-F/d;let K=0;for(let _=0;_<i;_++)u[_]>g&&u[_]<m&&(K=Math.max(K,(t[_][0]-w.X)*k+(t[_][1]-w.Y)*y));if(K>0)for(const _ of[B[o],B[n]])Math.abs(k*K)>Math.abs(_[0])&&(_[0]=k*K),Math.abs(y*K)>Math.abs(_[1])&&(_[1]=y*K)}return b.forEach((o,n)=>{o.X+=B[n][0],o.Y=Math.max(o.Y+B[n][1],0),o.h=o.Y-c}),b.forEach((o,n)=>{if(!o.solePt)return;const g=b[(n+b.length-1)%b.length],m=b[(n+1)%b.length],w=m.X-g.X,f=m.Y-g.Y,F=Math.hypot(w,f)||1;o.X+=p*(f/F)}),{pts:b,cx:l,yb:c,top:S,z:a,u:e}}const l0=(t,l,c,s)=>[t.origin[0]+t.lat[0]*l+t.fwd[0]*s,t.floor+c,t.origin[2]+t.lat[2]*l+t.fwd[2]*s],T=.6,Q=(t,l,c)=>((t+512)*1024+(l+512))*1024+(c+512);function r0(t,l){if(l.grid)return l.grid;const c=t.rest,s=new Map;for(const a of l.leg){const e=a[3],h=Q(Math.floor(c[e*3]/T),Math.floor(c[e*3+1]/T),Math.floor(c[e*3+2]/T));let p=s.get(h);p||s.set(h,p=[]),p.push(e)}return l.grid=s}function h0(t,l,c,s){const a=l.rest,e=[],h=r0(l,c),p=Math.floor(s[0]/T),i=Math.floor(s[1]/T),u=Math.floor(s[2]/T),v=[];for(let x=1;x<=4&&v.length<6;x++){v.length=0;for(let M=p-x;M<=p+x;M++)for(let X=i-x;X<=i+x;X++)for(let N=u-x;N<=u+x;N++){const O=h.get(Q(M,X,N));if(O)for(const U of O)v.push(U)}}for(const x of v.length>=6?v:c.leg.map(M=>M[3])){const M=a[x*3]-s[0],X=a[x*3+1]-s[1],N=a[x*3+2]-s[2],O=M*M+X*X+N*N;(e.length<6||O<e[e.length-1][0])&&(e.push([O,x]),e.sort((U,W)=>U[0]-W[0]),e.length>6&&e.pop())}const L=Math.max(e[0][0],.04)*2,A=new Map;for(const[x,M]of e){const X=Math.exp(-x/L);for(let N=0;N<4;N++){const O=t.skinIdx[M*4+N],U=t.skinW[M*4+N]*X;U>0&&A.set(O,(A.get(O)||0)+U)}}const z=[...A.entries()].sort((x,M)=>M[1]-x[1]).slice(0,4),Y=z.reduce((x,M)=>x+M[1],0)||1;return z.map(([x,M])=>[x,M/Y])}const $=new WeakMap;function x0(t,l,c){const s=D[c];if(!s||!l||!l.rest||!t||!t.wFoot)return null;let a=$.get(l);if(a||$.set(l,a=new Map),a.has(c))return a.get(c);const e=["L","R"].map(E=>n0(t,l,E,s));if(s.slide)for(const E of e)c0(E,s);const h=s.slide?e[0].strap.length*G*2:0,p=e[0].rows.length*28+h,i=p*2,u=new Float32Array(i*3),v=new Float32Array(i*3),L=new Float32Array(i*3),A=new Float32Array(i),z=new Uint8Array(i*4),Y=new Float32Array(i*4),x=new Float32Array(i).fill(-21),M=[],X={feet:[]};e.forEach((E,R)=>{const{F:r,rows:S,L:b}=E,B=R*p,o=(m,w,f,F,C,d,k,y,K)=>{const _=l0(r,w,f,F);u.set(_,m*3),v.set([C,d,k],m*3),L.set([y,K,f],m*3),A[m]=K?.42:1-.3*(1-j(0,.35,f)),h0(t,l,r,_).forEach(([I,V],q)=>{z[m*4+q]=I,Y[m*4+q]=V})};if(S.forEach((m,w)=>m.pts.forEach((f,F)=>o(B+w*28+F,f.X,f.Y,m.z,f.a,f.h,m.z/b,f.sole,f.lid))),E.strap){const m=B+S.length*28,w=E.strap.length,f=(d,k,y)=>m+(y?w*G:0)+d*G+k;E.strap.forEach((d,k)=>d.forEach((y,K)=>{o(f(k,K,0),y.X,y.Y,y.Z,y.a,y.h,y.Z/b,y.sole,0),o(f(k,K,1),y.iX,y.iY,y.Z,y.a,y.h,y.Z/b,y.sole,1)}));const F=r.side==="R",C=(d,k,y)=>F?M.push(d,y,k):M.push(d,k,y);for(let d=0;d+1<w;d++)for(let k=0;k+1<G;k++)C(f(d,k,0),f(d+1,k,0),f(d,k+1,0)),C(f(d,k+1,0),f(d+1,k,0),f(d+1,k+1,0)),C(f(d,k,1),f(d,k+1,1),f(d+1,k,1)),C(f(d,k+1,1),f(d+1,k+1,1),f(d+1,k,1));for(const[d,k]of[[0,1],[w-1,-1]])for(let y=0;y+1<G;y++){const K=f(d,y,0),_=f(d,y+1,0),I=f(d,y,1),V=f(d,y+1,1);k>0?(C(K,_,I),C(_,V,I)):(C(K,I,_),C(_,I,V))}}const n=r.side==="R",g=(m,w,f)=>n?M.push(m,f,w):M.push(m,w,f);for(let m=0;m+1<S.length;m++)for(let w=0;w<28;w++){const f=B+m*28+w,F=B+m*28+(w+1)%28,C=B+(m+1)*28+w,d=B+(m+1)*28+(w+1)%28;g(f,C,F),g(F,C,d)}X.feet.push({side:r.side,length:b,ankle:r.ay,rows:S.length,frame:r})});let N=Uint16Array.from(M);if(i0(u,N)<0)for(let E=0;E<N.length;E+=3){const R=N[E+1];N[E+1]=N[E+2],N[E+2]=R}const U=u0(u,N,i),W={n:i,pos:u,nrm:U,canon:v,fab:L,ao:A,joint:z,weight:Y,cav:x,idx:N,info:X,style:c,floor:(e[0].F.floor+e[1].F.floor)/2};return a.set(c,W),W}const G=19,P=.1;function c0(t,l){const{rows:c}=t,[s,a]=l.slide,e=[];for(const h of c.filter(p=>p.u>=s&&p.u<=a)){const p=[];for(let i=5;i<=23;i++){const u=h.pts[i],v=h.pts[i-1],L=h.pts[i+1],A=L.X-v.X,z=L.Y-v.Y,Y=Math.hypot(A,z)||1,x=z/Y,M=-A/Y,X=i<=6||i>=22?-.08:0;p.push({X:u.X,Y:u.Y+X,iX:u.X-x*P,iY:u.Y+X-M*P,Z:h.z,a:u.a,h:u.h+X,sole:u.sole})}e.push(p)}for(const h of c)for(const p of h.pts){const i=h.yb+p.sole;p.Y>i&&(p.Y=i,p.h=i-h.yb-.002,p.lid=0)}t.strap=e}function i0(t,l){let c=0;for(let s=0;s<l.length;s+=3){const a=l[s]*3,e=l[s+1]*3,h=l[s+2]*3;c+=t[a]*(t[e+1]*t[h+2]-t[e+2]*t[h+1])-t[a+1]*(t[e]*t[h+2]-t[e+2]*t[h])+t[a+2]*(t[e]*t[h+1]-t[e+1]*t[h])}return c/6}function u0(t,l,c){const s=new Float32Array(c*3);for(let a=0;a<l.length;a+=3){const e=l[a]*3,h=l[a+1]*3,p=l[a+2]*3,i=t[h]-t[e],u=t[h+1]-t[e+1],v=t[h+2]-t[e+2],L=t[p]-t[e],A=t[p+1]-t[e+1],z=t[p+2]-t[e+2],Y=u*z-v*A,x=v*L-i*z,M=i*A-u*L;for(const X of[e,h,p])s[X]+=Y,s[X+1]+=x,s[X+2]+=M}for(let a=0;a<c;a++){const e=Math.hypot(s[a*3],s[a*3+1],s[a*3+2])||1;s[a*3]/=e,s[a*3+1]/=e,s[a*3+2]/=e}return s}function b0(t,l,c){if(!t||!l||t.n!==l.n)return c<.5?t:l;if(c<=0)return t;if(c>=1)return l;const s=(h,p)=>{const i=new Float32Array(h.length);for(let u=0;u<i.length;u++)i[u]=h[u]+(p[u]-h[u])*c;return i},a=s(t.nrm,l.nrm);for(let h=0;h<a.length;h+=3){const p=Math.hypot(a[h],a[h+1],a[h+2])||1;a[h]/=p,a[h+1]/=p,a[h+2]/=p}return{...c<.5?t:l,pos:s(t.pos,l.pos),nrm:a,canon:s(t.canon,l.canon),fab:s(t.fab,l.fab),ao:s(t.ao,l.ao),floor:H(t.floor,l.floor,c)}}const w0=`
uniform vec4 uShoeK;     // v7 shoes: x style (0 barefoot … 12), y foot length (in), z the feet's floor in the bind pose (in)
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
`,S0=`
uniform vec4 uShoeK;
uniform vec3 uShoeU, uShoeS, uShoeO, uShoeA, uShoeL;
float sBand(float x, float a, float b, float w){ return smoothstep(a - w, a + w, x) * (1.0 - smoothstep(b - w, b + w, x)); }
void shoeMat(inout vec3 base, inout float rough, inout float f0s, inout vec3 N, inout float occK){
  float code = uShoeK.x, L = max(uShoeK.y, 6.0);
  float a = vC.x, h = vC.y, u = vC.z, sole = vFabN.x, lid = vFabN.y, ab = abs(a), zi = u * L;
  float w = 0.012 + 0.6 * max(fwidth(h), fwidth(zi) * 0.5);   // (edges a pixel wide at any size)
  float up = smoothstep(sole - w, sole + w, h);               // 1 on the upper, 0 on the sole
  float rubH = code > 7.5 && code < 8.5 ? 0.17 : code > 9.5 && code < 10.5 ? 0.16 : 0.075;   // (trail: lugs; minimalist: all rubber)
  float rub = 1.0 - smoothstep(rubH - w, rubH + w, h);        // the outsole's rubber
  vec3 c = mix(mix(uShoeS, uShoeO, rub), uShoeU, up);
  rough = mix(mix(0.62, 0.8, rub), 0.72, up); f0s = 0.04; occK = 1.0;
  float side = sBand(ab, 0.24, 0.86, 0.03);                   // the side panels (not the top, not under)
  float lace = (1.0 - smoothstep(0.19 - 0.02, 0.19 + 0.02, ab)) * up;
  float l0 = 0.4, l1 = 0.71;
  if (code > 2.5 && code < 3.5) { l0 = 0.42; l1 = 0.66; }
  float lzi = zi;
  if (code > 10.5 && code < 11.5) { l0 = 0.2; lzi = zi - 0.85 * max(h - 2.2, 0.0); }   // a high-top laces up the shaft
  float lz = sBand(u, l0, l1, 0.008);
  float bar = sBand(fract(lzi / 0.42), 0.12, 0.42, 0.04);     // laces across the tongue, 0.42 in apart
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
  } else if (code > 7.5) {   // v5/look-hair: trail (8), max-cushion (9), minimalist (10), high-top (11), slides (12)
    if (code < 8.5) {        // trail: lugs on the outsole's walls, a toe bumper, a welded cage over a tight mesh
      float lug = sBand(fract(zi / 0.38 + (a > 0.0 ? 0.0 : 0.5)), 0.15, 0.62, 0.05) * rub;
      c = mix(c, uShoeO * 0.6, rub * (1.0 - lug) * 0.85);   // (the gaps between the lugs in shade)
      N = normalize(mix(N, bumpN(N, vW, lug * 0.012), rub));
      float wrap = (1.0 - smoothstep(sole + 0.36 - w, sole + 0.36 + w, h)) * up;
      c = mix(c, uShoeO, wrap * smoothstep(0.84, 0.88, u));                                         // the toe bumper
      float cage = side * up * sBand(h - sole, 0.1, 0.9, w) * smoothstep(0.2, 0.26, u) * (1.0 - smoothstep(0.7, 0.76, u));
      c = mix(c, uShoeU * 0.62, cage * smoothstep(0.35, 0.55, abs(fract(zi * 0.9 + (h - sole) * 1.1) - 0.5) * 2.0));
      c = mix(c, uShoeA, up * (1.0 - smoothstep(0.18, 0.2, u)) * smoothstep(sole + 0.05, sole + 0.1, h) * 0.9);   // the heel counter
      N = normalize(mix(N, bumpN(N, vW, fine * 0.003), up));
      rough = mix(rough, 0.86, rub);
    } else if (code < 9.5) { // max-cushion: a tall rocker midsole, its sidewall sculpted; a padded collar and a pull tab
      c = mix(c, uShoeS * 0.86, (1.0 - up) * (1.0 - rub) * side * sBand(h, sole * 0.38, sole * 0.38 + 0.05, w));
      c = mix(c, uShoeA, (1.0 - up) * (1.0 - rub) * side * sBand(h, sole * 0.62, sole * 0.62 + 0.1, w) * sBand(u, 0.08, 0.5, 0.04));   // an accent wave on the foam
      c = mix(c, uShoeA, up * (1.0 - smoothstep(0.06, 0.08, u)) * smoothstep(sole + 0.3, sole + 0.4, h));   // the pull tab
      N = normalize(mix(N, bumpN(N, vW, fine * 0.004), up));
    } else if (code < 10.5) { // minimalist: the rubber sole wraps up the sides; a fine knit; a toe guard
      c = mix(c, uShoeO, up * (1.0 - smoothstep(sole + 0.12 - w, sole + 0.12 + w, h)));
      c = mix(c, uShoeA, up * smoothstep(0.88, 0.92, u) * (1.0 - smoothstep(sole + 0.4, sole + 0.46, h)));
      N = normalize(mix(N, bumpN(N, vW, sin(zi * 80.0) * sin(h * 80.0 + a * 12.0) * 0.003), up));
      rough = mix(rough, 0.82, up);
    } else if (code < 11.5) { // high-top: canvas over a cupsole with a pinstripe, a rubber toe cap, an ankle patch inside
      c = mix(c, uShoeA, (1.0 - up) * sBand(h, sole * 0.55, sole * 0.55 + 0.05, w));
      c = mix(c, uShoeS, up * smoothstep(0.855, 0.875, u) * (1.0 - smoothstep(sole + 0.45, sole + 0.5, h)));
      float patchD = length(vec2((zi - 0.32 * L) / 1.0, (h - 2.6) / 1.0));
      c = mix(c, uShoeS, up * step(a, -0.35) * (1.0 - smoothstep(0.72, 0.78, patchD)));                // the ankle patch
      c = mix(c, uShoeA, up * step(a, -0.35) * sBand(patchD, 0.5, 0.56, 0.02));
      rough = mix(rough, 0.86, up);
      N = normalize(mix(N, bumpN(N, vW, sin(zi * 70.0) * sin(h * 70.0) * 0.003), up));
      c = mix(c, uShoeU * 0.7, up * sBand(ab, 0.19, 0.235, 0.012) * sBand(u, 0.2, 0.4, 0.01));        // eyelets up the shaft
    } else {                 // slides: moulded foam; the footbed's toe grip; an embossed band across the strap
      float bed = 1.0 - up;
      c = mix(c, uShoeS * (0.9 + 0.1 * sin(zi * 18.0) * sin(a * 40.0)), bed * smoothstep(0.7, 0.75, u) * step(sole - 0.01, h));
      c = mix(c, uShoeA, up * sBand(u, 0.5, 0.56, 0.006) * (1.0 - smoothstep(0.55, 0.62, ab)));
      rough = mix(rough, 0.55, up);
    }
    if (code > 11.5) lz = 0.0;   // (slides: no laces)
  } else if (code > 5.5) {   // v5/airport-outfit: oxford (6) and loafer (7), polished leather
    rough = mix(rough, 0.3, up); f0s = mix(0.04, 0.055, up);
    float top = 1.0 - smoothstep(0.72, 0.8, ab);                                                    // over the top of the foot
    float sw = 0.006 + 0.6 * fwidth(u);
    c = mix(c, uShoeO * 1.25, (1.0 - up) * (1.0 - rub) * smoothstep(0.3, 0.36, u));                 // the forefoot's welt edge
    if (code < 6.5) {
      c = mix(c, uShoeU * 0.55, up * top * sBand(u, 0.805, 0.812, sw));                             // the toe cap's seam
      c = mix(c, uShoeU * 0.55, up * top * sBand(u - 0.06 * ab, 0.47, 0.477, sw) * smoothstep(0.08, 0.14, ab));   // the vamp over the quarters
      float lc = up * (1.0 - smoothstep(0.085, 0.11, ab)) * sBand(u, 0.5, 0.68, 0.006);            // the closed lacing
      c = mix(c, uShoeU * 0.6, lc);
      c = mix(c, uShoeL * 1.4, lc * sBand(fract(zi / 0.3), 0.15, 0.45, 0.05));                    // laces, 0.3 in apart
    } else {
      float ap = length(vec2(a / 0.5, (u - 0.8) / 0.17));
      c = mix(c, uShoeU * 0.5, up * smoothstep(0.62, 0.66, u) * sBand(ap, 0.985, 1.0, 0.012));        // the moc-toe apron
      float strap = up * top * sBand(u, 0.5, 0.57, 0.006);
      c = mix(c, uShoeA, strap);
      c = mix(c, c * 0.45, strap * sBand(a, -0.13, 0.13, 0.015) * sBand(u, 0.515, 0.555, 0.004));   // the strap's slot
    }
    lz = 0.0;
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
`;export{S0 as SHOE_FRAG_GLSL,f0 as SHOE_ID,D as SHOE_SHAPE,w0 as SHOE_VERT_GLSL,b0 as blendShoes,J as capAt,s0 as shoeFrame,x0 as shoeGeometry};
