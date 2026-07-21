const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", e => errors.push("PAGEERROR: " + e.message));
  page.on("console", m => { if (m.type() === "error") errors.push("CONSOLE: " + m.text()); });

  await page.goto("file:///C:/Dev/Blockwise/mockups/publish-flow-mockup.html");
  await page.waitForTimeout(600);

  const out = "C:/Dev/Blockwise/mockups/screens-v2";
  const fs = require("fs"); fs.mkdirSync(out, { recursive: true });
  const shot = async n => { await page.screenshot({ path: `${out}/${n}.png`, fullPage: false }); console.log("shot", n); };

  // 1. step 1 default (use existing selected)
  await shot("01-step1-existing");

  // placement -> suggested
  await page.click('.place[data-p="suggested"]');
  await page.waitForTimeout(250);
  const suggestedVisible = await page.isVisible("#suggestedCard");
  const nameHidden = !(await page.isVisible("#nameCard"));
  console.log("suggested card visible:", suggestedVisible, "| name card hidden:", nameHidden);
  await shot("02-step1-suggested");

  // placement -> new
  await page.click('.place[data-p="new"]');
  await page.waitForTimeout(250);
  const nameVisible = await page.isVisible("#nameCard");
  console.log("name card visible on new:", nameVisible);
  await shot("03-step1-new");

  // name validation: clear name, try continue
  await page.fill("#campaignName", "");
  await page.click("#nextBtn");
  await page.waitForTimeout(200);
  const nameInvalid = await page.evaluate(() => document.getElementById("nameField").classList.contains("invalid"));
  console.log("empty name blocked:", nameInvalid);
  // pick suggested chip
  await page.click('.name-chip[data-name="WA_SellerLeads_Winter_Jul26"]');
  const chipApplied = await page.$eval("#campaignName", el => el.value);
  console.log("chip applied:", chipApplied);

  // back to existing for main path
  await page.click('.place[data-p="existing"]');
  await page.waitForTimeout(200);
  await page.click("#nextBtn");
  await page.waitForTimeout(400);

  // 2. step 2 variants: deselect all -> blocked
  await page.click('.variant[data-v="0"]');
  await page.click('.variant[data-v="1"]');
  await page.click('.variant[data-v="2"]');
  await page.click("#nextBtn");
  await page.waitForTimeout(200);
  const hintShown = await page.evaluate(() => !document.getElementById("selectHint").hidden);
  console.log("zero-variants blocked:", hintShown);
  // reselect two
  await page.click('.variant[data-v="0"]');
  await page.click('.variant[data-v="1"]');
  await page.waitForTimeout(200);
  await shot("04-step2-two-variants");
  // open education accordion
  await page.click('[data-step="1"] .edu summary');
  await page.waitForTimeout(300);
  await shot("05-step2-education-open");
  await page.click('[data-step="1"] .edu summary');
  await page.click("#nextBtn");
  await page.waitForTimeout(400);

  // 3. step 3: bad URL blocked
  await page.fill("#destUrl", "not-a-url");
  await page.click("#nextBtn");
  await page.waitForTimeout(200);
  const urlBlocked = await page.evaluate(() => document.getElementById("urlField").classList.contains("invalid"));
  console.log("bad URL blocked:", urlBlocked);
  await page.fill("#destUrl", "https://southshorerealty.com.au/free-appraisal");
  await page.click(".obj[data-o='Traffic']");
  await page.waitForTimeout(150);
  await page.click(".obj[data-o='Leads']");
  await page.click("#nextBtn");
  await page.waitForTimeout(400);

  // 4. step 4: custom budget + custom dates
  await page.click('.b-card[data-b="custom"]');
  await page.fill("#customBudget", "35");
  await page.waitForTimeout(150);
  const customWrapShown = await page.evaluate(() => document.getElementById("customBudgetWrap").classList.contains("show"));
  const est1 = await page.$eval("#estTotal b", el => el.textContent);
  console.log("custom budget wrap shown:", customWrapShown, "| est total (35x7):", est1);

  await page.click('.dur[data-d="custom"]');
  await page.fill("#startDate", "2026-08-01");
  await page.fill("#endDate", "2026-08-14");
  await page.waitForTimeout(200);
  const est2 = await page.$eval("#estTotal b", el => el.textContent);
  const estLeads = await page.$eval("#estLeads b", el => el.textContent);
  console.log("est total (35 x 14d):", est2, "| est leads:", estLeads);
  await shot("06-step4-custom");

  await page.click('.dur[data-d="until"]');
  await page.waitForTimeout(200);
  const estNote = await page.$eval("#estNote", el => el.textContent);
  console.log("until-closed note:", estNote.slice(0, 50));
  await shot("07-step4-untilclosed");
  await page.click("#nextBtn");
  await page.waitForTimeout(400);

  // 5. review
  const summary = await page.$$eval("#summaryRows .srow", els => els.map(e => e.textContent.trim().replace(/\s+/g, " ")));
  console.log("REVIEW SUMMARY:", JSON.stringify(summary, null, 1));
  const checks = await page.$$eval("#checklist .check-row", els => els.map(e => e.textContent.trim().split("Goal")[0].length >= 0 ? e.childNodes[1] && e.childNodes[1].textContent : ""));
  const checkLabels = await page.$$eval("#checklist .check-row", els => els.map(e => { const t = e.textContent.trim(); return t.slice(0, 30); }));
  console.log("READINESS ITEMS:", JSON.stringify(checkLabels));
  await shot("08-step5-review");

  // 6. publish
  await page.click("#nextBtn");
  await page.waitForTimeout(1700);
  const onLive = await page.evaluate(() => document.querySelector('.step-pane[data-step="5"]').classList.contains("active"));
  const successSub = await page.$eval("#successSub", el => el.textContent.trim().slice(0, 120));
  console.log("reached live screen:", onLive);
  console.log("success copy:", successSub);
  const railDone = await page.$$eval(".step-item.done", els => els.length);
  console.log("rail steps done:", railDone, "of 6");
  await shot("09-step6-live");

  // annotations toggle
  await page.click("#annoToggle");
  await page.waitForTimeout(250);
  const annos = await page.$$eval(".annotation", els => els.filter(e => getComputedStyle(e).display !== "none").length);
  console.log("annotations visible after toggle:", annos);

  // back navigation check
  await page.click("#backToStudio");
  await page.waitForTimeout(300);
  const backOnStep1 = await page.evaluate(() => document.querySelector('.step-pane[data-step="0"]').classList.contains("active"));
  console.log("back-to-studio resets to step 1:", backOnStep1);

  console.log("JS ERRORS:", errors.length ? errors : "none");
  await browser.close();
})();
