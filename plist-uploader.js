addEventListener("fetch", event => {
event.respondWith(handleRequest(event.request));
});

const CONFIG = {
MAX_FILE_SIZE: 10 * 1024 * 1024,
EXPIRY_TIME: 60 * 60 * 1000,
ALLOWED_EXTENSIONS: [".plist", ".mobileconfig"],
MAX_STORAGE: 1000,
};

const fileStorage = new Map();

async function handleRequest(req) {
const url = new URL(req.url);
const path = url.pathname;

if (req.method === "OPTIONS") {
return new Response(null, {
headers: getCORSHeaders(),
});
}

cleanupExpiredFiles();

if (path === "/" && req.method === "GET") {
return new Response(getUploadHTML(), {
headers: {
"Content-Type": "text/html",
},
});
}

if (path === "/upload" && req.method === "POST") {
return await handleUpload(req);
}

if (path.startsWith("/view/") && req.method === "GET") {
const fileId = path.substring(6);
return await handleView(fileId);
}

if (path.startsWith("/download/") && req.method === "GET") {
const fileId = path.substring(10);
return await handleDownload(fileId);
}

if (path.startsWith("/delete/") && req.method === "POST") {
const fileId = path.substring(8);
return await handleDelete(fileId);
}

if (path.startsWith("/info/") && req.method === "GET") {
const fileId = path.substring(6);
return await handleInfo(fileId);
}

if (path === "/list" && req.method === "GET") {
return handleList();
}

if (path === "/stats" && req.method === "GET") {
return handleStats();
}

return new Response("Not found", { status: 404 });
}

async function handleUpload(req) {
try {
const contentType = req.headers.get("content-type") || "";

```
let fileData, filename;

if (contentType.includes("multipart/form-data")) {
  const formData = await req.formData();
  const file = formData.get("file");
  
  if (!file || !file.name) {
    return jsonError("No file provided", 400);
  }
  
  filename = file.name;
  fileData = await file.arrayBuffer();
  
} else if (contentType.includes("application/x-www-form-urlencoded")) {
  const formData = await req.formData();
  const file = formData.get("file");
  
  if (!file) {
    return jsonError("No file provided", 400);
  }
  
  filename = file.name || "uploaded.plist";
  fileData = await file.arrayBuffer();
  
} else {
  filename = req.headers.get("x-filename") || "uploaded.plist";
  fileData = await req.arrayBuffer();
}

const ext = filename.substring(filename.lastIndexOf(".")).toLowerCase();
if (!CONFIG.ALLOWED_EXTENSIONS.includes(ext)) {
  return jsonError("Only " + CONFIG.ALLOWED_EXTENSIONS.join(", ") + " files allowed", 400);
}

if (fileData.byteLength > CONFIG.MAX_FILE_SIZE) {
  return jsonError("File too large (max " + (CONFIG.MAX_FILE_SIZE / 1024 / 1024) + "MB)", 413);
}

if (fileData.byteLength === 0) {
  return jsonError("Empty file", 400);
}

if (fileStorage.size >= CONFIG.MAX_STORAGE) {
  return jsonError("Storage limit reached", 507);
}

const fileId = generateFileId();
const detectedType = detectContentType(new Uint8Array(fileData), ext);

fileStorage.set(fileId, {
  content: fileData,
  filename: filename,
  uploadTime: Date.now(),
  contentType: detectedType,
  size: fileData.byteLength,
});

console.log("File uploaded: " + fileId + " (" + filename + ", " + fileData.byteLength + " bytes)");

const accept = req.headers.get("accept") || "";
const origin = new URL(req.url).origin;
const viewUrl = origin + "/view/" + fileId;

if (accept.includes("application/json")) {
  const corsHeaders = getCORSHeaders();
  return new Response(JSON.stringify({
    success: true,
    message: "Your file is hosted at " + viewUrl,
    fileId: fileId,
    filename: filename,
    size: fileData.byteLength,
    expiresIn: CONFIG.EXPIRY_TIME / 1000,
    urls: {
      view: viewUrl,
      download: origin + "/download/" + fileId,
      delete: origin + "/delete/" + fileId,
      info: origin + "/info/" + fileId,
    }
  }, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": corsHeaders["Access-Control-Allow-Origin"],
      "Access-Control-Allow-Methods": corsHeaders["Access-Control-Allow-Methods"],
      "Access-Control-Allow-Headers": corsHeaders["Access-Control-Allow-Headers"],
    },
  });
} else {
  return Response.redirect(viewUrl, 302);
}
```

} catch (err) {
console.error("Upload error:", err);
return jsonError("Upload failed: " + err.message, 500);
}
}

