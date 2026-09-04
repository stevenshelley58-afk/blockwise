#!/usr/bin/env node

/*
 * Prove that both application SMTP identities can reach Stalwart, negotiate
 * TLS and authenticate.  This intentionally uses only the SMTP protocol so
 * it can run on a VPS without adding a mail client dependency.  Never include
 * hostnames, credentials or provider responses in an error.
 */
import net from "node:net";
import tls from "node:tls";
import { pathToFileURL } from "node:url";

const timeoutMs = Number(process.env.BLOCKWISE_SMTP_CHECK_TIMEOUT_MS || 10000);

class SmtpCheckError extends Error {}

function connect(host, targetPort, mode) {
  const implicitTls = mode === "implicit";
  return new Promise((resolve, reject) => {
    const socket = (implicitTls ? tls : net).connect({
      host,
      port: targetPort,
      ...(implicitTls ? { servername: host, rejectUnauthorized: true } : {}),
    });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new SmtpCheckError("SMTP connection timed out"));
    }, timeoutMs);
    const done = (error) => {
      clearTimeout(timer);
      socket.removeListener("error", onError);
      if (error) reject(new SmtpCheckError("SMTP connection failed"));
      else resolve(socket);
    };
    const onError = () => done(true);
    socket.once("error", onError);
    socket.once(implicitTls ? "secureConnect" : "connect", () => done(false));
  });
}

function readResponse(socket) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => finish(new SmtpCheckError("SMTP response timed out")), timeoutMs);
    const onData = (chunk) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split(/\r?\n/u);
      buffer = lines.pop() || "";
      for (const line of lines) {
        const match = line.match(/^(\d{3})([ -])/u);
        if (match && match[2] === " ") {
          finish(null, Number(match[1]));
          return;
        }
      }
    };
    const onError = () => finish(new SmtpCheckError("SMTP exchange failed"));
    const finish = (error, code) => {
      clearTimeout(timer);
      socket.removeListener("data", onData);
      socket.removeListener("error", onError);
      if (error) reject(error);
      else resolve(code);
    };
    socket.on("data", onData);
    socket.once("error", onError);
  });
}

async function command(socket, value, expected) {
  socket.write(`${value}\r\n`);
  const code = await readResponse(socket);
  if (!expected.includes(code)) throw new SmtpCheckError("SMTP server rejected the check");
  return code;
}

async function checkIdentity(hostName, portNumber, user, password, env) {
  const mode = env.BLOCKWISE_SMTP_TLS_MODE || (portNumber === 465 ? "implicit" : "starttls");
  if (mode !== "starttls" && mode !== "implicit") throw new SmtpCheckError("SMTP TLS mode is invalid");
  let socket = await connect(hostName, portNumber, mode);
  try {
    await readResponse(socket).then((code) => {
      if (code !== 220) throw new SmtpCheckError("SMTP greeting failed");
    });
    await command(socket, `EHLO ${env.BLOCKWISE_SMTP_HELO_NAME || "blockwise-mail-check"}`, [250]);
    if (mode === "starttls") {
      await command(socket, "STARTTLS", [220]);
      const plainSocket = socket;
      socket = await new Promise((resolve, reject) => {
        const secure = tls.connect({ socket: plainSocket, servername: hostName, rejectUnauthorized: true });
        const timer = setTimeout(() => { secure.destroy(); reject(new SmtpCheckError("SMTP TLS negotiation timed out")); }, timeoutMs);
        secure.once("secureConnect", () => { clearTimeout(timer); resolve(secure); });
        secure.once("error", () => { clearTimeout(timer); reject(new SmtpCheckError("SMTP TLS negotiation failed")); });
      });
      await command(socket, `EHLO ${env.BLOCKWISE_SMTP_HELO_NAME || "blockwise-mail-check"}`, [250]);
    }
    const auth = Buffer.from(`${user}\0${user}\0${password}`, "utf8").toString("base64");
    await command(socket, `AUTH PLAIN ${auth}`, [235]);
    await command(socket, "QUIT", [221, 250]);
  } finally {
    socket.destroy();
  }
}

export async function validateSmtpIdentities(env = process.env) {
  const identities = [
    ["application", env.SMTP_HOST, env.SMTP_PORT, env.SMTP_USER, env.SMTP_PASSWORD],
    ["gotrue", env.BLOCKWISE_AUTH_SMTP_HOST, env.BLOCKWISE_AUTH_SMTP_PORT, env.BLOCKWISE_AUTH_SMTP_USER, env.BLOCKWISE_AUTH_SMTP_PASS],
  ];
  for (const [, host, configuredPort, user, password] of identities) {
    if (!host?.trim() || !user?.trim() || !password?.trim()) throw new SmtpCheckError("SMTP configuration is incomplete");
    const targetPort = Number(configuredPort || 587);
    if (!Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65535) throw new SmtpCheckError("SMTP configuration is invalid");
    await checkIdentity(host.trim(), targetPort, user.trim(), password, env);
  }
  return true;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  validateSmtpIdentities().then(() => {
    process.stdout.write(JSON.stringify({ status: "authenticated", identities: ["application", "gotrue"], tls: true }) + "\n");
  }).catch(() => {
    process.stderr.write("SMTP validation failed\n");
    process.exitCode = 1;
  });
}
