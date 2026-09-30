import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import routes from './routes/index.js';
import sitemapRouter from "./routes/sitemap.js";
import { connectDB } from './config/db.js';
import Doctor from './models/Doctor.js';
import Hospital from './models/Hospital.js';
import { uniqueSlug } from './utils/slug.js';
import { notFound, errorHandler } from './middleware/error.js';

const app = express();
const PORT = Number(process.env.PORT || 5000);
const allowedOrigins = [
  ...(process.env.CLIENT_URL || 'http://localhost:5173')
    .split(',')
    .map(v => v.trim())
    .filter(Boolean),
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'https://doctorbd.info',
  'https://www.doctorbd.info'
];

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    if (
      origin.startsWith('http://localhost:') ||
      origin.startsWith('http://127.0.0.1:') ||
      origin.endsWith('.pages.dev') ||
      origin.endsWith('.workers.dev')
    ) {
      return callback(null, true);
    }
    console.warn('CORS rejected:', origin);
    return callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(morgan('combined'));
app.use("/", sitemapRouter);
app.use('/api/v1/auth', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
}));

app.get('/', (req, res) => res.json({
  success: true,
  service: 'DoctorBD API',
  status: 'online',
  version: '1.0.0',
}));

app.get('/health', (req, res) => res.json({
  success: true,
  service: 'doctorbd-api',
  status: 'online',
  database: 'connected',
  time: new Date().toISOString(),
}));

app.get('/api/v1/health', (req, res) => res.json({
  success: true,
  service: 'doctorbd-api',
  status: 'online',
  time: new Date().toISOString(),
}));

app.get('/api/v1', (req, res) => res.json({
  success: true,
  message: 'DoctorBD API',
  endpoints: {
    auth: '/api/auth',
    doctors: '/api/doctors',
    hospitals: '/api/hospitals',
    appointments: '/api/appointments',
    notifications: '/api/notifications',
  },
}));

app.use('/api/v1', routes);

app.use(notFound);
app.use(errorHandler);

async function ensureSeoSlugs() {
  const doctors = await Doctor.find({ $or: [{ slug: { $exists: false } }, { slug: "" }] }).select("_id name");
  for (const d of doctors) {
    d.slug = await uniqueSlug(Doctor, d.name, d._id);
    await d.save();
  }
  const hospitals = await Hospital.find({ $or: [{ slug: { $exists: false } }, { slug: "" }] }).select("_id name");
  for (const h of hospitals) {
    h.slug = await uniqueSlug(Hospital, h.name, h._id);
    await h.save();
  }
}

connectDB()
  .then(async () => {
    await ensureSeoSlugs();
    app.listen(PORT, '0.0.0.0', () => {
      `Server running on port ${PORT}`
    });
  })
  .catch(error => {
    console.error('Database connection failed:', error);
    process.exit(1);
  });

export default app;