async function handleView(fileId) {
const file = fileStorage.get(fileId);

if (!file) {
return new Response(getNotFoundHTML(), {
status: 404,
headers: { "Content-Type": "text/html" },
});
}

if (isExpired(file)) {
fileStorage.delete(fileId);
return new Response(getExpiredHTML(), {
status: 410,
headers: { "Content-Type": "text/html" },
});
}

const content = new TextDecoder().decode(file.content);
const timeLeft = getTimeLeft(file);

return new Response(getViewHTML(fileId, file.filename, content, file.size, timeLeft), {
headers: { "Content-Type": "text/html" },
});
}

async function handleDownload(fileId) {
const file = fileStorage.get(fileId);

if (!file) {
return jsonError("File not found", 404);
}

if (isExpired(file)) {
fileStorage.delete(fileId);
return jsonError("File expired", 410);
}

const corsHeaders = getCORSHeaders();
return new Response(file.content, {
headers: {
"Content-Type": file.contentType,
"Content-Disposition": ‘attachment; filename="’ + file.filename + ‘"’,
"Content-Length": file.size.toString(),
"Access-Control-Allow-Origin": corsHeaders["Access-Control-Allow-Origin"],
"Access-Control-Allow-Methods": corsHeaders["Access-Control-Allow-Methods"],
"Access-Control-Allow-Headers": corsHeaders["Access-Control-Allow-Headers"],
},
});
}

async function handleDelete(fileId) {
const file = fileStorage.get(fileId);

if (!file) {
return jsonError("File not found", 404);
}

fileStorage.delete(fileId);

console.log("File deleted: " + fileId + " (" + file.filename + ")");

const corsHeaders = getCORSHeaders();
return new Response(JSON.stringify({
success: true,
message: "File deleted successfully",
fileId: fileId,
}), {
headers: {
"Content-Type": "application/json",
"Access-Control-Allow-Origin": corsHeaders["Access-Control-Allow-Origin"],
"Access-Control-Allow-Methods": corsHeaders["Access-Control-Allow-Methods"],
"Access-Control-Allow-Headers": corsHeaders["Access-Control-Allow-Headers"],
},
});
}

async function handleInfo(fileId) {
const file = fileStorage.get(fileId);

if (!file) {
return jsonError("File not found", 404);
}

if (isExpired(file)) {
fileStorage.delete(fileId);
return jsonError("File expired", 410);
}

const timeLeft = getTimeLeft(file);
const corsHeaders = getCORSHeaders();

return new Response(JSON.stringify({
fileId: fileId,
filename: file.filename,
size: file.size,
contentType: file.contentType,
uploadTime: new Date(file.uploadTime).toISOString(),
expiresAt: new Date(file.uploadTime + CONFIG.EXPIRY_TIME).toISOString(),
timeLeftSeconds: Math.floor(timeLeft / 1000),
timeLeftMinutes: Math.floor(timeLeft / 1000 / 60),
}, null, 2), {
headers: {
"Content-Type": "application/json",
"Access-Control-Allow-Origin": corsHeaders["Access-Control-Allow-Origin"],
"Access-Control-Allow-Methods": corsHeaders["Access-Control-Allow-Methods"],
"Access-Control-Allow-Headers": corsHeaders["Access-Control-Allow-Headers"],
},
});
}

