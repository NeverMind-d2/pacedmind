// A protocol fixture: metadata requests only. Any attempt to send a prompt fails the handshake.
import readline from "node:readline";
const send = (v) => process.stdout.write(JSON.stringify(v) + "\n");
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const m = JSON.parse(line);
  if (m.method === "initialize") {
    send(null); send([]); process.stdout.write("startup message\n");
    send({ id: m.id, result: { userAgent: "fixture" } });
  } else if (m.method === "initialized") {
    // Notification, no reply.
  } else if (m.method === "model/list") {
    send({ id: m.id, result: { data: [{ model: m.params.cursor ? "second-account-model" : "first-account-model", displayName: "Account model" }], nextCursor: m.params.cursor ? null : "page-2" } });
  } else if (m.type === "control_request" && m.request.subtype === "initialize") {
    send({ type: "control_response", response: { request_id: m.request_id, response: {
      account: { email: "do-not-export@example.com" }, commands: ["do-not-export"], fast_mode_state: "on",
      models: [{ value: "account-opus", displayName: "Account Opus", supportsFastMode: true, supportsEffort: true, supportedEffortLevels: ["high"] }],
    } } });
  } else process.exit(1);
});
