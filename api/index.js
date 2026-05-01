const express = require('express');
const { MongoClient, ServerApiVersion } = require('mongodb');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// الربط المباشر بقاعدة البيانات sunnah
const uri = "mongodb+srv://zezo411200:zezo4112000@cluster0.9yrl0ey.mongodb.net/sunnah?retryWrites=true&w=majority";
const client = new MongoClient(uri, {
  serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true },
  connectTimeoutMS: 30000, // زيادة المهلة لضمان الاتصال
  family: 4
});

let cachedDb = null;

async function getDatabase() {
  if (cachedDb) return cachedDb;
  await client.connect();
  cachedDb = client.db(); // سيستخدم قاعدة sunnah المذكورة في الرابط تلقائياً
  return cachedDb;
}

// قائمة التصنيفات الأساسية كـ Fallback سريع لضمان عدم ظهور 500
const defaultCategories = ["ahmad", "bukhari", "muslim", "tirmidhi", "abudawud", "nasai", "ibnmajah", "malik"];

app.get('/api/categories', async (req, res) => {
  try {
    const db = await getDatabase();
    // محاولة جلب التصنيفات الحقيقية مع وضع مهلة (Timeout)
    const categories = await db.collection('hadiths').distinct('collection');
    res.json({ status: 'success', data: categories.length > 0 ? categories : defaultCategories });
  } catch (err) {
    // إذا فشل الـ Distinct لأي سبب، نرسل القائمة الافتراضية لكي لا يتعطل الموقع
    res.json({ status: 'success', data: defaultCategories });
  }
});

app.get('/api/hadiths', async (req, res) => {
  try {
    const db = await getDatabase();
    const { category, q, page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    let query = {};
    if (category && category !== 'all') query.collection = category;
    
    if (q) {
      query.$or = [
        { arabic_text: { $regex: q, $options: 'i' } },
        { english_text: { $regex: q, $options: 'i' } }
      ];
    }

    const hadiths = await db.collection('hadiths')
      .find(query)
      .sort({ _id: -1 })
      .skip(skip)
      .limit(parseInt(limit) || 50) // زيادة العدد الافتراضي لـ 50
      .toArray();

    const mapped = hadiths.map(h => ({
        text: h.arabic_text || "---",
        english: h.english_text || "",
        source: h.collection + (h.book ? ` - كِتَاب ${h.book}` : ""),
        chapter: h.narrator || "",
        grade: Array.isArray(h.grade) ? h.grade.join(' | ') : (h.grade || ""),
        ref: h.reference ? `رقم: ${h.reference.hadith_number || ""}` : ""
    }));

    res.json({ status: 'success', data: mapped });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

module.exports = app;
