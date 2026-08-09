// apns-relay — n8n'in konuşamadığı HTTP/2 protokolünü konuşarak Apple'ın APNs
// sunucusuna push bildirimi ileten minik köprü servis. n8n, bu servise sıradan
// bir HTTP/1.1 POST isteği atar; bu servis de içeride Node'un http2 modülüyle
// gerçek APNs bağlantısını kurar.
//
// Kullanım (n8n'den POST /push):
// {
//   "deviceToken": "...",
//   "jwt": "...",              -> n8n'deki "Build APNs JWT" node'unun ürettiği token
//   "bundleId": "com.dmkrclk8.herbokolog",
//   "title": "Yeni Deprem",
//   "body": "İzmir — 4.2 büyüklüğünde",
//   "environment": "sandbox"   -> "sandbox" (Xcode/debug) veya "production" (TestFlight/App Store)
// }

const express = require("express");
const http2 = require("http2");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

function sendToAPNs({ deviceToken, jwt, bundleId, title, body, environment }) {
  return new Promise((resolve) => {
    // environment "sandbox" ise Apple'ın test sunucusuna, aksi halde production'a bağlan.
    const host = environment === "sandbox"
      ? "https://api.sandbox.push.apple.com"
      : "https://api.push.apple.com";
    const client = http2.connect(host);

    client.on("error", (err) => {
      resolve({ ok: false, error: "connect_error: " + err.message });
    });

    const req = client.request({
      ":method": "POST",
      ":path": `/3/device/${deviceToken}`,
      authorization: `bearer ${jwt}`,
      "apns-topic": bundleId,
      "apns-priority": "10",
      "apns-push-type": "alert",
      "content-type": "application/json",
    });

    let status = null;
    req.on("response", (headers) => {
      status = headers[":status"];
    });

    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      client.close();
      resolve({ ok: status === 200, status, response: data });
    });

    req.on("error", (err) => {
      client.close();
      resolve({ ok: false, error: "request_error: " + err.message });
    });

    req.write(JSON.stringify({ aps: { alert: { title, body }, sound: "default" } }));
    req.end();
  });
}

// Sağlık kontrolü — servis ayakta mı diye tarayıcıdan/n8n'den bakmak için.
app.get("/", (req, res) => {
  res.json({ status: "apns-relay çalışıyor" });
});

app.post("/push", async (req, res) => {
  const { deviceToken, jwt, bundleId, title, body, environment } = req.body || {};
  if (!deviceToken || !jwt || !bundleId) {
    return res.status(400).json({ ok: false, error: "deviceToken, jwt ve bundleId zorunludur." });
  }
  const result = await sendToAPNs({
    deviceToken,
    jwt,
    bundleId,
    title: title || "Bildirim",
    body: body || "",
    environment,
  });
  res.status(result.ok ? 200 : 502).json(result);
});

app.listen(PORT, () => {
  console.log(`apns-relay ${PORT} portunda çalışıyor`);
});
