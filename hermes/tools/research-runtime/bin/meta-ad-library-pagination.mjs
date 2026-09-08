/**
 * Bounded native pagination helper for ScrapingBee Meta captures.
 */
import { classifyMetaAdLibraryPayload } from "./meta-ad-library-parser.mjs";

const DEFAULT_SCROLLS = 8,
  MAX_SCROLLS = 16,
  BUDGET = 40000;
const RECORDER_INSTALL =
  '(() => {\n const K="__hermesMetaPagination", r=window[K]||(window[K]={records:[]}), pk=["viewAllPageID","view_all_page_id","page_id","pageId","pageID","pageIDs","pagesID"], ak=["after","cursor","end_cursor","endCursor"], sk=["activeStatus","active_status","ad_active_status"], ck=["country","country_code","countryCode","countries"], ok=["operationName","operation_name","friendlyName","friendly_name"];\n const find=(v,ks,d=0)=>{if(d>8||v==null||typeof v!=="object")return; if(Array.isArray(v)){for(const x of v){const z=find(x,ks,d+1);if(z!==undefined)return z;}return;} for(const k of ks)if(Object.prototype.hasOwnProperty.call(v,k)&&v[k]!=null&&(!Array.isArray(v[k])||v[k].length>0))return v[k]; for(const x of Object.values(v)){const z=find(x,ks,d+1);if(z!==undefined)return z;}};\n const scalar=v=>v==null||["string","number","boolean"].includes(typeof v)?v:null; const one=v=>Array.isArray(v)?(v.length===1?scalar(v[0]):null):scalar(v);\n const parse=s=>{if(typeof s!=="string"||s.length>1500000)return;try{return JSON.parse(s)}catch{} try{const lines=s.split(/\\r?\\n/).map(x=>x.trim()).filter(Boolean);if(lines.length>1)return lines.map(x=>JSON.parse(x))}catch{} try{const p=new URLSearchParams(s);for(const k of ["variables","data","payload"]){const x=p.get(k);if(x)try{return JSON.parse(x)}catch{}}}catch{}};\n const meta=(url,method,body)=>{if(String(method||"GET").toUpperCase()!=="POST"||!/\\/api\\/graphql(?:\\/|$)/i.test(String(url||"")))return;const p=parse(body);if(!p)return;const page=one(find(p,pk));if(page==null||!/^\\d{5,}$/.test(String(page)))return;const after=one(find(p,ak)), active=one(find(p,sk)), country=one(find(p,ck)), operation=scalar(find(p,ok))||"anonymous";return {pageId:String(page),after:after==null?null:String(after),activeStatus:active==null?null:String(active),country:country==null?null:String(country),operation:String(operation).slice(0,200)}};\n const save=(m,status,response)=>{if(m&&r.records.length<64)r.records.push({request:m,status:Number(status)||0,response})};\n const fetchBody=async response=>{try{const s=await response.clone().text();if(s.length>4000000)return {truncated:true};try{return JSON.parse(s)}catch{try{const lines=s.split(/\\r?\\n/).map(x=>x.trim()).filter(Boolean);if(lines.length>1)return lines.map(x=>JSON.parse(x))}catch{}return {malformed:true}}}catch{return {unreadable:true}}};\n if(window.fetch&&!window.fetch.__hermesMetaPaginationWrapped){const old=window.fetch, wrapped=function(input,init){let u="",m="GET",b=null;try{if(typeof input==="string")u=input;else if(input){u=input.url||"";m=input.method||m}if(init){m=init.method||m;b=typeof init.body==="string"?init.body:null}}catch{}const x=meta(u,m,b), out=old.apply(this,arguments);if(x)Promise.resolve(out).then(q=>fetchBody(q).then(z=>save(x,q&&q.status,z))).catch(()=>{});return out};wrapped.__hermesMetaPaginationWrapped=true;window.fetch=wrapped}\n const xp=window.XMLHttpRequest&&window.XMLHttpRequest.prototype;if(xp&&!xp.__hermesMetaPaginationWrapped){const oo=xp.open, os=xp.send;xp.open=function(m,u){this.__hm=this.__hm||{};this.__hm.m=m;this.__hm.u=u;return oo.apply(this,arguments)};xp.send=function(b){const q=this.__hm||{},x=meta(q.u,q.m,b);if(x)this.addEventListener("load",()=>{let z={unreadable:true};try{const s=this.responseType===""||this.responseType==="text"?this.responseText:"";z=s.length>4000000?{truncated:true}:(()=>{try{return JSON.parse(s)}catch{try{const lines=s.split(/\\r?\\n/).map(x=>x.trim()).filter(Boolean);if(lines.length>1)return lines.map(x=>JSON.parse(x))}catch{}return {malformed:true}}})()}catch{}save(x,this.status,z)},{once:true});return os.apply(this,arguments)};xp.__hermesMetaPaginationWrapped=true}\n return {installed:true};\n})()';