function handleList() {
const files = Array.from(fileStorage.entries()).map(([id, file]) => ({
fileId: id,
filename: file.filename,
size: file.size,
uploadTime: new Date(file.uploadTime).toISOString(),
expiresAt: new Date(file.uploadTime + CONFIG.EXPIRY_TIME).toISOString(),
expired: isExpired(file),
}));

const corsHeaders = getCORSHeaders();
return new Response(JSON.stringify({
totalFiles: files.length,
maxStorage: CONFIG.MAX_STORAGE,
files: files,
}, null, 2), {
headers: {
"Content-Type": "application/json",
"Access-Control-Allow-Origin": corsHeaders["Access-Control-Allow-Origin"],
"Access-Control-Allow-Methods": corsHeaders["Access-Control-Allow-Methods"],
"Access-Control-Allow-Headers": corsHeaders["Access-Control-Allow-Headers"],
},
});
}

function handleStats() {
const files = Array.from(fileStorage.values());
const totalSize = files.reduce((sum, f) => sum + f.size, 0);
const expired = files.filter(f => isExpired(f)).length;

const corsHeaders = getCORSHeaders();
return new Response(JSON.stringify({
totalFiles: fileStorage.size,
maxStorage: CONFIG.MAX_STORAGE,
storageUsed: (totalSize / 1024 / 1024).toFixed(2) + " MB",
expiredFiles: expired,
activeFiles: fileStorage.size - expired,
expiryTime: (CONFIG.EXPIRY_TIME / 1000 / 60) + " minutes",
}, null, 2), {
headers: {
"Content-Type": "application/json",
"Access-Control-Allow-Origin": corsHeaders["Access-Control-Allow-Origin"],
"Access-Control-Allow-Methods": corsHeaders["Access-Control-Allow-Methods"],
"Access-Control-Allow-Headers": corsHeaders["Access-Control-Allow-Headers"],
},
});
}

function generateFileId() {
return Array.from(crypto.getRandomValues(new Uint8Array(16)))
.map(b => b.toString(16).padStart(2, "0"))
.join("")
.substring(0, 16);
}

function detectContentType(bytes, ext) {
const text = new TextDecoder().decode(bytes.slice(0, 100));
if (text.includes("<?xml") && text.includes("plist")) {
return "application/x-plist";
}

if (bytes[0] === 0x62 && bytes[1] === 0x70 && bytes[2] === 0x6C) {
return "application/x-plist";
}

if (ext === ".mobileconfig") {
return "application/x-apple-aspen-config";
}

return "application/octet-stream";
}

function isExpired(file) {
return Date.now() - file.uploadTime > CONFIG.EXPIRY_TIME;
}

function getTimeLeft(file) {
return Math.max(0, CONFIG.EXPIRY_TIME - (Date.now() - file.uploadTime));
}

function cleanupExpiredFiles() {
const now = Date.now();
let cleaned = 0;

for (const [id, file] of fileStorage.entries()) {
if (now - file.uploadTime > CONFIG.EXPIRY_TIME) {
fileStorage.delete(id);
cleaned++;
}
}

if (cleaned > 0) {
console.log("Cleaned up " + cleaned + " expired files");
}
}

function getCORSHeaders() {
return {
"Access-Control-Allow-Origin": "*",
"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
"Access-Control-Allow-Headers": "*",
};
}

function jsonError(message, status) {
if (status === undefined) status = 400;
const corsHeaders = getCORSHeaders();
return new Response(JSON.stringify({
error: message,
status: status,
}), {
status: status,
headers: {
"Content-Type": "application/json",
"Access-Control-Allow-Origin": corsHeaders["Access-Control-Allow-Origin"],
"Access-Control-Allow-Methods": corsHeaders["Access-Control-Allow-Methods"],
"Access-Control-Allow-Headers": corsHeaders["Access-Control-Allow-Headers"],
},
});
}

