import mongoose from "mongoose";
import Doctor from '../models/Doctor.js';
import Hospital from '../models/Hospital.js';
import Schedule from '../models/Schedule.js';
import Appointment from '../models/Appointment.js';
import { BANGLADESH_CITIES, SPECIALTIES } from '../utils/cities.js';


const SPECIALTY_SEARCH_ALIASES = {
  Medicine: ['medicine', 'medical', 'মেডিসিন', 'মেডিসিন বিশেষজ্ঞ', 'ইন্টারনাল মেডিসিন'],
  Cardiology: ['cardiology', 'cardiologist', 'cardio', 'heart', 'হৃদরোগ', 'হৃদরোগ বিশেষজ্ঞ', 'কার্ডিওলজি', 'কার্ডিওলজিস্ট', 'হার্ট'],
  Orthopedics: ['orthopedics', 'orthopedic', 'ortho', 'bone', 'হাড়', 'হাড়', 'অর্থোপেডিক', 'অর্থোপেডিক্স', 'হাড়ের ডাক্তার'],
  Gynecology: ['gynecology', 'gynecologist', 'gynae', 'gyno', 'গাইনি', 'গাইনী', 'স্ত্রীরোগ', 'স্ত্রীরোগ বিশেষজ্ঞ'],
  Pediatrics: ['pediatrics', 'pediatrician', 'child', 'children', 'শিশু', 'শিশু রোগ', 'শিশু বিশেষজ্ঞ', 'পেডিয়াট্রিক', 'পেডিয়াট্রিক'],
  Dermatology: ['dermatology', 'dermatologist', 'skin', 'চর্ম', 'চর্মরোগ', 'চর্মরোগ বিশেষজ্ঞ', 'ডার্মাটোলজি'],
  ENT: ['ent', 'ear nose throat', 'ear', 'nose', 'throat', 'কান', 'নাক', 'গলা', 'কান নাক গলা', 'ইএনটি'],
  Neurology: ['neurology', 'neurologist', 'neuro', 'brain', 'নার্ভ', 'স্নায়ু', 'স্নায়ু', 'নিউরো', 'নিউরোলজি', 'মস্তিষ্ক'],
  Urology: ['urology', 'urologist', 'urinary', 'kidney', 'মূত্র', 'মূত্রনালী', 'ইউরোলজি', 'কিডনি'],
  Dentistry: ['dentistry', 'dentist', 'dental', 'teeth', 'tooth', 'দাঁত', 'দাঁতের ডাক্তার', 'ডেন্টিস্ট', 'ডেন্টাল'],
  Psychiatry: ['psychiatry', 'psychiatrist', 'mental', 'মনোরোগ', 'মানসিক', 'মনোরোগ বিশেষজ্ঞ', 'সাইকিয়াট্রি', 'সাইকিয়াট্রিস্ট'],
  Ophthalmology: ['ophthalmology', 'ophthalmologist', 'eye', 'eyes', 'চোখ', 'চক্ষু', 'চক্ষু বিশেষজ্ঞ', 'চোখের ডাক্তার'],
  'General Surgery': ['general surgery', 'surgeon', 'surgery', 'সার্জারি', 'সার্জন', 'অস্ত্রোপচার', 'জেনারেল সার্জারি'],
};

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getSearchTerms(value) {
  const raw = String(value || '').trim();
  if (!raw) return [];

  const terms = new Set([raw]);

  for (const [specialty, aliases] of Object.entries(SPECIALTY_SEARCH_ALIASES)) {
    const all = [specialty, ...aliases];
    if (all.some(alias =>
      alias.toLocaleLowerCase().includes(raw.toLocaleLowerCase()) ||
      raw.toLocaleLowerCase().includes(alias.toLocaleLowerCase())
    )) {
      all.forEach(alias => terms.add(alias));
    }
  }

  return [...terms].filter(Boolean);
}

export async function doctors(req, res) {
  const q = { verified: true };

  if (req.query.specialty) q.specialty = new RegExp(req.query.specialty, 'i');
  if (req.query.city) q.city = new RegExp(req.query.city, 'i');
  if (req.query.location) q.location = new RegExp(req.query.location, 'i');
  if (req.query.hospital) q.hospitals = req.query.hospital;

  if (req.query.search) {
    const terms = getSearchTerms(req.query.search);
    q.$or = terms.flatMap(term => {
      const rx = new RegExp(escapeRegex(term), 'i');
      return [
        { name: rx },
        { specialty: rx },
      ];
    });
  }

  const items = await Doctor.find(q)
    .select('slug name specialty qualification experience city location fee image verified hospital chamberHospital hospitals scheduleDays scheduleStart scheduleEnd availability bio seo')
    .populate('chamberHospital', 'name city location')
    .sort({ name: 1 });

  // Expose only the doctor's active chamber hospital to public/patient views.
  const safeItems = items.map(d => {
    const x = d.toObject();
    if (x.chamberHospital) x.hospitals = [x.chamberHospital];
    else x.hospitals = (x.hospitals || []).slice(0, 1);
    delete x.chamberHospital;
    return x;
  });

  res.json({ items: safeItems });
}

