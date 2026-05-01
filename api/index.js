const express = require('express');
const { MongoClient, ServerApiVersion } = require('mongodb');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();

app.use(cors());
app.use(express.json());

const uri = "mongodb+srv://zezo411200:zezo4112000@cluster0.9yrl0ey.mongodb.net/?retryWrites=true&w=majority";
const client = new MongoClient(uri, {
  serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true },
  connectTimeoutMS: 15000,
  family: 4,
  tlsAllowInvalidCertificates: true
});

let cachedDb = null;

async function getDatabase() {
  if (cachedDb) return cachedDb;
  await client.connect();
  cachedDb = client.db("hadith_db");
  return cachedDb;
}

// Note: On Vercel, the path will already have /api stripped if we route it correctly, 
// but to be safe, we'll handle both /api/hadiths and /hadiths
app.get(['/api/hadiths', '/hadiths'], async (req, res) => {
  try {
    const db = await getDatabase();
    const { category, q, page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    let query = {};
    if (category && category !== 'all') query.category = category;
    if (q) query.text = { $regex: q, $options: 'i' };

    const hadiths = await db.collection('hadiths')
      .find(query)
      .sort({ _id: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .toArray();

    res.json({ status: 'success', data: hadiths });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

module.exports = app;
