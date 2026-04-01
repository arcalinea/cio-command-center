const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = 3456;
const COUNT_FILE = path.join(__dirname, "innovation-count.json");
const JETSTREAM_URL =
  "wss://jetstream2.us-east.bsky.network/subscribe?wantedCollections=app.bsky.feed.post";

// --- Persistent count ---

function loadCount() {
  try {
    const data = JSON.parse(fs.readFileSync(COUNT_FILE, "utf-8"));
    return { count: data.count || 0, since: data.since || new Date().toISOString() };
  } catch {
    return { count: 0, since: new Date().toISOString() };
  }
}

function saveCount() {
  fs.writeFileSync(COUNT_FILE, JSON.stringify({ count: state.count, since: state.since }));
}

const state = loadCount();
let saveTimer = null;

function scheduleSave() {
  if (!saveTimer) {
    saveTimer = setTimeout(() => {
      saveCount();
      saveTimer = null;
    }, 5000);
  }
}

// --- Jetstream firehose ---

function connectFirehose() {
  const ws = new WebSocket(JETSTREAM_URL);

  ws.on("open", () => {
    console.log("Connected to Jetstream firehose");
  });

  ws.on("message", (raw) => {
    try {
      const evt = JSON.parse(raw);
      if (
        evt.kind === "commit" &&
        evt.commit?.operation === "create" &&
        evt.commit?.collection === "app.bsky.feed.post"
      ) {
        const text = evt.commit.record?.text;
        if (text && /\b(innovation|bluesky|protocol|attie|decentralization|atproto|network|ai)\b/i.test(text)) {
          state.count++;
          scheduleSave();
        }
      }
    } catch {
      // skip malformed messages
    }
  });

  ws.on("close", () => {
    console.log("Firehose disconnected, reconnecting in 3s…");
    setTimeout(connectFirehose, 3000);
  });

  ws.on("error", (err) => {
    console.error("Firehose error:", err.message);
    ws.close();
  });
}

// --- HTTP server ---

const server = http.createServer((req, res) => {
  if (req.url === "/api/count") {
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(JSON.stringify({ count: state.count, since: state.since }));
    return;
  }

  // Serve static files
  let filePath = req.url === "/" ? "/cio-dashboard.html" : req.url;
  filePath = path.join(__dirname, filePath);
  const ext = path.extname(filePath);
  const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".json": "application/json" }[ext] || "application/octet-stream";

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": mime });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Dashboard → http://localhost:${PORT}`);
  connectFirehose();
});

// Save on exit
process.on("SIGINT", () => {
  saveCount();
  process.exit();
});
process.on("SIGTERM", () => {
  saveCount();
  process.exit();
});
