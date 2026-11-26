import * as T from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Kind, Side } from '../game/sim';
type UnitView = { kind: Kind; team: Side };

const metal = (color: number, metalness=.62, roughness=.32) => new T.MeshStandardMaterial({color,metalness,roughness,flatShading:true});
const dark=metal(0x1f303a), graphite=metal(0x344853), steel=metal(0x73898c), silver=metal(0xbad1cd), ivory=metal(0xe4d6b8,.4), brass=metal(0xc49552), gold=metal(0xf4c67a);
const cyan=new T.MeshStandardMaterial({color:0x99f7e5,emissive:0x30dfc4,emissiveIntensity:1.45});
const rose=new T.MeshStandardMaterial({color:0xffb8a8,emissive:0xff715d,emissiveIntensity:1.4});
const amber=new T.MeshStandardMaterial({color:0xffe4a8,emissive:0xffbc57,emissiveIntensity:1.1});
function mesh(g:T.BufferGeometry,m:T.Material,x=0,y=0,z=0){
 const o=new T.Mesh(g,m); o.position.set(x,y,z); o.castShadow=o.receiveShadow=true;return o;
}
function block(dx:number,dy:number,dz:number,m:T.Material,x=0,y=0,z=0){return mesh(new T.BoxGeometry(dx,dy,dz),m,x,y,z)}
function drum(a:number,b:number,h:number,n:number,m:T.Material,y:number){return mesh(new T.CylinderGeometry(a,b,h,n),m,0,y,0)}
function rod(a:T.Vector3,b:T.Vector3,r:number,m:T.Material){
 const d=b.clone().sub(a);const o=mesh(new T.CylinderGeometry(r,r,d.length(),5),m);
 o.position.copy(a).lerp(b,.5);o.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),d.normalize());return o;
}
function ring(r:number,t:number,m:T.Material,y:number,n=60){
 const o=mesh(new T.TorusGeometry(r,t,5,n),m,0,y,0);o.rotation.x=Math.PI/2;return o;
}
// Collapse static cut-metal components to one draw call per finish.
function batch(source:T.Group){
 source.updateMatrixWorld(true);const groups=new Map<T.Material,T.BufferGeometry[]>();
 source.traverse(o=>{if(o instanceof T.Mesh && !Array.isArray(o.material)){
   const geometry=o.geometry.index?o.geometry.toNonIndexed():o.geometry.clone();
   geometry.deleteAttribute('uv');geometry.applyMatrix4(o.matrixWorld);
   let list=groups.get(o.material);if(!list){list=[];groups.set(o.material,list)}list.push(geometry);o.geometry.dispose();
 }});
 const result=new T.Group();
 for(const [m,g] of groups){const merged=mergeGeometries(g);if(merged)result.add(mesh(merged,m));g.forEach(item=>item.dispose())}return result;
}
// A machined octagonal plate, with a second, smaller perimeter through the bevel.
function plate(half:number,corner:number,depth:number,m:T.Material,y:number){
 const s=new T.Shape();const q=half,c=corner;
 const pts=[[-q+c,-q],[q-c,-q],[q,-q+c],[q,q-c],[q-c,q],[-q+c,q],[-q,q-c],[-q,-q+c]];
 pts.forEach(([x,z],i)=>i?s.lineTo(x,z):s.moveTo(x,z));s.closePath();
 const g=new T.ExtrudeGeometry(s,{depth,bevelEnabled:true,bevelSegments:1,steps:1,bevelSize:.025,bevelThickness:.02,curveSegments:1});
 g.rotateX(-Math.PI/2);return mesh(g,m,4,y,4);
}
export function board(){
 const raw=new T.Group();
 raw.add(plate(4.25,.36,.17,dark,-.52),plate(4.38,.3,.09,steel,-.39),plate(4.36,.32,.085,dark,-.294),plate(4.37,.32,.10,graphite,-.19),plate(4.29,.26,.04,steel,-.075));
 const tickFinish=metal(0xc1c0a5);
 for(let side=0;side<4;side++){
   const rail=new T.Group();rail.position.set(4,0,4);rail.rotation.y=side*Math.PI/2;raw.add(rail);
   rail.add(block(7.9,.012,.018,dark,0,-.011,4.245));
   for(let i=0;i<=64;i++){
     const major=i%8===0,mid=i%4===0;
     rail.add(block(major?.021:.012,.01,major?.105:mid?.073:.038,major?tickFinish:graphite,-4+i/8,-.004,4.16));
   }
   for(const x of [-3.91,3.91]){
     rail.add(block(.43,.026,.09,brass,x,-.102,4.32),block(.25,.034,.04,ivory,x,-.10,4.37));
   }
   for(let i=0;i<8;i++){
     rail.add(block(.57,.092,.07,graphite,-3.5+i,-.32,4.32),block(.32,.018,.009,steel,-3.5+i,-.286,4.366));
   }
 }
 const group=batch(raw);
 const plates=new T.InstancedMesh(new T.BoxGeometry(.985,.054,.985),metal(0xffffff,.45,.42),64);
 const pin=new T.InstancedMesh(new T.CylinderGeometry(.058,.08,.03,8),graphite,81);
 const center=new T.InstancedMesh(new T.CylinderGeometry(.021,.021,.012,8),silver,81);
 const mat=new T.Matrix4();const tones=[0x1b2431,0x232e3d,0x1f2938,0x1b2431];
 for(let z=0;z<=8;z++)for(let x=0;x<=8;x++){
   const n=z*9+x;pin.setMatrixAt(n,mat.makeTranslation(x,.019,z));center.setMatrixAt(n,mat.makeTranslation(x,.041,z));
   if(x<8&&z<8){const k=z*8+x;plates.setMatrixAt(k,mat.makeTranslation(x+.5,-.018,z+.5));plates.setColorAt(k,new T.Color(tones[(x%2)*2+z%2]));}
 }
 plates.receiveShadow=true;group.add(plates,pin,center);return group;
}
function shellFin(m:T.Material){
 const shape=new T.Shape();shape.moveTo(.12,.14);shape.lineTo(.34,.19);shape.lineTo(.30,.64);shape.lineTo(.23,.99);shape.lineTo(.12,.78);shape.lineTo(.165,.47);shape.closePath();
 const g=new T.ExtrudeGeometry(shape,{depth:.105,bevelEnabled:true,bevelSize:.015,bevelThickness:.012,bevelSegments:1});g.translate(0,0,-.05);return mesh(g,m);
}
function foil(m:T.Material,x:number){
 const s=new T.Shape();s.moveTo(-.30,.13);s.lineTo(.42,.20);s.lineTo(.05,.43);s.lineTo(-.19,.37);s.closePath();
 const g=new T.ExtrudeGeometry(s,{depth:.11,bevelEnabled:true,bevelThickness:.014,bevelSize:.018,bevelSegments:1});return mesh(g,m,0,0,x);
}
export function piece(u:UnitView){
 const raw=new T.Group(),warm=u.team==='red',light=warm?rose:cyan,body=warm?ivory:silver;
 const v=(x:number,y:number,z:number)=>new T.Vector3(x,y,z);
 if(u.kind==='origin'){
   raw.add(drum(.39,.44,.12,8,dark,.09),drum(.36,.39,.055,8,brass,.175),drum(.29,.35,.10,8,graphite,.24));
   for(let i=0;i<4;i++){const arm=new T.Group();arm.rotation.y=i*Math.PI/2+Math.PI/4;
     arm.add(shellFin(i%2?body:ivory),rod(v(.276,.27,0),v(.224,.8,0),.021,light));raw.add(arm)}
   const jewel=mesh(new T.OctahedronGeometry(.205),light,0,.66,0);jewel.scale.y=1.5;raw.add(jewel,ring(.225,.017,brass,.57,8));
 }else if(u.kind==='courier'){
   raw.add(drum(.29,.35,.08,6,dark,.07),drum(.25,.29,.045,6,brass,.135),foil(body,-.17),foil(ivory,.06));
   raw.add(rod(v(-.29,.22,0),v(.38,.225,0),.047,light),rod(v(-.23,.3,-.18),v(.30,.22,-.18),.017,brass));raw.rotation.y=warm?Math.PI:0;
 }else if(u.kind==='relay'||u.kind==='phaser'){
   const ph=u.kind==='phaser';raw.add(drum(.25,.32,.105,8,dark,.082),drum(.20,.25,.055,8,brass,.16));
   const radius=ph?.31:.29;
   const rim=mesh(new T.TorusGeometry(radius,.058,4,ph?24:8),body,0,.50,0);rim.rotation.y=.53;rim.rotation.z=ph?.25:0;raw.add(rim);
   const inner=mesh(new T.TorusGeometry(radius-.045,.013,4,ph?24:8),light,0,.50,0);inner.rotation.copy(rim.rotation);raw.add(inner);
   if(ph){const cross=mesh(new T.TorusGeometry(radius*.83,.035,4,20),brass,0,.5,0);cross.rotation.set(.66,1.05,-.3);cross.name='phaseRing';raw.add(cross);}
   raw.add(rod(v(0,.12,0),v(0,.78,0),.025,brass),mesh(new T.OctahedronGeometry(.095),ph?light:gold,0,.5,0));
 }else{
   raw.add(drum(.26,.34,.07,4,dark,.055),drum(.24,.26,.035,4,brass,.108),ring(.18,.013,amber,.14,32));
   const core=mesh(new T.OctahedronGeometry(.17),gold,0,.45,0);core.scale.y=1.62;raw.add(core);
   for(let i=0;i<4;i++){const a=i*Math.PI/2;const p=v(Math.cos(a)*.228,.46,Math.sin(a)*.228);
      raw.add(rod(v(0,.13,0),p,.013,brass),rod(p,v(0,.8,0),.012,ivory));}
 }
 return batch(raw);
}
