/** Minimal Supabase RPC adapter for the exactly-once provider-attempt ledger. */
function required(value,name){if(value==null||String(value).trim()==="")throw new TypeError(`${name} is required`);return value;}
function uuid(value,name){const v=String(required(value,name));if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v))throw new TypeError(`${name} must be a UUID`);return v.toLowerCase();}
function text(value,name){return String(required(value,name)).trim();}
function credits(value,name,{zero=false}={}){required(value,name);const v=Number(value);if(!Number.isFinite(v)||(zero?v<0:v<=0))throw new TypeError(`${name} must be ${zero?"non-negative":"positive"}`);return v;}
function timestamp(value,name){required(value,name);const v=value instanceof Date?value:new Date(value);if(Number.isNaN(v.valueOf()))throw new TypeError(`${name} must be a timestamp`);return v.toISOString();}

export function providerAttemptReservationRpc(input){
  return {name:"reserve_provider_attempt_credits",args:{
    p_attempt_id:uuid(input.attemptId,"attemptId"),
    p_provider:text(input.provider,"provider"),
    p_run_id:uuid(input.runId,"runId"),
    p_reserved_credits:credits(input.reservedCredits,"reservedCredits"),
    p_run_credit_cap:credits(input.runCreditCap,"runCreditCap"),
    p_provider_balance_remaining:credits(input.providerBalanceRemaining,"providerBalanceRemaining",{zero:true}),
    p_provider_balance_verified_at:timestamp(input.providerBalanceVerifiedAt,"providerBalanceVerifiedAt")
  }};
}

export function providerAttemptSettlementRpc(input){
  if(typeof input.chargeKnown!=="boolean")throw new TypeError("chargeKnown must be boolean");
  if(!input.chargeKnown&&input.actualCredits!=null)throw new TypeError("actualCredits must be omitted when chargeKnown is false");
  return {name:"settle_provider_attempt_credits",args:{
    p_attempt_id:uuid(input.attemptId,"attemptId"),
    p_outcome:text(input.outcome,"outcome"),
    p_charge_known:input.chargeKnown,
    p_actual_credits:input.chargeKnown?credits(input.actualCredits,"actualCredits",{zero:true}):null
  }};
}

async function call(client,{name,args}){
  if(!client||typeof client.schema!=="function")throw new TypeError("client must be a Supabase client");
  const {data,error}=await client.schema("research").rpc(name,args);
  if(error)throw error;
  return data;
}
export function reserveProviderAttempt(client,input){return call(client,providerAttemptReservationRpc(input));}
export function settleProviderAttempt(client,input){return call(client,providerAttemptSettlementRpc(input));}
