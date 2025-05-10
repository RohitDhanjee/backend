// server.js - Backend for IoT Fan Speed Controller
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/fan_controller', {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('MongoDB connected'))
.catch(err => console.error('MongoDB connection error:', err));

// Schema for temperature and fan speed data
const dataSchema = new mongoose.Schema({
  temperature: Number,
  fanSpeed: Number,
  timestamp: { type: Date, default: Date.now }
});

const configSchema = new mongoose.Schema({
  threshold: { type: Number, default: 30 },
  lastUpdated: { type: Date, default: Date.now }
});

const Data = mongoose.model('Data', dataSchema);
const Config = mongoose.model('Config', configSchema);

// Initialize config if it doesn't exist
async function initializeConfig() {
  const configCount = await Config.countDocuments();
  if (configCount === 0) {
    await Config.create({ threshold: 30 });
    console.log('Config initialized with default values');
  }
}
initializeConfig();

// Routes
app.get("/", (req, res) => res.send("Express on Vercel"));
app.get('/api/data', async (req, res) => {
  try {
    // Get last 50 data points
    const data = await Data.find().sort({ timestamp: -1 }).limit(50);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/config', async (req, res) => {
  try {
    const config = await Config.findOne();
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/config', async (req, res) => {
  try {
    const { threshold } = req.body;
    
    if (threshold === undefined) {
      return res.status(400).json({ error: 'Threshold value is required' });
    }
    
    const config = await Config.findOneAndUpdate(
      {}, 
      { threshold, lastUpdated: Date.now() }, 
      { new: true, upsert: true }
    );
    
    // Broadcast the new threshold to all connected devices
    io.emit('config_update', { threshold });
    
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Endpoint for ESP8266 to post data
app.post('/api/esp8266/data', async (req, res) => {
  try {
    const { temperature, fanSpeed } = req.body;
    
    if (temperature === undefined || fanSpeed === undefined) {
      return res.status(400).json({ error: 'Temperature and fan speed values are required' });
    }
    
    const newData = new Data({
      temperature,
      fanSpeed,
      timestamp: Date.now()
    });
    
    await newData.save();
    
    // Broadcast the new data to all connected clients
    io.emit('data_update', { temperature, fanSpeed, timestamp: newData.timestamp });
    
    res.json(newData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get current config for ESP8266
app.get('/api/esp8266/config', async (req, res) => {
  try {
    const config = await Config.findOne();
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Socket.IO connection
io.on('connection', (socket) => {
  console.log('A user connected');
  
  socket.on('disconnect', () => {
    console.log('User disconnected');
  });
});

// // Start server
// const PORT = process.env.PORT || 5000;
// server.listen(PORT, () => {
//   console.log(`Server running on port ${PORT}`);
// });
if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

// Export for serverless use
module.exports = app;
