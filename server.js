const express = require('express');
const { MongoClient, ServerApiVersion } = require('mongodb');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Serve frontend files from public folder

// MongoDB Connection
const uri = "mongodb+srv://zezo411200:zezo4112000@cluster0.9yrl0ey.mongodb.net/?retryWrites=true&w=majority";

// We will try to use the direct node addresses if SRV fails, 
// but first, let's try to add 'ssl=true' and 'authSource=admin' which often helps
const clusterUrl = uri.includes('+srv') ? uri : uri; 

const client = new MongoClient(clusterUrl, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
  connectTimeoutMS: 15000,
  family: 4,
  tls: true,
  tlsAllowInvalidCertificates: true,
  retryWrites: true,
  // This option helps in some restricted networks
  authSource: 'admin' 
});

let db;

// API Routes
app.get('/api/hadiths', async (req, res) => {
  if (!db) {
    return res.status(503).json({ status: 'error', message: 'السيرفر ما زال يتصل بقاعدة البيانات، يرجى المحاولة بعد قليل.' });
  }

  try {
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

// Fallback for SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server with Smart Fallback
async function startServer() {
  let isConnected = false;
  try {
    // Set a timeout for connection
    console.log("⏳ Connecting to MongoDB Atlas...");
    await client.connect();
    db = client.db("hadith_db");
    console.log("✅ Connected to MongoDB Atlas Successfully");
    isConnected = true;
  } catch (err) {
    console.error("⚠️ MongoDB Connection Failed. Running in Fallback Mode.");
    console.error("Reason:", err.message);
    
    // Load sample data as fallback
    try {
        const fs = require('fs');
        const samplePath = path.join(__dirname, 'data', 'sample_hadiths.json');
        if (fs.existsSync(samplePath)) {
            const raw = fs.readFileSync(samplePath);
            // We'll mock the database behavior
            const sampleData = JSON.parse(raw);
            db = {
                collection: () => ({
                    find: () => ({
                        sort: () => ({
                            skip: () => ({
                                limit: () => ({
                                    toArray: async () => sampleData
                                })
                            })
                        })
                    })
                })
            };
            console.log("ℹ️ Loaded Sample Data from fallback file.");
        }
    } catch (fsErr) {
        console.error("❌ Failed to load fallback data:", fsErr.message);
    }
  }

  app.listen(port, () => {
    console.log(`🚀 Platform ready at http://localhost:${port}`);
    if (!isConnected) {
        console.log("📢 NOTE: Running with sample data because database connection was refused.");
    }
  });
}

// Export for Vercel
module.exports = app;

startServer();
