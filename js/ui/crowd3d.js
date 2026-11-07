import{IN_M as I}from"../engine/race.js";const C=`#version 300 es
precision highp float;
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNrm; layout(location=2) in vec2 aPart;
layout(location=3) in vec4 iPos; layout(location=4) in vec4 iAnim; layout(location=5) in vec4 iC0; layout(location=6) in vec4 iC1;
layout(location=7) in vec4 iC2; layout(location=8) in vec4 iC3;
uniform mat4 uVP; uniform float uT, uExc, uIn;
out vec3 vN; out vec3 vC; out vec3 vW;
float h1(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
vec3 rx(vec3 p, vec3 o, float a) { vec3 q = p - o; float c = cos(a), s = sin(a); return o + vec3(q.x, q.y * c - q.z * s, q.y * s + q.z * c); }
vec3 rz(vec3 p, vec3 o, float a) { vec3 q = p - o; float c = cos(a), s = sin(a); return o + vec3(q.x * c - q.y * s, q.x * s + q.y * c, q.z); }
vec3 rxn(vec3 n, float a) { float c = cos(a), s = sin(a); return vec3(n.x, n.y * c - n.z * s, n.y * s + n.z * c); }
vec3 rzn(vec3 n, float a) { float c = cos(a), s = sin(a); return vec3(n.x * c - n.y * s, n.x * s + n.y * c, n.z); }
void main() {
  float part = aPart.x, slot = aPart.y, mode = iAnim.y, seed = iC1.w;
  float side = aPos.x < 0.0 ? -1.0 : 1.0;
  float ph = iAnim.x * 6.2831853 + (side < 0.0 ? 0.0 : 3.14159265);
  vec3 p = aPos, n = aNrm;
  float hip = 0.0, knee = 0.0, sh = 0.0, el = 0.0, ab = 0.0, lift = 0.0, pitch = 0.0;
  {   // a fan: seated (mode 2) or standing (1); excitement stands them up, raises the arms and jumps the keenest
    float r = h1(seed * 91.7), up = step(1.0 - uExc * (0.55 + 0.45 * r), 0.35 * r + 0.05);
    float sit = mode > 1.5 ? 1.0 - up : 0.0;
    hip = -1.45 * sit; knee = 1.45 * sit; lift = -0.47 * sit;
    float wave = up * step(0.4, h1(seed * 3.1));
    ab = wave * (2.5 + 0.35 * sin(uT * 7.0 + seed * 11.0)) ;
    el = -0.25 - 0.4 * (1.0 - wave);
    sh = (1.0 - wave) * 0.08;
    lift += up * 0.13 * max(0.0, sin(uT * 9.0 + seed * 17.0)) * step(0.65, h1(seed * 5.3)) * uExc;
  }
  vec3 HIP = vec3(0.09 * side, 0.92, 0.0), KNEE = vec3(0.09 * side, 0.49, 0.0), SH = vec3(0.205 * side, 1.42, 0.0), EL = vec3(0.205 * side, 1.16, 0.0);
  if (part > 7.5 && part < 9.5) { p = rx(p, KNEE, knee); n = rxn(n, knee); p = rx(p, HIP, hip); n = rxn(n, hip); }        // shin, shoe
  else if (part > 6.5 && part < 7.5) { p = rx(p, HIP, hip); n = rxn(n, hip); }                                            // thigh
  else if (part > 4.5 && part < 5.5) { p = rx(p, EL, el); n = rxn(n, el); p = rx(p, SH, sh); n = rxn(n, sh); p = rz(p, SH, ab * side); n = rzn(n, ab * side); }   // forearm
  else if (part > 3.5 && part < 4.5) { p = rx(p, SH, sh); n = rxn(n, sh); p = rz(p, SH, ab * side); n = rzn(n, ab * side); }                                    // upper arm
  p.y += lift;
  p = rx(p, vec3(0.0), pitch); n = rxn(n, pitch);
  p *= iAnim.w; // (the figure's height ÷ 1.75 m)
  float c = cos(iPos.w), s = sin(iPos.w);
  vec3 w = vec3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c) + iPos.xyz;
  vN = vec3(n.x * c + n.z * s, n.y, -n.x * s + n.z * c);
  bool fan = mode > 0.5;
  vC = slot < 0.5 ? iC0.rgb : slot < 1.5 ? iC1.rgb : slot < 2.5 ? iC2.rgb : slot < 3.5 ? iC3.rgb : slot < 4.5 ? vec3(0.85, 0.85, 0.82) * (0.6 + 0.4 * iC3.w)
     : slot < 5.5 ? (fan ? iC1.rgb : iC2.rgb) : (fan ? iC0.rgb : iC2.rgb);   // (5: legs, skin on a runner, trousers on a fan; 6: arms, skin or sleeves)
  vW = w;
  gl_Position = uVP * vec4(w * uIn, 1.0);
}`,V=`#version 300 es
precision mediump float;
in vec3 vN; in vec3 vC; in vec3 vW;
uniform vec3 uSun, uEye, uFog; uniform float uFogD, uGain;
out vec4 o;
void main() {
  vec3 N = normalize(vN), c = pow(vC, vec3(2.2));
  float d = max(dot(N, uSun), 0.0), sky = 0.5 + 0.5 * N.y;
  vec3 L = c * (0.95 * d * vec3(1.0, 0.96, 0.9) + 0.42 * sky * vec3(0.75, 0.85, 1.0) + 0.1);
  L = pow(L * uGain, vec3(1.0 / 2.2));
  float f = 1.0 - exp(-length(vW - uEye) / uFogD);
  o = vec4(mix(L, uFog, f * 0.85), 1.0);
}`,N=`#version 300 es
precision highp float;
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNrm; layout(location=2) in vec3 aCol;
uniform mat4 uVP; uniform float uIn;
out vec3 vN; out vec3 vC; out vec3 vW;
void main() { vN = aNrm; vC = aCol; vW = aPos; gl_Position = uVP * vec4(aPos * uIn, 1.0); }`,L=`#version 300 es
precision highp float;
layout(location=0) in vec3 aPos; layout(location=1) in vec2 aUV;
uniform mat4 uVP; uniform float uIn; out vec2 vUV; out vec3 vW;
void main() { vUV = aUV; vW = aPos; gl_Position = uVP * vec4(aPos * uIn, 1.0); }`,M=`#version 300 es
precision mediump float;
in vec2 vUV; in vec3 vW; uniform sampler2D uTex; uniform vec3 uEye, uFog; uniform float uFogD, uBright;
out vec4 o;
void main() { vec4 c = texture(uTex, vUV); float f = 1.0 - exp(-length(vW - uEye) / uFogD); o = vec4(mix(c.rgb * uBright, uFog, f * 0.85), 1.0); }`;function D(e,v,d){const p=e.createProgram();for(const[a,f]of[[e.VERTEX_SHADER,v],[e.FRAGMENT_SHADER,d]]){const s=e.createShader(a);if(e.shaderSource(s,f),e.compileShader(s),!e.getShaderParameter(s,e.COMPILE_STATUS))throw new Error(`crowd3d shader: ${e.getShaderInfoLog(s)}`);e.attachShader(p,s)}if(e.linkProgram(p),!e.getProgramParameter(p,e.LINK_STATUS))throw new Error(`crowd3d link: ${e.getProgramInfoLog(p)}`);const x={},F=e.getProgramParameter(p,e.ACTIVE_UNIFORMS);for(let a=0;a<F;a++){const f=e.getActiveUniform(p,a);x[f.name]=e.getUniformLocation(p,f.name)}return{p,U:x}}const w=[[[1,0,0],[[1,0,0],[1,1,0],[1,1,1],[1,0,1]]],[[-1,0,0],[[0,0,1],[0,1,1],[0,1,0],[0,0,0]]],[[0,1,0],[[0,1,0],[0,1,1],[1,1,1],[1,1,0]]],[[0,-1,0],[[0,0,0],[1,0,0],[1,0,1],[0,0,1]]],[[0,0,1],[[1,0,1],[1,1,1],[0,1,1],[0,0,1]]],[[0,0,-1],[[0,0,0],[0,1,0],[1,1,0],[1,0,0]]]];function q(e){const v=[],d=[],p=[];for(const[x,F,a,f,s,u,m,y]of e)for(const[T,b]of w){const P=b.map(([o,A,c])=>[o?F:x,A?f:a,c?u:s]);for(const o of[0,1,2,0,2,3])v.push(...P[o]),d.push(...T),p.push(m,y)}return{P:new Float32Array(v),N:new Float32Array(d),A:new Float32Array(p),count:v.length/3}}const X=e=>[-e[1],-e[0],...e.slice(2)];function z(){const e=[],v=d=>{e.push(d,X(d))};return v([.04,.14,0,.5,-.06,.07,8,5]),v([.03,.16,.48,.92,-.07,.07,7,5]),e.push([-.18,.18,.88,1.46,-.11,.11,1,0]),e.push([-.085,.085,1.46,1.72,-.095,.1,2,2]),e.push([-.09,.09,1.64,1.75,-.11,.08,2,3]),v([.18,.25,.92,1.44,-.045,.045,4,6]),q(e)}const B=e=>{const v=String(e||"#888888").replace("#",""),d=parseInt(v.length===3?v.replace(/./g,p=>p+p):v,16)||8947848;return[(d>>16&255)/255,(d>>8&255)/255,(d&255)/255]},U=24;function W(e){const v=D(e,C,V),d=D(e,N,V),p=D(e,L,M),x={};function F(o){const A=e.createVertexArray();e.bindVertexArray(A);const c=[];for(const[t,E,i]of[[0,o.P,3],[1,o.N,3],[2,o.A,2]]){const r=e.createBuffer();e.bindBuffer(e.ARRAY_BUFFER,r),e.bufferData(e.ARRAY_BUFFER,E,e.STATIC_DRAW),e.enableVertexAttribArray(t),e.vertexAttribPointer(t,i,e.FLOAT,!1,0,0),c.push(r)}const h=e.createBuffer();e.bindBuffer(e.ARRAY_BUFFER,h);for(let t=0;t<6;t++)e.enableVertexAttribArray(3+t),e.vertexAttribPointer(3+t,4,e.FLOAT,!1,U*4,t*16),e.vertexAttribDivisor(3+t,1);return e.bindVertexArray(null),{vao:A,inst:h,bufs:c,count:o.count,n:0,data:new Float32Array(0),cap:0}}x.fan=F(z());const a=o=>Array.isArray(o)?o:B(o);function f(o,A){const c=x[o],h=A.length;if(!c)throw new Error(`crowd3d draws fans, not ${o}`);c.cap<h&&(c.cap=Math.max(h,c.cap*2,8),c.data=new Float32Array(c.cap*U),e.bindBuffer(e.ARRAY_BUFFER,c.inst),e.bufferData(e.ARRAY_BUFFER,c.data.byteLength,e.DYNAMIC_DRAW));const t=c.data;for(let E=0;E<h;E++){const i=A[E],r=E*U,R=a(i.top),n=a(i.shorts),_=a(i.skin),S=a(i.hair);t[r]=i.x,t[r+1]=i.y||0,t[r+2]=i.z,t[r+3]=i.psi,t[r+4]=i.phase||0,t[r+5]=i.mode||0,t[r+6]=i.amp??.6,t[r+7]=(i.h||1.75)/1.75,t[r+8]=R[0],t[r+9]=R[1],t[r+10]=R[2],t[r+11]=i.lean||0,t[r+12]=n[0],t[r+13]=n[1],t[r+14]=n[2],t[r+15]=i.seed??E,t[r+16]=_[0],t[r+17]=_[1],t[r+18]=_[2],t[r+19]=0,t[r+20]=S[0],t[r+21]=S[1],t[r+22]=S[2],t[r+23]=i.shoe??1}e.bindBuffer(e.ARRAY_BUFFER,c.inst),e.bufferSubData(e.ARRAY_BUFFER,0,t,0,h*U),c.n=h}const s=[],u=[];function m({P:o,N:A,C:c}){const h=e.createVertexArray();e.bindVertexArray(h);const t=[];for(const[i,r]of[[0,o],[1,A],[2,c]]){const R=e.createBuffer();e.bindBuffer(e.ARRAY_BUFFER,R),e.bufferData(e.ARRAY_BUFFER,r instanceof Float32Array?r:new Float32Array(r),e.STATIC_DRAW),e.enableVertexAttribArray(i),e.vertexAttribPointer(i,3,e.FLOAT,!1,0,0),t.push(R)}e.bindVertexArray(null);const E={vao:h,bufs:t,count:o.length/3,on:!0};return s.push(E),E}function y({P:o,UV:A,canvas:c,bright:h=1}){const t=e.createVertexArray();e.bindVertexArray(t);const E=[];for(const[R,n,_]of[[0,o,3],[1,A,2]]){const S=e.createBuffer();e.bindBuffer(e.ARRAY_BUFFER,S),e.bufferData(e.ARRAY_BUFFER,new Float32Array(n),e.STATIC_DRAW),e.enableVertexAttribArray(R),e.vertexAttribPointer(R,_,e.FLOAT,!1,0,0),E.push(S)}e.bindVertexArray(null);const i=e.createTexture();e.bindTexture(e.TEXTURE_2D,i),e.texImage2D(e.TEXTURE_2D,0,e.RGBA,e.RGBA,e.UNSIGNED_BYTE,c),e.generateMipmap(e.TEXTURE_2D),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.LINEAR_MIPMAP_LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.CLAMP_TO_EDGE);const r={vao:t,bufs:E,t:i,count:o.length/3,bright:h,on:!0,update(){e.bindTexture(e.TEXTURE_2D,i),e.texImage2D(e.TEXTURE_2D,0,e.RGBA,e.RGBA,e.UNSIGNED_BYTE,c),e.generateMipmap(e.TEXTURE_2D)}};return u.push(r),r}const T=(()=>{const o=[.35,.8,.45],A=Math.hypot(...o);return o.map(c=>c/A)})();function b(o,A,c,h={}){const t=A.map(n=>n/I),E=h.fog||[.62,.68,.76],i=h.fogD||900,r=h.gain??1;e.enable(e.DEPTH_TEST),e.depthFunc(e.LEQUAL),e.depthMask(!0),e.disable(e.BLEND),e.disable(e.CULL_FACE);const R=n=>{e.uniformMatrix4fv(n.uVP,!1,o),e.uniform1f(n.uIn,I),n.uEye&&e.uniform3fv(n.uEye,t),n.uFog&&e.uniform3fv(n.uFog,E),n.uFogD&&e.uniform1f(n.uFogD,i)};if(s.some(n=>n.on)){e.useProgram(d.p),R(d.U),e.uniform3fv(d.U.uSun,T),e.uniform1f(d.U.uGain,r);for(const n of s)n.on&&(e.bindVertexArray(n.vao),e.drawArrays(e.TRIANGLES,0,n.count))}if(u.some(n=>n.on)){e.useProgram(p.p),R(p.U),e.activeTexture(e.TEXTURE0),e.uniform1i(p.U.uTex,0);for(const n of u)n.on&&(e.uniform1f(p.U.uBright,n.bright),e.bindTexture(e.TEXTURE_2D,n.t),e.bindVertexArray(n.vao),e.drawArrays(e.TRIANGLES,0,n.count))}if(e.useProgram(v.p),R(v.U),e.uniform3fv(v.U.uSun,T),e.uniform1f(v.U.uGain,r),e.uniform1f(v.U.uT,c),e.uniform1f(v.U.uExc,h.exc||0),x.fan.n){const n=x.fan;e.bindVertexArray(n.vao),e.drawArraysInstanced(e.TRIANGLES,0,n.count,n.n)}return e.bindVertexArray(null),x.fan.n*x.fan.count/3}function P(){for(const o of Object.values(x))e.deleteVertexArray(o.vao),e.deleteBuffer(o.inst),o.bufs.forEach(A=>e.deleteBuffer(A));for(const o of s)e.deleteVertexArray(o.vao),o.bufs.forEach(A=>e.deleteBuffer(A));for(const o of u)e.deleteVertexArray(o.vao),o.bufs.forEach(A=>e.deleteBuffer(A)),e.deleteTexture(o.t);for(const o of[v,d,p])e.deleteProgram(o.p)}return{set:f,draw:b,mesh:m,quad:y,free:P,sets:x,tris:o=>x[o].count/3}}function Y(){const e=[],v=[],d=[],p=(a,f,s,u,m)=>{e.push(...a,...f,...s);for(let y=0;y<3;y++)v.push(...u),d.push(...m)},x=(a,f,s)=>{const u=[f[0]-a[0],f[1]-a[1],f[2]-a[2]],m=[s[0]-a[0],s[1]-a[1],s[2]-a[2]],y=[u[1]*m[2]-u[2]*m[1],u[2]*m[0]-u[0]*m[2],u[0]*m[1]-u[1]*m[0]],T=Math.hypot(...y)||1;return y.map(b=>b/T)},F={P:e,N:v,C:d,tri(a,f,s,u,m=null){return p(a,f,s,m||x(a,f,s),u),F},quad(a,f,s,u,m,y=null){const T=y||x(a,f,s);return p(a,f,s,T,m),p(a,s,u,T,m),F},post(a,f,s,u,m,y,T,b=0){const P=Math.cos(b),o=Math.sin(b),A=(t,E,i)=>[a+t*P+i*o,f+E,s-t*o+i*P],c=[-u/2,u/2],h=[-m/2,m/2];for(const[t,E]of w){const i=E.map(([R,n,_])=>A(c[R],n?y:0,h[_])),r=[t[0]*P+t[2]*o,t[1],-t[0]*o+t[2]*P];F.quad(i[0],i[1],i[2],i[3],T,r)}return F},cone(a,f,s,u,m,y,T=7){for(let b=0;b<T;b++){const P=b/T*2*Math.PI,o=(b+1)/T*2*Math.PI,A=[a+u*Math.sin(P),f,s+u*Math.cos(P)],c=[a+u*Math.sin(o),f,s+u*Math.cos(o)],h=[Math.sin((P+o)/2)*.8,.6,Math.cos((P+o)/2)*.8];p(A,c,[a,f+m,s],h,y)}return F},done(){return{P:new Float32Array(e),N:new Float32Array(v),C:new Float32Array(d)}}};return F}export{W as createCrowd,Y as geo,B as hex3};
