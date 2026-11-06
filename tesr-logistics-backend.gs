/**
 * TESR Logistics — Fulfillment QC & Evidence backend (Google Apps Script)   v1.0
 * ---------------------------------------------------------------------------
 * 1 Record = 1 โฟลเดอร์ใน Google Drive:
 *   Logistic-tracking-and-evidence / [ลูกค้า (ถ้าระบุ)] / <TagNo>_<ผู้แท็ก>_<DD-MM-YYYY>
 *
 * Login 2 แบบ (ตรวจที่ฝั่ง server ทุกครั้ง):
 *   • Google Sign-In  — ส่ง ID token มาตรวจกับ Google (ต้องตั้ง Google Client ID ในหน้า Admin)
 *   • อีเมล + รหัสผ่านของแอป — เก็บเป็น salted hash ใน Script Properties (ไม่ใช่รหัส Gmail)
 * หลัง login ได้ session token (HMAC) อายุ CONFIG.SESSION_DAYS วัน — ทุก action ต้องแนบ token
 *
 * actions (POST, JSON, Content-Type: text/plain):
 *   public : info, login
 *   user   : me, search, create, upload, begin, chunk, finish
 *   admin  : saveConfig, setPassword, logoutAll
 *
 * ติดตั้งครั้งแรก (ดู README.md):
 *   1. script.google.com → New project → วางโค้ดนี้ทั้งไฟล์ → Save
 *   2. ใส่รหัสผ่าน admin ที่ SETUP_ADMIN_PASSWORD ด้านล่าง → เลือกฟังก์ชัน setup → Run → Allow
 *      (เสร็จแล้วลบรหัสออกจากบรรทัดนั้นได้เลย — ระบบเก็บเป็น hash แล้ว)
 *   3. Deploy → New deployment → Web app · Execute as: Me · Who has access: Anyone → Deploy → คัดลอก URL /exec
 *   อัปเดตโค้ดครั้งถัดไป: Deploy → Manage deployments → ✎ → Version: New version → Deploy (URL เดิม)
 */

const CONFIG = {
  VERSION:        'v1.0',
  ROOT_FOLDER_ID: '17wFTaIpnOWenaLl3YrI-qTqqUTU7bKY9', // "Logistic-tracking-and-evidence" (owner ceo.anoney.potter@gmail.com)
  LOG_SHEET_NAME: 'TESR Logistics QC Log',
  TIMEZONE:       'Asia/Bangkok',
  SESSION_DAYS:   7,
  MAKE_PUBLIC:    true,   // โฟลเดอร์ record = Anyone with the link · Viewer
  // ค่าเริ่มต้น (แก้ภายหลังได้ในหน้า Admin)
  DEFAULTS: {
    adminEmails:   ['ceo.anoney.potter@gmail.com'],
    staffEmails:   ['tesrshop@gmail.com'],
    staff:         ['โอ๊ต', 'พี'],
    clients:       [],
    checklist:     ['สินค้าตรงรุ่น / SKU', 'จำนวนครบตามออเดอร์', 'สภาพสินค้าไม่มีความเสียหาย', 'อุปกรณ์ / อะไหล่ครบ', 'ฉลาก / บาร์โค้ดถูกต้อง', 'แพ็คกิ้งเรียบร้อย พร้อมส่ง'],
    tagPattern:    '',     // regex ตรวจรูปแบบเลข Tagging (ว่าง = ไม่ตรวจ)
    tagExample:    '',
    orderRequired: false,
    signRequired:  false,
    maxFileMB:     100,
    googleClientId:'',
  },
};

/** ใส่รหัสผ่าน admin ตรงนี้ แล้ว Run setup() หนึ่งครั้ง — จากนั้นลบออกได้ (ห้าม commit รหัสลง GitHub) */
const SETUP_ADMIN_PASSWORD = '';

const P = PropertiesService.getScriptProperties();

/* ═══ setup / authorize ═══════════════════════════════════════ */
function setup() {
  DriveApp.getFolderById(CONFIG.ROOT_FOLDER_ID).getName();
  UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/about?fields=user', { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
  if (!P.getProperty('SECRET')) P.setProperty('SECRET', Utilities.getUuid() + Utilities.getUuid());
  if (!P.getProperty('APP_CONFIG')) P.setProperty('APP_CONFIG', JSON.stringify(CONFIG.DEFAULTS));
  if (SETUP_ADMIN_PASSWORD) {
    setPw_(CONFIG.DEFAULTS.adminEmails[0], SETUP_ADMIN_PASSWORD);
    Logger.log('ตั้งรหัสผ่าน admin แล้ว — ลบรหัสออกจาก SETUP_ADMIN_PASSWORD ได้เลย');
  }
  getSheet_();
  Logger.log('setup OK · root = ' + DriveApp.getFolderById(CONFIG.ROOT_FOLDER_ID).getName());
}
function authorize() { setup(); }

