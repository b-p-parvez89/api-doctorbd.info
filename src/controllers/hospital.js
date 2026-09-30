import bcrypt from 'bcryptjs';
import Hospital from '../models/Hospital.js';
import Doctor from '../models/Doctor.js';
import Appointment from '../models/Appointment.js';
import User from '../models/User.js';
import { notify, notifyAdmins } from '../utils/notify.js';
import { sendSms } from '../utils/sms.js';
import { uploadBuffer } from '../utils/cloudinary.js';
import { BANGLADESH_CITIES, SPECIALTIES } from '../utils/cities.js';

function normalizeDoctorBio(value) {
  if (value === undefined || value === null) return value;
  return String(value)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .trim();
}

async function own(req) {
  return Hospital.findOne({ user: req.user.id });
}

function validCity(city) {
  return !city || BANGLADESH_CITIES.includes(city);
}

function validSpecialty(specialty) {
  return SPECIALTIES.includes(specialty);
}

export async function profile(req, res) {
  const h = await own(req);
  if (!h) return res.status(404).json({ message: 'Hospital profile not found' });
  const user = await User.findById(req.user.id).select('-passwordHash -otpHash -otpExpiresAt');
  res.json({ hospital: h, user });
}

export async function updateProfile(req, res) {
  const h = await own(req);
  if (!h) return res.status(404).json({ message: 'Hospital profile not found' });

  if (!validCity(req.body.city)) {
    return res.status(400).json({ message: 'Invalid Bangladesh city/district' });
  }

  for (const k of ['name', 'phone', 'address', 'city', 'location', 'departments', 'emergency']) {
    if (req.body[k] !== undefined) h[k] = req.body[k];
  }

  const user = await User.findById(req.user.id);
  if (!user) return res.status(404).json({ message: 'Hospital user not found' });

  if (req.body.email) {
    const email = req.body.email.toLowerCase().trim();
    const exists = await User.findOne({ email, _id: { $ne: user._id } });
    if (exists) return res.status(409).json({ message: 'Email already registered' });
    user.email = email;
  }

  user.name = h.name;
  user.phone = h.phone;
  await user.save();

  h.email = user.email;
  await h.save();

  res.json({
    hospital: h,
    user: await User.findById(user._id).select('-passwordHash -otpHash -otpExpiresAt'),
  });
}

export async function uploadImage(req, res) {
  if (!req.file) return res.status(400).json({ message: 'Image is required' });
  const h = await own(req);
  if (!h) return res.status(404).json({ message: 'Hospital profile not found' });

  const r = await uploadBuffer(req.file.buffer, 'doctorbd/hospitals', 'image');
  h.image = r.secure_url;
  await h.save();
  await User.findByIdAndUpdate(req.user.id, { avatar: r.secure_url });

  res.json({ hospital: h, url: r.secure_url });
}

export async function changePassword(req, res) {
  const user = await User.findById(req.user.id);
  if (!user || !await bcrypt.compare(req.body.currentPassword || '', user.passwordHash)) {
    return res.status(400).json({ message: 'Current password is incorrect' });
  }
  if (!req.body.newPassword || req.body.newPassword.length < 6) {
    return res.status(400).json({ message: 'New password must be at least 6 characters' });
  }
  user.passwordHash = await bcrypt.hash(req.body.newPassword, 12);
  await user.save();
  res.json({ ok: true });
}

export async function doctors(req, res) {
  const h = await own(req);
  if (!h) return res.status(404).json({ message: 'Hospital profile not found' });
  const items = await Doctor.find({ hospitals: h._id })
    .populate('user', 'email phone')
    .sort({ name: 1 });
  res.json({ items });
}