function getUploadHTML() {
return ’<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Plist File Uploader</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}.container{background:#fff;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.3);max-width:600px;width:100%;padding:40px}h1{color:#333;margin-bottom:10px;font-size:28px}.subtitle{color:#666;margin-bottom:30px;font-size:14px}.upload-area{border:3px dashed #ddd;border-radius:12px;padding:40px;text-align:center;transition:all .3s;cursor:pointer;margin-bottom:20px}.upload-area:hover{border-color:#667eea;background:#f8f9ff}.upload-area.dragover{border-color:#667eea;background:#e8ebff}.upload-icon{font-size:64px;margin-bottom:16px}input[type=file]{display:none}.file-info{background:#f5f5f5;padding:16px;border-radius:8px;margin-bottom:20px;display:none}.file-info.show{display:block}.file-name{font-weight:600;color:#333;margin-bottom:8px}.file-size{color:#666;font-size:14px}button{width:100%;padding:16px;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:#fff;border:none;border-radius:8px;font-size:16px;font-weight:600;cursor:pointer;transition:transform .2s,box-shadow .2s;display:none}button.show{display:block}button:hover{transform:translateY(-2px);box-shadow:0 8px 20px rgba(102,126,234,.4)}button:disabled{opacity:.5;cursor:not-allowed;transform:none}.info{background:#e3f2fd;border:1px solid #90caf9;color:#1976d2;padding:16px;border-radius:8px;margin-top:30px;font-size:13px;line-height:1.6}.info h3{margin-bottom:12px;font-size:15px}.info ul{margin-left:20px;margin-top:8px}.info li{margin:6px 0}.progress{display:none;margin-top:20px}.progress.show{display:block}.progress-bar{width:100%;height:8px;background:#e0e0e0;border-radius:4px;overflow:hidden}.progress-fill{height:100%;background:linear-gradient(90deg,#667eea 0%,#764ba2 100%);width:0;transition:width .3s}.progress-text{text-align:center;margin-top:8px;color:#666;font-size:14px}.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:15px;margin-top:30px}.stat-box{background:#f5f5f5;padding:15px;border-radius:8px;text-align:center}.stat-value{font-size:24px;font-weight:700;color:#667eea;margin-bottom:5px}.stat-label{font-size:12px;color:#666}.api-section{margin-top:30px;padding:20px;background:#f9f9f9;border-radius:8px}.api-section h3{margin-bottom:15px;color:#333}code{background:#fff;padding:12px;border-radius:6px;display:block;font-family:"Courier New",monospace;font-size:13px;overflow-x:auto;margin-top:10px;border:1px solid #e0e0e0}</style></head><body><div class="container"><h1>📄 Plist Uploader</h1><p class="subtitle">Upload .plist or .mobileconfig files • Auto-delete after 1 hour</p><form id="uploadForm"><div class="upload-area" id="uploadArea"><div class="upload-icon">📁</div><div style="font-size:18px;font-weight:600;margin-bottom:8px">Drop your file here</div><div style="color:#999;font-size:14px">or click to browse</div><input type="file" id="fileInput" accept=".plist,.mobileconfig"></div><div class="file-info" id="fileInfo"><div class="file-name" id="fileName"></div><div class="file-size" id="fileSize"></div></div><button type="submit" id="uploadBtn">📤 Upload File</button><div class="progress" id="progress"><div class="progress-bar"><div class="progress-fill" id="progressFill"></div></div><div class="progress-text" id="progressText">Uploading…</div></div></form><div class="stats" id="stats"><div class="stat-box"><div class="stat-value" id="statFiles">-</div><div class="stat-label">Active Files</div></div><div class="stat-box"><div class="stat-value" id="statSize">-</div><div class="stat-label">Storage Used</div></div><div class="stat-box"><div class="stat-value">1h</div><div class="stat-label">Auto-Delete</div></div></div><div class="info"><h3>ℹ️ Features</h3><ul><li>✅ View files in browser</li><li>✅ Download anytime</li><li>✅ Delete manually</li><li>❌ No editing (read-only)</li><li>⏰ Auto-delete after 1 hour</li><li>📊 Max 10MB per file</li></ul></div><div class="api-section"><h3>🔌 API Usage</h3><strong>Upload via cURL:</strong><code>curl -X POST -F "file=@config.plist" ’ + self.location.origin + ’/upload</code><strong style="display:block;margin-top:15px">Upload with JSON response:</strong><code>curl -X POST -H "Accept: application/json" -F "file=@config.plist" ’ + self.location.origin + ‘/upload</code></div></div><script>const uploadArea=document.getElementById("uploadArea"),fileInput=document.getElementById("fileInput"),fileInfo=document.getElementById("fileInfo"),fileName=document.getElementById("fileName"),fileSize=document.getElementById("fileSize"),uploadBtn=document.getElementById("uploadBtn"),uploadForm=document.getElementById("uploadForm"),progress=document.getElementById("progress"),progressFill=document.getElementById("progressFill"),progressText=document.getElementById("progressText");let selectedFile=null;function handleFileSelect(){if(0===fileInput.files.length)return;if(selectedFile=fileInput.files[0],-1===[".plist",".mobileconfig"].indexOf(selectedFile.name.substring(selectedFile.name.lastIndexOf(".")).toLowerCase()))return void alert("Only .plist and .mobileconfig files are allowed");fileName.textContent=selectedFile.name,fileSize.textContent=formatBytes(selectedFile.size),fileInfo.classList.add("show"),uploadBtn.classList.add("show")}function formatBytes(e){if(0===e)return"0 Bytes";const t=1024,s=["Bytes","KB","MB"],o=Math.floor(Math.log(e)/Math.log(t));return Math.round(e/Math.pow(t,o)*100)/100+" "+s[o]}fetch("/stats").then(e=>e.json()).then(e=>{document.getElementById("statFiles").textContent=e.activeFiles,document.getElementById("statSize").textContent=e.storageUsed}),uploadArea.addEventListener("click",()=>fileInput.click()),fileInput.addEventListener("change",handleFileSelect),uploadArea.addEventListener("dragover",e=>{e.preventDefault(),uploadArea.classList.add("dragover")}),uploadArea.addEventListener("dragleave",()=>{uploadArea.classList.remove("dragover")}),uploadArea.addEventListener("drop",e=>{e.preventDefault(),uploadArea.classList.remove("dragover");const t=e.dataTransfer.files;t.length>0&&(fileInput.files=t,handleFileSelect())}),uploadForm.addEventListener("submit",async e=>{if(e.preventDefault(),!selectedFile)return;uploadBtn.disabled=!0,progress.classList.add("show"),progressFill.style.width="0%",progressText.textContent="Uploading…";const t=new FormData;t.append("file",selectedFile);try{let e=0;const s=setInterval(()=>{e+=10,e<=90&&(progressFill.style.width=e+"%")},100),o=await fetch("/upload",{method:"POST",body:t});if(clearInterval(s),progressFill.style.width="100%",o.ok)progressText.textContent="Success! Redirecting…",setTimeout(()=>{window.location.href=o.url},500);else{const e=await o.json();throw new Error(e.error||"Upload failed")}}catch(e){alert("Upload failed: "+e.message),uploadBtn.disabled=!1,progress.classList.remove("show")}})</script></body></html>’;
}