/* ═══ HTTP ════════════════════════════════════════════════════ */
function doGet() {
  let root;
  try { root = DriveApp.getFolderById(CONFIG.ROOT_FOLDER_ID).getName(); } catch (e) { root = 'ERROR: เปิด root ไม่ได้'; }
  return json_({ ok: true, service: 'TESR Logistics QC backend ' + CONFIG.VERSION, time: new Date().toISOString(), root: root, ready: !!P.getProperty('SECRET') });
}

function doPost(e) {
  try {
    const b = JSON.parse(e.postData.contents);
    switch (b.action) {
      case 'info':        return json_(info_());
      case 'login':       return json_(login_(b));
      case 'me':          return json_(me_(auth_(b)));
      case 'search':      auth_(b); return json_(search_(b));
      case 'create':      return json_(create_(b, auth_(b)));
      case 'upload':      auth_(b); return json_(upload_(b));
      case 'begin':       auth_(b); return json_(begin_(b));
      case 'chunk':       auth_(b); return json_(chunk_(b));
      case 'finish':      return json_(finish_(b, auth_(b)));
      case 'saveConfig':  return json_(saveConfig_(b, auth_(b, true)));
      case 'setPassword': return json_(setPassword_(b, auth_(b, true)));
      case 'logoutAll':   auth_(b, true); P.setProperty('EPOCH', String(Date.now())); return json_({ ok: true });
      default: throw new Error('unknown action "' + b.action + '" — หน้าเว็บอาจเป็นเวอร์ชันเก่า');
    }
  } catch (err) {
    const msg = String(err && err.message || err);
    return json_({ ok: false, error: msg, auth: /^AUTH:/.test(msg) });
  }
}

/* ═══ config ══════════════════════════════════════════════════ */
function cfg_() {
  let c = {};
  try { c = JSON.parse(P.getProperty('APP_CONFIG') || '{}'); } catch (e) {}
  return Object.assign({}, CONFIG.DEFAULTS, c);
}
function info_() {
  const c = cfg_();
  return { ok: true, version: CONFIG.VERSION, googleClientId: c.googleClientId || '', ready: !!P.getProperty('SECRET') };
}
function publicCfg_(c, role) {
  const o = { staff: c.staff, clients: c.clients, checklist: c.checklist, tagPattern: c.tagPattern, tagExample: c.tagExample,
              orderRequired: !!c.orderRequired, signRequired: !!c.signRequired, maxFileMB: c.maxFileMB, googleClientId: c.googleClientId,
              rootUrl: 'https://drive.google.com/drive/folders/' + CONFIG.ROOT_FOLDER_ID };
  if (role === 'admin') {
    o.adminEmails = c.adminEmails; o.staffEmails = c.staffEmails;
    const sid = P.getProperty('LOG_SHEET_ID'); o.logSheetUrl = sid ? 'https://docs.google.com/spreadsheets/d/' + sid : '';
    o.passwordSet = {};
    c.adminEmails.concat(c.staffEmails).forEach(function (m) { o.passwordSet[m] = !!P.getProperty('PW_' + m); });
  }
  return o;
}
function saveConfig_(b, s) {
  const cur = cfg_(), n = b.config || {};
  const list = function (v, d) { return Array.isArray(v) ? v.map(function (x) { return String(x).trim(); }).filter(String).slice(0, 200) : d; };
  const emails = function (v, d) { return list(v, d).map(function (x) { return x.toLowerCase(); }).filter(function (x) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x); }); };
  const next = {
    adminEmails: emails(n.adminEmails, cur.adminEmails),
    staffEmails: emails(n.staffEmails, cur.staffEmails),
    staff:       list(n.staff, cur.staff),
    clients:     list(n.clients, cur.clients),
    checklist:   list(n.checklist, cur.checklist),
    tagPattern:  n.tagPattern != null ? String(n.tagPattern).trim() : cur.tagPattern,
    tagExample:  n.tagExample != null ? String(n.tagExample).trim() : cur.tagExample,
    orderRequired: n.orderRequired != null ? !!n.orderRequired : cur.orderRequired,
    signRequired:  n.signRequired != null ? !!n.signRequired : cur.signRequired,
    maxFileMB:   Math.max(5, Math.min(500, Number(n.maxFileMB) || cur.maxFileMB)),
    googleClientId: n.googleClientId != null ? String(n.googleClientId).trim() : cur.googleClientId,
  };
  if (next.tagPattern) { try { new RegExp(next.tagPattern); } catch (e) { throw new Error('รูปแบบเลข Tagging (regex) ไม่ถูกต้อง: ' + e.message); } }
  if (next.adminEmails.indexOf(s.email) < 0) throw new Error('ห้ามลบอีเมลของตัวเองออกจากรายชื่อ Admin');
  if (!next.staff.length) throw new Error('ต้องมีรายชื่อพนักงานอย่างน้อย 1 คน');
  P.setProperty('APP_CONFIG', JSON.stringify(next));
  return { ok: true, config: publicCfg_(next, 'admin') };
}