export async function addDoctor(req, res) {
  const h = await own(req);
  // SEO is admin-only. Never accept SEO data from hospital requests.
  if (Object.prototype.hasOwnProperty.call(req.body, 'seo')) {
    return res.status(403).json({ message: 'Only admin can manage doctor SEO' });
  }
  if (!h) return res.status(404).json({ message: 'Hospital profile not found' });

  const b = req.body;
  if (!b.name || !b.email || !b.password || !b.specialty) {
    return res.status(400).json({ message: 'Name, email, password and specialist are required' });
  }
  if (!validSpecialty(b.specialty)) {
    return res.status(400).json({ message: 'Invalid specialist' });
  }
  if (!validCity(b.city)) {
    return res.status(400).json({ message: 'Invalid Bangladesh city/district' });
  }

  let user = await User.findOne({ email: b.email.toLowerCase().trim() });
  if (user && user.role !== 'doctor') {
    return res.status(409).json({ message: 'Email belongs to another role' });
  }

  if (!user) {
    user = await User.create({
      name: b.name,
      email: b.email.toLowerCase().trim(),
      phone: b.phone,
      passwordHash: await bcrypt.hash(b.password, 12),
      role: 'doctor',
    });
  } else {
    user.name = b.name;
    user.phone = b.phone || user.phone;
    user.passwordHash = await bcrypt.hash(b.password, 12);
    await user.save();
  }

  let d = await Doctor.findOne({ user: user._id });
  if (!d) d = new Doctor({ user: user._id, name: b.name });

  Object.assign(d, {
    name: b.name,
    specialty: b.specialty,
    qualification: b.qualification,
    experience: b.experience,
    address: b.address,
    city: b.city,
    location: b.location,
    fee: Number(b.fee || 0),
    phone: b.phone,
    gender: b.gender,
    bio: normalizeDoctorBio(b.bio),
    scheduleDays: b.scheduleDays || [],
    scheduleStart: b.scheduleStart,
    scheduleEnd: b.scheduleEnd,
    availability: `${(b.scheduleDays || []).join(', ')} ${b.scheduleStart || ''}-${b.scheduleEnd || ''}`.trim(),
    // A doctor has one active chamber in the hospital dashboard.
    hospitals: [h._id],
    chamberHospital: h._id,
    hospital: h.name,
    verified: false,
  });

  // Convert hospital ids back to ObjectIds through the schema cast on save.
  await d.save();

  h.doctors = await Doctor.countDocuments({ hospitals: h._id });
  await h.save();

  await notifyAdmins(
    'NEW_DOCTOR',
    'New Doctor Added',
    `${d.name} was added to ${h.name}.`,
    d._id,
    'Doctor'
  );

  res.status(201).json({ doctor: d });
}

export async function updateDoctor(req, res) {
  const h = await own(req);
  // SEO is admin-only. Never accept SEO data from hospital requests.
  if (Object.prototype.hasOwnProperty.call(req.body, 'seo')) {
    return res.status(403).json({ message: 'Only admin can manage doctor SEO' });
  }
  if (!h) return res.status(404).json({ message: 'Hospital profile not found' });

  const d = await Doctor.findOne({ _id: req.params.id, hospitals: h._id });
  if (!d) return res.status(404).json({ message: 'Doctor not found in your hospital' });

  if (req.body.city !== undefined && !validCity(req.body.city)) {
    return res.status(400).json({ message: 'Invalid Bangladesh city/district' });
  }
  if (req.body.specialty !== undefined && !validSpecialty(req.body.specialty)) {
    return res.status(400).json({ message: 'Invalid specialist' });
  }

  for (const k of [
    'name', 'specialty', 'qualification', 'experience', 'address', 'city',
    'location', 'fee', 'phone', 'gender', 'bio', 'scheduleDays',
    'scheduleStart', 'scheduleEnd'
  ]) {
    if (req.body[k] !== undefined) d[k] = req.body[k];
  }

  if (req.body.scheduleDays !== undefined || req.body.scheduleStart !== undefined || req.body.scheduleEnd !== undefined) {
    d.availability = `${(d.scheduleDays || []).join(', ')} ${d.scheduleStart || ''}-${d.scheduleEnd || ''}`.trim();
  }

  const user = await User.findById(d.user);
  if (user) {
    if (req.body.email) {
      const email = req.body.email.toLowerCase().trim();
      const exists = await User.findOne({ email, _id: { $ne: user._id } });
      if (exists) return res.status(409).json({ message: 'Email already registered' });
      user.email = email;
    }
    if (req.body.password) user.passwordHash = await bcrypt.hash(req.body.password, 12);
    if (d.name) user.name = d.name;
    if (d.phone !== undefined) user.phone = d.phone;
    await user.save();
  }

  d.hospitals = [h._id];
  d.chamberHospital = h._id;
  d.hospital = h.name;
  await d.save();
  res.json({ doctor: d });
}

export async function deleteDoctor(req, res) {
  const h = await own(req);
  if (!h) return res.status(404).json({ message: 'Hospital profile not found' });

  const d = await Doctor.findOne({ _id: req.params.id, hospitals: h._id });
  if (!d) return res.status(404).json({ message: 'Doctor not found in your hospital' });

  d.hospitals = (d.hospitals || []).filter(x => x.toString() !== h._id.toString());

  if (!d.hospitals.length) {
    await Doctor.deleteOne({ _id: d._id });
    if (d.user) await User.deleteOne({ _id: d.user });
  } else {
    await d.save();
  }

  h.doctors = await Doctor.countDocuments({ hospitals: h._id });
  await h.save();

  res.json({ ok: true });
}

