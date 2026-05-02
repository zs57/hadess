/**
 * ══════════════════════════════════════════════════════════════
 *  🛡️  HADITH PLATFORM — ENTERPRISE FIREWALL v3.0
 * ══════════════════════════════════════════════════════════════
 *  نظام حماية متعدد الطبقات:
 *  ─ Layer 1: Rate Limiting (حد الطلبات لكل IP)
 *  ─ Layer 2: Request Validation (فحص المدخلات)
 *  ─ Layer 3: Bot & Crawler Shield (حماية من البوتات)
 *  ─ Layer 4: NoSQL Injection Prevention (منع حقن قاعدة البيانات)
 *  ─ Layer 5: XSS & Path Traversal Guard (منع XSS واختراق المسارات)
 *  ─ Layer 6: Security Headers (رؤوس أمان شاملة)
 *  ─ Layer 7: IP Blacklist & Threat Intelligence
 *  ─ Layer 8: Request Size & Payload Guard
 *  ─ Layer 9: Suspicious Pattern Detection
 * ══════════════════════════════════════════════════════════════
 */

// ═══════════════════════════════════════
//  🔒 LAYER 1: RATE LIMITER — حد الطلبات
// ═══════════════════════════════════════
const rateLimitStore = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000;   // نافذة دقيقة واحدة
const RATE_LIMIT_MAX = 120;            // 120 طلب/دقيقة لكل IP
const RATE_LIMIT_SEARCH = 30;          // 30 بحث/دقيقة (أغلى على السيرفر)
const BAN_DURATION = 10 * 60 * 1000;   // حظر 10 دقائق عند التجاوز المتكرر

// قائمة الـ IPs المحظورة مؤقتاً
const bannedIPs = new Map();

// سجل الهجمات المكتشفة
const threatLog = [];
const MAX_THREAT_LOG = 1000;

function getClientIP(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers['x-real-ip'] ||
    req.connection?.remoteAddress ||
    'unknown'
  );
}

function logThreat(ip, type, details) {
  const entry = {
    time: new Date().toISOString(),
    ip,
    type,
    details: String(details).substring(0, 200)
  };
  threatLog.unshift(entry);
  if (threatLog.length > MAX_THREAT_LOG) threatLog.pop();
}

function rateLimiter(req, res, next) {
  const ip = getClientIP(req);

  // فحص الحظر المؤقت
  const banExpiry = bannedIPs.get(ip);
  if (banExpiry) {
    if (Date.now() < banExpiry) {
      logThreat(ip, 'BANNED_ACCESS', req.originalUrl);
      return res.status(429).json({
        status: 'blocked',
        message: 'تم حظر IP مؤقتاً بسبب نشاط مشبوه. حاول بعد 10 دقائق.',
        retry_after: Math.ceil((banExpiry - Date.now()) / 1000)
      });
    }
    bannedIPs.delete(ip);
  }

  const now = Date.now();
  const isSearch = req.query.q && req.query.q.trim().length > 0;
  const key = isSearch ? `search:${ip}` : `req:${ip}`;
  const limit = isSearch ? RATE_LIMIT_SEARCH : RATE_LIMIT_MAX;

  let record = rateLimitStore.get(key);
  if (!record || now - record.start > RATE_LIMIT_WINDOW) {
    record = { count: 1, start: now, violations: 0 };
    rateLimitStore.set(key, record);
  } else {
    record.count++;
  }

  // إضافة رؤوس Rate Limit للشفافية
  res.setHeader('X-RateLimit-Limit', limit);
  res.setHeader('X-RateLimit-Remaining', Math.max(0, limit - record.count));
  res.setHeader('X-RateLimit-Reset', Math.ceil((record.start + RATE_LIMIT_WINDOW) / 1000));

  if (record.count > limit) {
    record.violations++;
    logThreat(ip, 'RATE_LIMIT', `${record.count}/${limit} - violations: ${record.violations}`);

    // حظر تلقائي بعد 3 تجاوزات متتالية
    if (record.violations >= 3) {
      bannedIPs.set(ip, now + BAN_DURATION);
      logThreat(ip, 'AUTO_BAN', `Banned for ${BAN_DURATION/1000}s after ${record.violations} violations`);
    }

    return res.status(429).json({
      status: 'rate_limited',
      message: 'عدد الطلبات تجاوز الحد المسموح. انتظر قليلاً.',
      retry_after: Math.ceil((record.start + RATE_LIMIT_WINDOW - now) / 1000)
    });
  }

  next();
}

