/* Blockwise - interactions
   SubSignals demo + hero live feed · reveal-on-scroll · chart · counters · FAQ */
(function () {
  "use strict";
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var ADS = window.BLOCKWISE_ADS || [];
  var MARKETS = window.BLOCKWISE_MARKETS || {};

  /* ---------- icons ---------- */
  var ICON = {
    verify: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 1.6 14.7 4l3.5-.5L19 7l3 1.9-2 3 .9 3.6-3.6.6L15.4 19 12 17.5 8.6 19l-1.9-2.9-3.6-.6L4 11.9l-2-3L5 7l.8-3.5L9.3 4 12 1.6Zm-1 13 5-5-1.4-1.4-3.6 3.6-1.6-1.6L8 11.2l3 3.4Z"/></svg>',
    like: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M7 10v10H4V10h3Zm0 0 4.5-7c1 0 2 .8 2 2v3h5a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 19.3 21H7"/></svg>',
    comment: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 11.5a8 8 0 0 1-11.6 7.1L3 20l1.4-6.4A8 8 0 1 1 21 11.5Z"/></svg>',
    share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v13"/></svg>'
  };

  /* ---------- build one radar ad card ---------- */
  function card(ad){
    var el = document.createElement("article");
    el.className = "ad";
    el.dataset.platform = ad.platform;
    el.dataset.type = ad.type;
    var platLabel = ad.platform === "Both" ? "Facebook · Instagram" : ad.platform;
    el.innerHTML =
      '<div class="ad__top">' +
        '<div class="ad__avatar" style="--c:'+ad.c+'">'+ad.initials+'</div>' +
        '<div class="ad__page">' +
          '<div class="ad__name">'+ad.agency+(ad.verified?ICON.verify:'')+'</div>' +
          '<div class="ad__meta">Sponsored <span class="sep"></span> '+platLabel+'</div>' +
        '</div>' +
        '<button class="ad__more" aria-label="More">···</button>' +
      '</div>' +
      '<p class="ad__text">'+ad.text+'</p>' +
      '<div class="ad__media" style="--g1:'+ad.g1+';--g2:'+ad.g2+'">' +
        '<span class="ad__media-tag">'+ad.tag+'</span>' +
        '<span class="ad__media-cap">'+ad.cap+'</span>' +
      '</div>' +
      '<div class="ad__cta">' +
        '<div class="ad__cta-left">' +
          '<div class="ad__url">'+ad.url+'</div>' +
          '<div class="ad__headline">'+ad.headline+'</div>' +
        '</div>' +
        '<button class="ad__btn">'+ad.cta+'</button>' +
      '</div>' +
      '<div class="ad__stats">' +
        '<span class="s">'+ICON.like+ad.likes+'</span>' +
        '<span class="s">'+ICON.comment+ad.comments+'</span>' +
        '<span class="s">'+ICON.share+ad.shares+'</span>' +
        '<span class="ad__active"><span class="ld"></span>Active '+ad.days+'d</span>' +
      '</div>';
    return el;
  }

  /* ---------- state ---------- */
  var state = { market: "Perth, WA", platform: "All", type: "All" };
  var grid = document.getElementById("adGrid");
  var countEl = document.getElementById("adCount");
  var marketEl = document.getElementById("adMarket");
  var metaEl = document.getElementById("resultMeta");
  var scanEl = document.getElementById("scanState");
  var scanLabel = document.getElementById("scanLabel");
  var searchInput = document.getElementById("radarSearch");
  var spyMarketEl = document.getElementById("spyMarket");
  var spyCountEl = document.getElementById("spyCount");
  // hero split-screen live feed
  var feedTrack = document.getElementById("feedTrack");
  var feedMarketEl = document.getElementById("feedMarket");
  var feedCountEl = document.getElementById("feedCount");

  /* order ads so the searched suburb floats up; longest-running first */
  function orderedAds(market){
    var key = market.replace(/,.*$/,"").trim().toLowerCase();
    var copy = ADS.slice();
    copy.sort(function(a,b){
      var am = a.suburb.toLowerCase().indexOf(key) === 0 ? 0 : 1;
      var bm = b.suburb.toLowerCase().indexOf(key) === 0 ? 0 : 1;
      if (am !== bm) return am - bm;
      return b.days - a.days; // longest-running first = "proven" ads
    });
    return copy;
  }

  function filtered(){
    return orderedAds(state.market).filter(function(ad){
      var pOk = state.platform === "All" ||
        ad.platform === state.platform ||
        (ad.platform === "Both");
      if (state.platform !== "All" && ad.platform !== "Both" && ad.platform !== state.platform) pOk = false;
      var tOk = state.type === "All" || ad.type === state.type;
      return pOk && tOk;
    });
  }

  function render(stagger){
    if (!grid) return;
    var list = filtered();
    grid.innerHTML = "";
    list.forEach(function(ad){ grid.appendChild(card(ad)); });
    var total = (MARKETS[state.market] && MARKETS[state.market].count) || list.length;
    if (metaEl) metaEl.textContent = "Showing " + list.length + " of ~" + total.toLocaleString() + " active ads";
    var cards = grid.querySelectorAll(".ad");
    cards.forEach(function(c, i){
      if (reduce){ c.classList.add("show"); return; }
      setTimeout(function(){ c.classList.add("show"); }, stagger ? 60 + i * 55 : 0);
    });
  }

  /* ---------- hero live feed (split-screen) ---------- */
  function feedCard(ad){
    var plat = ad.platform === "Both" ? "Facebook · Instagram" : ad.platform;
    return '<article class="adc">' +
      '<div class="adc__h">' +
        '<div class="adc__av" style="background:' + ad.c + '">' + ad.initials + '</div>' +
        '<div><div class="adc__n">' + ad.agency + (ad.verified ? ICON.verify : '') + '</div>' +
        '<div class="adc__m">Sponsored · ' + plat + '</div></div>' +
      '</div>' +
      '<p class="adc__t">' + ad.text + '</p>' +
      '<div class="adc__img" style="--g1:' + ad.g1 + ';--g2:' + ad.g2 + '"><span class="adc__cap">' + ad.cap + '</span></div>' +
      '<div class="adc__live"><span class="d"></span>Active ' + ad.days + 'd</div>' +
    '</article>';
  }
  function buildFeed(market){
    if (!feedTrack) return;
    var html = orderedAds(market).map(feedCard).join("");
    feedTrack.innerHTML = html + html; // doubled for a seamless loop
  }
  function updateFeed(market, animateCount){
    var target = (MARKETS[market] && MARKETS[market].count) || orderedAds(market).length;
    if (feedMarketEl) feedMarketEl.textContent = market;
    if (feedCountEl){
      if (animateCount && !reduce) animateNumber(feedCountEl, target, 800);
      else feedCountEl.textContent = target.toLocaleString();
    }
    buildFeed(market);
  }

  function setMarket(market, animateCount){
    state.market = market;
    if (marketEl) marketEl.innerHTML = '<b>' + market + '</b>';
    if (spyMarketEl) spyMarketEl.textContent = market;
    var target = (MARKETS[market] && MARKETS[market].count) || filtered().length;
    if (countEl){
      if (animateCount && !reduce) animateNumber(countEl, target, 900);
      else countEl.textContent = target.toLocaleString();
    }
    if (spyCountEl) spyCountEl.textContent = target.toLocaleString();
  }

  /* ---------- scan flow ---------- */
  var blipTimers = [];
  function scan(market){
    market = market || state.market;
    // sync demo chips
    document.querySelectorAll(".chip[data-market]").forEach(function(ch){
      ch.setAttribute("aria-pressed", ch.dataset.market === market ? "true" : "false");
    });
    // update the hero live feed immediately (independent of the demo scan delay)
    updateFeed(market, true);
    if (reduce){ setMarket(market, false); render(false); return; }

    if (scanLabel) scanLabel.innerHTML = 'Scanning <b>' + market + '</b>…';
    if (scanEl) scanEl.classList.add("on");
    spawnBlips();
    if (grid) grid.style.opacity = "0.25";

    setTimeout(function(){
      if (scanEl) scanEl.classList.remove("on");
      clearBlips();
      if (grid) grid.style.opacity = "1";
      setMarket(market, true);
      render(true);
    }, 1350);
  }

  function spawnBlips(){
    if (!scanEl) return;
    var radar = scanEl.querySelector(".scan__radar");
    if (!radar) return;
    for (var i = 0; i < 5; i++){
      (function(i){
        var t = setTimeout(function(){
          var b = document.createElement("span");
          b.className = "scan__blip";
          var ang = Math.random() * Math.PI * 2;
          var rad = 20 + Math.random() * 42;
          b.style.left = (50 + Math.cos(ang) * rad) + "%";
          b.style.top = (50 + Math.sin(ang) * rad) + "%";
          radar.appendChild(b);
          b.animate(
            [{ opacity:0, transform:"scale(.4)" },{ opacity:1, transform:"scale(1)" },{ opacity:0, transform:"scale(.6)" }],
            { duration:1100, easing:"ease-out" }
          );
          setTimeout(function(){ b.remove(); }, 1100);
        }, 150 + i * 200);
        blipTimers.push(t);
      })(i);
    }
  }
  function clearBlips(){ blipTimers.forEach(clearTimeout); blipTimers = []; }

  /* ---------- number animation ---------- */
  function animateNumber(el, target, dur){
    var start = 0, t0 = performance.now();
    function step(now){
      var p = Math.min((now - t0) / dur, 1);
      var e = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(start + (target - start) * e).toLocaleString();
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  /* ---------- wire controls ---------- */
  function wireRadar(){
    // demo suburb chips
    document.querySelectorAll(".chip[data-market]").forEach(function(ch){
      ch.addEventListener("click", function(){
        if (searchInput) searchInput.value = "";
        scan(ch.dataset.market);
        var r = document.getElementById("radar");
        if (r) r.scrollIntoView({ block:"nearest" });
      });
    });
    // hero search submit
    var form = document.getElementById("radarForm");
    if (form){
      form.addEventListener("submit", function(e){
        e.preventDefault();
        var v = (searchInput.value || "").trim();
        if (!v){ scan("Perth, WA"); return; }
        var match = Object.keys(MARKETS).find(function(m){
          return m.toLowerCase().indexOf(v.toLowerCase()) === 0;
        });
        scan(match || v);
      });
    }
    // platform segmented
    document.querySelectorAll(".seg[data-group='platform'] button").forEach(function(b){
      b.addEventListener("click", function(){
        document.querySelectorAll(".seg[data-group='platform'] button").forEach(function(x){ x.setAttribute("aria-pressed","false"); });
        b.setAttribute("aria-pressed","true");
        state.platform = b.dataset.platform;
        render(true);
      });
    });
    // type chips
    document.querySelectorAll(".tchip[data-type]").forEach(function(b){
      b.addEventListener("click", function(){
        document.querySelectorAll(".tchip[data-type]").forEach(function(x){ x.setAttribute("aria-pressed","false"); });
        b.setAttribute("aria-pressed","true");
        state.type = b.dataset.type;
        render(true);
      });
    });
  }

  /* ---------- scroll-driven reveal / charts / counters / auto-scan ----------
     Rect-based (not IntersectionObserver) so it works reliably in every
     preview/screenshot context. Failsafe reveals everything after a beat. */
  var scanFired = false;
  function inView(el, marginRatio){
    var vh = window.innerHeight || document.documentElement.clientHeight || 0;
    if (vh < 2) return true; // broken/zero viewport (some preview contexts) -> reveal
    var r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    var m = vh * (marginRatio || 0.06);
    return r.top < (vh - m) && r.bottom > 0;
  }
  function countUp(el){
    if (el.classList.contains("counted")) return;
    el.classList.add("counted");
    var pre = el.dataset.prefix || "", suf = el.dataset.suffix || "", target = +el.dataset.count;
    if (reduce){ el.textContent = pre + target.toLocaleString() + suf; return; }
    var t0 = performance.now(), dur = 1100;
    (function loop(now){
      var p = Math.min((now - t0) / dur, 1), e = 1 - Math.pow(1 - p, 3);
      el.textContent = pre + Math.round(target * e).toLocaleString() + suf;
      if (p < 1) requestAnimationFrame(loop);
    })(t0);
  }
  function fillChart(chart){
    if (chart.classList.contains("filled")) return;
    chart.classList.add("filled");
    chart.querySelectorAll(".bar").forEach(function(bar, i){
      var v = +bar.dataset.v;
      setTimeout(function(){ bar.querySelector("i").style.height = (v * 100) + "%"; }, reduce ? 0 : i * 70);
    });
  }
  function scrollCheck(){
    document.querySelectorAll("[data-reveal]:not(.in)").forEach(function(el){
      if (inView(el, 0.05)) el.classList.add("in");
    });
    document.querySelectorAll(".chart:not(.filled)").forEach(function(el){
      if (inView(el, 0.12)) fillChart(el);
    });
    document.querySelectorAll("[data-count]:not(.counted)").forEach(function(el){
      if (inView(el, 0.12)) countUp(el);
    });
    if (!scanFired && !reduce){
      var p = document.getElementById("radar");
      if (p && inView(p, 0.22)){ scanFired = true; scan("Perth, WA"); }
    }
  }
  var ticking = false;
  function onScroll(){
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function(){ scrollCheck(); ticking = false; });
  }
  function forceStatic(){
    document.documentElement.classList.add("no-anim");
    document.querySelectorAll("[data-reveal]").forEach(function(e){ e.classList.add("in"); });
    document.querySelectorAll(".chart").forEach(function(c){
      c.classList.add("filled");
      c.querySelectorAll(".bar").forEach(function(b){ b.querySelector("i").style.height = (+b.dataset.v * 100) + "%"; });
    });
    document.querySelectorAll("[data-count]").forEach(function(el){
      el.classList.add("counted");
      el.textContent = (el.dataset.prefix || "") + (+el.dataset.count).toLocaleString() + (el.dataset.suffix || "");
    });
    document.querySelectorAll("#adGrid .ad").forEach(function(e){ e.classList.add("show"); });
  }
  function wireScroll(){
    if (reduce){
      document.querySelectorAll("[data-reveal]").forEach(function(e){ e.classList.add("in"); });
      document.querySelectorAll(".chart").forEach(fillChart);
      document.querySelectorAll("[data-count]").forEach(countUp);
      return;
    }
    window.addEventListener("scroll", onScroll, { passive:true });
    window.addEventListener("resize", onScroll, { passive:true });
    scrollCheck();                 // reveal anything already in view
    setTimeout(scrollCheck, 120);  // after fonts/layout settle
    // capability failsafe: if the hero is still invisible shortly after load,
    // CSS transitions aren't progressing in this context - render everything static.
    setTimeout(function(){
      var h = document.querySelector(".hero h1");
      var op = h ? parseFloat(getComputedStyle(h).opacity) : 1;
      if (!isFinite(op) || op < 0.05) forceStatic();
    }, 1500);
  }

  /* ---------- FAQ ---------- */
  function wireFaq(){
    document.querySelectorAll(".faq__item").forEach(function(item){
      var q = item.querySelector(".faq__q");
      var a = item.querySelector(".faq__a");
      q.addEventListener("click", function(){
        var open = item.getAttribute("aria-expanded") === "true";
        document.querySelectorAll(".faq__item").forEach(function(o){
          o.setAttribute("aria-expanded","false");
          o.querySelector(".faq__a").style.height = "0px";
        });
        if (!open){
          item.setAttribute("aria-expanded","true");
          a.style.height = a.scrollHeight + "px";
        }
      });
    });
  }

  /* ---------- nav scrolled state ---------- */
  function wireNav(){
    var nav = document.querySelector(".nav");
    if (!nav) return;
    var onScroll = function(){ nav.classList.toggle("scrolled", window.scrollY > 8); };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive:true });
  }

  /* ---------- init ---------- */
  function init(){
    wireNav();
    wireRadar();
    wireScroll();
    wireFaq();
    // first paint of radar + hero feed (static), then auto-scan when scrolled into view
    setMarket("Perth, WA", false);
    render(false);
    updateFeed("Perth, WA", false);
    document.querySelectorAll(".chip[data-market]").forEach(function(ch){
      ch.setAttribute("aria-pressed", ch.dataset.market === "Perth, WA" ? "true" : "false");
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