/* ═══ auth ════════════════════════════════════════════════════ */
function roleOf_(email, c) {
  email = String(email || '').toLowerCase();
  if (c.adminEmails.indexOf(email) >= 0) return 'admin';
  if (c.staffEmails.indexOf(email) >= 0) return 'staff';
  return '';
}
function hash_(salt, pw) {
  let h = Utilities.computeHmacSha256Signature(pw, salt);
  for (let i = 0; i < 300; i++) h = Utilities.computeHmacSha256Signature(h, Utilities.newBlob(salt).getBytes());
  return Utilities.base64EncodeWebSafe(h);
}
function setPw_(email, pw) {
  const salt = Utilities.getUuid();
  P.setProperty('PW_' + String(email).toLowerCase(), salt + ':' + hash_(salt, pw));
}
function checkPw_(email, pw) {
  const v = P.getProperty('PW_' + email); if (!v) return false;
  const i = v.indexOf(':'); return hash_(v.slice(0, i), pw) === v.slice(i + 1);
}
function login_(b) {
  const c = cfg_(); let email;
  if (b.method === 'google') {
    if (!c.googleClientId) throw new Error('ยังไม่ได้ตั้งค่า Google Client ID — ใช้อีเมล + รหัสผ่านไปก่อน');
    const r = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(b.idToken || ''), { muteHttpExceptions: true });
    if (r.getResponseCode() !== 200) throw new Error('ยืนยันตัวตนกับ Google ไม่สำเร็จ — ลองใหม่อีกครั้ง');
    const t = JSON.parse(r.getContentText());
    if (t.aud !== c.googleClientId) throw new Error('Google token ไม่ได้ออกให้แอปนี้');
    if (String(t.email_verified) !== 'true') throw new Error('อีเมล Google ยังไม่ได้ยืนยัน');
    email = String(t.email).toLowerCase();
  } else {
    email = String(b.email || '').trim().toLowerCase();
    const cache = CacheService.getScriptCache(), k = 'fail_' + email, fails = Number(cache.get(k) || 0);
    if (fails >= 5) throw new Error('ใส่รหัสผิดหลายครั้ง — รอ 15 นาทีแล้วลองใหม่ หรือใช้ Sign in with Google');
    if (!roleOf_(email, c) || !checkPw_(email, String(b.password || ''))) {
      cache.put(k, String(fails + 1), 900);
      throw new Error('อีเมลหรือรหัสผ่านไม่ถูกต้อง');
    }
    cache.remove(k);
  }
  const role = roleOf_(email, c);
  if (!role) throw new Error('บัญชี ' + email + ' ไม่มีสิทธิ์ใช้งานระบบนี้ — ให้ Admin เพิ่มอีเมลในหน้า Admin');
  return { ok: true, token: sign_({ e: email, r: role, x: Date.now() + CONFIG.SESSION_DAYS * 864e5, p: Number(P.getProperty('EPOCH') || 0) }), email: email, role: role, config: publicCfg_(c, role) };
}
function sign_(o) {
  const body = Utilities.base64EncodeWebSafe(JSON.stringify(o));
  return body + '.' + Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(body, P.getProperty('SECRET')));
}
function auth_(b, needAdmin) {
  const t = String(b.token || ''), i = t.lastIndexOf('.');
  if (i < 0) throw new Error('AUTH: กรุณาเข้าสู่ระบบ');
  const secret = P.getProperty('SECRET'); if (!secret) throw new Error('AUTH: backend ยังไม่ได้ Run setup()');
  const body = t.slice(0, i);
  if (Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(body, secret)) !== t.slice(i + 1)) throw new Error('AUTH: session ไม่ถูกต้อง — เข้าสู่ระบบใหม่');
  const o = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(body)).getDataAsString());
  if (o.x < Date.now()) throw new Error('AUTH: session หมดอายุ — เข้าสู่ระบบใหม่');
  if (o.p !== Number(P.getProperty('EPOCH') || 0)) throw new Error('AUTH: Admin ให้ออกจากระบบทุกเครื่อง — เข้าสู่ระบบใหม่');
  const c = cfg_(), role = roleOf_(o.e, c);           // ตรวจสิทธิ์ล่าสุดทุกครั้ง (ลบอีเมลออก = หมดสิทธิ์ทันที)
  if (!role) throw new Error('AUTH: บัญชีนี้ถูกถอนสิทธิ์แล้ว');
  if (needAdmin && role !== 'admin') throw new Error('เฉพาะ Admin เท่านั้น');
  return { email: o.e, role: role, cfg: c };
}
function me_(s) { return { ok: true, email: s.email, role: s.role, config: publicCfg_(s.cfg, s.role) }; }
function setPassword_(b, s) {
  const email = String(b.email || '').toLowerCase(), pw = String(b.password || '');
  if (!roleOf_(email, s.cfg)) throw new Error('อีเมลนี้ไม่อยู่ในรายชื่อ Admin / Staff');
  if (pw.length < 8) throw new Error('รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร');
  setPw_(email, pw);
  return { ok: true };
}