const RECORDER_READ =
  "(() => { const r=window.__hermesMetaPagination&&window.__hermesMetaPagination.records; return {metaPaginationRecords:Array.isArray(r)?r:[]}; })()";

const NATIVE_SCROLL_TO_BOTTOM = String.raw`(()=>{for(const e of document.querySelectorAll("main,div"))e.scrollTop=e.scrollHeight;window.scrollTo(0,1e9)})()`;

// Provider GET request lines are limited to 8190 bytes. Remove indentation
// from our own scripts without changing tokens, quoted strings or regexes.
function compactScript(script) {
  return script
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .join(" ");
}

function positive(value, fallback, max) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 1 ? Math.min(Math.floor(n), max) : fallback;
}

export function buildMetaPaginationScenario({
  maxScrolls = DEFAULT_SCROLLS,
  delayMs = 1000,
  settleMs = 1500,
} = {}) {
  const scrolls = positive(maxScrolls, DEFAULT_SCROLLS, MAX_SCROLLS),
    delay = positive(delayMs, 1000, 4000),
    settle = positive(settleMs, 1500, 4000);
  if (scrolls * delay + settle + 5000 >= BUDGET)
    throw new Error("Meta pagination scenario exceeds 40 second budget");
  const instructions = [{ evaluate: compactScript(RECORDER_INSTALL) }];
  for (let index = 0; index < scrolls; index += 1) {
    instructions.push(
      { evaluate: compactScript(NATIVE_SCROLL_TO_BOTTOM) },
      { wait: delay },
    );
  }
  instructions.push(
    { wait: settle },
    { evaluate: compactScript(RECORDER_READ) },
  );
  return { strict: true, instructions };
}
function unwrap(raw) {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw;
  const s = String(raw || "");
  try {
    const x = JSON.parse(s);
    if (x && typeof x === "object" && !Array.isArray(x)) return x;
  } catch {}
  return { body: s };
}
function failed(c) {
  const r = c.js_scenario_report;
  if (!r || typeof r !== "object") return false;
  if (
    Number(r.task_failure) > 0 ||
    (r.task_success === 0 && Number(r.task_executed) > 0)
  )
    return true;
  return (
    Array.isArray(r.tasks) && r.tasks.some((x) => x && x.success === false)
  );
}
function records(c) {
  const out = [],
    walk = (v, d = 0) => {
      if (d > 8 || v == null || typeof v !== "object") return;
      if (Array.isArray(v)) {
        for (const x of v) walk(x, d + 1);
        return;
      }
      if (Array.isArray(v.metaPaginationRecords))
        for (const x of v.metaPaginationRecords)
          if (x && typeof x === "object") out.push(x);
      for (const x of Object.values(v)) walk(x, d + 1);
    };
  for (const x of Array.isArray(c.evaluate_results) ? c.evaluate_results : [])
    walk(x);
  return out;
}
function responseBody(r) {
  for (const x of [r.response, r.responseBody, r.body]) {
    if (x && typeof x === "object") {
      if (x.truncated || x.malformed || x.unreadable)
        return { invalid: true, reason: "response_truncated_or_malformed" };
      return { value: x };
    }
    if (typeof x === "string") {
      if (x.length > 4000000)
        return { invalid: true, reason: "response_truncated_or_malformed" };
      try {
        return { value: JSON.parse(x) };
      } catch {
        try {
          const lines = x
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean);
          if (lines.length > 1)
            return { value: lines.map((line) => JSON.parse(line)) };
        } catch {
          // A malformed final line means the stream is incomplete.
        }
        return { invalid: true, reason: "response_truncated_or_malformed" };
      }
    }
  }
  return { invalid: true, reason: "response_body_missing" };
}
function connection(v, d = 0) {
  if (d > 12 || v == null || typeof v !== "object") return null;
  if (
    !Array.isArray(v) &&
    v.search_results_connection &&
    typeof v.search_results_connection === "object"
  )
    return { value: v.search_results_connection };
  if (Array.isArray(v)) {
    for (const x of v) {
      const y = connection(x, d + 1);
      if (y) return y;
    }
    return null;
  }
  for (const x of Object.values(v)) {
    const y = connection(x, d + 1);
    if (y) return y;
  }
  return null;
}
function finalStream(v, d = 0) {
  if (d > 12 || v == null || typeof v !== "object") return false;
  if (v.extensions && v.extensions.is_final === true) return true;
  if (Array.isArray(v)) return v.some((x) => finalStream(x, d + 1));
  return Object.values(v).some((x) => finalStream(x, d + 1));
}
function hasErrors(v, d = 0) {
  if (d > 12 || v == null || typeof v !== "object") return false;
  if (!Array.isArray(v) && Array.isArray(v.errors) && v.errors.length)
    return true;
  if (Array.isArray(v)) return v.some((x) => hasErrors(x, d + 1));
  return Object.values(v).some((x) => hasErrors(x, d + 1));
}
function adRecords(c) {
  const out = [],
    seen = new Set();
  if (!Array.isArray(c.edges)) return out;
  const walk = (v) => {
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) {
      for (const x of v) walk(x);
      return;
    }
    const id = v.ad_archive_id ?? v.adArchiveID;
    if (typeof id === "string" && /^\d[\d_]{5,}$/.test(id) && !seen.has(id)) {
      seen.add(id);
      out.push({ id, node: v });
    }
    for (const x of Object.values(v)) walk(x);
  };
  for (const e of c.edges)
    walk(e && typeof e === "object" ? (e.node ?? e) : null);
  return out;
}
function info(c) {
  const p = c && c.page_info;
  if (!p || typeof p !== "object" || typeof p.has_next_page !== "boolean")
    return null;
  return {
    hasNextPage: p.has_next_page,
    endCursor: typeof p.end_cursor === "string" ? p.end_cursor : null,
  };
}
function oneRequestValue(value) {
  if (Array.isArray(value)) return value.length === 1 ? value[0] : null;
  return value;
}
function reqPage(r) {
  const x = r.request || r.variables || r;
  const v = oneRequestValue(
    x.pageId ??
      x.page_id ??
      x.viewAllPageID ??
      x.view_all_page_id ??
      x.pageIDs ??
      x.pagesID,
  );
  return v == null ? null : String(v);
}
function reqAfter(r) {
  const x = r.request || r.variables || r;
  const v = x.after ?? x.cursor ?? x.endCursor ?? x.end_cursor;
  return v == null ? null : String(v);
}
function reqFilters(r, expectedCountry, expectedActiveStatus) {
  const x = r.request || r.variables || r;
  const operation = x.operation ?? x.operationName ?? x.friendlyOperation;
  const active = oneRequestValue(x.activeStatus ?? x.active_status);
  const country = oneRequestValue(x.country ?? x.country_code ?? x.countries);
  return (
    typeof operation === "string" &&
    operation.length > 0 &&
    typeof active === "string" &&
    active.toLowerCase() === expectedActiveStatus.toLowerCase() &&
    typeof country === "string" &&
    country.toUpperCase() === expectedCountry.toUpperCase()
  );
}
function pageHtml(c) {
  if (typeof c.body === "string") return c.body;
  if (c.body && typeof c.body === "object") return JSON.stringify(c.body);
  if (typeof c.html === "string") return c.html;
  return "";
}
function partial(base, warns, count = 0) {
  return {
    outcome: "partial",
    ads: base.ads || [],
    adIds: base.adIds || [],
    connectionCount: base.connectionCount ?? null,
    pageInfo: base.pageInfo || { hasNextPage: null, endCursor: null },
    warnings: [...new Set([...(base.warnings || []), ...warns])],
    coverageComplete: false,
    paginationExhausted: false,
    paginationRecords: count,
  };
}

