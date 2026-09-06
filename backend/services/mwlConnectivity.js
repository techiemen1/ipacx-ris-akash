const net = require("net");

function checkTcpReachable(host, port, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    if (!host || !port) {
      const err = new Error("Host/port missing");
      err.code = "MWL_TARGET_INVALID";
      reject(err);
      return;
    }

    const socket = new net.Socket();
    let settled = false;

    const finish = (err) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (err) reject(err);
      else resolve({ host, port });
    };

    socket.setTimeout(timeoutMs);
    socket.once("error", (err) => finish(err));
    socket.once("timeout", () => {
      const err = new Error(`Connection timeout to ${host}:${port}`);
      err.code = "ETIMEDOUT";
      finish(err);
    });

    socket.connect(Number(port), host, () => finish());
  });
}

module.exports = { checkTcpReachable };
