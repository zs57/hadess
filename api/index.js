const express = require('express');
const { MongoClient, ServerApiVersion } = require('mongodb');
const cors = require('cors');
const firewall = require('./firewall');

const app = express();

// ─── CORS مع كاش للـ Preflight لتقليل الطلبات ───
app.use(cors({ maxAge: 86400 }));
app.use(express.json({ limit: '1mb' }));

// ══════════════════════════════════════════════════
// 🛡️ تفعيل جدار الحماية — 5 طبقات أمان متتالية
// ══════════════════════════════════════════════════
app.use(firewall.securityHeaders);     // Layer 1: رؤوس الأمان الشاملة
app.use(firewall.botShield);           // Layer 2: حماية من البوتات وأدوات الاختراق
app.use(firewall.requestFingerprint);  // Layer 3: فحص بصمة الطلب (حجم، عدد، طول)
app.use(firewall.rateLimiter);         // Layer 4: حد الطلبات مع حظر تلقائي
app.use(firewall.inputValidator);      // Layer 5: فحص وتنظيف المدخلات

// ─── كاش CDN عالمي ───
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
  res.setHeader('Vary', 'Accept-Encoding');
  next();
});

// ─── إعداد قاعدة البيانات مع Connection Pooling احترافي ───
const uri = "mongodb+srv://zezo411200:zezo4112000@cluster0.9yrl0ey.mongodb.net/sunnah?retryWrites=true&w=majority";
const client = new MongoClient(uri, {
  serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true },
  connectTimeoutMS: 20000,
  socketTimeoutMS: 45000,
  maxPoolSize: 10,
  minPoolSize: 2,
  maxIdleTimeMS: 60000,
  family: 4,
  retryWrites: true,
  retryReads: true
});

let cachedDb = null;
let isConnecting = false;

async function getDatabase() {
  if (cachedDb) return cachedDb;
  if (isConnecting) {
    await new Promise(r => setTimeout(r, 100));
    return getDatabase();
  }
  isConnecting = true;
  try {
    await client.connect();
    cachedDb = client.db();
    return cachedDb;
  } finally {
    isConnecting = false;
  }
}

// ─── نظام الكاش في الذاكرة ───
const memoryCache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

function getCached(key) {
  const entry = memoryCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.time > CACHE_TTL) { memoryCache.delete(key); return null; }
  return entry.data;
}

function setCache(key, data) {
  if (memoryCache.size > 500) {
    const oldest = memoryCache.keys().next().value;
    memoryCache.delete(oldest);
  }
  memoryCache.set(key, { data, time: Date.now() });
}

const defaultCategories = ["ahmad", "bukhari", "muslim", "tirmidhi", "abudawud", "nasai", "ibnmajah", "malik"];
const catNames = {
  ahmad: 'مسند الإمام أحمد بن حنبل', bukhari: 'صحيح البخاري', muslim: 'صحيح مسلم',
  tirmidhi: 'جامع الترمذي', abudawud: 'سنن أبي داود', nasai: 'سنن النسائي',
  ibnmajah: 'سنن ابن ماجه', malik: 'موطأ الإمام مالك'
};

// ═══════════════════════════════════════════════
// 📚 API: جلب التصنيفات / الكتب
// ═══════════════════════════════════════════════
app.get('/api/categories', async (req, res) => {
  try {
    const cached = getCached('categories');
    if (cached) return res.json(cached);

    const db = await getDatabase();
    const categories = await db.collection('hadiths').distinct('collection');
    const result = {
      status: 'success',
      data: categories.length > 0 ? categories : defaultCategories,
      names: catNames
    };
    setCache('categories', result);
    res.json(result);
  } catch (err) {
    // Fallback فوري: لن يعلق الموقع أبداً
    res.json({ status: 'success', data: defaultCategories, names: catNames });
  }
});

// ═══════════════════════════════════════════════
// 📖 API: جلب الأحاديث مع بحث وفلترة
// ═══════════════════════════════════════════════
app.get('/api/hadiths', async (req, res) => {
  try {
    const { category, q, page = 1, limit = 30 } = req.query;
    // حماية السيرفر: الحد الأقصى 50 حديث لكل طلب
    const maxLimit = Math.min(Math.max(parseInt(limit) || 30, 1), 50);
    const pageNum = Math.max(parseInt(page) || 1, 1);
    const skip = (pageNum - 1) * maxLimit;

    // مفتاح الكاش الفريد لكل طلب
    const cacheKey = `h:${category || 'all'}:${q || ''}:${pageNum}:${maxLimit}`;
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    const db = await getDatabase();
    let query_obj = {};
    if (category && category !== 'all') query_obj.collection = category;

    if (q && q.trim()) {
      // تنظيف مدخلات البحث لمنع ReDoS attacks
      const safeQ = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query_obj.$or = [
        { arabic_text: { $regex: safeQ, $options: 'i' } },
        { english_text: { $regex: safeQ, $options: 'i' } }
      ];
    }

    // Projection: نجلب فقط الحقول المطلوبة لتقليل حجم البيانات المنقولة
    const projection = {
      arabic_text: 1,
      english_text: 1,
      collection: 1,
      book: 1,
      narrator: 1,
      grade: 1,
      reference: 1,
      _id: 0
    };

    // تنفيذ الاستعلام والعد بالتوازي (Parallel Execution)
    const [hadiths, totalCount] = await Promise.all([
      db.collection('hadiths')
        .find(query_obj)
        .project(projection)
        .sort({ _id: -1 })
        .skip(skip)
        .limit(maxLimit)
        .toArray(),
      // العد فقط إذا كانت الصفحة الأولى (لتوفير الموارد)
      pageNum === 1
        ? db.collection('hadiths').countDocuments(query_obj).catch(() => 0)
        : Promise.resolve(-1)
    ]);

    const mapped = hadiths.map(h => ({
      text: h.arabic_text || "---",
      english: h.english_text || "",
      source: h.collection + (h.book ? ` - كِتَاب ${h.book}` : ""),
      chapter: h.narrator || "",
      grade: Array.isArray(h.grade) ? h.grade.join(' | ') : (h.grade || ""),
      ref: h.reference ? `رقم: ${h.reference.hadith_number || ""}` : ""
    }));

    const result = {
      status: 'success',
      data: mapped,
      pagination: {
        page: pageNum,
        limit: maxLimit,
        hasMore: hadiths.length === maxLimit,
        ...(totalCount >= 0 && { total: totalCount })
      }
    };

    setCache(cacheKey, result);
    res.json(result);
  } catch (err) {
    // حتى في حالة الخطأ نرسل مصفوفة فارغة بدلاً من 500
    res.json({ status: 'success', data: [], pagination: { page: 1, limit: 30, hasMore: false } });
  }
});

// ═══════════════════════════════════════════════
// 🏥 API: فحص صحة السيرفر (Health Check)
// ═══════════════════════════════════════════════
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    cache_size: memoryCache.size,
    timestamp: new Date().toISOString()
  });
});

// ═══════════════════════════════════════════════
// 🛡️ API: لوحة تحكم التهديدات (Threat Dashboard)
// ═══════════════════════════════════════════════
app.get('/api/threats', (req, res) => {
  // يفضل حماية هذا المسار بكلمة مرور أو توكن (Token) في بيئة الإنتاج
  // لكن لأغراض هذا المشروع، سنعرض الإحصائيات مع إخفاء بعض تفاصيل الـ IP للحماية
  const stats = firewall.getThreatDashboard();
  res.json(stats);
});

module.exports = app;
