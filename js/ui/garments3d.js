const et=(t,o,n)=>Math.min(n,Math.max(o,t)),D=(t,o,n)=>{const c=et((n-t)/(o-t),0,1);return c*c*(3-2*c)},kt={tech:0,jersey:1,cotton:2,fleece:3,lycra:4,shirting:5,wool:6,denim:7},mt={none:{bridge:0,ease:0,loose:0,mat:"jersey"},bra:{bridge:.88,ease:0,loose:0,mat:"lycra"},tank:{bridge:1,ease:.04,loose:.15,mat:"jersey"},stringer:{bridge:1,ease:.08,loose:.25,mat:"jersey",curves:"stringer",detail:3},tee:{bridge:1,ease:.05,loose:.2,mat:"jersey"},boxtee:{bridge:1,ease:.3,loose:.65,mat:"cotton",sleeve:.6,hemK:.2,detail:4},crop:{bridge:1,ease:.05,loose:.2,mat:"jersey",hemNav:.32,detail:5},longsleeve:{bridge:1,ease:.08,loose:.35,mat:"jersey"},hoodie:{bridge:1,ease:.48,loose:1,mat:"fleece",hemK:.12,cuff:.3,detail:1,hood:.8},zip:{bridge:1,ease:.3,loose:.7,mat:"tech",hemK:.2,cuff:.2,detail:2},dress:{bridge:1,ease:.1,loose:.4,mat:"shirting"},dressrolled:{bridge:1,ease:.1,loose:.4,mat:"shirting"},blouse:{bridge:1,ease:.1,loose:.4,mat:"shirting"},shorts:{bridge:.93,ease:.06,loose:.3,mat:"tech"},athletic:{bridge:1,ease:.42,flare:.35,loose:.8,mat:"tech",cut:[2.1,.12],detail:1},bike:{bridge:.88,ease:0,loose:0,mat:"lycra"},compression:{bridge:.88,ease:0,loose:0,mat:"lycra"},capri:{bridge:.88,ease:0,loose:0,mat:"lycra"},leggings:{bridge:.88,ease:0,loose:0,mat:"lycra"},tights:{bridge:.88,ease:0,loose:0,mat:"lycra"},joggers:{bridge:1,ease:.42,loose:1,mat:"fleece",cuff:.28,detail:2},slacks:{bridge:1,ease:.16,loose:.5,mat:"wool"},jeans:{bridge:1,ease:.1,loose:.45,mat:"denim"}},Lt=t=>mt[t]||mt.none,xt=(t,o)=>{const n=t.bones[t.B[o]].head,c=t.base;return[c[n*3],c[n*3+1],c[n*3+2]]},$=(t,o)=>[t[0]-o[0],t[1]-o[1],t[2]-o[2]],pt=(t,o)=>t[0]*o[0]+t[1]*o[1]+t[2]*o[2],it=t=>Math.hypot(t[0],t[1],t[2]),bt=(t,o)=>et(t.grp[o*6+2]+t.grp[o*6+3],0,1),qt=new WeakMap;function Jt(t,o,n){const c=o.topStyle||"none",s=o.bottomStyle||"shorts",a=c+"|"+s;let l=qt.get(n);if(l||qt.set(n,l=new Map),l.has(a))return l.get(a);const i=Lt(c),d=Lt(s),m=t.base,u=p=>m[p*3+1],M=u(t.lm.navelV),C=u(t.lm.crotchV),f={...n,top:n.top.slice(),shortsCut:d.cut||null};return i.hemK!=null&&(f.top[0]=C+i.hemK*(M-C)),i.hemNav!=null&&(f.top[0]=M+i.hemNav),i.sleeve!=null&&(f.top[3]=i.sleeve*it($(n.el,n.sh))),f.fitTop=i,f.fitBottom=d,l.set(a,f),f}function Pt(t){const o=t.fitTop||mt.none,n=t.fitBottom||mt.shorts;return{cloth:[o.detail||0,n.detail||0,kt[o.mat]||0,kt[n.mat]||0],cloth2:[o.loose||0,n.loose||0,o.cuff||0,n.cuff||0]}}const Ft=new WeakMap;function Nt(t,o,n,c){const s=o.fitTop||mt.none,a=o.fitBottom||mt.shorts,l=[n,c,o.top.join(","),o.leg.join(","),String(o.shortsCut),s.ease,a.ease,s.bridge,a.bridge,s.cuff,a.cuff].join("|");let i=Ft.get(t);if(i||Ft.set(t,i=new Map),i.has(l))return i.get(l);const d=t.nMesh,m=t.base,u=t.lm,M=k=>m[k*3+1],C=M(u.navelV),f=M(u.nippleV),p=M(u.crotchV),v=M(t.notchV),B=t.sex==="female",H=B&&u.imfV!=null?M(u.imfV):f-.4,O=o.sh,E=o.el,F=o.wr||xt(t,"handL"),W=$(E,O),I=it(W),J=$(F,E),L=it(J),K=new Float32Array(d),P=new Float32Array(d),h=new Float32Array(d),g=new Float32Array(d),T=(k,S)=>Math.max(0,1-Math.abs(k)/S),N=o.shortsCut||[1.25,.25],U=c>=4,V=.2,q=xt(t,"neck")[2]-.1;for(let k=0;k<d;k++){const S=t.part[k];if(S===1||S===6)continue;const _=m[k*3],Z=m[k*3+1],G=m[k*3+2],X=Math.abs(_),nt=bt(t,k),A=[X,Z,G];let Q=0,dt=0;if(S===0||S===4||S===5){let e=C-.55-.12*D(0,1.2,X),r=p-N[0]+N[1]*D(.4,1.4,X);c>0&&(e+=o.leg[1],r=o.leg[0]),U&&o.hemBare!=null&&(r=Math.max(r,o.drapeY??r));const y=D(e,e-V,Z),x=D(r,r+V,Z),b=D(.2,.1,nt);Q=y*x*b;const w=a.cuff||0,z=w?D(r+.05,r+w+.25,Z):D(r,r+.15,Z),j=a.flare?1+a.flare/a.ease*D(p,r,Z):1;dt=a.ease*j*D(e-.05,e-.3,Z)*z*b,g[k]=Math.max(T(Z-r,.4),n>1?0:T(Z-e,.4))*b}let ht=0,ct=0;if(n>0){const e=D(.25,.1,nt);let r=o.top[0],y=v-.1;n===1?(r=H-.37,y=f+.45):n===2&&s.curves!=="stringer"?y=f+.55:s.curves==="stringer"&&(y=f+.2);const x=D(r,r+V,Z)*D(y,y-V,Z),b=f+(s.curves==="stringer"?-1.1:B?.45:-.05),w=.55*O[0]+(s.curves==="stringer"?.1:.24),z=n===2?1-D(b-.1,b+.1,Z)*D(w-.1,w+.1,X):1;if(S===0&&(ht=x*e*z),n>1&&S===0&&(g[k]=Math.max(g[k],T(Z-r,.4)*e)),s.ease>0){let j=0;n===3?j=D(0,.2,o.top[3]-pt($(A,O),W)/I*D(.12,.55,nt)):n>=4&&o.shirt&&(j=D(0,(s.cuff||.1)+.15,o.shirt[3]-pt($(A,E),J)/L*D(.12,.55,nt)));const R=s.cuff?D(r+.02,r+s.cuff+.2,Z):D(r,r+.15,Z),st=(S===0?1:0)*R*D(v+.15,v-.25,Z);ct=s.ease*(st*e+.7*j*(1-e)),s.hood&&S<=1&&G<q&&(ct+=s.hood*Tt(X,Z,v)),s.hood&&S===0&&(ct+=.35*s.hood*D(v-.45,v-.1,Z)*e)}}K[k]=Math.max(Q*a.bridge,ht*s.bridge),P[k]=Math.max(dt,ct),h[k]=ht>.01?s.loose||0:(a.loose||0)*Q}const Y={bridge:K,ease:P,drape:h,band:g};return i.set(l,Y),Y}const ot={dy:.3,passes:24,omega:1.6,max:3.5,nrmPasses:8,drapeIn:6,drapeK:.7},vt=new WeakMap;function jt(t,o,n=null){if(!n&&vt.has(o))return vt.get(o);const c=t.nMesh,s=o.rest,a=o.restNrm,{off:l,idx:i}=t.adj,d=t.weld,m=t.base,u=t.tris,M=m[t.bones[t.B.footL].head*3+1]+.3,C=m[t.notchV*3+1]+.2,f=m[t.lm.crotchV*3+1],p=new Uint8Array(c),v=new Uint8Array(c);for(let e=0;e<c;e++){const r=t.part[e],y=m[e*3+1];(r===0||r===4||r===5)&&bt(t,e)<.5&&(v[e]=1),d[e]===e&&v[e]&&y>M&&y<C&&bt(t,e)<.3&&(p[e]=1),n&&(y<n[0]||y>n[1]||m[e*3+2]>n[2])&&(p[e]=0)}let B=Float32Array.from(a.subarray(0,c*3)),H=new Float32Array(c*3);for(let e=0;e<ot.nrmPasses;e++){for(let r=0;r<c;r++){if(d[r]!==r)continue;let y=B[r*3],x=B[r*3+1],b=B[r*3+2];for(let z=l[r];z<l[r+1];z++){const j=i[z]*3;y+=B[j],x+=B[j+1],b+=B[j+2]}const w=Math.hypot(y,x,b)||1;H[r*3]=y/w,H[r*3+1]=x/w,H[r*3+2]=b/w}[B,H]=[H,B]}const O=f-.6,E=f-.2;let F=1/0,W=-1/0;for(let e=0;e<c;e++)p[e]&&(F=Math.min(F,s[e*3+1]),W=Math.max(W,s[e*3+1]));const I=ot.dy,J=Math.max(1,Math.ceil((W-F)/I)+1),L=Array.from({length:J*3},()=>[]),K=new Uint8Array(c);for(let e=0;e<c;e++){if(!v[e])continue;const r=m[e*3+1];n&&(r<n[0]||r>n[1]+.3||m[e*3+2]>n[2]+.3)||(K[e]=(r>=O?1:0)|(r<E?m[e*3]>=0?2:4:0))}for(let e=0;e<u.length;e+=3){const r=u[e],y=u[e+1],x=u[e+2],b=K[r]&K[y]&K[x];if(!b)continue;const w=s[r*3+1],z=s[y*3+1],j=s[x*3+1],R=Math.min(w,z,j),st=Math.max(w,z,j);for(let rt=Math.max(0,Math.ceil((R-F)/I));rt<J&&F+rt*I<=st;rt++){const ft=F+rt*I;for(let tt=0;tt<3;tt++){const at=tt===0?r:tt===1?y:x,ut=tt===0?y:tt===1?x:r,lt=s[at*3+1],Ct=s[ut*3+1];if(lt<ft==Ct<ft)continue;const Bt=(ft-lt)/(Ct-lt),Kt=[s[at*3]+(s[ut*3]-s[at*3])*Bt,s[at*3+2]+(s[ut*3+2]-s[at*3+2])*Bt];for(let yt=0;yt<3;yt++)b&1<<yt&&L[rt*3+yt].push(Kt)}}}const P=L.map(e=>e.length>=6?Mt(e):null),h=new Float32Array(c*3),g=e=>{if(!e)return null;const r=e.length,y=new Float64Array(r*4);for(let x=0;x<r;x++){const b=e[x],w=e[(x+1)%r],z=w[0]-b[0],j=w[1]-b[1],R=Math.hypot(z,j)||1;y[x*4]=b[0],y[x*4+1]=b[1],y[x*4+2]=-j/R,y[x*4+3]=z/R}return y},T=(e,r,y)=>{if(!e)return null;let x=1/0,b=0;for(let w=0;w<e.length;w+=4){const z=(r-e[w])*e[w+2]+(y-e[w+1])*e[w+3];z<x&&(x=z,b=w)}return x>0?[-e[b+2]*x,-e[b+3]*x]:[0,0]},N=(e,r)=>{let y=0,x=0;for(const b of e)y+=b[0],x+=b[1];return y/=e.length,x/=e.length,e.map(b=>{const w=b[0]-y,z=b[1]-x,j=Math.hypot(w,z),R=j>r?(j-r)/j:0;return[y+w*R,x+z*R]})},U=P.slice(),V=n?0:Math.round(ot.drapeIn/I);for(let e=0;e<J;e++){const r=P[e*3];if(!r)continue;const y=r.slice();for(let x=2;x<=V&&e+x<J;x+=2){const b=P[(e+x)*3];if(b)for(const w of N(b,ot.drapeK*x*I))y.push(w)}U[e*3]=Mt(y)}const q=P.map(g),Y=U.map((e,r)=>e===P[r]?q[r]:g(e)),k=(e,r,y)=>{const x=(s[r*3+1]-F)/I,b=Math.floor(x),w=x-b,z=T(e[b*3+y],s[r*3],s[r*3+2]),j=T(e[Math.min(J-1,b+1)*3+y],s[r*3],s[r*3+2]);return z&&j?[z[0]+(j[0]-z[0])*w,z[1]+(j[1]-z[1])*w]:z||j||[0,0]},S=new Float32Array(c*3);for(let e=0;e<c;e++){if(!p[e]||Math.hypot(B[e*3],B[e*3+2])<.05)continue;const r=D(O,E,m[e*3+1]),y=m[e*3]>=0?1:2;for(const[x,b,w]of[[q,h,!1],[Y,S,!0]]){if(w&&(r<=0||n)){b[e*3]=h[e*3],b[e*3+2]=h[e*3+2];continue}const z=r>0?k(x,e,0):[0,0],j=r<1?k(x,e,y):[0,0];let R=j[0]+(z[0]-j[0])*r,st=j[1]+(z[1]-j[1])*r;const rt=B[e*3],ft=B[e*3+2],tt=Math.hypot(rt,ft),at=Math.hypot(R,st),ut=(R*rt+st*ft)/(at*(tt||1));if(at>1e-6){let lt=D(.3,.6,tt)*D(.2,.6,ut);w&&m[e*3+1]>f+.3&&(lt=Math.max(lt,D(.05,.25,tt)*D(0,.4,ut))),R*=lt,st*=lt}b[e*3]=R,b[e*3+2]=st}}const _=l[c],Z=new Float32Array(_),G=new Float32Array(_);for(let e=0;e<c;e++){if(!p[e])continue;const r=B[e*3],y=B[e*3+1],x=B[e*3+2];for(let b=l[e];b<l[e+1];b++){const w=i[b];Z[b]=(s[w*3]-s[e*3])*r+(s[w*3+1]-s[e*3+1])*y+(s[w*3+2]-s[e*3+2])*x,G[b]=B[w*3]*r+B[w*3+1]*y+B[w*3+2]*x}}const X=new Float64Array(c),nt=ot.omega,A=ot.max,Q=[];for(let e=0;e<c;e++)p[e]&&l[e+1]>l[e]&&Q.push(e);const dt=Int32Array.from(Q),ht=dt.length;for(let e=0;e<(n?0:ot.passes);e++)for(let r=0;r<2;r++)for(let y=0;y<ht;y++){const x=dt[r?ht-1-y:y],b=l[x],w=l[x+1];let z=0;for(let R=b;R<w;R++)z+=Z[R]+G[R]*X[i[R]];const j=X[x]+nt*(z/(w-b)-X[x]);X[x]=j<0?0:j>A?A:j}for(const e of[h,S])for(let r=0;r<c;r++){const y=d[r];if(!p[y]){e[r*3]=e[r*3+1]=e[r*3+2]=0;continue}if(y!==r){for(let z=0;z<3;z++)e[r*3+z]=e[y*3+z];continue}const x=e[r*3]*B[r*3]+e[r*3+2]*B[r*3+2],b=Math.max(0,X[r]-x);for(let z=0;z<3;z++)e[r*3+z]+=B[r*3+z]*b;const w=Math.hypot(e[r*3],e[r*3+1],e[r*3+2]);if(w>ot.max)for(let z=0;z<3;z++)e[r*3+z]*=ot.max/w}for(let e=0;e<c;e++){const r=d[e];if(r!==e)for(let y=0;y<3;y++)B[e*3+y]=B[r*3+y]}const ct={disp:h,drape:S,dir:B};return n||vt.set(o,ct),ct}const wt=new WeakMap;function zt(t,o){const n=t.nMesh,c=t.tris,s=new Float32Array(n*3),a=t.weld;for(let l=0;l<c.length;l+=3){const i=c[l]*3,d=c[l+1]*3,m=c[l+2]*3,u=o[d]-o[i],M=o[d+1]-o[i+1],C=o[d+2]-o[i+2],f=o[m]-o[i],p=o[m+1]-o[i+1],v=o[m+2]-o[i+2],B=M*v-C*p,H=C*f-u*v,O=u*p-M*f;for(let E=0;E<3;E++){const F=a[c[l+E]]*3;s[F]+=B,s[F+1]+=H,s[F+2]+=O}}for(let l=0;l<n;l++){const i=a[l]*3,d=Math.hypot(s[i],s[i+1],s[i+2])||1;s[l*3]=s[i]/d,s[l*3+1]=s[i+1]/d,s[l*3+2]=s[i+2]/d}return s}function Ot(t,o,n){const c=wt.get(o);return!!(c&&c.has(n))}function Wt(t,o,n,c,s=a=>zt(t,a)){if(!c||o.mixOf)return n;let a=wt.get(o);if(a||wt.set(o,a=new Map),a.has(c))return a.get(c);const l=t.nMesh,{disp:i,drape:d,dir:m}=jt(t,o),{bridge:u,ease:M,drape:C}=c,f=Float32Array.from(n.pos),p=new Float32Array(l);let v=!1;for(let h=0;h<l;h++){const g=u[h],T=M[h],N=C[h];if(g<=0&&T<=0)continue;const U=i[h*3]+(d[h*3]-i[h*3])*N,V=i[h*3+1]+(d[h*3+1]-i[h*3+1])*N,q=i[h*3+2]+(d[h*3+2]-i[h*3+2])*N,Y=U*g+m[h*3]*T,k=V*g+m[h*3+1]*T,S=q*g+m[h*3+2]*T,_=Math.hypot(Y,k,S);_<=1e-4||(p[h]=_,v=!0,f[h*3]+=Y,f[h*3+1]+=k,f[h*3+2]+=S)}if(!v)return a.set(c,n),n;St(t,o,f,c.band);const B=s(f.subarray(0,l*3)),H=Float32Array.from(n.nrm),O=Float32Array.from(n.fab),E=Float32Array.from(n.ao),F=Float32Array.from(n.cav),{off:W,idx:I}=t.adj;for(let h=0;h<l;h++){const g=Math.max(u[h],M[h]>0?1:0);if(g<=0&&p[h]<=0)continue;const T=Math.min(1,g*1.5);for(let q=0;q<3;q++)H[h*3+q]=n.nrm[h*3+q]+(B[h*3+q]-n.nrm[h*3+q])*T,O[h*3+q]=n.fab[h*3+q]+(B[h*3+q]-n.nrm[h*3+q])*T;const N=Math.hypot(H[h*3],H[h*3+1],H[h*3+2])||1,U=Math.hypot(O[h*3],O[h*3+1],O[h*3+2])||1;for(let q=0;q<3;q++)H[h*3+q]/=N,O[h*3+q]/=U;const V=et(p[h]/.35,0,1);if(V>0){const q=t.weld[h];let Y=n.ao[h];for(let k=W[q];k<W[q+1];k++)Y=Math.max(Y,n.ao[I[k]]);for(let k=W[q];k<W[q+1];k++){const S=I[k];for(let _=W[S];_<W[S+1];_++)Y=Math.max(Y,n.ao[I[_]])}E[h]=n.ao[h]+(Y-n.ao[h])*V,F[h]>=0&&F[h]<=1&&(F[h]*=1-V)}}let J=0;const L=t.base[t.lm.nippleV*3+1],K=t.base[t.bones[t.B.neck].head*3+2]+.2;for(let h=0;h<l;h++)t.part[h]===0&&t.base[h*3+1]>L&&t.base[h*3+2]<K&&(J=Math.max(J,p[h]));const P={...n,pos:f,nrm:H,fab:O,ao:E,cav:F,dressOff:p,hairOff:J};return a.set(c,P),P}function St(t,o,n,c){const s=t.nMesh,a=t.base,l=o.rest,{off:i,idx:d}=t.adj,m=t.lm,u=(l[m.navelV*3+1]-l[m.crotchV*3+1])/(a[m.navelV*3+1]-a[m.crotchV*3+1]);let M=new Float32Array(s),C=new Float32Array(s);for(let p=0;p<s;p++)M[p]=n[p*3+1]-u*a[p*3+1];const f=Float32Array.from(M);for(let p=0;p<12;p++){for(let v=0;v<s;v++){if(c[v]<=0||t.weld[v]!==v){C[v]=M[v];continue}let B=M[v];for(let H=i[v];H<i[v+1];H++)B+=M[d[H]];C[v]=B/(i[v+1]-i[v]+1)}[M,C]=[C,M]}for(let p=0;p<s;p++){const v=c[t.weld[p]];v>0&&(n[p*3+1]+=(M[t.weld[p]]-f[t.weld[p]])*v)}}function It(t,o,n,c=null){const s=c||{};for(const a of["pos","nrm","fab","ao","cav"]){const l=t[a],i=o[a];(!s[a]||s[a].length!==l.length)&&(s[a]=new Float32Array(l.length));const d=s[a];for(let m=0;m<d.length;m++)d[m]=l[m]+(i[m]-l[m])*n}for(const a of["nrm","fab"]){const l=s[a];for(let i=0;i<l.length;i+=3){const d=Math.hypot(l[i],l[i+1],l[i+2]);d>1e-9&&(l[i]/=d,l[i+1]/=d,l[i+2]/=d)}}(!s.flare||s.flare.length!==t.flare.length)&&(s.flare=new Float32Array(t.flare.length));for(let a=0;a<s.flare.length;a++)s.flare[a]=t.flare[a]+(o.flare[a]-t.flare[a])*n;return s.seat=t.seat&&o.seat?t.seat.map((a,l)=>a+(o.seat[l]-a)*n):t.seat||o.seat,s}const gt={top:0,depth:1.7,half:1.15};function Tt(t,o,n){const c=(n+gt.top-o)/(gt.depth+gt.top);if(c<=0||c>=1)return 0;const s=gt.half*Math.sqrt(Math.max(0,1-c*c));return D(s,s-.25,t)*D(.05,.35,c)*(1-.5*c)}function Zt(t,o,n){if(!o.fitTop||o.fitTop.curves!=="stringer")return null;if(t.stringerEdges)return t.stringerEdges;const c=t.base,s=L=>[c[L*3],c[L*3+1],c[L*3+2]],a=s(t.lm.nippleV)[1],l=s(t.notchV)[1],i=s(t.bones[t.B.uarm1L].head),d=.5*i[0],m=.1,u=.35,M=.6,C=-1.1,f=3,p=[30,30,1],v=[100,30,1],B=[25,1,10],H=[1,8,8],O=(L,K,P)=>L+(K-L)*P,E=L=>{const K=Math.hypot(...L)||1;return L.map(P=>P/K)},F=L=>E([-.8*L[0],1,0]),W=L=>$(i,L),I=n(t,[[[0,a+u,f],v],[[.5*(d-m),a+u+.15,f],p],[[d-m,l-.1,f],p],[[d-m,l+3,-.15],B],[[d-m,l-.1,-f],p],[[.6*(d-m),l-M+.05,-f],p],[[0,l-M,-f],v]],!1,F,20),J=n(t,[[[d+m,l+3,-.15],B],[[d+m*1.1,l-.15,f],p],[[O(d+m,i[0],.55),a+.2,f],p],[[O(d+m,i[0],.6),a+C+.25,f],p],[[3,a+C,.2],H],[[O(d+m,i[0],.45),a+C+.1,-f],p],[[.85*d,l-1.2,-f],p],[[d+m*.6,l-.5,-f],p]],!0,W,24);return t.stringerEdges={neck:I,arm:J}}const Rt=["ex:db_rdl",.45];function Ut(t,o,n,c,s){const a=t.nMesh,l=t.base,i=t.lm,d=t.B,{pos:m,M:u,J:M}=s(n.pos),C=d.pelvis*16,f=[u[C],u[C+1],u[C+2],u[C+4],u[C+5],u[C+6],u[C+8],u[C+9],u[C+10]],p=[u[C+12],u[C+13],u[C+14]],v=new Float32Array(a*3);for(let g=0;g<a;g++){const T=m[g*3]-p[0],N=m[g*3+1]-p[1],U=m[g*3+2]-p[2];v[g*3]=f[0]*T+f[1]*N+f[2]*U,v[g*3+1]=f[3]*T+f[4]*N+f[5]*U,v[g*3+2]=f[6]*T+f[7]*N+f[8]*U}const B=l[i.crotchV*3+1],H=l[i.navelV*3+1],O=.5*(l[i.navelV*3+2]+l[i.buttV*3+2]),E=jt(t,{rest:v,restNrm:zt(t,v)},[B-.05,H-.3,O]).disp,F=new Float32Array(a*3),{skinIdx:W,skinW:I}=t;for(let g=0;g<a;g++){const T=c.bridge[g];if(T<=0||l[g*3+1]>=H-.3)continue;const N=E[g*3],U=E[g*3+1],V=E[g*3+2];if(N===0&&U===0&&V===0)continue;const q=[f[0]*N+f[3]*U+f[6]*V,f[1]*N+f[4]*U+f[7]*V,f[2]*N+f[5]*U+f[8]*V],Y=new Float64Array(9);for(let G=0;G<4;G++){const X=I[g*4+G];if(!X)continue;const nt=W[g*4+G]*16;for(let A=0;A<3;A++)for(let Q=0;Q<3;Q++)Y[A*3+Q]+=X*u[nt+A*4+Q]}const k=Dt(Y);if(!k)continue;const S=[0,1,2].map(G=>k[G]*q[0]+k[3+G]*q[1]+k[6+G]*q[2]),_=Math.hypot(...S),Z=_>Vt?Vt/_:1;for(let G=0;G<3;G++)F[g*3+G]=T*S[G]*Z}const J=Float32Array.from(n.pos);for(let g=0;g<a*3;g++)J[g]+=F[g];const L=zt(t,s(J).pos),K=new Float32Array(a*3);for(let g=0;g<a;g++){if(c.bridge[g]<=0||l[g*3+1]>=H-.3||Math.hypot(F[g*3],F[g*3+1],F[g*3+2])<.01)continue;const T=new Float64Array(9);for(let V=0;V<4;V++){const q=I[g*4+V];if(!q)continue;const Y=W[g*4+V]*16;for(let k=0;k<3;k++)for(let S=0;S<3;S++)T[k*3+S]+=q*u[Y+k*4+S]}const N=[0,1,2].map(V=>T[V*3]*L[g*3]+T[V*3+1]*L[g*3+1]+T[V*3+2]*L[g*3+2]),U=Math.hypot(...N)||1;for(let V=0;V<3;V++)K[g*3+V]=N[V]/U}const P=Ht(t,o.heads),h=Ht(t,M);return{e:F,nrm:K,hip:[.5*(P[0]+P[1]),Math.max(.5*(P[0]+P[1])+.05,.5*(h[0]+h[1]))]}}function Dt(t){const o=(a,l)=>t[l*3+a],n=(a,l)=>{const i=(a+1)%3,d=(a+2)%3,m=(l+1)%3,u=(l+2)%3;return o(i,m)*o(d,u)-o(i,u)*o(d,m)},c=o(0,0)*n(0,0)+o(0,1)*n(0,1)+o(0,2)*n(0,2);if(Math.abs(c)<1e-9)return null;const s=new Array(9);for(let a=0;a<3;a++)for(let l=0;l<3;l++)s[l*3+a]=n(l,a)/c;return s}function Gt(t,[o,n]){return[et((t[0]-o)/(n-o),0,1.4),et((t[1]-o)/(n-o),0,1.4)]}const Vt=1;function Ht(t,o){const n=t.B,c=(u,M,C)=>{const f=$(o[u],o[M]),p=$(o[C],o[M]);return Math.acos(et(pt(f,p)/(it(f)*it(p)||1),-1,1))},s=u=>et(((Math.PI-u)/(Math.PI*2/3)-.15)/.85,0,1),a=(()=>{const u=$(o[n.spine2],o[n.spine1]),M=it(u)||1;return u.map(C=>C/M)})(),l=(()=>{const u=$(o[n.spine1],o[n.pelvis]),M=pt(u,a),C=u.map((p,v)=>p-M*a[v]),f=it(C)||1;return C.map(p=>p/f)})(),i=u=>{const M=$(o[n["shin"+u]],o[n["thigh"+u]]);return et(Math.atan2(pt(M,l),-pt(M,a))/(Math.PI*2/3),0,1)},d=u=>s(c(n["thigh"+u],n["shin"+u],n["foot"+u])),m=u=>s(c(n["uarm1"+u],n["farm1"+u],n["hand"+u]));return[i("L"),i("R"),d("L"),d("R"),m("L"),m("R"),0,0]}function Yt(t){if(t.clothJ)return t.clothJ;const o=t.base,n=t.lm.navelV,c=t.lm.buttV,s=["thighL","shinL","footL","uarm1L","farm1L","handL"].map(a=>xt(t,a));return t.clothJ={J:new Float32Array(s.flat()),z:[.5*(o[n*3+2]+o[c*3+2]),s[0][2],o[t.notchV*3+1]]}}const _t=`
uniform vec2 uClothHair;
vec3 clothKeepOut(vec3 q){
  if (uClothHair.x <= 0.0 || dot(aAncN, aAncN) < 1e-10 || aAncP.y > uClothHair.y + 3.0) return q;
  ivec4 ja = ivec4(aAncJ + 0.5);
  mat3x4 Ma = aAncW.x * uBones[ja.x] + aAncW.y * uBones[ja.y] + aAncW.z * uBones[ja.z] + aAncW.w * uBones[ja.w];
  vec3 ap = vec4(aAncP, 1.0) * Ma, an = normalize(vec4(aAncN, 0.0) * Ma);
  float need = length(aAncN) + uClothHair.x * (1.0 - smoothstep(uClothHair.y, uClothHair.y + 3.0, aAncP.y)), d = dot(q - ap, an);
  if (d < need) q += an * (need - d);
  return q;
}
`,Xt=`
uniform vec4 uCloth;        // v5/look-cloth: x top detail, y bottom detail, z top fabric, w bottom fabric (garments3d.js MATS)
uniform vec4 uCloth2;       // x top fold (looseness), y bottom fold, z top cuff (dm), w bottom cuff (dm)
uniform vec4 uClothB[2];    // the pose's bend: [0] hip L, hip R, knee L, knee R; [1] elbow L, elbow R
uniform vec3 uClothJ[6];    // canonical joints (left): hip, knee, ankle, shoulder, elbow, wrist
uniform vec3 uClothZ;       // canonical z of the trunk's side seam and of the legs' seams, and the notch's y
uniform vec3 uHoodK;        // the hood's outline (garments3d.js HOOD): top above the notch, depth, half-width
float cLine(float d, float w){ return 1.0 - smoothstep(0.5 * w, 1.5 * w, abs(d)); }
// fold height (in) on the legs: the knee's back, the hip's front crease, the cuff's gathers, a loose drape
float legFolds(vec3 c, float loose, float cuff, float hem){
  bool L = c.x >= 0.0; vec3 q = vec3(abs(c.x), c.y, c.z);
  float hipB = L ? uClothB[0].x : uClothB[0].y, kneeB = L ? uClothB[0].z : uClothB[0].w;
  vec3 K = uClothJ[1], H = uClothJ[0];
  vec2 r = normalize(q.xz - K.xz + vec2(1e-4)); float ang = atan(r.x, r.y);
  float amp = 0.3 + 0.7 * loose, h = 0.0;
  float tk = c.y - K.y;
  if (kneeB > 0.02) h += kneeB * amp * 0.07 * exp(-tk * tk / 0.3) * smoothstep(-0.2, 0.7, -r.y) * sin(tk * 24.0 + 1.7 * sin(ang * 3.0));
  float th = c.y - (H.y - 0.35);
  vec2 rh = normalize(q.xz - H.xz + vec2(1e-4));
  if (hipB > 0.02) h += hipB * amp * 0.06 * exp(-th * th / 0.12) * smoothstep(0.0, 0.7, rh.y) * sin(th * 30.0 + 4.0 * (q.x - H.x));
  if (cuff > 0.0) { float tc = c.y - hem - cuff; float g = smoothstep(0.7, 0.0, tc) * step(0.0, tc); h += 0.05 * g * sin(ang * 11.0 + tc * 9.0) * (0.6 + 0.4 * sin(ang * 4.0 + 1.3)); }
  if (loose > 0.5) h += loose * 0.035 * sin(ang * 5.0 + 2.0 * sin(c.y * 1.3 + ang * 2.0)) * smoothstep(K.y + 1.5, K.y, c.y);
  return h * smoothstep(hem, hem + 0.2, c.y);   // (nothing at the hem itself: the bump is taken across the garment's edge)
}
// fold height (in) on a top: the elbow's crook (sleeves), gathers above a rib hem or cuff, a loose top's waist bunching
float topFolds(vec3 c, float armw, float loose, float cuff, float hem){
  bool L = c.x >= 0.0; vec3 q = vec3(abs(c.x), c.y, c.z);
  float elB = L ? uClothB[1].x : uClothB[1].y;
  vec3 S = uClothJ[3], E = uClothJ[4], W = uClothJ[5], d = normalize(W - E);
  float te = dot(q - E, d), onArm = smoothstep(0.2, 0.6, armw), amp = 0.3 + 0.7 * loose;
  vec3 rr = q - E - d * te; float front = smoothstep(-0.1, 0.6, rr.z / max(length(rr), 1e-4));
  float h = elB < 0.02 ? 0.0 : elB * amp * 0.06 * exp(-te * te / 0.12) * front * onArm * sin(te * 30.0 + 3.0 * rr.y);
  if (cuff > 0.0) {
    float tw = length(W - E) - te; float g = smoothstep(0.6, 0.05, tw - cuff) * onArm;
    h += 0.04 * g * sin(atan(rr.x, rr.z) * 9.0 + te * 10.0);
    float tb = c.y - hem - cuff; float gb = smoothstep(0.6, 0.0, tb) * step(0.0, tb) * (1.0 - onArm);
    h += 0.04 * gb * sin(q.x * 16.0 + 2.0 * sin(c.y * 7.0 + c.z * 5.0));
  }
  if (loose > 0.5) h += loose * 0.015 * sin(q.x * 9.0 + 3.0 * sin(c.y * 2.3 + c.z * 4.0)) * (1.0 - onArm);
  return h * smoothstep(hem, hem + 0.2, c.y);
}
// the hood's outline on the back (the HOOD constants in uHoodK): signed, > 0 inside
float hoodField(vec3 c, float notch){
  float v = (notch + uHoodK.x - c.y) / (uHoodK.y + uHoodK.x);
  float hw = uHoodK.z * sqrt(max(1.0 - v * v, 0.0));
  float f = min(min(hw - abs(c.x), v * 2.0), (1.0 - v) * 2.0);
  return c.z < uClothJ[3].z + 0.3 ? f : -1.0;   // (the back only)
}
// a knit's stretch (0..1) where the pose bends: the front of a bent knee, the seat over a flexed hip
float legStretch(vec3 c){
  bool L = c.x >= 0.0; vec3 q = vec3(abs(c.x), c.y, c.z);
  float hipB = L ? uClothB[0].x : uClothB[0].y, kneeB = L ? uClothB[0].z : uClothB[0].w;
  vec3 K = uClothJ[1], H = uClothJ[0];
  float tk = c.y - K.y; vec2 r = normalize(q.xz - K.xz + vec2(1e-4));
  float s = kneeB * exp(-tk * tk / 0.2) * smoothstep(0.0, 0.8, r.y);
  float ts = c.y - (H.y - 0.15);
  s = max(s, hipB * exp(-ts * ts / 0.6) * smoothstep(0.1, -0.6, c.z - uClothZ.x));
  return s;
}
// paint: x shade multiplier, y trim colour share (the stripe, the shorts' cords), z metal share (zip), w a cord in the garment's colour, lighter
// (px: a pixel in canonical dm, taken by the caller in uniform control flow: this runs inside the fabric's branch)
vec4 clothPaint(vec3 c, float armw, float onTop, float waist, float bandD, float hemB, float notch, float pxIn){
  float px = max(pxIn, 1e-4), lw = max(0.012, 0.9 * px), vis = 1.0 - smoothstep(0.01, 0.03, px);
  float lw2 = max(0.022, 1.1 * px), vis2 = 1.0 - smoothstep(0.05, 0.1, px);   // (stitches fade out first; seams and edges are wider)
  vec3 q = vec3(abs(c.x), c.y, c.z);
  float sh = 1.0, trim = 0.0, metal = 0.0, rgh = 0.0;
  bool front = c.z > uClothZ.x;
  if (onTop < 0.5) {
    float hb = uCloth.y;
    // the outseam and inseam (canonical: the leg's lateral and medial lines through the hip joint's z)
    float seam = cLine(c.z - uClothZ.y, lw2) * step(c.y, uClothJ[0].y);
    sh *= 1.0 - 0.18 * seam * vis2;
    // twin-needle hem
    float dh = c.y - hemB;
    if (vis > 0.0) sh *= 1.0 - 0.22 * vis * (cLine(dh - 0.06, lw * 0.8) + cLine(dh - 0.1, lw * 0.8)) * step(uCloth2.w, 0.001);
    if (hb > 0.5 && hb < 1.5) {   // athletic shorts: a side stripe in the trim colour, a drawcord at the front
      trim = max(trim, (1.0 - smoothstep(0.05, 0.05 + lw, abs(c.z - uClothZ.y))) * step(uClothJ[0].x * 0.9, q.x));
    }
    if (hb > 0.5) {   // athletic shorts and joggers: a corded waistband (ribs) and two cords hanging at the front
      float inBand = step(waist - bandD, c.y) * step(c.y, waist);
      sh *= 1.0 - 0.12 * inBand * (0.5 + 0.5 * sin(atan(c.x, c.z) * 90.0)) * vis;
      float cx = abs(q.x - 0.13);
      float cord = (1.0 - smoothstep(0.02, 0.02 + lw, cx)) * step(waist - bandD - 0.75 + 0.1 * c.x, c.y) * step(c.y, waist - 0.02) * step(0.0, c.z) * step(q.x, 0.25);
      trim = max(trim, cord);
    }
    if (hb > 1.5) {   // joggers: the rib cuff over the ankle
      float inCuff = step(hemB, c.y) * step(c.y, hemB + uCloth2.w);
      vec2 r = q.xz - uClothJ[2].xz;
      sh *= 1.0 - inCuff * (0.12 + 0.12 * (0.5 + 0.5 * sin(atan(r.x, r.y) * 70.0)) * vis);
      sh *= 1.0 - 0.3 * cLine(c.y - hemB - uCloth2.w, lw2) * vis2;
    }
  } else {
    float tb = uCloth.x;
    // the trunk's side seams and a twin-needle hem (not on the rib-hemmed pieces)
    float seam = cLine(c.z - uClothZ.x, lw2) * (1.0 - smoothstep(0.1, 0.2, armw)) * step(c.y, uClothJ[3].y - 0.75) * step(0.5, q.x);   // (up to the armpit)
    sh *= 1.0 - 0.16 * seam * vis2;
    float dh = c.y - hemB;
    if (vis > 0.0) sh *= 1.0 - 0.2 * vis * (cLine(dh - 0.06, lw * 0.8) + cLine(dh - 0.1, lw * 0.8)) * step(uCloth2.z, 0.001);
    if (uCloth2.z > 0.0) {   // rib hem band and cuffs (the hoodie, the zip jacket)
      float inHem = step(hemB, c.y) * step(c.y, hemB + uCloth2.z) * (1.0 - smoothstep(0.2, 0.4, armw));
      sh *= 1.0 - inHem * (0.1 + 0.1 * (0.5 + 0.5 * sin(atan(c.x, c.z - uClothZ.x) * 110.0)) * vis);
      sh *= 1.0 - 0.3 * cLine(c.y - hemB - uCloth2.z, lw2) * vis2 * (1.0 - smoothstep(0.2, 0.4, armw));
      vec3 d = normalize(uClothJ[5] - uClothJ[4]); float te = length(uClothJ[5] - uClothJ[4]) + 0.06 - dot(q - uClothJ[4], d);
      float inCuff = step(0.0, te) * step(te, uCloth2.z) * smoothstep(0.3, 0.6, armw);
      sh *= 1.0 - inCuff * 0.16;
      sh *= 1.0 - 0.3 * cLine(te - uCloth2.z, lw2) * vis2 * smoothstep(0.3, 0.6, armw);
    }
    if (tb > 0.5 && tb < 1.5) {   // hoodie: the pouch pocket, the hood (its seam and shade), two cords from the neck
      float py0 = hemB + uCloth2.z + 0.05, py1 = py0 + 1.25, pw = 0.85 - 0.25 * smoothstep(py0, py1, c.y);
      float inP = step(py0, c.y) * step(c.y, py1) * step(q.x, pw) * step(0.0, c.z - uClothZ.x - 0.2);
      float edgeP = max(cLine(q.x - pw, lw2), cLine(c.y - py1, lw2) * step(q.x, pw)) * step(py0, c.y) * step(c.y, py1) * step(0.0, c.z - uClothZ.x - 0.2);
      float slant = cLine(q.x - (pw - 0.25 + 0.45 * smoothstep(py0 + 0.2, py1 - 0.1, c.y)), lw2) * step(py0 + 0.2, c.y) * step(c.y, py1 - 0.1) * step(0.0, c.z - uClothZ.x - 0.2);
      sh *= (1.0 - 0.3 * edgeP * vis2) * (1.0 - 0.45 * slant * vis2) * (1.0 - 0.06 * inP);
      float hf = hoodField(c, notch);
      sh *= (1.0 - 0.35 * cLine(hf, lw2 * 1.5) * vis2) * (1.0 - 0.12 * smoothstep(-lw2, lw2, hf));
      float cord = (1.0 - smoothstep(0.022, 0.022 + lw, abs(q.x - 0.2))) * step(notch - 1.1, c.y) * step(c.y, notch - 0.15) * step(uClothJ[3].z + 0.2, c.z);
      rgh = max(rgh, cord);
      // the hood's rim round the neck (inside the crew curve's 0.2 dm) and its two edges crossing in a V under the notch
      float nd = neckSD(q), fr = step(uClothJ[3].z + 0.2, c.z);
      sh *= (1.0 - 0.1 * step(0.0, nd) * step(nd, 0.2)) * (1.0 - 0.35 * cLine(nd - 0.2, lw2) * vis2);
      float vx = 0.55 * (c.y - (notch - 0.4));
      sh *= 1.0 - 0.4 * cLine(q.x - vx, lw2) * vis2 * fr * step(notch - 0.4, c.y) * step(c.y, notch + 0.05);
    }
    if (tb > 1.5 && tb < 2.5) {   // zip jacket: the zip's tape and teeth down the front, its pull under the neck
      float fz = step(uClothZ.x + 0.25, c.z) * step(c.y, notch + 0.2);
      float tape = (1.0 - smoothstep(0.045, 0.045 + lw, q.x)) * fz;
      float teeth = (1.0 - smoothstep(0.016, 0.016 + lw, q.x)) * fz * (0.6 + 0.4 * step(0.5, fract(c.y * 60.0)) * vis);
      float pull = (1.0 - smoothstep(0.035, 0.035 + lw, q.x)) * step(notch - 0.55, c.y) * step(c.y, notch - 0.25) * step(uClothZ.x + 0.25, c.z);
      sh *= 1.0 - 0.2 * tape; metal = max(teeth, pull);
      sh *= 1.0 - 0.2 * vis2 * (cLine(c.y - (notch - 0.05), lw2) * step(uClothZ.x, c.z));   // the stand collar's seam
    }
    if (tb > 2.5 && tb < 3.5) {   // stringer: bound edges (neck and armholes), a shade darker
      float b = max(1.0 - smoothstep(0.05, 0.05 + lw, abs(neckSD(q) + 0.05)), 1.0 - smoothstep(0.05, 0.05 + lw, abs(armSD(q) + 0.05)));
      sh *= 1.0 - 0.18 * b;
    }
    if (tb > 3.5) {   // the regular tee and the crop: the sleeve's twin-needle hem
      vec3 d = uClothJ[4] - uClothJ[3];
      float fS = uTopK.w - dot(q - uClothJ[3], d) / length(d);
      if (vis > 0.0) sh *= 1.0 - 0.2 * vis * (cLine(fS - 0.06, lw * 0.8) + cLine(fS - 0.1, lw * 0.8)) * smoothstep(0.3, 0.6, armw);
    }
  }
  return vec4(sh, trim, metal, rgh);
}
// the fabric's response: x roughness, y sheen strength, z specular floor (f0)
vec3 clothMat(float m){
  if (m < 0.5) return vec3(0.66, 0.85, 0.05);   // tech (polyester)
  if (m < 1.5) return vec3(0.8, 1.0, 0.042);    // jersey
  if (m < 2.5) return vec3(0.86, 1.0, 0.04);    // cotton
  if (m < 3.5) return vec3(0.93, 1.25, 0.035);  // fleece
  if (m < 4.5) return vec3(0.52, 0.75, 0.05);   // lycra / spandex knit
  return vec3(-1.0);                            // shirting, wool, denim: their own (v5/airport-outfit)
}
// Mikkelsen 2010 ("Bump Mapping Unparametrized Surfaces on the GPU"): the normal under a height field h (in) on the
// world-space surface, from screen-space derivatives (uniform control flow)
vec3 clothBump(vec3 N, float h){
  vec3 dpx = dFdx(vW), dpy = dFdy(vW);
  float dhx = dFdx(h), dhy = dFdy(h);
  vec3 r1 = cross(dpy, N), r2 = cross(N, dpx);
  float det = dot(dpx, r1);
  vec3 g = sign(det) * (dhx * r1 + dhy * r2);
  return normalize(abs(det) * N - g);
}
`;function Qt(t,o,n,c,{mid:s=.8,slices:a=9,log:l=null}={}){const i=t.base,d=t.lm,m=E=>t.part[E]===0||t.part[E]===4||t.part[E]===5,u=d.crotchV,M=d.buttV,C=d.navelV,f=o[u*3+1]+.8,p=o[M*3+1]+.6*(o[C*3+1]-o[M*3+1]),v=.5*(o[C*3+2]+o[M*3+2]),B=i[u*3+1]-.3;let H=0,O=null;for(let E=0;E<a;E++){const F=f+(p-f)*(E+.5)/a,W=[];for(let J=0;J<c.length;J+=3){const L=[c[J],c[J+1],c[J+2]];if(!(!L.every(m)||L.some(K=>Math.abs(i[K*3])>2.2||o[K*3+2]>v||i[K*3+1]<B)))for(let K=0;K<3;K++){const P=L[K],h=L[(K+1)%3],g=n[P*3+1],T=n[h*3+1];if(g<F==T<F)continue;const N=(F-g)/(T-g);W.push([n[P*3]+(n[h*3]-n[P*3])*N,n[P*3+2]+(n[h*3+2]-n[P*3+2])*N])}}if(W.length<6)continue;const I=Mt(W);for(const J of W){if(Math.abs(J[0])>s||J[1]>v-1.5)continue;let L=1/0;for(let K=0;K<I.length;K++)L=Math.min(L,Et(J,I[K],I[(K+1)%I.length]));L>H&&(H=L,O=F)}l&&l.push(F)}return{depth:H,y:O}}function Mt(t){const o=t.slice().sort((a,l)=>a[0]-l[0]||a[1]-l[1]),n=(a,l,i)=>(l[0]-a[0])*(i[1]-a[1])-(l[1]-a[1])*(i[0]-a[0]),c=[],s=[];for(const a of o){for(;c.length>=2&&n(c[c.length-2],c[c.length-1],a)<=0;)c.pop();c.push(a)}for(let a=o.length-1;a>=0;a--){const l=o[a];for(;s.length>=2&&n(s[s.length-2],s[s.length-1],l)<=0;)s.pop();s.push(l)}return c.slice(0,-1).concat(s.slice(0,-1))}function Et(t,o,n){const c=n[0]-o[0],s=n[1]-o[1],a=et(((t[0]-o[0])*c+(t[1]-o[1])*s)/(c*c+s*s||1),0,1);return Math.hypot(t[0]-o[0]-c*a,t[1]-o[1]-s*a)}export{ot as BRIDGE,Xt as CLOTH_GLSL,_t as CLOTH_VERT_GLSL,mt as GARMENTS,gt as HOOD,kt as MATS,Rt as SEAT_POSE,Ht as bendUniforms,jt as bridgeDepth,Yt as clothJoints,Pt as clothUniforms,It as dressBlend,Ot as dressCached,Wt as dressPacked,Nt as garmentCover,Zt as garmentCurves,Jt as garmentWear,Tt as hoodBump,zt as normalsOf,Ut as seatCorrection,Qt as seatGap,Gt as seatK};