function getViewHTML(fileId, filename, content, size, timeLeft) {
const escapedContent = content
.replace(/&/g, "&")
.replace(/</g, "<")
.replace(/>/g, ">");

const minutes = Math.floor(timeLeft / 1000 / 60);
const seconds = Math.floor((timeLeft / 1000) % 60);

return ‘<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>’ + filename + ’</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#f5f5f5;padding:20px}.header{background:#fff;padding:20px;border-radius:8px;margin-bottom:20px;box-shadow:0 2px 8px rgba(0,0,0,.1)}.header h1{font-size:24px;margin-bottom:10px;color:#333}.metadata{display:flex;gap:20px;flex-wrap:wrap;font-size:14px;color:#666;margin-bottom:15px}.metadata span{display:flex;align-items:center;gap:5px}.timer{background:#fff3cd;border:1px solid #ffc107;color:#856404;padding:12px 16px;border-radius:6px;margin-bottom:15px;font-size:14px}.actions{display:flex;gap:10px;flex-wrap:wrap}.btn{padding:10px 20px;border:none;border-radius:6px;font-size:14px;font-weight:600;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;gap:8px;transition:all .2s}.btn-primary{background:#667eea;color:#fff}.btn-primary:hover{background:#5568d3}.btn-danger{background:#dc3545;color:#fff}.btn-danger:hover{background:#c82333}.btn-secondary{background:#6c757d;color:#fff}.btn-secondary:hover{background:#5a6268}.content{background:#fff;padding:20px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.1)}pre{background:#f8f9fa;padding:20px;border-radius:6px;overflow-x:auto;font-family:"Courier New",monospace;font-size:13px;line-height:1.6;border:1px solid #e0e0e0}.readonly-notice{background:#e3f2fd;border:1px solid #90caf9;color:#1976d2;padding:12px 16px;border-radius:6px;margin-top:15px;font-size:14px}</style></head><body><div class="header"><h1>📄 ’ + filename + ’</h1><div class="metadata"><span>📦 Size: ’ + formatBytes(size) + ’</span><span>🔑 ID: ’ + fileId + ‘</span></div><div class="timer" id="timer">⏰ Expires in: <strong>’ + minutes + ’m ’ + seconds + ‘s</strong></div><div class="actions"><a href="/download/' + fileId + '" class="btn btn-primary">⬇️ Download</a> <button onclick="copyToClipboard()" class="btn btn-secondary">📋 Copy Content</button> <button onclick="deleteFile()" class="btn btn-danger">🗑️ Delete</button> <a href="/" class="btn btn-secondary">🏠 Upload Another</a></div><div class="readonly-notice">ℹ️ <strong>Read-Only:</strong> This file cannot be edited. Download to modify locally.</div></div><div class="content"><pre id="content">’ + escapedContent + ‘</pre></div><script>let timeLeft=’ + timeLeft + ‘;function updateTimer(){if(timeLeft<=0)return void(document.getElementById("timer").innerHTML='⏰ <strong style="color:#d32f2f">File expired</strong>');const e=Math.floor(timeLeft/1e3/60),t=Math.floor(timeLeft/1e3%60);document.getElementById("timer").innerHTML=`⏰ Expires in: <strong>${e}m ${t}s</strong>`,timeLeft-=1e3,timeLeft>0&&setTimeout(updateTimer,1e3)}function copyToClipboard(){const e=document.getElementById("content").textContent;navigator.clipboard.writeText(e).then(()=>{alert("Content copied to clipboard!")}).catch(()=>{alert("Failed to copy")})}async function deleteFile(){if(!confirm("Are you sure you want to delete this file?"))return;try{if(!(await fetch("/delete/’ + fileId + ‘",{method:"POST"})).ok){const e=await response.json();alert("Delete failed: "+e.error)}else alert("File deleted successfully"),window.location.href="/"}catch(e){alert("Delete failed: "+e.message)}}setTimeout(updateTimer,1e3)</script></body></html>’;
}

