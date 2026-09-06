const net = require("net");

/**
 * Basic TCP connection test to a DICOM Modality/PACS
 * This doesn't do a full C-ECHO but verifies the port is open and reachable.
 */
async function testDicomConnection(host, port, timeout = 5000) {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        
        const timer = setTimeout(() => {
            socket.destroy();
            resolve({ success: false, error: "Connection Timeout" });
        }, timeout);

        socket.connect(port, host, () => {
            clearTimeout(timer);
            socket.destroy();
            resolve({ success: true });
        });

        socket.on("error", (err) => {
            clearTimeout(timer);
            resolve({ success: false, error: err.message });
        });
    });
}

module.exports = { testDicomConnection };