/**
 * Parse final HTML and recorder responses. Arbitrary xhr[] entries are ignored.
 */
export function parseMetaPaginatedCapture(
  raw,
  expectedPageId,
  { country = "AU", activeStatus = "active" } = {},
) {
  const c = unwrap(raw),
    expected = String(expectedPageId ?? "").trim();
  const initial = classifyMetaAdLibraryPayload(pageHtml(c), {
    requestedPageId: expected || null,
  });
  const base = {
    outcome: initial.outcome,
    ads: initial.ads,
    adIds: initial.adIds,
    connectionCount: initial.connectionCount,
    pageInfo: initial.pageInfo,
    warnings: initial.warnings,
  };
  if (!expected || !/^\d{5,}$/.test(expected))
    return partial(base, ["requested_page_id_invalid"]);
  if (["challenge", "login_wall", "unparseable"].includes(initial.outcome))
    return {
      ...base,
      warnings: [...initial.warnings, "initial_capture_" + initial.outcome],
      coverageComplete: false,
      paginationExhausted: false,
      paginationRecords: 0,
    };
  if (initial.pageInfo.hasNextPage === false)
    return {
      ...base,
      warnings: [...initial.warnings],
      coverageComplete:
        initial.outcome === "success" ||
        initial.outcome === "confirmed_absence",
      paginationExhausted:
        initial.outcome === "success" ||
        initial.outcome === "confirmed_absence",
      paginationRecords: 0,
    };
  if (
    initial.outcome !== "success" ||
    initial.pageInfo.hasNextPage !== true ||
    typeof initial.pageInfo.endCursor !== "string" ||
    !initial.pageInfo.endCursor
  )
    return partial(base, ["initial_page_pagination_unproven"]);
  if (failed(c)) return partial(base, ["js_scenario_failed"]);
  const rs = records(c);
  let cursor = initial.pageInfo.endCursor,
    last = null,
    ads = [...initial.ads];
  const ids = new Set(initial.adIds),
    warn = [...initial.warnings];
  let valid = 0,
    done = false,
    why = null;
  for (const r of rs) {
    const status = Number(r.status ?? r.httpStatus ?? 0);
    if (status < 200 || status >= 300) {
      why = "pagination_http_failure";
      break;
    }
    if (reqPage(r) !== expected) {
      why = "pagination_page_mismatch";
      break;
    }
    if (reqAfter(r) !== cursor) {
      why = "pagination_cursor_gap";
      break;
    }
    if (!reqFilters(r, String(country), String(activeStatus))) {
      why = "pagination_request_filters_mismatch";
      break;
    }
    const body = responseBody(r);
    if (body.invalid) {
      why = body.reason;
      break;
    }
    if (hasErrors(body.value)) {
      why = "pagination_response_errors";
      break;
    }
    const found = connection(body.value);
    if (!found || !finalStream(body.value)) {
      why = "pagination_response_not_final";
      break;
    }
    const pi = info(found.value);
    if (!pi) {
      why = "pagination_page_info_missing";
      break;
    }
    for (const a of adRecords(found.value))
      if (!ids.has(a.id)) {
        ids.add(a.id);
        ads.push(a);
      }
    valid++;
    last = found.value;
    if (pi.hasNextPage === true && pi.endCursor === cursor) {
      why = "pagination_cursor_not_progressing";
      break;
    }
    cursor = pi.endCursor;
    if (pi.hasNextPage === false) {
      done = true;
      break;
    }
    if (!cursor) {
      why = "pagination_cursor_missing";
      break;
    }
  }
  if (done)
    return {
      outcome: "success",
      ads,
      adIds: [...ids],
      connectionCount:
        typeof last.count === "number" ? last.count : initial.connectionCount,
      pageInfo: { hasNextPage: false, endCursor: cursor },
      warnings: [...new Set(warn)],
      coverageComplete: true,
      paginationExhausted: true,
      paginationRecords: valid,
    };
  if (why) warn.push(why);
  else
    warn.push(
      rs.length ? "pagination_chain_incomplete" : "pagination_records_missing",
    );
  const pbase = {
    ...base,
    ads,
    adIds: [...ids],
    connectionCount:
      last && typeof last.count === "number"
        ? last.count
        : base.connectionCount,
    pageInfo: (last && info(last)) || base.pageInfo,
  };
  return partial(pbase, warn, valid);
}
