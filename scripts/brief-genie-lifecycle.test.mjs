import "./dom-test-setup.mjs";
import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { createElement as h, act } from "react";
import { render, cleanup } from "@testing-library/react";
let reduceMotion=false;
let deferred=null;
let snapshotCalls=0;
mock.module("@/hooks/use-motion-preference", {namedExports:{useMotionPreference:()=>({reduceMotion})}});
mock.module("html-to-image", {namedExports:{toCanvas:()=> {snapshotCalls++; return deferred ?? Promise.resolve({width:960,height:500})}}});
const {useBriefGenie}=await import("@/features/catchup/use-brief-genie");
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const callbacks=new Map(); let nextFrame=0; const animations=[]; const draws=[];
globalThis.requestAnimationFrame=cb=>{callbacks.set(++nextFrame,cb);return nextFrame};
globalThis.cancelAnimationFrame=id=>callbacks.delete(id);
window.HTMLCanvasElement.prototype.getContext=()=>({setTransform(){},clearRect(){},drawImage(...args){draws.push(args)}});
window.Element.prototype.animate=function(frames,options){
 let finish; const a={element:this,frames,options,cancelled:false,finished:new Promise(r=>finish=r),finish:()=>finish(),cancel(){this.cancelled=true}};
 animations.push(a);return a;
};
window.Element.prototype.getBoundingClientRect=function(){
 const r=this.hasAttribute("data-brief-anchor")?{x:900,y:20,width:292,height:42}:{x:220,y:100,width:960,height:500};
 return {...r,top:r.y,bottom:r.y+r.height,left:r.x,right:r.x+r.width};
};
let capture;
function Harness({open}){const hook=useBriefGenie(open);capture=hook.capture;return h("div",{ref:hook.panelRef,"data-brief-motion":open?"pending":undefined,className:"morning-brief"},h("h1",null,"Real window content"))}
function setup(){snapshotCalls=0;reduceMotion=false;deferred=null;draws.length=0;animations.length=0;Object.defineProperty(window,"innerWidth",{value:1440,configurable:true});document.body.insertAdjacentHTML("beforeend","<button data-brief-anchor></button>")}
async function flush(time=0){await act(async()=>{for(const[id,cb]of[...callbacks]){callbacks.delete(id);cb(time)}})}
function reset(){cleanup();document.querySelector("[data-brief-anchor]")?.remove();callbacks.clear()}
test("opening uses DOM bands through the final frame without a raster handoff; closing retains the canvas",async()=>{
 setup();const view=render(h(Harness,{open:true}));await flush();await flush(0);await flush(250);await flush(300);
 assert.equal(document.querySelectorAll(".brief-genie-canvas").length,0);
 assert.equal(document.querySelectorAll(".brief-genie-band").length,64);
 assert.equal(snapshotCalls,0);
 assert.equal(document.querySelectorAll(".brief-genie-avatar").length,0);
 assert.equal(document.querySelector(".brief-genie-ghost").getAttribute("aria-hidden"),"true");
 await flush(500);
 assert.equal(document.querySelectorAll(".brief-genie-ghost").length,0);
 act(()=>capture());view.rerender(h(Harness,{open:false}));await act(async()=>{});await flush(0);await flush(250);await flush(300);
 assert.equal(document.querySelectorAll(".brief-genie-canvas").length,1);
 assert.equal(snapshotCalls,1);
 assert.ok(draws.length>0);
 await flush(500);assert.equal(document.querySelectorAll(".brief-genie-ghost").length,0);
 reset();assert.equal(document.querySelectorAll(".morning-brief").length,0);
});
test("reduced motion, mobile, and missing anchor use a short fade",async()=>{
 for(const mode of["reduced","mobile","anchor"]){setup();if(mode==="reduced")reduceMotion=true;if(mode==="mobile")Object.defineProperty(window,"innerWidth",{value:390,configurable:true});if(mode==="anchor")document.querySelector("[data-brief-anchor]").remove();
 const view=render(h(Harness,{open:true}));await flush();assert.equal(animations.at(-1).options.duration,140);assert.equal(document.querySelectorAll(".brief-genie-canvas").length,0);
 act(()=>capture());view.rerender(h(Harness,{open:false}));assert.equal(document.querySelectorAll(".brief-fade-ghost").length,1);
 animations.at(-1).finish();await act(async()=>{});reset();}
});
test("late rasterization cannot resurrect a closed or unmounted dialog",async()=>{
 setup();let resolve;deferred=new Promise(r=>resolve=r);const view=render(h(Harness,{open:true}));await flush();await flush(0);await flush(500);act(()=>capture());view.rerender(h(Harness,{open:false}));await flush(0);await flush(25);view.unmount();resolve({width:960,height:500});await act(async()=>{});
 assert.equal(document.querySelectorAll(".brief-genie-ghost,.morning-brief").length,0);assert.equal(callbacks.size,0);reset();
});
test("resize and interrupted reopening remove all transient layers",async()=>{
 setup();const view=render(h(Harness,{open:true}));await flush();window.dispatchEvent(new window.Event("resize"));assert.equal(document.querySelectorAll(".brief-genie-ghost").length,0);
 act(()=>capture());view.rerender(h(Harness,{open:false}));view.rerender(h(Harness,{open:true}));await flush();assert.equal(document.querySelectorAll(".brief-genie-ghost").length,1);reset();assert.equal(document.querySelectorAll(".brief-genie-ghost,.morning-brief").length,0);
});