/* ═══ records ═════════════════════════════════════════════════ */
function create_(b, s) {
  const r = b.record || {};
  const tag = cleanCode_(r.tag);
  if (!tag) throw new Error('ต้องมีเลข Tagging');
  if (s.cfg.tagPattern && !(new RegExp(s.cfg.tagPattern)).test(tag)) throw new Error('เลข Tagging "' + tag + '" ไม่ตรงรูปแบบที่ Admin กำหนด' + (s.cfg.tagExample ? ' (ตัวอย่าง ' + s.cfg.tagExample + ')' : ''));
  if (s.cfg.orderRequired && !cleanCode_(r.order)) throw new Error('ต้องมีเลขออเดอร์');
  if (!r.tagger) throw new Error('ต้องระบุผู้แท็ก');

  let root;
  try { root = DriveApp.getFolderById(CONFIG.ROOT_FOLDER_ID); root.getName(); }
  catch (e) { throw new Error('เปิดโฟลเดอร์ root (' + CONFIG.ROOT_FOLDER_ID + ') ไม่ได้ — ตรวจว่าบัญชีที่ Deploy มีสิทธิ์แก้ไขโฟลเดอร์นี้'); }

  const now = new Date();
  const dateStr = Utilities.formatDate(now, CONFIG.TIMEZONE, 'dd-MM-yyyy');
  const parent = r.client ? getOrCreateFolder_(root, safeName_(r.client)) : root;
  if (r.client && CONFIG.MAKE_PUBLIC) parent.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  const base = safeName_(tag + '_' + r.tagger + '_' + dateStr);
  let name = base, n = 1;
  while (parent.getFoldersByName(name).hasNext()) name = base + ' (' + (++n) + ')';
  const folder = parent.createFolder(name);
  const id = nextId_(now);

  const lines = [
    'TESR Co., Ltd. — TESR Logistics · Fulfillment QC Record',
    '========================================================',
    'Record ID     : ' + id,
    'Tagging No.   : ' + tag,
    'Order No.     : ' + (cleanCode_(r.order) || '-'),
    'Tracking No.  : ' + (cleanCode_(r.tracking) || '-'),
    'Client        : ' + (r.client || '-'),
    'Product / SKU : ' + (r.product || '-') + (r.qty ? '   ×' + r.qty : ''),
    'QC Result     : ' + (r.result || '-'),
    'Checked by    : ' + r.tagger + (r.signed ? '  (signed)' : ''),
    'Date          : ' + Utilities.formatDate(now, CONFIG.TIMEZONE, 'dd/MM/yyyy HH:mm') + ' (ICT)',
    '', 'QC Checklist:'
  ].concat((r.checklist || []).map(function (c) { return '  [' + (c.ok ? '✓' : ' ') + '] ' + c.item; }))
   .concat(['', 'Evidence files:']).concat((r.files || []).map(function (f) { return '  - ' + f; }))
   .concat(['', 'Notes:', r.notes || '-', '', 'TESR Logistics — Robot · AI · IoT · Automation · Real-world Solutions', 'tesrshop.com · 090-465-6519']);
  folder.createFile('QC_Record_' + tag + '.txt', lines.join('\n'), MimeType.PLAIN_TEXT);
  if (CONFIG.MAKE_PUBLIC) folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return { ok: true, id: id, folderId: folder.getId(), folderUrl: folder.getUrl(), folderName: name, dateStr: dateStr,
           path: (r.client ? safeName_(r.client) + ' / ' : '') + name };
}

