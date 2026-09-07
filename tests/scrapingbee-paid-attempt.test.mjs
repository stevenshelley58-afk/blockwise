import { test } from "node:test";
import assert from "node:assert/strict";
import { executeScrapingBeePaidAttempt } from "../hermes/tools/research-runtime/bin/scrapingbee-paid-attempt.mjs";

function headers(values={}) { return { get: (name) => values[name] ?? null }; }
function harness(response, maxResponseBytes=10_000_000) {
  const calls=[];
  return {
    calls,
    run: () => executeScrapingBeePaidAttempt({
      maxResponseBytes,
      reserve: async()=>{calls.push("reserve");return {attempt_id:"a"};},
      persist: async()=>{calls.push("persist");},
      request: async()=>{calls.push("fetch");if(response instanceof Error)throw response;return response;},
      persistReceipt: async()=>{calls.push("receipt");},
      handleResponse: async({response:res,body})=>{calls.push("handle");return {
        attempt:{outcome:res.ok?"unparseable":"blocked",httpStatus:res.status,responseBytes:body.length,error:"bad"},
        result:{status:"failed"},
      };},
      complete: async(details)=>{calls.push(["complete",details]);},
      settle: async(details)=>{calls.push(["settle",details]);},
    }),
  };
}

test("HTTP 200 bad body is persisted and charged from headers", async()=>{
  const h=harness({ok:true,status:200,headers:headers({"spb-cost":"25"}),text:async()=>"<bad>"});
  await h.run();
  assert.deepEqual(h.calls.slice(0,5),["reserve","persist","fetch","receipt","handle"]);
  assert.equal(h.calls[5][1].outcome,"unparseable");
  assert.deepEqual(h.calls[6][1],{outcome:"unparseable",chargeKnown:true,actualCredits:25});
});

test("paid HTTP failure still counts its provider charge", async()=>{
  const h=harness({ok:false,status:500,headers:headers({"spb-auto-cost":"12"}),text:async()=>"failure"});
  await h.run();
  assert.equal(h.calls[5][1].outcome,"blocked");
  assert.equal(h.calls[6][1].actualCredits,12);
});

test("network timeout holds the full reservation as an unknown charge", async()=>{
  const h=harness(new Error("timeout"));
  await assert.rejects(h.run(),/timeout/);
  assert.deepEqual(h.calls,[
    "reserve","persist","fetch",
    ["complete",{outcome:"error",httpStatus:null,responseBytes:null,error:"timeout",receipt:{
      chargeKnown:false,credits:null,spbCost:null,spbAutoCost:null,requestId:null,initialStatus:null,
    }}],
    ["settle",{outcome:"error",chargeKnown:false,actualCredits:null}],
  ]);
});

test("paid fetch cannot occur unless reservation and durable attempt persist", async()=>{
  const calls=[];
  await assert.rejects(executeScrapingBeePaidAttempt({
    reserve:async()=>{calls.push("reserve");return {};},
    persist:async()=>{calls.push("persist");throw new Error("db down");},
    request:async()=>{calls.push("fetch");},
    persistReceipt:async()=>{},handleResponse:async()=>{},complete:async()=>{},
    settle:async(details)=>{calls.push(["settle",details]);},
  }),/db down/);
  assert.equal(calls.includes("fetch"),false);
  assert.deepEqual(calls[2],["settle",{outcome:"attempt_persistence_failed",chargeKnown:true,actualCredits:0}]);
});

test("blank cost headers are unknown, and receipt persists before body", async()=>{
  const order=[];
  const response={ok:true,status:200,headers:headers({"spb-cost":" ","spb-auto-cost":"7"}),
    text:async()=>{order.push("body");return "bad";}};
  await executeScrapingBeePaidAttempt({
    reserve:async()=>({}),persist:async()=>{},request:async()=>response,
    persistReceipt:async({receipt})=>{order.push("receipt");assert.equal(receipt.chargeKnown,false);},
    handleResponse:async()=>({attempt:{outcome:"unparseable"},result:{}}),
    complete:async()=>{},settle:async(details)=>{assert.equal(details.chargeKnown,false);},
  });
  assert.deepEqual(order,["receipt","body"]);
});

test("replayed durable reservation never sends another provider request", async()=>{
  let requests=0;
  await assert.rejects(executeScrapingBeePaidAttempt({
    reserve:async()=>({idempotent:true,status:"reserved"}),persist:async()=>{},
    request:async()=>{requests++;},persistReceipt:async()=>{},handleResponse:async()=>{},
    complete:async()=>{},settle:async()=>{},
  }),/already_reserved/);
  assert.equal(requests,0);
});
test("streamed paid body is bounded before parsing", async()=>{
  let cancelled=false;
  const chunks=[new TextEncoder().encode("ok"),new TextEncoder().encode("too")];
  let index=0;
  const response={ok:true,status:200,headers:headers({"spb-cost":"4"}),body:{
    getReader(){
      return {
        read:async()=> index<chunks.length ? {done:false,value:chunks[index++]} : {done:true},
        cancel:async()=>{cancelled=true;},
        releaseLock:()=>{},
      };
    },
  }};
  const h=harness(response, 4);
  await assert.rejects(h.run(),/exceeds 4 bytes/);
  assert.equal(cancelled,true);
  assert.equal(h.calls.includes("handle"),false);
  const complete=h.calls.find((call)=>Array.isArray(call) && call[0]==="complete");
  const settle=h.calls.find((call)=>Array.isArray(call) && call[0]==="settle");
  assert.equal(complete[1].outcome,"error");
  assert.equal(settle[1].actualCredits,4);
});
