import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
  providerAttemptReservationRpc,providerAttemptSettlementRpc,
  reserveProviderAttempt,settleProviderAttempt
} from "../scripts/research/provider-credit-ledger.mjs";

function fakeClient(data={status:"ok"}){
  const calls=[];
  return {calls,schema(schema){calls.push(["schema",schema]);return {rpc:async(name,args)=>{
    calls.push(["rpc",name,args]);return {data,error:null};
  }};}};
}

test("reserve helper passes durable identity, both caps, and fresh balance",async()=>{
  const client=fakeClient({status:"reserved"});
  const out=await reserveProviderAttempt(client,{
    attemptId:"11111111-1111-4111-8111-111111111111",provider:"scrapingbee",
    runId:"22222222-2222-4222-8222-222222222222",reservedCredits:25,runCreditCap:100,
    providerBalanceRemaining:850,providerBalanceVerifiedAt:"2026-09-05T00:00:00Z"
  });
  assert.equal(out.status,"reserved");
  assert.equal(client.calls[0][1],"research");
  assert.equal(client.calls[1][1],"reserve_provider_attempt_credits");
  assert.equal(client.calls[1][2].p_run_credit_cap,100);
  assert.equal(client.calls[1][2].p_provider_balance_remaining,850);
});

test("settle helper distinguishes known zero from unknown charge",async()=>{
  const known=providerAttemptSettlementRpc({
    attemptId:"11111111-1111-4111-8111-111111111111",outcome:"blocked",
    chargeKnown:true,actualCredits:0
  });
  const unknown=providerAttemptSettlementRpc({
    attemptId:"22222222-2222-4222-8222-222222222222",outcome:"transport_unknown",
    chargeKnown:false
  });
  assert.equal(known.args.p_actual_credits,0);
  assert.equal(unknown.args.p_actual_credits,null);
  await settleProviderAttempt(fakeClient(),{
    attemptId:"22222222-2222-4222-8222-222222222222",outcome:"transport_unknown",
    chargeKnown:false
  });
  assert.throws(()=>providerAttemptSettlementRpc({
    attemptId:"22222222-2222-4222-8222-222222222222",outcome:"unknown",
    chargeKnown:false,actualCredits:0
  }),/must be omitted/);
});

test("numeric and timestamp metadata reject null and blank values",()=>{
  const base={
    attemptId:"11111111-1111-4111-8111-111111111111",provider:"scrapingbee",
    runId:"22222222-2222-4222-8222-222222222222",reservedCredits:25,runCreditCap:100,
    providerBalanceRemaining:850,providerBalanceVerifiedAt:"2026-09-05T00:00:00Z"
  };
  for(const [field,value] of [["reservedCredits",null],["providerBalanceRemaining",""],["providerBalanceVerifiedAt",null]]){
    assert.throws(()=>providerAttemptReservationRpc({...base,[field]:value}),new RegExp(field));
  }
  assert.throws(()=>providerAttemptSettlementRpc({
    attemptId:base.attemptId,outcome:"blocked",chargeKnown:true,actualCredits:null
  }),/actualCredits/);
});

test("migration contract holds unknown charges and settles once",()=>{
  const m=readFileSync("supabase/migrations/202609050009_ad_db_attempt_credits.sql","utf8");
  assert.match(m,/attempt_id uuid primary key/);
  assert.match(m,/provider_credit_attempt_conflict/);
  assert.match(m,/provider_credit_settlement_conflict/);
  assert.match(m,/v_charge:=v_attempt\.reserved_credits/);
  assert.match(m,/spent_credits=spent_credits\+v_charge/);
  assert.match(m,/v_run_committed\+p_reserved_credits>p_run_credit_cap/);
  assert.match(m,/v_account_committed\+p_reserved_credits>v_budget\.provider_balance_remaining/);
  assert.match(m,/provider_balance_verified_at<clock_timestamp\(\)-interval '15 minutes'/);
});