function upload_(b) {
  const folder = folderUnderRoot_(b.folderId);
  const bytes = decode_(b.data, 'upload ' + b.name);
  if (b.size && bytes.length !== b.size) throw new Error('upload ' + b.name + ': received ' + bytes.length + ' of ' + b.size + ' bytes — ส่งซ้ำอีกครั้ง');
  const old = folder.getFilesByName(b.name); while (old.hasNext()) old.next().setTrashed(true);   // retry → แทนที่ไฟล์เดิม
  const f = folder.createFile(Utilities.newBlob(bytes, b.mime || 'application/octet-stream', b.name));
  return { ok: true, fileId: f.getId() };
}

function begin_(b) {
  folderUnderRoot_(b.folderId);
  const res = UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true', {
    method: 'post', contentType: 'application/json; charset=UTF-8',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), 'X-Upload-Content-Type': b.mime || 'application/octet-stream', 'X-Upload-Content-Length': String(b.size) },
    payload: JSON.stringify({ name: b.name, parents: [b.folderId] }), muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) throw new Error('begin failed: HTTP ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 200));
  const h = res.getAllHeaders(), uri = h['Location'] || h['location'];
  if (!uri) throw new Error('no session URI returned');
  return { ok: true, sessionUri: uri };
}

function chunk_(b) {
  if (!/^https:\/\/www\.googleapis\.com\/upload\/drive\//.test(String(b.sessionUri))) throw new Error('invalid session URI');
  const bytes = decode_(b.data, 'chunk ' + b.start + '-' + b.end);
  if (bytes.length !== (b.end - b.start + 1)) throw new Error('chunk ' + b.start + '-' + b.end + ': received ' + bytes.length + ' bytes — ส่งซ้ำอีกครั้ง');
  const res = UrlFetchApp.fetch(b.sessionUri, { method: 'put', contentType: 'application/octet-stream',
    headers: { 'Content-Range': 'bytes ' + b.start + '-' + b.end + '/' + b.total }, payload: bytes, muteHttpExceptions: true });
  const code = res.getResponseCode();
  if (code === 308) return { ok: true, done: false };
  if (code === 200 || code === 201) { const j = JSON.parse(res.getContentText() || '{}'); return { ok: true, done: true, fileId: j.id }; }
  throw new Error('chunk failed: HTTP ' + code + ' ' + res.getContentText().slice(0, 200));
}

function finish_(b, s) {
  const r = b.record || {}, folder = folderUnderRoot_(b.folderId);
  const row = [new Date(), r.id, cleanCode_(r.tag), cleanCode_(r.order), cleanCode_(r.tracking), r.client || '', r.product || '', r.qty || '',
    r.result || '', (r.checklist || []).map(function (c) { return (c.ok ? '✓ ' : '✗ ') + c.item; }).join('\n'),
    r.tagger || '', r.signed ? 'Yes' : 'No', s.email, b.fileCount || 0, b.folderName || folder.getName(), folder.getUrl(), r.notes || ''];
  const sh = getSheet_();
  sh.appendRow(row.map(function (v) { return typeof v === 'string' && /^[=+\-@]/.test(v) ? "'" + v : v; }));  // กัน formula injection
  return { ok: true };
}

const COLS = ['Timestamp', 'Record ID', 'Tagging No.', 'Order No.', 'Tracking No.', 'Client', 'Product / SKU', 'Qty', 'QC Result', 'Checklist', 'Tagger', 'Signed', 'Account', 'Files', 'Folder', 'Folder URL', 'Notes'];
function search_(b) {
  const sh = getSheet_(), last = sh.getLastRow();
  if (last < 2) return { ok: true, rows: [], total: 0 };
  const q = String(b.q || '').trim().toLowerCase(), exact = !!b.exact, limit = Math.min(Number(b.limit) || 50, 300);
  const vals = sh.getRange(2, 1, last - 1, COLS.length).getValues();
  const out = [];
  for (let i = vals.length - 1; i >= 0 && out.length < limit; i--) {
    const v = vals[i];
    if (q) {
      const keys = [v[1], v[2], v[3], v[4]].map(function (x) { return String(x).replace(/^'/, '').toLowerCase(); });
      const hit = exact ? keys.indexOf(q) >= 0 : (keys.concat([String(v[5]).toLowerCase(), String(v[6]).toLowerCase(), String(v[10]).toLowerCase()]).join(' | ').indexOf(q) >= 0);
      if (!hit) continue;
    }
    out.push({ at: v[0] instanceof Date ? v[0].toISOString() : String(v[0]), id: v[1], tag: str_(v[2]), order: str_(v[3]), tracking: str_(v[4]), client: v[5], product: v[6], qty: v[7],
               result: v[8], checklist: v[9], tagger: v[10], signed: v[11] === 'Yes', account: v[12], files: v[13], folder: v[14], url: v[15], notes: str_(v[16]) });
  }
  return { ok: true, rows: out, total: vals.length };
}

/* ═══ helpers ═════════════════════════════════════════════════ */
function getSheet_() {
  let id = P.getProperty('LOG_SHEET_ID'), ss = null;
  try { ss = id ? SpreadsheetApp.openById(id) : null; } catch (e) { ss = null; }
  if (!ss) {
    ss = SpreadsheetApp.create(CONFIG.LOG_SHEET_NAME);   // อยู่ใน My Drive (ไม่ใส่ในโฟลเดอร์ public)
    P.setProperty('LOG_SHEET_ID', ss.getId());
    const sh = ss.getActiveSheet(); sh.setName('QC Log'); sh.appendRow(COLS); sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, COLS.length).setFontWeight('bold').setBackground('#0A0A0B').setFontColor('#C9A84C');
    sh.getRange('C:E').setNumberFormat('@');
  }
  return ss.getSheets()[0];
}
function nextId_(d) {
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const day = Utilities.formatDate(d, CONFIG.TIMEZONE, 'yyMMdd'), k = 'SEQ_' + day;
    const n = Number(P.getProperty(k) || 0) + 1; P.setProperty(k, String(n));
    const old = P.getProperty('SEQ_LAST'); if (old && old !== k) P.deleteProperty(old); P.setProperty('SEQ_LAST', k);
    return 'QC-' + day + '-' + String(n).padStart(3, '0');
  } finally { lock.releaseLock(); }
}
function folderUnderRoot_(id) {
  const f = DriveApp.getFolderById(id);
  const cache = CacheService.getScriptCache();
  if (cache.get('ok_' + id)) return f;
  let cur = f;
  for (let depth = 0; depth < 4; depth++) {
    const it = cur.getParents(); if (!it.hasNext()) break;
    cur = it.next();
    if (cur.getId() === CONFIG.ROOT_FOLDER_ID) { cache.put('ok_' + id, '1', 21600); return f; }
  }
  throw new Error('โฟลเดอร์ปลายทางไม่ได้อยู่ใต้ root ของระบบ');
}
function getOrCreateFolder_(parent, name) { const it = parent.getFoldersByName(name); return it.hasNext() ? it.next() : parent.createFolder(name); }
function cleanCode_(s) { return String(s || '').replace(/[\u0000-\u001F]/g, '').trim().slice(0, 80); }
function safeName_(s) { return String(s).replace(/[\\\/:*?"<>|\u0000-\u001F]/g, '-').trim().slice(0, 120); }
function str_(v) { return String(v == null ? '' : v).replace(/^'/, ''); }
function decode_(data, ctx) {
  if (typeof data !== 'string' || !data.length) throw new Error(ctx + ': ไม่มีข้อมูลไฟล์ในคำขอ — ลองลบไฟล์แล้วเพิ่มใหม่');
  const clean = data.replace(/^data:[^,]*,/, '').replace(/\s/g, '');
  try { return Utilities.base64Decode(clean); } catch (e) { throw new Error(ctx + ': base64 เสียหาย (' + clean.length + ' chars) — ลองส่งอีกครั้ง'); }
}
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
