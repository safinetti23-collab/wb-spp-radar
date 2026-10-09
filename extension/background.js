chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== "wb-price") return;
  fetch("http://localhost:3000/api/browser-price", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(msg.payload),
  })
    .then(async (res) => {
      const json = await res.json().catch(() => ({}));
      sendResponse({ ok: res.ok && json.ok, json });
    })
    .catch((err) => {
      sendResponse({ ok: false, json: { message: String(err) } });
    });
  return true;
});
