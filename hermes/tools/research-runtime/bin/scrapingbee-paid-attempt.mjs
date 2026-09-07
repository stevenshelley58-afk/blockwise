function strictNumber(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function parseScrapingBeeUsage(usage, verifiedAt) {
  const max = strictNumber(usage?.max_api_credit);
  const used = strictNumber(usage?.used_api_credit);
  if (max === null || max <= 0 || used === null || used < 0) {
    throw new Error("scrapingbee usage returned invalid credit metadata");
  }
  return { remaining: Math.max(0, max - used), verifiedAt };
}

export function assertBudgetWithinConfiguredCap(maxCredits, configuredCap) {
  const budgetMax = strictNumber(maxCredits);
  if (budgetMax === null || budgetMax <= 0 || budgetMax > configuredCap) {
    throw new Error("scrapingbee database budget exceeds configured monthly cap");
  }
}

export function readScrapingBeeReceipt(headers) {
  const rawCost = headers.get("spb-cost");
  const rawAutoCost = headers.get("spb-auto-cost");
  const selected = rawCost !== null ? rawCost : rawAutoCost;
  const validNumber = (value) => value !== null && value.trim() !== "" && Number.isFinite(Number(value));
  const parsed = validNumber(selected) ? Number(selected) : NaN;
  const numberOrNull = (value) => validNumber(value) ? Number(value) : null;
  return {
    chargeKnown: Number.isFinite(parsed) && parsed >= 0,
    credits: Number.isFinite(parsed) && parsed >= 0 ? parsed : null,
    spbCost: numberOrNull(rawCost),
    spbAutoCost: numberOrNull(rawAutoCost),
    requestId: headers.get("spb-request-id") || null,
    initialStatus: numberOrNull(headers.get("spb-initial-status-code")),
  };
}

async function readBoundedBody(response, maxBytes) {
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        total += part.value.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          throw new Error(`provider response exceeds ${maxBytes} bytes`);
        }
        chunks.push(Buffer.from(part.value));
      }
    } finally {
      reader.releaseLock();
    }
    return Buffer.concat(chunks).toString("utf8");
  }
  const body = await response.text();
  if (Buffer.byteLength(body, "utf8") > maxBytes) {
    throw new Error(`provider response exceeds ${maxBytes} bytes`);
  }
  return body;
}


export async function executeScrapingBeePaidAttempt({
  maxResponseBytes = 10_000_000,
  reserve, persist, request, persistReceipt, handleResponse, complete, settle,
}) {
  const reservation = await reserve();
  if (reservation?.idempotent === true || reservation?.status === "settled") {
    throw new Error("provider_attempt_already_reserved");
  }
  try {
    await persist(reservation);
  } catch (error) {
    await settle({ outcome: "attempt_persistence_failed", chargeKnown: true, actualCredits: 0 });
    throw error;
  }

  let receipt = { chargeKnown: false, credits: null, spbCost: null, spbAutoCost: null, requestId: null, initialStatus: null };
  let finalizationStarted = false;
  const finalize = async (details) => {
    finalizationStarted = true;
    let completionError = null;
    try {
      await complete({ ...details, receipt });
    } catch (error) {
      completionError = error;
    }
    await settle({
      outcome: details.outcome,
      chargeKnown: receipt.chargeKnown,
      actualCredits: receipt.chargeKnown ? receipt.credits : null,
    });
    if (completionError) throw completionError;
  };

  try {
    const response = await request();
    receipt = readScrapingBeeReceipt(response.headers);
    await persistReceipt({ receipt, response });
    const body = await readBoundedBody(response, maxResponseBytes);
    const handled = await handleResponse({ response, body, receipt });
    await finalize(handled.attempt);
    return handled.result;
  } catch (error) {
    if (!finalizationStarted) {
      try {
        await finalize({ outcome: "error", httpStatus: null, responseBytes: null, error: error.message });
      } catch (finalizeError) {
        throw new Error(`${error.message}; credit finalization failed: ${finalizeError.message}`, { cause: error });
      }
    }
    throw error;
  }
}
