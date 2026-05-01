const express = require('express');
const { MongoClient, ServerApiVersion } = require('mongodb');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const uri = "mongodb+srv://zezo411200:zezo4112000@cluster0.9yrl0ey.mongodb.net/?retryWrites=true&w=majority";
const client = new MongoClient(uri, {
  serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true },
  connectTimeoutMS: 20000,
  family: 4,
  tlsAllowInvalidCertificates: true
});

let cachedDb = null;
let targetCollName = "hadiths"; // Default

async function getDatabase() {
  if (cachedDb) return cachedDb;
  await client.connect();
  cachedDb = client.db("sunnah");
  
  // Auto-discover the main collection name once
  const collections = await cachedDb.listCollections().toArray();
  const names = collections.map(c => c.name);
  if (names.length > 0) {
    targetCollName = names.includes('hadiths') ? 'hadiths' : names[0];
  }
  
  return cachedDb;
}

// Fixed Categories Endpoint
app.get('/api/categories', async (req, res) => {
  try {
    const db = await getDatabase();
    const categories = await db.collection(targetCollName).distinct('collection');
    res.json({ status: 'success', data: categories.filter(c => c) });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// Advanced Topic Search Endpoint
app.get('/api/hadiths', async (req, res) => {
  try {
    const db = await getDatabase();
    const { category, q, page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    let query = {};
    if (category && category !== 'all') query.collection = category;
    
    if (q) {
      // Powerful Topic Search in multiple fields
      query.$or = [
        { arabic_text: { $regex: q, $options: 'i' } },
        { english_text: { $regex: q, $options: 'i' } },
        { narrator: { $regex: q, $options: 'i' } }
      ];
    }

    const hadiths = await db.collection(targetCollName)
      .find(query)
      .sort({ _id: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .toArray();

    const mapped = hadiths.map(h => ({
        text: h.arabic_text || "---",
        english: h.english_text || "",
        source: h.collection + (h.book ? ` - كِتَاب ${h.book}` : ""),
        chapter: h.narrator || ""
    }));

    res.json({ status: 'success', data: mapped });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

module.exports = app;