export async function uploadDoctorImage(req, res) {
  if (!req.file) return res.status(400).json({ message: 'Image is required' });

  const h = await own(req);
  if (!h) return res.status(404).json({ message: 'Hospital profile not found' });

  const d = await Doctor.findOne({ _id: req.params.id, hospitals: h._id });
  if (!d) return res.status(404).json({ message: 'Doctor not found' });

  const r = await uploadBuffer(req.file.buffer, 'doctorbd/doctors', 'image');
  d.image = r.secure_url;
  await d.save();

  await User.findByIdAndUpdate(d.user, { avatar: r.secure_url });

  res.json({ doctor: d, url: r.secure_url });
}

export async function stats(req, res) {
  const h = await own(req);
  if (!h) return res.status(404).json({ message: 'Hospital profile not found' });

  const filter = { hospital: h._id };

  const [appointments, completed, pending, doctors] = await Promise.all([
    Appointment.countDocuments(filter),
    Appointment.countDocuments({ ...filter, status: 'completed' }),
    Appointment.countDocuments({ ...filter, status: 'waiting' }),
    Doctor.find({ hospitals: h._id }).select('_id name specialty'),
  ]);

  const doctorStats = await Promise.all(
    doctors.map(async d => ({
      doctor: d,
      appointments: await Appointment.countDocuments({ hospital: h._id, doctor: d._id }),
      patients: (await Appointment.distinct('patient', { hospital: h._id, doctor: d._id })).length,
    }))
  );

  res.json({ appointments, completed, pending, doctors: doctors.length, doctorStats });
}

export async function appointments(req, res) {
  const h = await own(req);
  if (!h) return res.status(404).json({ message: 'Hospital profile not found' });

  const items = await Appointment.find({ hospital: h._id })
    .populate('patient', 'name email phone age gender address city avatar')
    .populate('doctor', 'name specialty image phone')
    .sort({ date: -1, createdAt: -1 });

  res.json({ items });
}