// تنظيف دوري لذاكرة Rate Limiter كل 5 دقائق
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of rateLimitStore) {
    if (now - val.start > RATE_LIMIT_WINDOW * 2) rateLimitStore.delete(key);
  }
  for (const [ip, expiry] of bannedIPs) {
    if (now > expiry) bannedIPs.delete(ip);
  }
}, 5 * 60 * 1000);


// ═══════════════════════════════════════
//  🔒 LAYER 2: INPUT VALIDATION — فحص المدخلات
// ═══════════════════════════════════════

// أنماط NoSQL Injection الخطيرة
const NOSQL_PATTERNS = [
  /\$(?:gt|gte|lt|lte|ne|nin|in|exists|regex|where|expr|merge|push|pull|set|unset|inc)\b/i,
  /\{\s*["\']?\$\w+/,
  /\[\s*\$\w+/,
  /\bfunction\s*\(/i,
  /\bthis\s*\./i,
  /\bdb\s*\.\s*\w+/i,
  /\bsleep\s*\(\s*\d+\s*\)/i,
];

// أنماط XSS الخطيرة
const XSS_PATTERNS = [
  /<\s*script/i,
  /javascript\s*:/i,
  /on(?:load|error|click|mouse|focus|blur|key|submit|change|input)\s*=/i,
  /<\s*iframe/i,
  /<\s*object/i,
  /<\s*embed/i,
  /<\s*svg[^>]*on\w+/i,
  /data\s*:\s*text\/html/i,
  /vbscript\s*:/i,
  /expression\s*\(/i,
  /url\s*\(\s*['"]?\s*javascript/i,
];

// أنماط Path Traversal
const PATH_TRAVERSAL_PATTERNS = [
  /\.\.\//g,
  /\.\.\\/, 
  /%2e%2e/i,
  /%252e/i,
  /\.\./,
  /\/etc\//i,
  /\/proc\//i,
  /\/dev\//i,
  /\\windows\\/i,
  /\\system32\\/i,
];

// أنماط SQL Injection (حتى لو MongoDB, بعض الهجمات مختلطة)
const SQL_PATTERNS = [
  /(?:UNION|SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|EXEC|EXECUTE)\s+/i,
  /(?:OR|AND)\s+\d+\s*=\s*\d+/i,
  /['";]\s*(?:OR|AND)\s+/i,
  /--\s*$/,
  /\/\*[\s\S]*?\*\//,
  /;\s*(?:DROP|DELETE|UPDATE|INSERT)/i,
  /WAITFOR\s+DELAY/i,
  /BENCHMARK\s*\(/i,
];

// أنماط Command Injection
const CMD_INJECTION_PATTERNS = [
  /[;&|`]\s*(?:ls|cat|pwd|whoami|id|uname|curl|wget|nc|ncat|bash|sh|cmd|powershell)/i,
  /\$\(.*\)/,
  /`[^`]+`/,
  /\|\s*\w+/,
];

function sanitizeInput(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[<>'"`;\\]/g, '')     // إزالة الحروف الخطيرة
    .replace(/\$/g, '')              // إزالة علامة $ (NoSQL)
    .replace(/\{/g, '')              // إزالة الأقواس المعقوفة
    .replace(/\}/g, '')
    .trim()
    .substring(0, 500);             // حد أقصى 500 حرف
}

function detectThreat(value) {
  if (typeof value !== 'string') return null;
  const allPatterns = [
    { patterns: NOSQL_PATTERNS, type: 'NOSQL_INJECTION' },
    { patterns: XSS_PATTERNS, type: 'XSS_ATTACK' },
    { patterns: PATH_TRAVERSAL_PATTERNS, type: 'PATH_TRAVERSAL' },
    { patterns: SQL_PATTERNS, type: 'SQL_INJECTION' },
    { patterns: CMD_INJECTION_PATTERNS, type: 'CMD_INJECTION' },
  ];
  for (const group of allPatterns) {
    for (const pattern of group.patterns) {
      if (pattern.test(value)) return group.type;
    }
  }
  return null;
}

function inputValidator(req, res, next) {
  const ip = getClientIP(req);

  // فحص جميع Query Parameters
  for (const [key, value] of Object.entries(req.query)) {
    if (typeof value === 'object') {
      logThreat(ip, 'OBJECT_INJECTION', `param: ${key}`);
      return res.status(400).json({ status: 'blocked', message: 'طلب غير صالح.' });
    }
    const threat = detectThreat(String(value));
    if (threat) {
      logThreat(ip, threat, `param=${key}, value=${String(value).substring(0, 100)}`);
      return res.status(403).json({ status: 'blocked', message: 'تم اكتشاف محتوى ضار في الطلب.' });
    }
  }

  // فحص Body (POST requests)
  if (req.body && typeof req.body === 'object') {
    const bodyStr = JSON.stringify(req.body);
    if (bodyStr.length > 10000) {
      logThreat(ip, 'PAYLOAD_OVERFLOW', `body size: ${bodyStr.length}`);
      return res.status(413).json({ status: 'blocked', message: 'حجم البيانات تجاوز الحد المسموح.' });
    }
    const threat = detectThreat(bodyStr);
    if (threat) {
      logThreat(ip, threat, `body attack: ${bodyStr.substring(0, 100)}`);
      return res.status(403).json({ status: 'blocked', message: 'تم اكتشاف محتوى ضار.' });
    }
  }

  // فحص URL نفسه
  const urlThreat = detectThreat(decodeURIComponent(req.originalUrl || ''));
  if (urlThreat) {
    logThreat(ip, urlThreat, `URL: ${req.originalUrl}`);
    return res.status(403).json({ status: 'blocked', message: 'رابط مشبوه.' });
  }

  // تنظيف المدخلات تلقائياً
  if (req.query.q) req.query.q = sanitizeInput(req.query.q);
  if (req.query.category) req.query.category = sanitizeInput(req.query.category);

  next();
}


// ═══════════════════════════════════════
//  🔒 LAYER 3: BOT SHIELD — حماية من البوتات
// ═══════════════════════════════════════
const BLOCKED_BOTS = [
  /sqlmap/i, /nikto/i, /nmap/i, /masscan/i, /dirbuster/i,
  /gobuster/i, /wpscan/i, /hydra/i, /metasploit/i, /burpsuite/i,
  /nessus/i, /acunetix/i, /w3af/i, /havij/i, /zmeu/i,
  /python-requests\/\d/i, /scrapy/i, /phantomjs/i,
  /headlesschrome/i, /nuclei/i, /httpx/i, /ffuf/i,
  /wfuzz/i, /commix/i, /joomscan/i, /xsstrike/i,
];

const BLOCKED_PATHS = [
  /\.env/i, /\.git/i, /\.htaccess/i, /\.htpasswd/i,
  /wp-admin/i, /wp-login/i, /wp-content/i, /wp-includes/i,
  /phpmyadmin/i, /phpinfo/i, /adminer/i, /\.php$/i,
  /\.asp$/i, /\.jsp$/i, /\.cgi$/i, /shell/i,
  /admin\/?$/i, /login\/?$/i, /config\/?$/i,
  /backup/i, /\.sql$/i, /\.bak$/i, /\.old$/i,
  /\.swp$/i, /\.DS_Store/i, /thumbs\.db/i,
  /\.log$/i, /debug/i, /test\/?$/i, /\.xml$/i,
  /actuator/i, /graphql/i, /\.well-known\/security/i,
];

function botShield(req, res, next) {
  const ip = getClientIP(req);
  const ua = req.headers['user-agent'] || '';
  const path = req.path || '';

  // فحص الـ User-Agent ضد أدوات الاختراق
  for (const bot of BLOCKED_BOTS) {
    if (bot.test(ua)) {
      logThreat(ip, 'BLOCKED_BOT', ua.substring(0, 100));
      return res.status(403).json({ status: 'blocked', message: 'Access denied.' });
    }
  }

  // فحص المسارات المشبوهة (WordPress, phpMyAdmin, etc.)
  for (const blocked of BLOCKED_PATHS) {
    if (blocked.test(path)) {
      logThreat(ip, 'BLOCKED_PATH', path);
      // Honeypot: نرد 404 عادي بدون معلومات
      return res.status(404).json({ status: 'not_found' });
    }
  }

  // فحص طلبات بدون User-Agent (بوتات بسيطة)
  if (!ua || ua.length < 5) {
    logThreat(ip, 'NO_USER_AGENT', 'Empty or too short UA');
    // نسمح لها لكن نسجلها
  }

  // فحص HTTP Methods غير المسموحة
  const allowedMethods = ['GET', 'HEAD', 'OPTIONS'];
  if (!allowedMethods.includes(req.method)) {
    logThreat(ip, 'BLOCKED_METHOD', req.method);
    return res.status(405).json({ status: 'blocked', message: 'Method not allowed.' });
  }

  next();
}


// ═══════════════════════════════════════
//  🔒 LAYER 4: SECURITY HEADERS — رؤوس الأمان
// ═══════════════════════════════════════
function securityHeaders(req, res, next) {
  // منع التضمين في مواقع أخرى (Clickjacking)
  res.setHeader('X-Frame-Options', 'DENY');

  // منع تخمين نوع المحتوى (MIME Sniffing)
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // حماية XSS في المتصفحات القديمة
  res.setHeader('X-XSS-Protection', '1; mode=block');

  // سياسة الإحالة
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // منع تسريب معلومات السيرفر
  res.removeHeader('X-Powered-By');
  res.setHeader('Server', 'Hadith-Shield');

  // Content Security Policy
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline'; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net; " +
    "font-src 'self' https://fonts.gstatic.com https://cdn.jsdelivr.net; " +
    "img-src 'self' data: https:; " +
    "connect-src 'self'; " +
    "frame-ancestors 'none';"
  );

  // Permissions Policy (منع الوصول لأجهزة المستخدم)
  res.setHeader('Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()'
  );

  // HSTS (فرض HTTPS)
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');

  // منع DNS Prefetch لمواقع خارجية
  res.setHeader('X-DNS-Prefetch-Control', 'off');

  // Cross-Origin Policies
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');

  next();
}


// ═══════════════════════════════════════
//  🔒 LAYER 5: REQUEST FINGERPRINT — بصمة الطلب
// ═══════════════════════════════════════
function requestFingerprint(req, res, next) {
  const ip = getClientIP(req);

  // فحص حجم الـ Headers (حماية من Header Overflow)
  const headerSize = JSON.stringify(req.headers).length;
  if (headerSize > 16000) {
    logThreat(ip, 'HEADER_OVERFLOW', `size: ${headerSize}`);
    return res.status(431).json({ status: 'blocked', message: 'Request headers too large.' });
  }

  // فحص عدد Query Parameters (حماية من Parameter Pollution)
  const paramCount = Object.keys(req.query).length;
  if (paramCount > 10) {
    logThreat(ip, 'PARAM_POLLUTION', `count: ${paramCount}`);
    return res.status(400).json({ status: 'blocked', message: 'Too many parameters.' });
  }

  // فحص طول URL
  if (req.originalUrl && req.originalUrl.length > 2048) {
    logThreat(ip, 'URL_OVERFLOW', `length: ${req.originalUrl.length}`);
    return res.status(414).json({ status: 'blocked', message: 'URL too long.' });
  }

  next();
}


// ═══════════════════════════════════════
//  📊 THREAT DASHBOARD — لوحة التحكم الأمنية
// ═══════════════════════════════════════
function getThreatDashboard() {
  const stats = {};
  threatLog.forEach(t => {
    stats[t.type] = (stats[t.type] || 0) + 1;
  });
  return {
    total_threats: threatLog.length,
    banned_ips: bannedIPs.size,
    active_sessions: rateLimitStore.size,
    threat_types: stats,
    recent_threats: threatLog.slice(0, 20),
    firewall_version: '3.0',
    status: 'ACTIVE'
  };
}


// ═══════════════════════════════════════
//  📦 تصدير جميع الطبقات
// ═══════════════════════════════════════
module.exports = {
  rateLimiter,
  inputValidator,
  botShield,
  securityHeaders,
  requestFingerprint,
  getThreatDashboard,
  getClientIP,
  sanitizeInput,
  logThreat
};
