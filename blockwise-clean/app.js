/* Suburb Signals — interactions
   Split-screen live feed · reveal-on-scroll · chart · FAQ · nav */
(function () {
  "use strict";
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var ADS = window.BLOCKWISE_ADS || [];
  var MARKETS = window.BLOCKWISE_MARKETS || {};

  var VERIFY = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 1.6 14.7 4l3.5-.5L19 7l3 1.9-2 3 .9 3.6-3.6.6L15.4 19 12 17.5 8.6 19l-1.9-2.9-3.6-.6L4 11.9l-2-3L5 7l.8-3.5L9.3 4 12 1.6Zm-1 13 5-5-1.4-1.4-3.6 3.6-1.6-1.6L8 11.2l3 3.4Z"/></svg>';

  /* ---------- compact feed card ---------- */
  function card(ad) {
    var plat = ad.platform === "Both" ? "Facebook · Instagram" : ad.platform;
    return '<article class="adc">' +
      '<div class="adc__h">' +
        '<div class="adc__av" style="background:' + ad.c + '">' + ad.initials + '</div>' +
        '<div><div class="adc__n">' + ad.agency + (ad.verified ? VERIFY : '') + '</div>' +
        '<div class="adc__m">Sponsored · ' + plat + '</div></div>' +
      '</div>' +
      '<p class="adc__t">' + ad.text + '</p>' +
      '<div class="adc__img" style="--g1:' + ad.g1 + ';--g2:' + ad.g2 + '"><span class="adc__cap">' + ad.cap + '</span></div>' +
      '<div class="adc__live"><span class="d"></span>Active ' + ad.days + 'd</div>' +
    '</article>';
  }

  /* float the searched suburb to the top, then longest-running first */
  function orderedAds(market) {
    var key = market.replace(/,.*$/, "").trim().toLowerCase();
    return ADS.slice().sort(function (a, b) {
      var am = a.suburb.toLowerCase().indexOf(key) === 0 ? 0 : 1;
      var bm = b.suburb.toLowerCase().indexOf(key) === 0 ? 0 : 1;
      if (am !== bm) return am - bm;
      return b.days - a.days;
    });
  }

  var track = document.getElementById("feedTrack");
  var marketEl = document.getElementById("adMarket");
  var countEl = document.getElementById("adCount");
  var input = document.getElementById("radarSearch");

  function buildFeed(market) {
    if (!track) return;
    var html = orderedAds(market).map(card).join("");
    track.innerHTML = html + html; // doubled for a seamless loop
  }

  function animateNumber(el, target) {
    if (!el) return;
    if (reduce) { el.textContent = target.toLocaleString(); return; }
    var from = parseInt((el.textContent || "0").replace(/[^0-9]/g, "")) || 0, t0 = performance.now();
    (function step(now) {
      var p = Math.min((now - t0) / 800, 1), e = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(from + (target - from) * e).toLocaleString();
      if (p < 1) requestAnimationFrame(step);
    })(t0);
  }

  function setMarket(market, animate) {
    if (marketEl) marketEl.textContent = market;
    var target = (MARKETS[market] && MARKETS[market].count) || orderedAds(market).length;
    if (countEl) { if (animate) animateNumber(countEl, target); else countEl.textContent = target.toLocaleString(); }
  }

  function scan(market) {
    setMarket(market, true);
    buildFeed(market);
  }

  function wireSearch() {
    var form = document.getElementById("radarForm");
    if (!form) return;
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var v = (input.value || "").trim();
      if (!v) { scan("Perth, WA"); return; }
      var match = Object.keys(MARKETS).find(function (m) {
        return m.toLowerCase().indexOf(v.toLowerCase()) === 0;
      });
      scan(match || v.replace(/(^|\s)\S/g, function (s) { return s.toUpperCase(); }));
    });
  }

  /* ---------- reveal-on-scroll + chart fill ---------- */
  function inView(el, marginRatio) {
    var vh = window.innerHeight || document.documentElement.clientHeight || 0;
    if (vh < 2) return true;
    var r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    var m = vh * (marginRatio || 0.06);
    return r.top < (vh - m) && r.bottom > 0;
  }
  function fillChart(chart) {
    if (chart.classList.contains("filled")) return;
    chart.classList.add("filled");
    chart.querySelectorAll(".bar").forEach(function (bar, i) {
      var v = +bar.dataset.v;
      setTimeout(function () { bar.querySelector("i").style.height = (v * 100) + "%"; }, reduce ? 0 : i * 70);
    });
  }
  function scrollCheck() {
    document.querySelectorAll("[data-reveal]:not(.in)").forEach(function (el) {
      if (inView(el, 0.05)) el.classList.add("in");
    });
    document.querySelectorAll(".chart:not(.filled)").forEach(function (el) {
      if (inView(el, 0.12)) fillChart(el);
    });
  }
  var ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () { scrollCheck(); ticking = false; });
  }
  function wireScroll() {
    if (reduce) {
      document.querySelectorAll("[data-reveal]").forEach(function (e) { e.classList.add("in"); });
      document.querySelectorAll(".chart").forEach(fillChart);
      return;
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    scrollCheck();
    setTimeout(scrollCheck, 120);
    // failsafe: if the hero never reveals (no-transition contexts), force static
    setTimeout(function () {
      var h = document.querySelector(".hero h1");
      var op = h ? parseFloat(getComputedStyle(h).opacity) : 1;
      if (!isFinite(op) || op < 0.05) {
        document.documentElement.classList.add("no-anim");
        document.querySelectorAll("[data-reveal]").forEach(function (e) { e.classList.add("in"); });
        document.querySelectorAll(".chart").forEach(fillChart);
      }
    }, 1500);
  }

  /* ---------- FAQ ---------- */
  function wireFaq() {
    document.querySelectorAll(".faq__item").forEach(function (item) {
      var q = item.querySelector(".faq__q"), a = item.querySelector(".faq__a");
      q.addEventListener("click", function () {
        var open = item.getAttribute("aria-expanded") === "true";
        document.querySelectorAll(".faq__item").forEach(function (o) {
          o.setAttribute("aria-expanded", "false");
          o.querySelector(".faq__a").style.height = "0px";
        });
        if (!open) { item.setAttribute("aria-expanded", "true"); a.style.height = a.scrollHeight + "px"; }
      });
    });
  }

  /* ---------- nav scrolled state ---------- */
  function wireNav() {
    var nav = document.querySelector(".nav");
    if (!nav) return;
    var on = function () { nav.classList.toggle("scrolled", window.scrollY > 8); };
    on();
    window.addEventListener("scroll", on, { passive: true });
  }

  /* ---------- init ---------- */
  function init() {
    wireNav();
    wireSearch();
    wireScroll();
    wireFaq();
    buildFeed("Perth, WA");
    setMarket("Perth, WA", false);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