export async function createAppointment(req, res) {
  const h = await own(req);
  if (!h) return res.status(404).json({ message: 'Hospital profile not found' });
  const { patientEmail, patientPhone, doctor, date, serial, name, age, phone, gender, address, problem } = req.body;
  if ((!patientEmail && !patientPhone) || !doctor || !date || !serial) {
    return res.status(400).json({ message: 'Patient email/phone, doctor, date and serial are required' });
  }
  const patient = await User.findOne({ role:'patient', ...(patientEmail ? {email:patientEmail.toLowerCase().trim()} : {phone:String(patientPhone).trim()}) });
  if (!patient) return res.status(404).json({ message: 'Patient account not found. Ask the patient to register first.' });
  const d = await Doctor.findOne({ _id:doctor, hospitals:h._id, verified:true });
  if (!d) return res.status(404).json({ message:'Doctor is not assigned to this hospital or is not verified' });
  const [yy,mm,dd] = String(date).split('-').map(Number);
  const requested = new Date(Date.UTC(yy,mm-1,dd));
  if (!yy || !mm || !dd || requested.getUTCFullYear()!==yy || requested.getUTCMonth()!==mm-1 || requested.getUTCDate()!==dd) return res.status(400).json({message:'Invalid appointment date'});
  const day=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][requested.getUTCDay()];
  if (!d.scheduleDays?.includes(day)) return res.status(400).json({message:`Doctor is not available on ${day}`});
  const serialNumber=Number(serial);
  if (!Number.isInteger(serialNumber)||serialNumber<1) return res.status(400).json({message:'Invalid serial number'});
  const exists=await Appointment.findOne({doctor:d._id,date,serial:serialNumber});
  if (exists) return res.status(409).json({message:'This serial is already booked'});
  const ap=await Appointment.create({
    patient:patient._id, doctor:d._id, hospital:h._id, hospitalName:h.name,
    date, serial:serialNumber, status:'waiting', fee:d.fee,
    patientName:name||patient.name, patientAge:age!==undefined&&age!==''?Number(age):patient.age,
    patientPhone:phone||patient.phone, patientGender:gender||patient.gender,
    patientAddress:address||patient.address, problem,
  });
  await notify(d.user,'NEW_APPOINTMENT','Hospital Appointment Created',`${patient.name} was given an appointment for ${date}, serial ${serialNumber}. Hospital/doctor can now manage this appointment.`,ap._id,'Appointment');
  await notify(patient._id,'NEW_APPOINTMENT','Appointment Added',`${h.name} added an appointment with Dr. ${d.name} for ${date}, serial ${serialNumber}. Hospital/doctor can now manage it.`,ap._id,'Appointment');
  res.status(201).json({appointment:ap});
}
export async function updateAppointment(req, res) {
  const h = await own(req);

  if (!h) {
    return res.status(404).json({
      message: 'Hospital profile not found',
    });
  }

  const status = req.body.status;

  if (
    ![
      'confirmed',
      'rejected',
      'completed',
      'cancelled',
    ].includes(status)
  ) {
    return res.status(400).json({
      message: 'Invalid appointment status',
    });
  }

  // ---------------------------------------
  // Confirm / Reject
  // FIRST ONE WINS
  // ---------------------------------------

  if (
    status === 'confirmed' ||
    status === 'rejected'
  ) {
    const update =
      status === 'confirmed'
        ? {
            $set: {
              status: 'confirmed',
              approvedBy: req.user.id,
              approvedByRole: 'hospital',
              approvedAt: new Date(),
            },
          }
        : {
            $set: {
              status: 'rejected',
              approvedBy: req.user.id,
              approvedByRole: 'hospital',
              rejectedAt: new Date(),
            },
          };

    const ap =
      await Appointment.findOneAndUpdate(
        {
          _id: req.params.id,

          hospital: h._id,

          status: 'waiting',
        },

        update,

        {
          new: true,
        }
      )
        .populate(
          'patient',
          'name phone'
        )
        .populate(
          'doctor',
          'name user'
        );

    if (!ap) {
      return res.status(409).json({
        message:
          'This appointment has already been processed by another person.',
      });
    }

    const type =
      status === 'confirmed'
        ? 'APPOINTMENT_CONFIRMED'
        : 'APPOINTMENT_REJECTED';

    const doctorName =
      ap.doctor?.name || 'Doctor';

    const patientMessage =
      status === 'confirmed'
        ? `Hospital ${h.name} confirmed your appointment with Dr. ${doctorName} for ${ap.date}, serial ${ap.serial}.`
        : `Hospital ${h.name} rejected your appointment with Dr. ${doctorName}.`;

    await notify(
      ap.patient._id,
      type,
      status === 'confirmed'
        ? 'Appointment Confirmed'
        : 'Appointment Rejected',
      patientMessage,
      ap._id,
      'Appointment'
    );

    // SMS
    try {
      await sendSms(
        ap.patient?.phone ||
          ap.patientPhone,

        status === 'confirmed'
          ? `DoctorBD: ${h.name} confirmed your appointment with Dr. ${doctorName} on ${ap.date}, serial ${ap.serial}.`
          : `DoctorBD: ${h.name} rejected your appointment with Dr. ${doctorName} on ${ap.date}, serial ${ap.serial}.`
      );
    } catch (error) {
      console.error(
        'Hospital appointment SMS failed:',
        error
      );
    }

    // Notify doctor
    if (ap.doctor?.user) {
      await notify(
        ap.doctor.user,
        type,
        `Hospital ${status} appointment`,
        `${h.name} ${status} ${ap.patient?.name || 'patient'}'s appointment for ${ap.date}, serial ${ap.serial}.`,
        ap._id,
        'Appointment'
      );
    }

    return res.json({
      appointment: ap,
    });
  }

  // ---------------------------------------
  // Complete / Cancel
  // ---------------------------------------

  const ap =
    await Appointment.findOne({
      _id: req.params.id,
      hospital: h._id,
    })
      .populate(
        'patient',
        'name phone'
      )
      .populate(
        'doctor',
        'name user'
      );

  if (!ap) {
    return res.status(404).json({
      message: 'Appointment not found',
    });
  }

  if (
    ['cancelled', 'rejected'].includes(
      ap.status
    ) &&
    status !== ap.status
  ) {
    return res.status(400).json({
      message:
        `Appointment is already ${ap.status}`,
    });
  }

  ap.status = status;

  await ap.save();

  const type =
    status === 'completed'
      ? 'APPOINTMENT_COMPLETED'
      : 'APPOINTMENT_CANCELLED';

  await notify(
    ap.patient._id,
    type,
    `Appointment ${status}`,
    `Hospital ${h.name} ${status} your appointment with Dr. ${ap.doctor?.name || ''}.`,
    ap._id,
    'Appointment'
  );

  return res.json({
    appointment: ap,
  });
}