function getNotFoundHTML() {
return ‘<!DOCTYPE html><html><head><meta charset="UTF-8"><title>File Not Found</title><style>body{font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%)}.box{background:#fff;padding:40px;border-radius:12px;text-align:center;max-width:400px}h1{color:#d32f2f;margin-bottom:10px}a{display:inline-block;margin-top:20px;padding:12px 24px;background:#667eea;color:#fff;text-decoration:none;border-radius:6px}</style></head><body><div class="box"><div style="font-size:64px">❌</div><h1>File Not Found</h1><p>The file you are looking for does not exist or has been deleted.</p><a href="/">Upload New File</a></div></body></html>’;
}

function getExpiredHTML() {
return ‘<!DOCTYPE html><html><head><meta charset="UTF-8"><title>File Expired</title><style>body{font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%)}.box{background:#fff;padding:40px;border-radius:12px;text-align:center;max-width:400px}h1{color:#ff9800;margin-bottom:10px}a{display:inline-block;margin-top:20px;padding:12px 24px;background:#667eea;color:#fff;text-decoration:none;border-radius:6px}</style></head><body><div class="box"><div style="font-size:64px">⏰</div><h1>File Expired</h1><p>This file has expired and been automatically deleted after 1 hour.</p><a href="/">Upload New File</a></div></body></html>’;
}

function formatBytes(bytes) {
if (bytes === 0) return "0 Bytes";
const k = 1024;
const sizes = ["Bytes", "KB", "MB"];
const i = Math.floor(Math.log(bytes) / Math.log(k));
return Math.round(bytes / Math.pow(k, i) * 100) / 100 + " " + sizes[i];
}

export default { fetch: handleRequest };
