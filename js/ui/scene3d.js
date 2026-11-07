import{CLEAR as M0,sceneId as U,FIXTURES as W,TREADMILL as g0}from"../data/scenes.js";import{TRACK as _,IN_M as G,pathAt as k0,lapSpot as q0,stagger400 as L0,measureOff as A0,pathRadius as R0,FIELD as X}from"./trackpath.js";import{trapBarGeometry as z0,barbellGeometry as S0,benchGeometry as E0,kettlebellGeometry as F0,pullupBarGeometry as P0,KETTLEBELLS as Q,PULLUP_BAR as T0}from"./props.js";const B={PLAIN:0,FLOOR:1,EMIT:2,BLINDS:3,GLASS:4,TILES:5,DOOR:6,STRIPES:7,MIRROR:8,BELT:9,SEATS:10,NET:11},I0=[0,0,0,1],j={NONE:0,TREADMILL:1,BAR:2},d=e=>{const a=parseInt(e.slice(1),16);return[a>>16&255,a>>8&255,a&255].map(t=>(t/=255,t<=.04045?t/12.92:Math.pow((t+.055)/1.055,2.4)))},f0=e=>()=>(e=e*1664525+1013904223>>>0,e/4294967296);function O(e,a){return[e[0]-a[0],e[1]-a[1],e[2]-a[2]]}function V(e,a){return[e[1]*a[2]-e[2]*a[1],e[2]*a[0]-e[0]*a[2],e[0]*a[1]-e[1]*a[0]]}function Z(e,a){return e[0]*a[0]+e[1]*a[1]+e[2]*a[2]}function Y(e){const a=Math.hypot(e[0],e[1],e[2])||1;return[e[0]/a,e[1]/a,e[2]/a]}function J(){const e=[],a=[],t=[],r=[],h=[],i=[],u=[];let w={r:0,t:[0,0,0]},y=I0,M=0;const q=(s,m)=>{const c=Math.cos(m),o=Math.sin(m);return[s[0]*c+s[2]*o,s[1],-s[0]*o+s[2]*c]},b=s=>{const m=q(s,w.r);return[m[0]+w.t[0],m[1]+w.t[1],m[2]+w.t[2]]},f=(s,m,c,o)=>(e.push(...b(s)),a.push(...q(m,w.r)),t.push(...c),r.push(o[0],o[1],M),h.push(...y),e.length/3-1),g={at(s,m,c){const o=w;w={r:o.r+m,t:b(s)};try{c()}finally{w=o}return g},wall(s,m){const c=y;y=s;try{m()}finally{y=c}return g},piece(s){const m=e.length/3;s();const c=e.length/3;let o=null;for(let p=0;p<360;p++){const k=p/360*Math.PI*2,x=Math.cos(k),l=Math.sin(k);let v=-1/0;for(let A=m;A<c;A++)v=Math.max(v,x*e[A*3]+l*e[A*3+2]);(!o||-v>o[3])&&(o=[x,0,l,-v])}if(o)for(let p=m;p<c;p++)for(let k=0;k<4;k++)h[p*4+k]=o[k];return g},fixture(s,m){const c=M;M=s;try{m()}finally{M=c}return g},tri(s,m,c,o,p,k){Z(V(O(m,s),O(c,s)),o)<0&&([m,c]=[c,m]);const x=f(s,o,p,k);return f(m,o,p,k),f(c,o,p,k),i.push(x,x+1,x+2),g},quad(s,m,c,o,p,k,x){Z(V(O(m,s),O(c,s)),p)<0&&([s,m,c,o]=[o,c,m,s]);const l=f(s,p,k,x);return f(m,p,k,x),f(c,p,k,x),f(o,p,k,x),i.push(l,l+1,l+2,l,l+2,l+3),g},box(s,m,c,o,p,k,x,l=[0,0],v=""){const A=[["+x",[1,0,0],[[m,c,p],[m,o,p],[m,o,k],[m,c,k]]],["-x",[-1,0,0],[[s,c,p],[s,c,k],[s,o,k],[s,o,p]]],["+y",[0,1,0],[[s,o,p],[s,o,k],[m,o,k],[m,o,p]]],["-y",[0,-1,0],[[s,c,p],[m,c,p],[m,c,k],[s,c,k]]],["+z",[0,0,1],[[s,c,k],[m,c,k],[m,o,k],[s,o,k]]],["-z",[0,0,-1],[[s,c,p],[s,o,p],[m,o,p],[m,c,p]]]];for(const[L,E,z]of A)v.includes(L)||g.quad(...z,E,x,l);return g},cyl(s,m,c,o,p=[0,0],{segs:k=16,rb:x=c,caps:l=!0}={}){const v=Y(O(m,s)),A=Math.abs(v[1])<.9?[0,1,0]:[1,0,0],L=Y(V(v,A)),E=V(v,L),z=(S,F,R)=>{const P=R/k*Math.PI*2,I=[L[0]*Math.cos(P)+E[0]*Math.sin(P),L[1]*Math.cos(P)+E[1]*Math.sin(P),L[2]*Math.cos(P)+E[2]*Math.sin(P)];return[[S[0]+I[0]*F,S[1]+I[1]*F,S[2]+I[2]*F],I]};for(let S=0;S<k;S++){const[F,R]=z(s,c,S),[P,I]=z(s,c,S+1),[D]=z(m,x,S),[K]=z(m,x,S+1),N=e.length/3,v0=Y([R[0]+I[0],R[1]+I[1],R[2]+I[2]]),w0=Z(V(O(P,F),O(K,F)),v0)<0;f(F,R,o,p),f(P,I,o,p),f(K,I,o,p),f(D,R,o,p),w0?i.push(N,N+2,N+1,N,N+3,N+2):i.push(N,N+1,N+2,N,N+2,N+3),l&&(g.tri(s,P,F,[-v[0],-v[1],-v[2]],o,p),g.tri(m,D,K,v,o,p))}return g},blob(s,m,c,o,p,k=[0,0],{lat:x=5,lon:l=8}={}){const v=(S,F)=>{const R=S/x*Math.PI,P=F/l*Math.PI*2,I=[Math.sin(R)*Math.cos(P),Math.cos(R),Math.sin(R)*Math.sin(P)];return[[s[0]+I[0]*m,s[1]+I[1]*c,s[2]+I[2]*o],Y([I[0]/m,I[1]/c,I[2]/o])]},A=e.length/3,L=[];for(let S=0;S<=x;S++)for(let F=0;F<=l;F++){const[R,P]=v(S,F);L.push([R,P]),f(R,P,p,k)}const E=(S,F)=>S*(l+1)+F,z=(S,F,R)=>{const P=L[S],I=L[F],D=L[R],K=V(O(I[0],P[0]),O(D[0],P[0]));Math.hypot(...K)<1e-6||(Z(K,[P[1][0]+I[1][0]+D[1][0],P[1][1]+I[1][1]+D[1][1],P[1][2]+I[1][2]+D[1][2]])<0&&([F,R]=[R,F]),i.push(A+S,A+F,A+R))};for(let S=0;S<x;S++)for(let F=0;F<l;F++)z(E(S,F),E(S+1,F),E(S+1,F+1)),z(E(S,F),E(S+1,F+1),E(S,F+1));return g},poly(s,m,c,o=[0,0]){const p=s.map(L=>[L[0],L[1]]);p.reduce((L,E,z)=>L+(p[(z+1)%p.length][0]-E[0])*(p[(z+1)%p.length][1]+E[1]),0)>0&&p.reverse();const x=p.map((L,E)=>E),l=(L,E,z)=>(E[0]-L[0])*(z[1]-L[1])-(E[1]-L[1])*(z[0]-L[0]),v=(L,E,z,S)=>l(E,z,L)>0&&l(z,S,L)>0&&l(S,E,L)>0;let A=0;for(;x.length>3&&A++<5e3;)for(let L=0;L<x.length;L++){const E=x[(L+x.length-1)%x.length],z=x[L],S=x[(L+1)%x.length],F=p[E],R=p[z],P=p[S];if(!(l(F,R,P)<=1e-9)&&!x.some(I=>I!==E&&I!==z&&I!==S&&v(p[I],F,R,P))){g.tri([F[0],F[1],m],[R[0],R[1],m],[P[0],P[1],m],[0,0,1],c,o),x.splice(L,1);break}}return x.length===3&&g.tri(...x.map(L=>[p[L][0],p[L][1],m]),[0,0,1],c,o),g},geo(s,m,{lift:c=null}={}){let o=1/0;for(let x=0;x<s.n;x++)o=Math.min(o,s.pos[x*3+1]);const p=c==null?0:c-o,k=e.length/3;for(let x=0;x<s.n;x++){const[l,v]=m(s.cav[x],s.uv?s.uv[x*3+2]:0);f([s.pos[x*3],s.pos[x*3+1]+p,s.pos[x*3+2]],[s.nrm[x*3],s.nrm[x*3+1],s.nrm[x*3+2]],l,v)}for(let x=0;x<s.idx.length;x++)i.push(k+s.idx[x]);return g},shadow(s,m,c,o,p=.5){const k=[[s,0,c],[m,0,c],[m,0,o],[s,0,o]].map(b);return u.push([Math.min(...k.map(x=>x[0])),Math.min(...k.map(x=>x[2])),Math.max(...k.map(x=>x[0])),Math.max(...k.map(x=>x[2])),p]),g},out(){return{n:e.length/3,pos:new Float32Array(e),nrm:new Float32Array(a),col:new Float32Array(t),mat:new Float32Array(r),cut:new Float32Array(h),idx:new Uint32Array(i),shadows:u}}};return g}const T={black:d("#1b1c1f"),chrome:d("#b9bcc0"),iron:d("#16171a"),vinyl:d("#121214"),knurl:d("#7d8086")},H=(e=T.black)=>(a,t)=>a===-16?[T.chrome,[0,.8]]:a===-17?[T.iron,[0,.3]]:a===-18?[e,[0,.35]]:a===-19?[T.vinyl,[0,.25]]:a===-20?[t>.5?T.knurl:T.chrome,[0,t>.5?.3:.7]]:[e,[0,.3]];function e0(e,a,t,{dia:r=450/25.4,thick:h=3,colour:i=d("#121315")}={}){const u=h/2,w=[a[0]-t[0]*u,a[1]-t[1]*u,a[2]-t[2]*u],y=[a[0]+t[0]*u,a[1]+t[1]*u,a[2]+t[2]*u];e.cyl(w,y,r/2,i,[0,.12],{segs:28});const M=.06,q=[w[0]-t[0]*M,w[1]-t[1]*M,w[2]-t[2]*M],b=[y[0]+t[0]*M,y[1]+t[1]*M,y[2]+t[2]*M];e.cyl(q,b,2.9,T.chrome,[0,.7],{segs:18});const f=.1,g=[w[0]-t[0]*f,w[1]-t[1]*f,w[2]-t[2]*f],s=[y[0]+t[0]*f,y[1]+t[1]*f,y[2]+t[2]*f];e.cyl(g,s,1,d("#050505"),[0,0],{segs:14})}function B0(){const e=[],a=(r,h,i,u=8)=>{for(let w=1;w<=u;w++){const y=w/u,M=1-y;e.push([M*M*r[0]+2*M*y*h[0]+y*y*i[0],M*M*r[1]+2*M*y*h[1]+y*y*i[1]])}},t=(r,h,i,u,w=8)=>{for(let y=1;y<=w;y++){const M=y/w,q=1-M;e.push([0,1].map(b=>q*q*q*r[b]+3*q*q*M*h[b]+3*q*M*M*i[b]+M*M*M*u[b]))}};return e.push([832,446],[356,446]),a([356,446],[258,446],[160,488]),a([160,488],[250,548],[384,566]),t([384,566],[434,576],[462,606],[466,652]),e.push([466,694]),t([466,694],[466,730],[422,748],[356,768]),e.push([356,820],[790,820],[790,768]),t([790,768],[724,748],[680,730],[680,694]),e.push([680,652]),t([680,652],[684,606],[718,576],[770,568]),e.push([832,568]),e}const C0=[[[500,405],[467,377],[374,359],[457,406]],[[535,367],[511,309],[411,209],[484,330]],[[581,348],[592,275],[556,110],[554,279]],[[629,357],[672,308],[722,168],[642,293]],[[671,387],[716,377],[794,311],[700,352]]];function N0(e,a,t,r,h){const i=h/700,u=w=>[a+(w[0]-496)*i,t-(w[1]-465)*i];e.poly(B0().map(u),r,d("#ff6b3d"),[0,.2]);for(const w of C0)e.poly(w.map(u),r,d("#fff4dc"),[0,.1])}function i0(e,a,t,r){return{back:[0,0,1,-a],front:[0,0,-1,t],left:[1,0,0,e],right:[-1,0,0,e],ceil:[0,-1,0,r]}}const C=(e,a)=>[e[0],e[1],e[2],e[3]-a],l0=21,_0=[[12,-68,1.5],[12.6,-67.6,4.5],[11.5,-68.3,7.5]],t0=1.6;function h0(e){const a=g0,t=d("#8c9096"),r=d("#1c1d20"),h=d("#0b0b0c"),i=a.beltW/2,u=i+4.5,[w,y]=a.beltZ,[M,q]=a.hoodZ,b=a.beltTop;e.box(-u,u,.8,b-.6,w-4,M,r,[0,.3]);for(const o of[-1,1])e.box(o*u-1.5,o*u+1.5,0,.8,w-4,w-1,r,[0,.3],"-y");for(const o of[-1,1])e.box(o*u-1.5,o*u+1.5,0,.8,q-4,q-1,r,[0,.3],"-y");e.quad([-i,b,w],[i,b,w],[i,b,y],[-i,b,y],[0,1,0],h,[B.BELT,.12]);for(const o of[-1,1])e.box(o>0?i+.2:-u,o>0?u:-i-.2,b-.6,b+.4,w,M,d("#3a3c40"),[0,.25]);e.box(-u,u,.8,b+.3,w-4,w,d("#2a2b2e"),[0,.35]),e.box(-u,u,.8,b+5,M,q,r,[0,.4]),e.box(-u+1,u-1,b+5,b+5.4,M+1,q-1,d("#2b2d31"),[0,.5]);const[f,g]=a.consoleZ,[s,m]=a.consoleY,c=u-1;for(const o of[-1,1])e.cyl([o*c,b+4,M+5],[o*c,s-1,f+2],1.3,t,[0,.6],{segs:12}),e.cyl([o*a.railX,a.railY,f+1],[o*a.railX,a.railY,a.railZ[0]],.9,d("#222326"),[0,.3],{segs:12}),e.cyl([o*a.railX,a.railY,f+1],[o*c,a.railY-6,f-1],.8,t,[0,.6],{segs:10});e.box(-u,u,s,m,f,g,r,[0,.4]),e.box(-9,9,s+2,m-1.5,f-.2,f,d("#1d2731"),[B.GLASS,.85]),e.box(-u+2,u-2,s-3,s,f-6,f,r,[0,.35]),e.shadow(-u-1,u+1,w-5,g+1,.5)}function O0(){const e=J(),a=f0(7),t=90,r=-112,h=84,i=120,u=128,w=d("#cfcfcb"),y=d("#ecebe6"),M=d("#efeeea"),q=i0(t,r,h,i);e.quad([-800,0,-800],[800,0,-800],[800,0,800],[-800,0,800],[0,1,0],d("#4a2c1a"),[B.FLOOR,.45]),e.wall(C(q.back,t0),()=>{e.quad([-t,0,r],[t,0,r],[t,i,r],[-t,i,r],[0,0,1],w,[0,.05]),e.box(-t,t,0,5,r,r+.7,y,[0,.2],"-y-z"),e.box(-t,t,i-6,i,r,r+1.5,y,[0,.15],"+y-z")}),e.wall(C(q.front,t0),()=>{e.quad([-t,0,h],[t,0,h],[t,i,h],[-t,i,h],[0,0,-1],w,[0,.05]),e.box(-t,t,0,5,h-.7,h,y,[0,.2],"-y+z"),e.box(-t,t,i-6,i,h-1.5,h,y,[0,.15],"+y+z")});for(const c of[-1,1])e.wall(C(c<0?q.left:q.right,t0),()=>{e.quad([c*t,0,r],[c*t,0,h],[c*t,i,h],[c*t,i,r],[-c,0,0],w,[0,.05]),e.box(c>0?t-.7:-t,c>0?t:-t+.7,0,5,r,h,y,[0,.2],"-y"),e.box(c>0?t-1.5:-t,c>0?t:-t+1.5,i-6,i,r,h,y,[0,.15],"+y")});const b=t-18,f=r+18,g=h-18;e.wall(q.ceil,()=>{e.quad([-t,i,r],[t,i,r],[t,i,f],[-t,i,f],[0,-1,0],M,[0,0]),e.quad([-t,i,g],[t,i,g],[t,i,h],[-t,i,h],[0,-1,0],M,[0,0]);for(const c of[-1,1])e.quad([c*t,i,f],[c*b,i,f],[c*b,i,g],[c*t,i,g],[0,-1,0],M,[0,0]);e.quad([-b,i,f],[b,i,f],[b,u,f],[-b,u,f],[0,0,1],M,[0,0]);for(const c of[-1,1])e.quad([c*b,i,f],[c*b,i,g],[c*b,u,g],[c*b,u,f],[-c,0,0],M,[0,0]);e.quad([-b,u,f],[b,u,f],[b,u,g],[-b,u,g],[0,-1,0],M,[0,0]);for(const[c,o]of[[-40,-78],[40,-78],[-40,0],[40,0]])e.cyl([c,u-.05,o],[c,u-.3,o],3,d("#fff1d6").map(p=>p*6),[B.EMIT,0],{segs:16})}),e.piece(()=>e.at([0,0,-86],0,()=>{e.cyl([0,u,0],[0,114,0],.5,T.black,[0,.4],{segs:8}),e.cyl([0,114,0],[0,108,0],5.5,T.black,[0,.5],{segs:20,rb:4.5}),e.cyl([0,108,0],[0,103,0],4.5,d("#f4efe3").map(c=>c*1.6),[B.EMIT,0],{segs:20,rb:2.5});for(let c=0;c<5;c++)e.at([0,0,0],c/5*Math.PI*2+.3,()=>{e.box(5,25,110.5,111,-2.6,2.6,T.black,[0,.35]),e.box(3,6,110,111.2,-.8,.8,T.black,[0,.5])})})),e.wall(C(q.left,2.2),()=>e.at([-t+.6,0,-38],0,()=>{e.box(0,1.2,27,30,-29,29,y,[0,.2]),e.quad([.3,30,-26],[.3,30,26],[.3,88,26],[.3,88,-26],[1,0,0],d("#f1f0ea"),[B.BLINDS,.1]);const l=[...Array(17)].map((v,A)=>{const L=Math.PI*A/16;return[.3,88+Math.sin(L)*26,-Math.cos(L)*26]});for(let v=0;v<16;v++)e.tri([.3,88,0],l[v],l[v+1],[1,0,0],d("#1c2430"),[B.GLASS,.9]);for(const v of[-26-1.5,26+1.5])e.box(0,1.5,30,88,v-1.5,v+1.5,y,[0,.2]);for(let v=0;v<16;v++){const A=l[v],L=l[v+1],E=(A[2]+L[2])/2*1.08,z=88+((A[1]+L[1])/2-88)*1.08;e.box(0,1.5,z-1.4,z+1.4,E-1.4,E+1.4,y,[0,.2])}})),e.wall(C(q.right,2.2),()=>e.at([t-.6,0,48],0,()=>{for(const[c,o]of[[-26,-1],[1,26]]){e.box(-1.5,0,0,96,c,o,y,[0,.2],"-y");for(let p=0;p<5;p++)for(const[k,x]of[[c+3,(c+o)/2-.7],[(c+o)/2+.7,o-3]])e.quad([-1.6,8+p*17.4,k],[-1.6,8+p*17.4,x],[-1.6,23.6+p*17.4,x],[-1.6,23.6+p*17.4,k],[-1,0,0],d("#2a3240"),[B.GLASS,.9])}})),e.piece(()=>e.at([t,0,-52],0,()=>{const l=Y([-65,7,0]),v=(A,L)=>[-8+7*A,65*A,L];e.quad(v(.03,-11+1.6),v(.03,11-1.6),v(.97,11-1.6),v(.97,-11+1.6),l,d("#4a5560"),[B.MIRROR,1]);for(const[A,L,E,z]of[[0,.03,-11,11],[.97,1,-11,11],[0,1,-11,-11+1.6],[0,1,11-1.6,11]])e.quad(v(A,E),v(A,z),v(L,z),v(L,E),l,T.black,[0,.3]);e.shadow(-10,-1,-11,11,.35)}));const s=r+.05;e.wall(C(q.back,6),()=>{e.box(-30,30,72,108,s,s+.25,d("#1f2c52"),[0,.08]),e.cyl([-31,108.4,s+.6],[31,108.4,s+.6],.35,T.black,[0,.5],{segs:8}),N0(e,0,90,s+.3,20),e.box(-24,24,53,54.2,s,s+5,d("#141416"),[0,.3]);const c=(k,x,l)=>e.at([k,54.2,s+2.6],0,()=>{x==="cup"?(e.box(-1.3,1.3,0,1.4,-1.3,1.3,d("#18181a"),[0,.5]),e.cyl([0,1.4,0],[0,l-2.6,0],.3,d("#c9a64a"),[0,.8],{segs:8}),e.cyl([0,l-2.6,0],[0,l,0],.5,d("#d4b25a"),[0,.85],{segs:14,rb:1.5})):x==="glass"?e.box(-1.6,1.6,0,l,-.5,.5,d("#b8cfd8"),[B.GLASS,.9]):(e.box(-2,2,0,l,-.4,.4,d("#4a2e1c"),[0,.4]),e.box(-1.4,1.4,l*.25,l*.8,.4,.5,d("#c8a650"),[0,.85]))});[[-20,"glass",6.5],[-13,"plaque",5.5],[-6,"cup",7.5],[0,"plaque",6.5],[6,"glass",5.5],[13,"cup",6],[20,"plaque",5]].forEach(k=>c(...k)),e.box(-23,23,49.5,51,s,s+.5,d("#141416"),[0,.4]);const o=["#c8102e","#1d4fa3","#f2c230","#2c9a5a","#e26a2c","#6b3fa0","#14a3b5","#e8e8e8","#d0407a","#16224a","#8cc63f","#ff8a00"].map(d),p=[[d("#d4af37"),.85],[d("#c0c0c4"),.85],[d("#b07a45"),.8],[d("#d9b54a"),.7],[d("#8a8f96"),.6]];for(let k=0;k<25;k++){const x=-21.5+k*1.7916666666666667+(a()-.5)*.5,l=9+a()*4,v=1.25+a()*.7,A=s+.55+k%3*.12+a()*.05,L=o[Math.floor(a()*o.length)],E=o[Math.floor(a()*o.length)],z=.75;e.quad([x-z,50,A],[x,50,A],[x,50-l,A],[x-z,50-l,A],[0,0,1],L,[0,.15]),e.quad([x,50,A],[x+z,50,A],[x+z,50-l,A],[x,50-l,A],[0,0,1],E,[0,.15]);const[S,F]=p[Math.floor(a()*p.length)],R=50-l-v*.9;e.cyl([x,R,A+.02],[x,R,A+.3],v,S,[0,F],{segs:18}),a()<.5&&e.cyl([x,R,A+.3],[x,R,A+.34],v*.62,o[Math.floor(a()*o.length)],[0,.3],{segs:18})}for(const k of[-1,1]){const x=k<0?-64:28,l=k<0?-28:64;e.box(x,l,38,54,s,s+.9,d("#111113"),[0,.3],"-z"),e.quad([x+.8,38.8,s+.92],[l-.8,38.8,s+.92],[l-.8,53.2,s+.92],[x+.8,53.2,s+.92],[0,0,1],d("#151517"),[B.TILES,.3])}for(const[k,x]of[[-80,60],[-80,46],[78,60]])e.box(k-4.5,k+4.5,x-6,x+6,s,s+.7,d("#111113"),[0,.3],"-z"),e.quad([k-3.6,x-5.1,s+.72],[k+3.6,x-5.1,s+.72],[k+3.6,x+5.1,s+.72],[k-3.6,x+5.1,s+.72],[0,0,1],d("#f3f1ea"),[0,.2]),e.cyl([k+1.8,x-3,s+.73],[k+1.8,x-3,s+.78],.8,d("#c8a650"),[0,.8],{segs:12})}),e.piece(()=>e.at([-8,0,-90],0,()=>{for(const c of[-1,1])e.at([c*7,0,0],0,()=>{e.cyl([0,0,0],[0,26,0],.9,T.black,[0,.4],{segs:10});for(const[o,p]of[[9,0],[-9,0],[0,9],[0,-9]])e.cyl([0,2.5,0],[o*.7,.6,p],.6,T.black,[0,.4],{segs:8});e.box(-4.5,4.5,25,27,-8,8,T.black,[0,.35]);for(const o of[-1,1]){e.box(-4,4,27,35.5,o*8.5-1.2,o*8.5+1.2,d("#202124"),[0,.35]);for(let p=0;p<4;p++)e.box(-3.7,3.7,27.2,35.2,o*(6.9-p*1.25)-.55,o*(6.9-p*1.25)+.55,p%2?d("#2b2c30"):d("#17181b"),[0,.3])}e.cyl([0,31,-2.2],[0,31,2.2],.65,d("#3a3b40"),[0,.4],{segs:10})});e.shadow(-14,14,-10,10,.4)})),e.piece(()=>e.box(14,38,0,30,r+.8,r+20.8,d("#141416"),[0,.2],"-y")),e.shadow(14,38,r+.8,r+20.8,.6);for(const[c,o]of[[50,.14],[68,.1]]){const p=8.858267716535433,k=p*Math.cos(o),x=r+1.6+p*Math.sin(o);e.piece(()=>e0(e,[c,k,x],[0,Math.sin(o),-Math.cos(o)].map(l=>-l))),e.shadow(c-p,c+p,r,r+6,.45)}e.piece(()=>{for(const[c,o,p]of _0)e0(e,[c,p,o],[0,1,0])}),e.shadow(3,21,-77,-59,.6),e.piece(()=>e.at([30,0,h-15.5],0,()=>e.geo(z0({lb:60}),H(d("#151517")),{lift:0}))),e.at([30,0,h-15.5],0,()=>e.shadow(-44,44,-14,14,.3));const m=W.homegym;return e.fixture(j.TREADMILL,()=>e.piece(()=>e.at(m.treadmill.at,m.treadmill.yaw,()=>h0(e)))),e.fixture(j.BAR,()=>e.wall(C(q.right,l0+1),()=>e.at(m.bar.at,m.bar.yaw,()=>e.geo(P0({heightIn:m.bar.heightIn,mount:"wall",wallZ:-l0}),H())))),e.wall(C(q.front,2.5),()=>e.at([-44,0,h],Math.PI,()=>{e.box(-19.5,19.5,0,84.5,-.6,0,y,[0,.2],"-y-z"),e.box(-16,16,0,80,-1.4,-.6,d("#f2f1ec"),[0,.25],"-y-z");for(const[c,o,p,k]of[[-12,-1.5,52,76],[1.5,12,52,76],[-12,-1.5,30,48],[1.5,12,30,48],[-12,-1.5,5,26],[1.5,12,5,26]])e.box(c,o,p,k,-1.7,-1.4,d("#e9e8e2"),[0,.3],"+z");e.cyl([-12.5,36,-1.4],[-12.5,36,-2.6],.35,T.chrome,[0,.7],{segs:10}),e.cyl([-12.5,36,-2.6],[-12.5,36,-3.2],1.1,T.chrome,[0,.75],{segs:16}),e.box(26,29,46,50.5,-.3,0,y,[0,.3],"+z")})),e.wall(C(q.front,1.2),()=>e.at([40,0,h],Math.PI,()=>{e.box(-18,18,46,72,-1,0,d("#111113"),[0,.3],"+z"),e.quad([-16.8,47.2,-1.02],[16.8,47.2,-1.02],[16.8,70.8,-1.02],[-16.8,70.8,-1.02],[0,0,-1],d("#151517"),[B.TILES,.3])})),e.piece(()=>e.at([-46,0,-86],.28,()=>{const c=d("#b3191f");e.box(-24,8,15.5,18,-5.5,5.5,T.vinyl,[0,.25]),e.box(10,24,15.5,18,-5.5,5.5,T.vinyl,[0,.25]),e.box(-22,22,7,9.5,-1.5,1.5,T.black,[0,.35]),e.box(-6,6,9.5,15.5,-1.2,1.2,T.black,[0,.35]);for(const o of[-22,22])e.box(o-1.5,o+1.5,0,9,-1.5,1.5,T.black,[0,.35],"-y"),e.box(o-1.5,o+1.5,0,2,-8,8,T.black,[0,.35],"-y"),e.box(o-1.6,o+1.6,2,3,-8.1,-6,c,[0,.4]),e.box(o-1.6,o+1.6,2,3,6,8.1,c,[0,.4]);e.box(-2,2,9.6,11,1.2,1.8,c,[0,.4]),e.shadow(-25,25,-8,8,.45)})),{...e.out(),room:[-t,t,r,h],...n0.homegym}}function D0(){const e=J(),a=120,t=-126,r=90,h=120,i=i0(a,t,r,h),u=W.garage,w=d("#b9bbb8"),y=d("#d8d8d3");e.quad([-800,0,-800],[800,0,-800],[800,0,800],[-800,0,800],[0,1,0],d("#8e8b85"),[B.FLOOR,.25]),e.wall(C(i.back,.6),()=>{e.quad([-a,0,t],[a,0,t],[a,h,t],[-a,h,t],[0,0,1],w,[0,.03]),e.box(-a,a,0,4,t,t+.5,y,[0,.1],"-y-z")}),e.wall(C(i.front,.6),()=>{e.quad([-a,0,r],[a,0,r],[a,h,r],[-a,h,r],[0,0,-1],w,[0,.03]),e.box(-a,a,0,4,r-.5,r,y,[0,.1],"-y+z")});for(const f of[-1,1])e.wall(C(f<0?i.left:i.right,.6),()=>{e.quad([f*a,0,t],[f*a,0,r],[f*a,h,r],[f*a,h,t],[-f,0,0],w,[0,.03]),e.box(f>0?a-.5:-a,f>0?a:-a+.5,0,4,t,r,y,[0,.1],"-y")});e.wall(C(i.ceil,3.2),()=>{e.quad([-a,h,t],[a,h,t],[a,h,r],[-a,h,r],[0,-1,0],d("#c9c9c4"),[0,0]);for(const[f,g]of[[-48,-90],[48,-90],[-48,-20],[48,-20],[-48,50],[48,50]])e.box(f-24,f+24,117,119.9,g-2.5,g+2.5,d("#ffffff").map(s=>s*7),[B.EMIT,0],"+y")}),e.wall(C(i.back,5.5),()=>{e.quad([-96,0,t+.6],[96,0,t+.6],[96,96,t+.6],[-96,96,t+.6],[0,0,1],d("#4d5157"),[B.DOOR,.35]),e.box(-100,-96,0,100,t,t+2,y,[0,.2],"-y-z"),e.box(96,100,0,100,t,t+2,y,[0,.2],"-y-z"),e.box(-100,100,96,100,t,t+2,y,[0,.2],"-z");for(const f of[-1,1])e.box(f*100,f*103,0,98,t,t+5,d("#7d8086"),[0,.5],"-y-z")});const M=d("#141415"),q=d("#18191c");return e.fixture(j.BAR,()=>e.piece(()=>{for(let f=0;f<2;f++)e.box(-118+f*48.2,-70+f*48.2,0,.75,t+1,t+73,M,[0,.12],"-y");e.at([-68,.75,-98],0,()=>{for(const f of[-24.5,21.5])for(const g of[-24,21])e.box(f,f+3,0,90,g,g+3,q,[0,.35],"-y"),e.shadow(f-1,f+4,g-1,g+4,.6);for(const f of[-24,21])e.box(-24.5,24.5,86,89,f,f+3,q,[0,.35]);for(const f of[-24.5,21.5])e.box(f,f+3,86,89,-21,21,q,[0,.35]),e.box(f,f+3,0,3,-21,21,q,[0,.35],"-y");e.cyl([-24.5,u.bar.heightIn-.75,25],[24.5,u.bar.heightIn-.75,25],T0.dia/2,T.chrome,[0,.7],{segs:12});for(const f of[-1,1])e.box(f>0?21.5:-24.5,f>0?24.5:-21.5,u.bar.heightIn-2.75,u.bar.heightIn+.25,24,26,q,[0,.35]);for(const f of[-23,23])e.cyl([f,20,-24],[f,20,24],.5,T.chrome,[0,.7],{segs:10}),e.box(f-1.5,f+1.5,49,53,24,27,q,[0,.35]);e.at([0,20.5+.56,-12],0,()=>e.geo(S0({lb:135}),H()))})})),e.shadow(-118,-22,t+1,t+73,.25),e.piece(()=>e.at([46,0,-86],-.45,()=>e.geo(E0(),H(d("#18191c")),{lift:0}))),e.at([46,0,-86],-.45,()=>e.shadow(-8,8,-26,26,.45)),[Q.find(f=>f[0]===16),Q.find(f=>f[0]===24),Q.find(f=>f[0]===32)].filter(Boolean).forEach((f,g)=>e.at([14+g*13,0,t+12],.2*g,()=>{e.piece(()=>e.geo(F0(f[0]*2.2046),H(d("#1b1c1f")),{lift:0})),e.shadow(-4.5,4.5,-4.5,4.5,.55)})),e.at([88,0,-104],-.3,()=>{e.piece(()=>{e.box(-12,12,0,2,-10,10,T.black,[0,.3],"-y"),e.cyl([0,2,0],[0,44,0],1.3,T.black,[0,.35],{segs:10});for(const[f,g]of[[12,1],[12,-1],[30,1],[30,-1]])e.cyl([0,f,0],[g*9,f+2,0],1,T.chrome,[0,.6],{segs:10});for(const[f,g,s]of[[12,1,17.7],[12,-1,17.7],[30,1,10.9],[30,-1,10.9]])e0(e,[g*4.5,Math.max(f,s/2+.2),0],[g,0,0],{dia:s,thick:s>15?2.6:1.6,colour:T.iron})}),e.shadow(-13,13,-11,11,.5)}),e.fixture(j.TREADMILL,()=>e.piece(()=>e.at(u.treadmill.at,u.treadmill.yaw,()=>h0(e)))),e.wall(C(i.front,2.5),()=>e.at([-60,0,r],Math.PI,()=>{e.box(-20,20,0,83,-.6,0,y,[0,.2],"-y-z"),e.box(-18,18,0,80,-1.4,-.6,d("#e6e6e2"),[0,.3],"-y-z");for(const[f,g]of[[8,36],[44,74]])e.box(-13,13,f,g,-1.7,-1.4,d("#dcdcd7"),[0,.3],"+z");e.cyl([-14.5,37,-1.4],[-14.5,37,-2.8],.35,T.chrome,[0,.7],{segs:10}),e.box(-16,-13,36,38,-3.2,-2.8,T.chrome,[0,.7]),e.box(26,29,46,50.5,-.3,0,y,[0,.3],"+z")})),e.wall(C(i.front,11),()=>e.at([10,0,r],Math.PI,()=>{e.box(-30,30,40,82,-.8,0,d("#6b5a44"),[0,.15],"+z");for(let f=0;f<7;f++)e.cyl([-24+f*8,70,-.8],[-24+f*8,70.6,-4],.2,T.chrome,[0,.6],{segs:6});e.box(-30,30,36,37,-10,0,d("#5a4a38"),[0,.2]);for(const[f,g]of[[-22,"#2b4e7a"],[-6,"#3a3b3f"],[10,"#2b4e7a"],[24,"#7a2b2b"]])e.box(f-6,f+6,37,45,-9,-1,d(g),[0,.25])})),{...e.out(),room:[-a,a,t,r],...n0.garage}}const o0={x:-(_.hx+_.outer+16*G),y:[6.4*G,13.2*G],z:[-7.2*G,7.2*G]};function K0(e,a,t){if(!e)return!1;let r=1/0,h=-1/0,i=1/0,u=-1/0;for(const M of o0.y)for(const q of o0.z){const b=[o0.x,M,q],f=e[3]*b[0]+e[7]*b[1]+e[11]*b[2]+e[15];if(f<=0)return!1;const g=(e[0]*b[0]+e[4]*b[1]+e[8]*b[2]+e[12])/f,s=(e[1]*b[0]+e[5]*b[1]+e[9]*b[2]+e[13])/f;r=Math.min(r,g),h=Math.max(h,g),i=Math.min(i,s),u=Math.max(u,s)}const w=Math.max(.03,(h-r)*.15),y=Math.max(.03,(u-i)*.15);return a>=r-w&&a<=h+w&&t>=i-y&&t<=u+y}const n=e=>e*G,U0=40;function u0(e,a=U0){const t=_.radius+e,r=_.hx,h=[];for(let i=0;i<=a;i++){const u=i/a*Math.PI;h.push([r+t*Math.sin(u),t*Math.cos(u)])}for(let i=0;i<=a;i++){const u=i/a*Math.PI;h.push([-r-t*Math.sin(u),-t*Math.cos(u)])}return h.push(h[0]),h}function a0(e,a,t,r,h,i,u,w="-y"){for(let y=0;y+1<a.length;y++){const[M,q]=a[y],[b,f]=a[y+1],g=b-M,s=f-q,m=Math.hypot(g,s);m<.001||e.at([(M+b)/2,0,(q+f)/2],Math.atan2(-s,g),()=>e.box(-m/2-.3,m/2+.3,t,r,-h/2,h/2,i,u,w))}}function G0(){const e=J(),a=f0(11),t=_,r=16e3,h=t.outer;e.quad([-r,0,-r],[r,0,-r],[r,0,r],[-r,0,r],[0,1,0],d("#a8473a"),[B.FLOOR,.15]),a0(e,u0(-t.kerbW/2),0,t.kerbH,t.kerbW,d("#e8e8e4"),[0,.5]);const i=u0(h-t.radius+n(10),24),u=([l,v])=>l>X.wallX-n(3)&&Math.abs(v)<X.len/2+n(1),w=[[]];for(const l of i)u(l)?w[w.length-1].length&&w.push([]):w[w.length-1].push(l);for(const l of w)l.length>1&&(a0(e,l,0,n(.95),n(.06),d("#2c4a36"),[0,.2]),a0(e,l,n(.95),n(1.02),n(.08),d("#e6e6e2"),[0,.4]));j0(e);const y=n(.8),M=n(55),q=n(57.6)+22*y,b=[[q,0],[n(57.6),0]];for(let l=0;l<22;l++){const v=n(57.6)+l*y,A=n(1.4+.4*(l+1)),L=l?n(1.4+.4*l):0;e.box(-M,M,L,A,v,v+y,d("#23508f"),[B.SEATS,.25],"-y+z-x+x"),b.push([v,A],[v+y,A])}for(const l of[-1,1])e.at([l*M,0,0],l*Math.PI/2,()=>e.poly(b.map(([v,A])=>[-l*v,A]),0,d("#8d8f91"),[0,.15]));e.box(-M-n(.4),M+n(.4),0,n(16),q,q+n(.6),d("#8d8f91"),[0,.15],"-y"),e.box(-M-n(.4),M+n(.4),n(15.6),n(16.2),n(54.5),q+n(.6),d("#c9cbcc"),[0,.3]);for(let l=-4;l<=4;l++)e.box(l*n(13.5)-n(.3),l*n(13.5)+n(.3),n(10),n(15.6),q-n(.6),q,d("#a4a7aa"),[0,.2]);e.box(-M-n(.4),M+n(.4),n(15),n(16.2),n(54.2),n(54.5),d("#e9e9e6"),[0,.3]);const f=[[n(58.4)+10*y,0],[n(58.4),0]];for(let l=0;l<10;l++){const v=-n(58.4)-l*y,A=n(.5+.35*(l+1)),L=l?n(.5+.35*l):0;e.box(-n(35),n(35),L,A,v-y,v,d("#9ea3a8"),[B.SEATS,.45],l<9?"-y-z-x+x":"-y-x+x"),f.push([-v,A],[-v+y,A])}for(const l of[-1,1])e.at([l*n(35),0,0],l*Math.PI/2,()=>e.poly(f.map(([v,A])=>[l*v,A]),0,d("#8d8f91"),[0,.2]));for(const[l,v]of[[n(64),n(64)],[-n(64),n(64)],[n(66),-n(62)],[-n(66),-n(62)]])e.cyl([l,0,v],[l,n(38),v],n(.55),d("#9aa0a6"),[0,.3],{segs:10,rb:n(.3)}),e.at([l,n(38),v],Math.atan2(-l,-v),()=>{e.box(-n(3.2),n(3.2),0,n(3.4),-n(.3),n(.3),d("#55595f"),[0,.3]),e.box(-n(3),n(3),n(.2),n(3.2),n(.3),n(.33),d("#fff2cf").map(A=>A*1.3),[B.EMIT,0],"-z")});e.at([-(t.hx+h+n(16)),0,0],Math.PI/2,()=>{for(const l of[-1,1])e.box(l*n(5)-n(.4),l*n(5)+n(.4),0,n(6),-n(.4),n(.4),d("#4a4e54"),[0,.2],"-y");e.box(-n(7.6),n(7.6),n(6),n(13.6),-n(.5),n(.4),d("#2e3136"),[0,.2]),e.box(-n(7.2),n(7.2),n(6.4),n(13.2),n(.4),n(.45),d("#0b1016"),[0,.7],"-z")});const g=n(.06),s=n(3.66),m=n(2.44),c=n(2);for(const l of[-1,1])e.at([l*n(50),0,0],l>0?0:Math.PI,()=>{const v=d("#f2f2ef"),A=[d("#e4e4e0"),[B.NET,0]];for(const L of[-1,1])e.cyl([0,0,L*s],[0,m,L*s],g,v,[0,.4],{segs:8});e.cyl([0,m,-s],[0,m,s],g,v,[0,.4],{segs:8});for(const L of[[1,0,0],[-1,0,0]])e.quad([c,0,-s],[c,0,s],[c,m*.55,s],[c,m*.55,-s],L,...A);for(const L of[[-.6,.8,0],[.6,-.8,0]])e.quad([0,m,-s],[0,m,s],[c,m*.55,s],[c,m*.55,-s],L,...A);for(const L of[-1,1])for(const E of[[0,0,1],[0,0,-1]])e.quad([0,0,L*s],[c,0,L*s],[c,m*.55,L*s],[0,m,L*s],E,...A)});const o=[-n(62),0],p=n(4.2),k=n(7),x=Array.from({length:9},(l,v)=>{const A=(40+v/8*280)*Math.PI/180;return[o[0]+p*Math.cos(A),o[1]+p*Math.sin(A)]});for(const[l,v]of x)e.cyl([l,0,v],[l,k,v],n(.06),d("#c9ccd0"),[0,.4],{segs:6});for(let l=0;l+1<x.length;l++){const[v,A]=x[l],[L,E]=x[l+1],z=Y([o[0]-(v+L)/2,0,o[1]-(A+E)/2]);for(const S of[z,z.map(F=>-F)])e.quad([v,0,A],[L,0,E],[L,k,E],[v,k,A],S,d("#30343a"),[B.NET,0])}e.box(n(61.6),n(66.6),0,n(.7),-n(3),n(3),d("#1f4e9a"),[0,.15],"-y"),e.shadow(n(61.6),n(66.6),-n(3),n(3),.55);for(const l of[-1,1])e.cyl([n(61.4),0,l*n(2.2)],[n(61.4),n(2.5),l*n(2.2)],n(.04),d("#e9e9e6"),[0,.4],{segs:6});e.cyl([n(61.4),n(1.85),-n(2.2)],[n(61.4),n(1.85),n(2.2)],n(.02),d("#e8c43a"),[0,.4],{segs:6});for(let l=0;l<6;l++)e.at([-n(40)+l*n(1.3),0,-(h+n(7.5))],0,()=>{for(const L of[-1,1])e.cyl([L*23.6,0,0],[L*23.6,33,0],.6,d("#e9e9e6"),[0,.4],{segs:8}),e.box(L*23.6-.8,L*23.6+.8,0,1.4,-27,1,d("#2a2b2e"),[0,.3],"-y");e.box(-23.6-.5,23.6+.5,33-2.75,33,-.4,.4,d("#f2f2ef"),[B.STRIPES,.3])});for(let l=0;l<140;l++){const v=l/140*Math.PI*2+a()*.03,A=n(170)+a()*n(35),L=n(138)+a()*n(30),E=Math.cos(v)*A,z=Math.sin(v)*L,S=n(8)+a()*n(8),F=d(["#2f3f22","#3a4a26","#29361d","#44522c","#34431f"][l%5]).map(R=>R*(.85+.3*a()));if(e.cyl([E,0,z],[E,S*.45,z],n(.35),d("#3a2d22"),[0,0],{segs:5,caps:!1}),l%5===2){const R=n(2.2)+a()*n(1);e.cyl([E,S*.2,z],[E,S*1.1,z],R,F,[0,.05],{segs:7,rb:R*.08})}else{const R=n(3.2)+a()*n(2.4);e.blob([E,S-R*.8,z],R,R*.85,R*(.9+.2*a()),F,[0,.05])}}return{...e.out(),room:[-1e5,1e5,-1e5,1e5],...n0.track,turntable:!0,laps:!0}}function j0(e){const a=X,t=a.wallX,r=t+a.depth,h=a.height,i=a.len/2,u=d("#8a8076"),w=d("#4a4440"),y=d("#4d5560"),M=d("#c8c6c0");e.wall([-1,0,0,t],()=>{e.box(t,r,0,h,-i,i,u,[0,.12],"-y"),e.box(t-1.2,t,0,n(.45),-i-1.2,i+1.2,w,[0,.15],"-y"),e.box(t-2,r+2,h,h+6,-i-2,i+2,M,[0,.35],"-y");for(const q of[-n(11),n(11)]){e.box(t-.8,t,0,n(2.3),q-n(1),q+n(1),d("#3a3d42"),[0,.3],"-y");for(const b of[-1,1])e.box(t-1.2,t-.8,0,n(2.2),q+(b<0?-n(.9):.4),q+(b<0?-.4:n(.9)),y,[0,.45],"-y")}for(let q=0;q<6;q++){const b=-n(7)+q*n(2.8);Math.abs(b)>n(8.5)||(e.box(t-.6,t,n(2.85),n(3.85),b-n(1.3),b+n(1.3),d("#5f6266"),[0,.3],"-y"),e.box(t-.7,t-.6,n(2.9),n(3.8),b-n(1.25),b+n(1.25),d("#26313b"),[B.GLASS,.85],"-y+z-z-x"))}for(const q of[-1,1])e.cyl([t-3,0,q*(i-8)],[t-3,h,q*(i-8)],2,d("#6e7378"),[0,.35],{segs:8})}),e.shadow(t-n(1.2),t,-i,i,.45)}const n0={homegym:{floorKind:0,key:[1,.93,.82],fill:[1,.96,.9],rim:[1,.95,.88],kick:[1,.95,.9],sky:[.105,.098,.088],gnd:[.04,.028,.02],lit:.5,amb:1.9,exposure:1,fog:[0,0,0,0],sky0:[.06,.06,.06],sky1:[.06,.06,.06],skyKind:0,vignette:.32},garage:{floorKind:1,key:[.98,.98,1],fill:[.92,.97,1.06],rim:[.95,.98,1.05],kick:[1,1,1],sky:[.1,.104,.11],gnd:[.045,.043,.04],lit:.48,amb:1.8,exposure:1,fog:[0,0,0,0],sky0:[.05,.05,.05],sky1:[.05,.05,.05],skyKind:0,vignette:.3},track:{floorKind:2,key:[1.18,.86,.6],fill:[.62,.74,1.05],rim:[1.2,.8,.55],kick:[1.1,.85,.65],sky:[.13,.13,.16],gnd:[.07,.035,.025],lit:.62,amb:1.6,exposure:1,fog:[.74,.52,.38,1/12e4],sky0:[.98,.55,.28],sky1:[.16,.27,.55],skyKind:1,vignette:.22}},d0={homegym:O0,garage:D0,track:G0},s0=new Map;function x0(e){return e=U(e),d0[e]?(s0.has(e)||s0.set(e,d0[e]()),s0.get(e)):null}const m0=`#version 300 es
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNrm; layout(location=2) in vec3 aCol; layout(location=3) in vec3 aMat; layout(location=4) in vec4 aCut;
uniform mat4 uVP; uniform vec3 uEye; uniform float uKeep;
out vec3 vPos, vNrm, vCol; out vec2 vMat;
void main(){
  vPos = aPos; vNrm = aNrm; vCol = aCol; vMat = aMat.xy; gl_Position = uVP * vec4(aPos, 1.0);
  // v4/scenes2, the cut-away: a wall or piece the camera is outside of is not drawn (its triangles clipped away whole), unless
  // it is the fixture the avatar is on (uKeep)
  if (abs(aMat.z - uKeep) > 0.5 && dot(aCut.xyz, uEye) + aCut.w < 0.0) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
}`,p0=`
vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0., 1.); }
float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(h21(i), h21(i + vec2(1,0)), f.x), mix(h21(i + vec2(0,1)), h21(i + vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * vn(p); p *= 2.03; a *= 0.5; } return s; }
vec3 finish(vec3 col, vec2 fc){
  col = aces(col * uExposure);
  vec2 q = fc / uRes - 0.5; q.x *= uRes.x / uRes.y;
  col *= 1.0 - uVig * smoothstep(0.35, 1.05, length(q));
  col = clamp(col, 0.0, 1.0); col = mix(col * 12.92, 1.055 * pow(col, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, col));   // (v5/look-all: sRGB, as the body)
  return col + (fract(sin(dot(fc, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
}
const vec3 SUN = normalize(vec3(-0.62, 0.07, 0.78));   // (the sun's direction, scene space: low over bend 2 and the main stand)
vec3 skyAt(vec3 d){
  if (uSkyKind < 0.5) return uSky0;
  float h = clamp(d.y, -0.2, 1.0);
  vec3 c = mix(uSky0, uSky1, pow(clamp(h, 0.0, 1.0), 0.35));
  c += vec3(0.9, 0.42, 0.18) * 0.45 * exp(-max(h, 0.0) * 14.0);   // the warm band on the horizon
  // v5/track-world: the low sun's glow (scene space; no disc) and thin high cloud lit from below
  float sd = max(dot(d, SUN), 0.0);
  c += vec3(1.0, 0.62, 0.3) * (0.55 * pow(sd, 24.0) + 0.25 * pow(sd, 4.0)) * (1.0 - smoothstep(0.0, 0.5, h));
  if (h > 0.01) {
    vec2 cp = d.xz / (h + 0.06) * 0.9;
    float cl = smoothstep(0.5, 0.8, fbm(cp * vec2(1.0, 3.0) + 7.0)) * smoothstep(0.01, 0.08, h) * (1.0 - smoothstep(0.25, 0.6, h));
    c = mix(c, mix(vec3(1.0, 0.6, 0.38), vec3(0.95, 0.75, 0.62), h * 2.0) * (0.75 + 0.5 * sd), cl * 0.55);
  }
  c = mix(c, uSky0 * 0.55, smoothstep(0.0, -0.08, h));
  return c;
}`,V0=[0,2,3,4,5,6,7,8].map(e=>e<2?0:L0(e)/R0(A0(e))),Y0=`
// v5/track-world: the stadium's ground (js/ui/trackpath.js TRACK; scene origin = the infield's centre, the home straight at
// z = +r). Every marking is a distance field, box-filtered over the pixel's footprint (lineCov), so the far straight's
// 50 mm lines fade to their true average instead of shimmering. FQ: the footprint, fwidth of the ground point (in).
vec2 FQ;
float lineCov(float x, float hw, float fw){ fw = max(fw, 1e-3); return (clamp(x + hw, -0.5 * fw, 0.5 * fw) - clamp(x - hw, -0.5 * fw, 0.5 * fw)) / fw; }
float aaL(float x, float hw, vec2 n){ return lineCov(x, hw, dot(abs(n), FQ)); }   // a line at x = 0 of the field x, its gradient n
float ringL(vec2 q, vec2 c, float r, float hw){ vec2 v = q - c; float l = length(v); return aaL(l - r, hw, v / max(l, 1e-3)); }
float rayL(vec2 q, vec2 c, vec2 u, float a, float b, float hw){   // a line from c along u, a..b out
  vec2 v = q - c; float t = dot(v, u); vec2 nn = vec2(-u.y, u.x);
  return aaL(dot(v, nn), hw, nn) * step(a, t) * step(t, b);
}
float segX(vec2 q, float z0, float x0, float x1, float hw){ return lineCov(q.y - z0, hw, FQ.y) * step(x0, q.x) * step(q.x, x1); }   // along x at z0
float segZ(vec2 q, float x0, float z0, float z1, float hw){ return lineCov(q.x - x0, hw, FQ.x) * step(z0, q.y) * step(q.y, z1); }   // along z at x0
const float A400[8] = float[8](${V0.map(e=>e.toFixed(6)).join(", ")});   // the 400 m start's staggers: their angle round bend 1 (rad, lanes 1–8)
vec3 trackFloor(vec2 q, inout float gloss){
  FQ = fwidth(q);
  const float hx = ${_.hx.toFixed(3)}, R = ${_.radius.toFixed(3)}, L = ${_.lane.toFixed(4)}, ln = ${_.line.toFixed(4)}, Ro = R + 8.0 * L, M = 39.3701;
  vec2 b = vec2(sign(q.x) * max(abs(q.x) - hx, 0.0), q.y);
  float rr = length(b), d = rr - R;            // in outside the inner edge (on a straight: |z| − r)
  vec2 nd = rr > 1e-3 ? b / rr : vec2(0.0, 1.0);
  float n1 = fbm(q * 0.004), n2 = vn(q * 0.6);
  vec3 grass = mix(vec3(0.05, 0.078, 0.026), vec3(0.085, 0.115, 0.04), n1 * 0.7 + 0.3 * step(0.5, fract(q.x / (5.0 * M))));
  #define RED mix(vec3(0.27, 0.06, 0.035), vec3(0.34, 0.085, 0.05), n1 * 0.4 + n2 * 0.6)
  vec3 white = vec3(0.82, 0.82, 0.8);
  float wl = 0.0;   // white line coverage
  // the 100 m chute: the home straight's lanes carried on past bend 2 (to 115 m before the finish)
  bool chute = q.y > R && q.y < Ro && q.x < -hx && q.x > hx - 115.0 * M;
  if (d < 0.0 && !chute) {   // ---- the infield: mown grass, a football pitch, the throws and the high jump
    gloss = 0.0;
    vec3 c = grass;
    vec2 a = abs(q); float hw = 0.06 * M;
    float p = 0.0;
    if (a.x < 51.0 * M && a.y < 33.0 * M) {   // (the pitch's lines only over the pitch)
    p = segX(vec2(a.x, a.y), 32.0 * M, 0.0, 50.0 * M + hw, hw) + segZ(vec2(a.x, a.y), 50.0 * M, 0.0, 32.0 * M, hw) + segZ(q, 0.0, -32.0 * M, 32.0 * M, hw);
    p += ringL(q, vec2(0.0), 9.15 * M, hw) + ringL(a, vec2(50.0 * M - 11.0 * M, 0.0), 0.0, 0.11 * M);
    p += segZ(a, 50.0 * M - 16.5 * M, 0.0, 20.16 * M, hw) + segX(a, 20.16 * M, 50.0 * M - 16.5 * M, 50.0 * M, hw);
    p += segZ(a, 50.0 * M - 5.5 * M, 0.0, 9.16 * M, hw) + segX(a, 9.16 * M, 50.0 * M - 5.5 * M, 50.0 * M, hw);
    p += ringL(a, vec2(50.0 * M - 11.0 * M, 0.0), 9.15 * M, hw) * step(a.x, 50.0 * M - 16.5 * M);
    p += ringL(a, vec2(50.0 * M, 32.0 * M), 1.0 * M, hw) * step(a.x, 50.0 * M) * step(a.y, 32.0 * M);
    }
    c = mix(c, white, clamp(p, 0.0, 1.0) * 0.9);
    // bend 2's D: the discus circle (2.5 m) on its concrete pad and the 34.92° sector into the field
    vec2 dc = vec2(-62.0 * M, 0.0); float rd = length(q - dc);
    if (rd < 1.6 * M) c = mix(vec3(0.2, 0.2, 0.19), vec3(0.26, 0.255, 0.24), n2);
    float s = 0.0;
    if (rd < 35.0 * M) { s = ringL(q, dc, 1.25 * M, 0.03 * M);
    for (int k = 0; k < 2; k++) { float an = (k == 0 ? 1.0 : -1.0) * 0.30473; s += rayL(q, dc, vec2(cos(an), sin(an)), 1.25 * M, 34.0 * M, 0.025 * M); } }
    // bend 1's D: the shot circle (2.135 m) with its stop board, the sector toward the field; the high jump's fan
    vec2 sc = vec2(55.0 * M, -19.0 * M); float rs = length(q - sc);
    if (rs < 1.4 * M) c = mix(vec3(0.2, 0.2, 0.19), vec3(0.26, 0.255, 0.24), n2);
    if (rs < 21.0 * M) { s += ringL(q, sc, 1.0675 * M, 0.03 * M);
    for (int k = 0; k < 2; k++) { float an = 3.14159 + (k == 0 ? 1.0 : -1.0) * 0.30473 + 0.35; s += rayL(q, sc, vec2(cos(an), sin(an)), 1.07 * M, 20.0 * M, 0.025 * M); } }
    vec2 hj = vec2(61.4 * M, 0.0);
    if (q.x > hx && length(q - hj) < 11.0 * M && q.x < hj.x + 6.0 * M) { c = RED * 0.95; gloss = 0.15; }
    c = mix(c, white, clamp(s, 0.0, 1.0) * 0.9);
    return c;
  }
  vec3 c;
  if (d < 8.0 * L || chute) {   // ---- the eight lanes
    c = RED; gloss = max(gloss, 0.15);
    float u = clamp(floor((d + ln * 0.5) / L + 0.5), 1.0, 8.0);   // the nearest lane line: lane u's, on its right
    if (d < 8.0 * L + L * 0.5) wl = aaL(d - (u * L - ln * 0.5), ln * 0.5, nd);
    if (chute) { float ds = q.y - R, uc = clamp(floor((ds + ln * 0.5) / L + 0.5), 1.0, 8.0); wl = max(wl, aaL(ds - (uc * L - ln * 0.5), ln * 0.5, vec2(0.0, 1.0))); }
    float lane = floor(max(d, 0.0) / L) + 1.0;
    // the finish line across the home straight's end (its far edge on x = hx); the 100 m and 110 m hurdles starts
    if (q.y > 0.0) {
      wl = max(wl, lineCov(q.x - (hx - ln * 0.5), ln * 0.5, FQ.x));
      if (chute || abs(q.x) < hx) {
        wl = max(wl, lineCov(q.x - (hx - 100.0 * M), ln * 0.5, FQ.x));
        c = mix(c, vec3(0.75, 0.62, 0.12), lineCov(q.x - (hx - 110.0 * M), ln * 0.5, FQ.x) * 0.8);   // (the 110 m hurdles start: yellow)
      }
    }
    // the 400 m staggers round bend 1, the 200 m round bend 2 (each lane's start line across that lane only)
    if (q.x > hx && d < 8.0 * L) {
      float t = atan(q.x - hx, q.y), al = A400[int(lane) - 1];
      if (lane > 1.5) wl = max(wl, aaL((t - al) * rr, ln * 0.5, vec2(nd.y, -nd.x)));
    }
    // v5/race: the waterfall (curved) starts on bend 1, the 1600 m's off the finish line and the 1500 m's 100 m on: the
    // involute of lane 1's measurement circle, t = tan α − α (cos α = r₁ / ρ), so every point is the same shortest route
    // from the line (js/engine/race.js waterfallS)
    if (q.x > hx - 2.0 && d < 8.0 * L) {
      float t = atan(q.x - hx, q.y), rm = R + ${_.measure1.toFixed(3)}, al = acos(min(1.0, rm / max(rr, rm))), tw = tan(al) - al;
      wl = max(wl, aaL((t - tw) * rr + ln * 0.5, ln * 0.5, vec2(nd.y, -nd.x)));
      wl = max(wl, aaL((t - tw - 100.0 * M / rm) * rr + ln * 0.5, ln * 0.5, vec2(nd.y, -nd.x)));
    }
    if (q.x < -hx && d < 8.0 * L && !chute) {
      float t = atan(-(q.x + hx), -q.y), al = A400[int(lane) - 1] * 0.5;
      if (lane > 1.5) wl = max(wl, aaL((t - al) * rr, ln * 0.5, vec2(nd.y, -nd.x)));
    }
    return mix(c, white, clamp(wl, 0.0, 1.0));
  }
  if (d < 8.0 * L + 1.5 * M) { gloss = max(gloss, 0.12); return RED * 0.85; }   // the outer apron
  gloss = 0.0;
  // the long and triple jump beyond the back straight: a 1.22 m runway, a take-off board, a 9 × 2.75 m sand pit
  float zj = -(Ro + 3.0 * M);
  if (abs(q.x) < hx && abs(q.y - zj) < 0.75 * M && q.x > -30.0 * M && q.x < 24.0 * M) {
    if (q.x > 15.0 * M) { if (abs(q.y - zj) < 1.375 * M) return mix(vec3(0.42, 0.33, 0.2), vec3(0.52, 0.42, 0.27), n2); }
    else {
      vec3 rw = RED * 0.92;
      float e = aaL(abs(q.y - zj) - 0.61 * M, 0.025 * M, vec2(0.0, 1.0));
      float bd = step(12.8 * M, q.x) * step(q.x, 13.0 * M) * step(abs(q.y - zj), 0.61 * M);
      return mix(rw, white, clamp(e + bd, 0.0, 1.0));
    }
  }
  if (abs(q.y - zj) < 1.375 * M && q.x > 15.0 * M && q.x < 24.0 * M) return mix(vec3(0.42, 0.33, 0.2), vec3(0.52, 0.42, 0.27), n2);
  // v5/track-paces: the field house's concrete apron, 4 m deep along its front (js/ui/trackpath.js FIELD)
  if (q.x > ${X.wallX.toFixed(2)} - 4.0 * M && abs(q.y) < ${(X.len/2).toFixed(2)} + 1.0 * M) return mix(vec3(0.24, 0.23, 0.21), vec3(0.31, 0.30, 0.27), n1 * 0.6 + n2 * 0.4);
  if (d < 8.0 * L + 10.0 * M) return grass;   // inside the fence
  // outside the fence: a concrete concourse round the stand and the bleachers, grass beyond
  if (d < 8.0 * L + 22.0 * M) return mix(vec3(0.16, 0.15, 0.14), vec3(0.22, 0.21, 0.19), n1);
  return grass * 0.92;
  #undef RED
}
`,y0=`#version 300 es
precision highp float;
in vec3 vPos, vNrm, vCol; in vec2 vMat; out vec4 frag;
uniform vec2 uRes; uniform float uExposure, uVig, uLit, uAmb, uFloorKind, uSkyKind, uNBox;
uniform vec3 uEye, uKey, uFill, uRim, uLC[3], uSkyA, uGndA, uSky0, uSky1;
uniform vec4 uFog, uRoom, uGround, uBox[24], uTread;
uniform vec2 uBelt;
uniform mat4 uModel;
uniform sampler2D uSh;
${p0}
const vec2 DISC[5] = vec2[5](vec2(0.0), vec2(0.52, 0.10), vec2(0.18, 0.52), vec2(-0.38, 0.40), vec2(-0.54, -0.12));
const float LOD[3] = float[3](0.0, 1.6, 4.2);
const float RAD[3] = float[3](0.0040, 0.0140, 0.075);
${Y0}
float bodyShadow(vec3 P){   // the renderer's top-down height map of the body (as its studio floor reads it)
  vec3 W = (uModel * vec4(P, 1.0)).xyz; float R = uGround.x;
  vec2 suv = vec2(0.5 + W.x / (2.0 * R), 0.5 - W.z / (2.0 * R));
  if (any(lessThan(suv, vec2(0.0))) || any(greaterThan(suv, vec2(1.0)))) return 0.0;
  float sh = 0.0;
  for (int k = 0; k < 3; k++) { float a = 0.0;
    for (int i = 1; i < 5; i++) a += 1.0 - textureLod(uSh, clamp(suv + DISC[i] * RAD[k], 0.003, 0.997), LOD[k]).g;
    sh = max(sh, a * 0.25 * (k == 2 ? 0.92 : 1.0)); }
  return clamp(sh, 0.0, 1.0);
}
float boxShadow(vec2 p){   // baked contact shadows under the props: soft rectangles
  float s = 0.0;
  for (int i = 0; i < 24; i++) { if (float(i) >= uNBox) break;
    vec4 b = uBox[i]; vec2 c = (b.xy + b.zw) * 0.5, h = abs(b.zw - b.xy) * 0.5;
    vec2 d = abs(p - c) - h; float e = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
    s = max(s, exp(-max(e + 1.5, 0.0) / 5.0) * smoothstep(-0.5, 2.0, -e + 2.0)); }
  return s;
}
vec3 floorAlbedo(vec3 P, inout float gloss){
  vec2 q = P.xz;
  if (uFloorKind < 0.5) {   // stained oak: 5 in boards along z, random lengths, per-board tone, grain, dark seams
    float bx = floor(q.x / 5.0), off = h21(vec2(bx, 3.1)) * 60.0, by = floor((q.y + off) / 60.0);
    vec2 f = vec2(fract(q.x / 5.0), fract((q.y + off) / 60.0));
    float tone = h21(vec2(bx, by)), grain = fbm(vec2(q.x * 1.6 + tone * 9.0, q.y * 0.12));
    vec3 c = mix(vec3(0.075, 0.035, 0.018), vec3(0.15, 0.075, 0.038), tone * 0.7 + grain * 0.45);
    float seam = max(1.0 - smoothstep(0.0, 0.025, min(f.x, 1.0 - f.x)), 1.0 - smoothstep(0.0, 0.004, min(f.y, 1.0 - f.y)));
    return c * (1.0 - 0.55 * seam);
  }
  if (uFloorKind < 1.5) {   // sealed concrete: mottled, fine aggregate, saw-cut control joints every 10 ft
    float m = fbm(q * 0.02) * 0.65 + vn(q * 0.3) * 0.25 + h21(floor(q * 3.0)) * 0.1;
    vec3 c = mix(vec3(0.17, 0.165, 0.155), vec3(0.3, 0.29, 0.27), m);
    vec2 j = abs(fract(q / 120.0) - 0.5) * 120.0;   // (joints at ±60 in: none under the feet)
    c *= 1.0 - 0.6 * (1.0 - smoothstep(0.15, 0.5, min(j.x, j.y)));
    gloss *= 0.6 + 0.8 * m;
    return c;
  }
  return trackFloor(q, gloss);   // the track (v5/track-world)
}
void main(){
  vec3 P = vPos, N = normalize(vNrm), V = normalize(uEye - P);
  if (!gl_FrontFacing) N = -N;
  float pat = vMat.x, gloss = vMat.y; vec3 alb = vCol;
  float dist = length(uEye - P);
  if (pat > 1.5 && pat < 2.5) {   // emissive: radiance as given
    vec3 c = mix(alb, uFog.rgb, uFog.w > 0.0 ? 1.0 - exp(-dist * uFog.w) : 0.0);
    frag = vec4(finish(c, gl_FragCoord.xy), 1.0); return;
  }
  float ao = 1.0;
  bool room = uRoom.y - uRoom.x < 1e4;
  float dw = min(min(P.x - uRoom.x, uRoom.y - P.x), min(P.z - uRoom.z, uRoom.w - P.z));   // inches inside the room's walls
  if (pat > 0.5 && pat < 1.5) { alb = floorAlbedo(P, gloss); if (room && dw < 0.0) { alb *= mix(1.0, 0.5, smoothstep(0.0, 60.0, -dw)); gloss *= 0.6; } }   // (past a cut-away wall: darker)
  else if (pat > 10.5) {   // v5/track-world: a net (the goals', the cage's): 4 in mesh, 4 mm cord, its average coverage
    // past the pixel; dithered (an ordered threshold per pixel, no blending), so it stays one opaque pass
    vec2 g = vec2(P.y, P.x + P.z) / 4.0, fw = fwidth(g), e = abs(fract(g) - 0.5);
    vec2 cov = clamp((0.08 + fw * 0.5 - (0.5 - e)) / max(fw, vec2(1e-3)), 0.0, 1.0);
    cov = mix(cov, vec2(0.1), smoothstep(0.25, 0.6, fw));
    float k = 1.0 - (1.0 - cov.x) * (1.0 - cov.y);
    if (k < fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))))) discard;
  }
  else if (pat > 9.5) {   // v5/track-world: stand seating. The main stand (z > 0): a row of seats on each 0.8 m tread, whose
    // backs face the field over the 0.4 m riser behind (what the field sees of a stand above eye height); 0.5 m seats, a
    // stair aisle every 12 m, the seat blocks varying a little in tone. The bleachers (z < 0): aluminium planks.
    vec3 conc = vec3(0.2, 0.195, 0.185);
    float sx = fract(P.x / 19.685), ax = fract(P.x / 472.44 + 0.5), blk = h21(vec2(floor(P.x / 472.44 + 0.5), 0.5));
    if (P.z > 0.0) {
      float f = fract(P.z / 31.4961), fy = fract((P.y - 55.118) / 15.748);
      float seat = (N.y > 0.5 ? step(0.55, f) * step(f, 0.95) : step(55.118 + 15.748 - 0.5, P.y) * step(0.12, fy) * step(fy, 0.92))
        * step(0.1, sx) * step(sx, 0.9) * step(0.03, ax) * step(ax, 0.97);
      alb = mix(conc, alb * (0.8 + 0.4 * blk), seat); gloss *= seat;
    } else {
      float fy = fract((P.y - 19.685) / 13.78);
      alb *= 1.0 - 0.45 * (1.0 - smoothstep(0.0, 0.12, fy)) * step(N.y, 0.5) - 0.3 * step(0.5, N.y) * step(0.6, fract(abs(P.z) / 31.4961));
    }
  }
  else if (pat > 8.5) {   // v4/scenes2: the treadmill's belt, fine cross grooves moving back at the gait's speed (uBelt: offset, period)
    float bz = (P.x - uTread.x) * uTread.z + (P.z - uTread.y) * uTread.w + uBelt.x;
    float g = fract(bz / uBelt.y);
    alb *= 1.0 + 1.6 * (1.0 - smoothstep(0.0, 0.12, min(g, 1.0 - g)));
  }
  else if (pat > 2.5 && pat < 3.5) alb *= 0.8 + 0.2 * smoothstep(0.1, 0.35, abs(fract(P.y / 1.0) - 0.5));   // blinds: 1 in slats
  else if (pat > 4.5 && pat < 5.5) {   // collage: a black mat with photo windows of warm abstract tiles
    vec2 c = vec2(P.x / 4.4, (P.y - 38.8) / 3.6), id = floor(c), f = fract(c);
    float win = step(0.12, f.x) * step(f.x, 0.88) * step(0.12, f.y) * step(f.y, 0.88);
    float h = h21(id + 7.0), h2 = h21(id + 19.0);
    vec3 warm = mix(mix(vec3(0.55, 0.22, 0.08), vec3(0.75, 0.52, 0.25), h), mix(vec3(0.45, 0.16, 0.14), vec3(0.62, 0.42, 0.32), h2), 0.5);
    warm *= 0.7 + 0.5 * mix(f.x, f.y, h2);   // a soft gradient inside each tile
    alb = mix(alb, warm, win); gloss = mix(gloss, 0.75, win);
  } else if (pat > 5.5 && pat < 6.5) {   // the sectional door: four 24 in sections, eight raised panels each, windows on top
    float sy = P.y / 24.0, s = floor(sy), fy = fract(sy), fx = fract((P.x + 96.0) / 24.0);
    float groove = 1.0 - smoothstep(0.0, 0.03, min(fy, 1.0 - fy));
    float panel = smoothstep(0.1, 0.13, fx) * smoothstep(0.1, 0.13, 1.0 - fx) * smoothstep(0.16, 0.2, fy) * smoothstep(0.16, 0.2, 1.0 - fy);
    float edge = panel * (1.0 - smoothstep(0.13, 0.18, min(min(fx, 1.0 - fx), min(fy, 1.0 - fy))));
    alb *= (1.0 - 0.6 * groove) * (1.0 + 0.25 * edge);
    if (s > 2.5 && panel > 0.5) {   // the window row: daylight
      vec3 day = mix(vec3(0.5, 0.6, 0.74), vec3(0.7, 0.74, 0.78), fy) * 0.8;   // (overcast daylight through frosted glass)
      frag = vec4(finish(day, gl_FragCoord.xy), 1.0); return;
    }
    N = normalize(N + vec3(0.0, (fy < 0.2 ? -1.0 : fy > 0.8 ? 1.0 : 0.0) * 0.3 * panel, 0.0));
  } else if (pat > 6.5 && pat < 7.5) alb = mix(alb, vec3(0.012), step(0.5, fract(P.x / 8.0 + 0.25)));   // hurdle bands
  // baked occlusion where the room meets itself: the floor at the walls, the walls at the floor and in the corners
  if (room && dw > -0.5) {
    ao *= 1.0 - 0.45 * exp(-max(dw, 0.0) / 9.0) * (pat > 0.5 && pat < 1.5 ? 1.0 : 0.5);
    ao *= 1.0 - 0.35 * exp(-max(P.y, 0.0) / 7.0) * (pat > 0.5 && pat < 1.5 ? 0.0 : 1.0);
  }
  float shade = 1.0;
  if (pat > 0.5 && pat < 1.5) { shade = 1.0 - 0.6 * boxShadow(P.xz); shade *= 1.0 - 0.92 * bodyShadow(P); }
  else if (pat > 8.5 && pat < 9.5) shade = 1.0 - 0.92 * bodyShadow(P);   // (the runner's shadow on the belt)
  // the renderer's BRDF terms: Lambert / π from each light, hemisphere ambient, a Blinn highlight scaled by gloss
  vec3 L[3]; L[0] = normalize(uKey); L[1] = normalize(uFill); L[2] = normalize(uRim);
  vec3 col = vec3(0.0);
  for (int i = 0; i < 3; i++) {
    float nl = max(dot(N, L[i]), 0.0); vec3 H = normalize(L[i] + V);
    float sp = pow(max(dot(N, H), 0.0), mix(12.0, 160.0, gloss)) * gloss * mix(0.04, 0.5, gloss);
    col += uLC[i] * uLit * (alb * nl / 3.14159 + sp * nl);
  }
  vec3 amb = mix(uGndA, uSkyA, N.y * 0.5 + 0.5) * uAmb;
  col += alb * amb;
  if (pat > 3.5 && pat < 4.5 || pat > 7.5 && pat < 8.5) {   // glass and the mirror: what they face, darkened (the room behind the camera)
    vec3 Rf = reflect(-V, N);
    vec3 env = uSkyKind > 0.5 ? skyAt(Rf) : mix(vec3(0.05, 0.045, 0.04), vec3(0.35, 0.34, 0.32), smoothstep(-0.3, 0.6, Rf.y));
    float fr = 0.04 + 0.96 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
    col = mix(col, env * (pat > 7.5 ? 0.85 : 1.0), pat > 7.5 ? 0.85 : fr * 0.8 + 0.15);
  }
  col *= ao * shade;
  if (uFog.w > 0.0) col = mix(col, uFog.rgb * mix(1.0, 0.75, smoothstep(0.0, 0.3, normalize(P - uEye).y)), 1.0 - exp(-dist * uFog.w));
  frag = vec4(finish(col, gl_FragCoord.xy), 1.0);
}`,X0=`#version 300 es
layout(location=0) in vec2 aXY; out vec2 vUV;
void main(){ vUV = aXY * 0.5 + 0.5; gl_Position = vec4(aXY, 0.9999, 1.0); }`,H0=`#version 300 es
precision highp float;
in vec2 vUV; out vec4 frag;
uniform vec2 uRes; uniform float uExposure, uVig, uSkyKind; uniform vec3 uSky0, uSky1, uEye; uniform mat4 uInv;
${p0}
void main(){
  vec4 fw = uInv * vec4(vUV * 2.0 - 1.0, 1.0, 1.0);
  vec3 d = normalize(fw.xyz / fw.w - uEye);
  frag = vec4(finish(skyAt(d), gl_FragCoord.xy), 1.0);
}`;function b0(e,a,t){const r=e.createShader(a);if(e.shaderSource(r,t),e.compileShader(r),!e.getShaderParameter(r,e.COMPILE_STATUS)&&!e.isContextLost())throw new Error("[scene3d] "+e.getShaderInfoLog(r));return r}function r0(e,a,t){const r=e.createProgram(),h=b0(e,e.VERTEX_SHADER,a),i=b0(e,e.FRAGMENT_SHADER,t);if(e.attachShader(r,h),e.attachShader(r,i),e.linkProgram(r),!e.getProgramParameter(r,e.LINK_STATUS)&&!e.isContextLost())throw new Error("[scene3d] "+e.getProgramInfoLog(r));e.deleteShader(h),e.deleteShader(i);const u={},w=e.getProgramParameter(r,e.ACTIVE_UNIFORMS);for(let y=0;y<w;y++){const M=e.getActiveUniform(r,y);u[M.name.replace(/\[0\]$/,"")]=e.getUniformLocation(r,M.name)}return r.loc=u,r}function ae(e,a,t,r){const h=1/Math.tan(e/2),i=1/(t-r);return[h/a,0,0,0,0,h,0,0,0,0,(r+t)*i,-1,0,0,2*r*t*i,0]}function c0(e,a){const t=new Array(16);for(let r=0;r<4;r++)for(let h=0;h<4;h++){let i=0;for(let u=0;u<4;u++)i+=e[u*4+h]*a[r*4+u];t[r*4+h]=i}return t}function W0(e){const a=new Array(16),[t,r,h,i,u,w,y,M,q,b,f,g,s,m,c,o]=e;a[0]=w*f*o-w*g*c-b*y*o+b*M*c+m*y*g-m*M*f,a[4]=-u*f*o+u*g*c+q*y*o-q*M*c-s*y*g+s*M*f,a[8]=u*b*o-u*g*m-q*w*o+q*M*m+s*w*g-s*M*b,a[12]=-u*b*c+u*f*m+q*w*c-q*y*m-s*w*f+s*y*b,a[1]=-r*f*o+r*g*c+b*h*o-b*i*c-m*h*g+m*i*f,a[5]=t*f*o-t*g*c-q*h*o+q*i*c+s*h*g-s*i*f,a[9]=-t*b*o+t*g*m+q*r*o-q*i*m-s*r*g+s*i*b,a[13]=t*b*c-t*f*m-q*r*c+q*h*m+s*r*f-s*h*b,a[2]=r*y*o-r*M*c-w*h*o+w*i*c+m*h*M-m*i*y,a[6]=-t*y*o+t*M*c+u*h*o-u*i*c-s*h*M+s*i*y,a[10]=t*w*o-t*M*m-u*r*o+u*i*m+s*r*M-s*i*w,a[14]=-t*w*c+t*y*m+u*r*c-u*h*m-s*r*y+s*h*w,a[3]=-r*y*g+r*M*f+w*h*g-w*i*f-b*h*M+b*i*y,a[7]=t*y*g-t*M*f-u*h*g+u*i*f+q*h*M-q*i*y,a[11]=-t*w*g+t*M*b+u*r*g-u*i*b-q*r*M+q*i*w,a[15]=t*w*f-t*y*b-u*r*f+u*h*b+q*r*y-q*h*w;const p=t*a[0]+r*a[4]+h*a[8]+i*a[12];return p?a.map(k=>k/p):e}const Z0=e=>{const a=Math.cos(e),t=Math.sin(e);return[a,0,-t,0,0,1,0,0,t,0,a,0,0,0,0,1]},$=(e,a)=>{const t=Math.cos(a),r=Math.sin(a);return[e[0]*t+e[2]*r,e[1],-e[0]*r+e[2]*t]};function $0(e,a){const t=x0(a);if(!t)return e;const r=new Float32Array(e.lights),h=[t.key,t.fill,t.rim,t.kick];for(let i=0;i<4;i++)for(let u=0;u<3;u++)r[i*3+u]*=h[i][u];return{...e,lights:r,sky:new Float32Array(t.sky),gnd:new Float32Array(t.gnd),exposure:e.exposure*t.exposure}}function Q0(e){const a=[],t=[],r=[];for(let h=0;h<e.idx.length;h+=3){const i=e.mat[e.idx[h]*3],u=[e.idx[h],e.idx[h+1],e.idx[h+2]];(i===B.NET?r:e.laps&&i===B.FLOOR?t:a).push(...u)}return{idx:new Uint32Array([...a,...t,...r]),n:e.idx.length,nOpaque:a.length+t.length}}function ne(e,a){const t=x0(a);if(!t)return null;const r=Q0(t),h=r.n-r.nOpaque,i=r0(e,m0,y0.replace("discard;",";")),u=h?r0(e,m0,y0):null,w=r0(e,X0,H0),y=e.createVertexArray(),M=[];e.bindVertexArray(y);for(const[o,p,k]of[[0,t.pos,3],[1,t.nrm,3],[2,t.col,3],[3,t.mat,3],[4,t.cut,4]]){const x=e.createBuffer();M.push(x),e.bindBuffer(e.ARRAY_BUFFER,x),e.bufferData(e.ARRAY_BUFFER,p,e.STATIC_DRAW),e.enableVertexAttribArray(o),e.vertexAttribPointer(o,k,e.FLOAT,!1,0,0)}const q=e.createBuffer();M.push(q),e.bindBuffer(e.ELEMENT_ARRAY_BUFFER,q),e.bufferData(e.ELEMENT_ARRAY_BUFFER,r.idx,e.STATIC_DRAW),e.bindVertexArray(null);const b=e.createVertexArray();e.bindVertexArray(b);const f=e.createBuffer();M.push(f),e.bindBuffer(e.ARRAY_BUFFER,f),e.bufferData(e.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),e.STATIC_DRAW),e.enableVertexAttribArray(0),e.vertexAttribPointer(0,2,e.FLOAT,!1,0,0),e.bindVertexArray(null);const g=new Float32Array(96);t.shadows.slice(0,24).forEach((o,p)=>g.set([o[0],o[1],o[2],o[3]],p*4));const s=Math.min(24,t.shadows.length);let m=0,c=null;return{id:U(a),hitScoreboard:(o,p)=>U(a)==="track"&&K0(c,o,p),rig:o=>$0(o,a),stats:()=>({id:U(a),verts:t.n,tris:t.idx.length/3,ms:m}),turntable:!!t.turntable,laps:!!t.laps,far:o=>o+(t.floorKind===2?16e3:1400),draw(o){const p=performance.now(),k=t.laps?o.spot&&(o.spot.kind==="lap"||o.spot.kind==="field")?o.spot:q0(k0(_.homeS),0):t.turntable||!o.spot?{at:[0,0,0],yaw:t.turntable?-o.yaw:0}:o.spot,x=k.yaw,l=k.at,v=c0(Z0(-x),[1,0,0,0,0,1,0,0,0,0,1,0,-l[0],-l[1],-l[2],1]),A=c0(o.P,c0(o.V,v));c=A;const L=$(o.eye,x).map((z,S)=>z+l[S]),E=(o.lightYaw||0)+o.yaw+x;if(e.disable(e.DEPTH_TEST),e.depthMask(!1),e.disable(e.BLEND),t.skyKind<.5){const z=t.sky0[0],S=z<=.0031308?12.92*z:1.055*Math.pow(z,1/2.4)-.055;e.clearColor(S,S,S,1),e.clear(e.COLOR_BUFFER_BIT)}else{e.useProgram(w),e.bindVertexArray(b);const z=w.loc;e.uniform2f(z.uRes,o.W,o.H),e.uniform1f(z.uExposure,t.exposure),e.uniform1f(z.uVig,t.vignette),e.uniform1f(z.uSkyKind,t.skyKind),e.uniform3fv(z.uSky0,t.sky0),e.uniform3fv(z.uSky1,t.sky1),e.uniform3fv(z.uEye,L),e.uniformMatrix4fv(z.uInv,!1,W0(A)),e.drawArrays(e.TRIANGLES,0,3)}e.enable(e.DEPTH_TEST),e.depthMask(!0),e.depthFunc(e.LEQUAL),e.clear(e.DEPTH_BUFFER_BIT),e.enable(e.CULL_FACE),e.cullFace(e.BACK),e.frontFace(e.CCW),e.enable(e.POLYGON_OFFSET_FILL),e.polygonOffset(1,4),e.bindVertexArray(y);for(const[z,S,F]of[[i,0,r.nOpaque],[u,r.nOpaque,h]]){if(!z||!F)continue;e.useProgram(z);const R=z.loc;e.uniformMatrix4fv(R.uVP,!1,A),e.uniformMatrix4fv(R.uModel,!1,v),e.uniform2f(R.uRes,o.W,o.H),e.uniform3fv(R.uEye,L),e.uniform1f(R.uKeep,!t.turntable&&o.spot&&o.spot.kind==="treadmill"?j.TREADMILL:!t.turntable&&o.spot&&o.spot.kind==="bar"?j.BAR:-1);const P=W[U(a)]&&W[U(a)].treadmill,I=o.belt||{off:0,period:2};e.uniform4f(R.uTread,P?P.at[0]:0,P?P.at[2]:0,P?Math.sin(P.yaw):0,P?Math.cos(P.yaw):1),e.uniform2f(R.uBelt,I.off,I.period),e.uniform3fv(R.uKey,$([-.55,.65,.75],E)),e.uniform3fv(R.uFill,$([.8,.05,.55],E)),e.uniform3fv(R.uRim,$([.75,.35,-.85],E)),e.uniform3fv(R.uLC,o.ST.lights.subarray(0,9)),e.uniform3fv(R.uSkyA,o.ST.sky),e.uniform3fv(R.uGndA,o.ST.gnd),e.uniform1f(R.uExposure,t.exposure),e.uniform1f(R.uVig,t.vignette),e.uniform1f(R.uLit,t.lit),e.uniform1f(R.uAmb,t.amb),e.uniform1f(R.uFloorKind,t.floorKind),e.uniform1f(R.uSkyKind,t.skyKind),e.uniform3fv(R.uSky0,t.sky0),e.uniform3fv(R.uSky1,t.sky1),e.uniform4fv(R.uFog,t.fog),e.uniform4fv(R.uRoom,t.room),e.uniform4f(R.uGround,o.SR,o.maxH,1,0),e.uniform4fv(R.uBox,g),e.uniform1f(R.uNBox,s),e.activeTexture(e.TEXTURE0),e.bindTexture(e.TEXTURE_2D,o.shTex),e.uniform1i(R.uSh,0),e.drawElements(e.TRIANGLES,F,e.UNSIGNED_INT,S*4)}e.bindVertexArray(null),e.disable(e.POLYGON_OFFSET_FILL),m=performance.now()-p},free(){for(const o of M)e.deleteBuffer(o);e.deleteVertexArray(y),e.deleteVertexArray(b),e.deleteProgram(i),u&&e.deleteProgram(u),e.deleteProgram(w)}}}export{M0 as CLEAR,j as FIX,B as MAT,I0 as NO_WALL,o0 as SCOREBOARD,_ as TRACK,x0 as buildScene,ne as createScene,Q0 as drawOrder,J as mesher,K0 as onScoreboard,$0 as sceneRig};