export async function doctor(req, res) {
  const doctorQuery = { verified: true, $or: [{ slug: req.params.id }] };
  if (mongoose.Types.ObjectId.isValid(req.params.id)) {
    doctorQuery.$or.push({ _id: req.params.id });
  }
  const d = await Doctor.findOne(doctorQuery).select('slug name specialty qualification experience city location fee image verified hospital chamberHospital hospitals scheduleDays scheduleStart scheduleEnd availability bio seo')
    .populate('chamberHospital', 'name city location');

  if (!d) return res.status(404).json({ message: 'Doctor not found' });

  const [appointments, patients] = await Promise.all([
    Appointment.countDocuments({ doctor: d._id }),
    Appointment.distinct('patient', {
      doctor: d._id,
      status: { $in: ['confirmed', 'completed'] },
    }),
  ]);

  const doctorData = d.toObject();
  doctorData.hospitals = doctorData.chamberHospital ? [doctorData.chamberHospital] : [];
  delete doctorData.chamberHospital;

  res.json({
    doctor: doctorData,
    stats: {
      appointments,
      patients: patients.length,
    },
  });
}

export async function hospitals(req, res) {
  const q = { verified: true };

  if (req.query.search) {
    q.$or = [
      { name: new RegExp(req.query.search, 'i') },
      { city: new RegExp(req.query.search, 'i') },
      { location: new RegExp(req.query.search, 'i') },
    ];
  }

  if (req.query.city) q.city = new RegExp(req.query.city, 'i');

  res.json({
    items: await Hospital.find(q).sort({ name: 1 }),
  });
}

export async function hospital(req, res) {
  const hospitalQuery = { verified: true, $or: [{ slug: req.params.id }] };
  if (mongoose.Types.ObjectId.isValid(req.params.id)) {
    hospitalQuery.$or.push({ _id: req.params.id });
  }
  const h = await Hospital.findOne(hospitalQuery);

  if (!h) return res.status(404).json({ message: 'Hospital not found' });

  res.json({ hospital: h });
}

export async function meta(req, res) {
  res.json({
    cities: BANGLADESH_CITIES,
    specialties: SPECIALTIES,
  });
}

export async function schedule(req, res) {
  const d = await Doctor.findOne({
    _id: req.params.doctorId,
    verified: true,
  });

  if (!d) return res.status(404).json({ message: 'Doctor not found' });

  const date = req.query.date;
  if (!date) return res.status(400).json({ message: 'Date is required' });

  const [yy, mm, dd] = String(date).split('-').map(Number);
  const requested = new Date(Date.UTC(yy, mm - 1, dd));
  if (!yy || !mm || !dd || requested.getUTCFullYear() !== yy || requested.getUTCMonth() !== mm - 1 || requested.getUTCDate() !== dd) {
    return res.status(400).json({ message: 'Invalid date' });
  }
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Dhaka', year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(new Date());
  const today = `${parts.find(x=>x.type==='year').value}-${parts.find(x=>x.type==='month').value}-${parts.find(x=>x.type==='day').value}`;
  const maxDateObj = new Date(Date.UTC(...today.split('-').map((v,i)=>i===1?Number(v)-1:Number(v))));
  maxDateObj.setUTCMonth(maxDateObj.getUTCMonth() + 1);
  const maxDate = `${maxDateObj.getUTCFullYear()}-${String(maxDateObj.getUTCMonth()+1).padStart(2,'0')}-${String(maxDateObj.getUTCDate()).padStart(2,'0')}`;
  if (date < today || date > maxDate) {
    return res.status(400).json({ message: 'Date must be between today and one month from today' });
  }

  const day = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][requested.getUTCDay()];

  if (!d.scheduleDays?.length || !d.scheduleDays.includes(day)) {
    return res.json({
      available: false,
      date,
      day,
      serials: [],
      start: d.scheduleStart,
      end: d.scheduleEnd,
    });
  }

  let s = await Schedule.findOne({
    doctor: d._id,
    date,
  });

  if (!s) {
    s = await Schedule.create({
      doctor: d._id,
      date,
      serials: Array.from(
        { length: 20 },
        (_, i) => ({ number: i + 1, available: true })
      ),
    });
  }

  const booked = new Set(
    await Appointment.find({
      doctor: d._id,
      date,
      status: { $nin: ['cancelled', 'rejected'] },
    }).distinct('serial')
  );

  const serials = s.serials.map(item => ({
    number: item.number,
    available: item.available && !booked.has(item.number),
  }));

  res.json({
    available: true,
    date,
    day,
    start: d.scheduleStart || '8:00 AM',
    end: d.scheduleEnd || '4:00 PM',
    serials,
  });
}
