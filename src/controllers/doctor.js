import bcrypt from 'bcryptjs';
import { sendSms } from '../utils/sms.js';
import Doctor from '../models/Doctor.js';
import Appointment from '../models/Appointment.js';
import User from '../models/User.js';
import Hospital from '../models/Hospital.js';
import Prescription from '../models/Prescription.js';
import { uploadBuffer } from '../utils/cloudinary.js';
import { notify } from '../utils/notify.js';
import { BANGLADESH_CITIES, SPECIALTIES } from '../utils/cities.js';

async function own(req) {
  return Doctor.findOne({ user: req.user.id });
}

export async function profile(req, res) {
  const d = await own(req);
  if (!d) return res.status(404).json({ message: 'Doctor profile not found' });
  const user = await User.findById(req.user.id).select('-passwordHash -otpHash -otpExpiresAt');
  res.json({ doctor: d, user });
}

export async function updateProfile(req, res) {
  const d = await own(req);
  if (!d) return res.status(404).json({ message: 'Doctor profile not found' });

  if (req.body.city !== undefined && !BANGLADESH_CITIES.includes(req.body.city)) {
    return res.status(400).json({ message: 'Invalid city' });
  }
  if (req.body.specialty !== undefined && !SPECIALTIES.includes(req.body.specialty)) {
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
  if (!user) return res.status(404).json({ message: 'Doctor user not found' });

  if (req.body.email) {
    const email = req.body.email.toLowerCase().trim();
    const exists = await User.findOne({ email, _id: { $ne: user._id } });
    if (exists) return res.status(409).json({ message: 'Email already registered' });
    user.email = email;
  }

  user.name = d.name;
  user.phone = d.phone;
  await user.save();
  await d.save();

  res.json({
    doctor: d,
    user: await User.findById(user._id).select('-passwordHash -otpHash -otpExpiresAt'),
  });
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

export async function uploadSignature(req, res) {
  if (!req.file) return res.status(400).json({ message: 'Signature image is required' });
  const d = await own(req);
  if (!d) return res.status(404).json({ message: 'Doctor profile not found' });
  const r = await uploadBuffer(req.file.buffer, 'doctorbd/signatures', 'image');
  d.signature = r.secure_url;
  await d.save();
  res.json({ doctor: d, url: r.secure_url });
}

export async function uploadImage(req, res) {
  if (!req.file) return res.status(400).json({ message: 'Image is required' });
  const d = await own(req);
  if (!d) return res.status(404).json({ message: 'Doctor profile not found' });

  const r = await uploadBuffer(req.file.buffer, 'doctorbd/doctors', 'image');
  d.image = r.secure_url;
  await d.save();

  await User.findByIdAndUpdate(req.user.id, { avatar: r.secure_url });

  res.json({ doctor: d, url: r.secure_url });
}

export async function hospitals(req, res) {
  const d = await own(req);
  if (!d) return res.status(404).json({ message: 'Doctor profile not found' });
  const chamberId = d.chamberHospital || d.hospitals?.[0];
  res.json({
    hospitals: chamberId ? await Hospital.find({ _id: chamberId }) : [],
  });
}

export async function appointments(req, res) {
  const d = await own(req);
  if (!d) return res.status(404).json({ message: 'Doctor profile not found' });

  res.json({
    items: await Appointment.find({ doctor: d._id })
      .populate('patient', 'name email phone age gender address city avatar')
      .populate('hospital', 'name city location')
      .sort({ date: -1, createdAt: -1 }),
  });
}

export async function updateAppointment(req, res) {
  const d = await own(req);

  if (!d) {
    return res.status(404).json({
      message: 'Doctor profile not found',
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
              approvedBy: d.user,
              approvedByRole: 'doctor',
              approvedAt: new Date(),
            },
          }
        : {
            $set: {
              status: 'rejected',
              approvedBy: d.user,
              approvedByRole: 'doctor',
              rejectedAt: new Date(),
            },
          };

    const ap = await Appointment.findOneAndUpdate(
      {
        _id: req.params.id,

        doctor: d._id,

        // IMPORTANT:
        // only waiting appointment can be
        // approved/rejected
        status: 'waiting',
      },

      update,

      {
        new: true,
      }
    )
      .populate('patient', 'name phone')
      .populate('hospital', 'name');

    // Someone else already approved/rejected
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

    const patientMessage =
      status === 'confirmed'
        ? `Your appointment with Dr. ${d.name} is confirmed for ${ap.date}, serial ${ap.serial}.`
        : `Your appointment with Dr. ${d.name} has been rejected.`;

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
        ap.patient?.phone || ap.patientPhone,
        status === 'confirmed'
          ? `DoctorBD: Appointment confirmed with Dr. ${d.name} on ${ap.date}, serial ${ap.serial}.`
          : `DoctorBD: Your appointment with Dr. ${d.name} on ${ap.date}, serial ${ap.serial} has been rejected.`
      );
    } catch (error) {
      console.error(
        'Doctor appointment SMS failed:',
        error
      );
    }

    // Notify doctor
    await notify(
      d.user,
      type,
      status === 'confirmed'
        ? 'Appointment Approved'
        : 'Appointment Rejected',
      `You ${status} ${ap.patient?.name || 'patient'}'s appointment for ${ap.date}, serial ${ap.serial}.`,
      ap._id,
      'Appointment'
    );

    // Notify hospital
    if (ap.hospital) {
      const hospital =
        await Hospital.findById(
          ap.hospital
        );

      if (hospital?.user) {
        await notify(
          hospital.user,
          type,
          `Appointment ${status}`,
          `Doctor ${d.name} ${status} the appointment for ${ap.date}, serial ${ap.serial}.`,
          ap._id,
          'Appointment'
        );
      }
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
      doctor: d._id,
    })
      .populate('patient', 'name phone')
      .populate('hospital', 'name');

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
    `Your appointment with Dr. ${d.name} is ${status}.`,
    ap._id,
    'Appointment'
  );

  return res.json({
    appointment: ap,
  });
}

export async function patients(req, res) {
  const d = await own(req);
  if (!d) return res.status(404).json({ message: 'Doctor profile not found' });

  const ids = await Appointment.distinct('patient', { doctor: d._id });
  const users = await User.find({ _id: { $in: ids } })
    .select('name email phone age gender address city avatar');

  const items = await Promise.all(
    users.map(async patient => ({
      patient,
      appointments: await Appointment.find({
        doctor: d._id,
        patient: patient._id,
      })
        .populate('hospital', 'name city')
        .sort({ date: -1 }),
      prescriptions: await Prescription.find({
        doctor: d._id,
        patient: patient._id,
      }).sort({ createdAt: -1 }),
    }))
  );

  res.json({ items });
}

export async function prescriptions(req, res) {
  const d = await own(req);
  if (!d) return res.status(404).json({ message: 'Doctor profile not found' });

  const q = { doctor: d._id };
  if (req.query.patient) q.patient = req.query.patient;

  res.json({
    items: await Prescription.find(q)
      .populate('patient', 'name phone age gender address')
      .populate('appointment', 'date serial problem')
      .populate('doctor', 'name qualification specialty phone signature')
      .sort({ createdAt: -1 }),
  });
}

export async function addPrescription(req, res) {
  const d = await own(req);
  if (!d) return res.status(404).json({ message: 'Doctor profile not found' });

  const ap = await Appointment.findOne({
    _id: req.body.appointment,
    doctor: d._id,
    patient: req.body.patient,
  });

  if (!ap) {
    return res.status(403).json({
      message: 'Patient is not associated with your appointment',
    });
  }

  const p = await Prescription.create({
    doctor: d._id,
    patient: req.body.patient,
    appointment: ap._id,
    diagnosis: req.body.diagnosis,
    notes: req.body.notes,
    medicines: req.body.medicines || [],
  });

  await notify(
    p.patient,
    'PRESCRIPTION_ADDED',
    'New Prescription',
    'A doctor added a prescription to your account.',
    p._id,
    'Prescription'
  );

  res.status(201).json({ prescription: p });
}

export async function updatePrescription(req, res) {
  const d = await own(req);
  if (!d) return res.status(404).json({ message: 'Doctor profile not found' });

  const p = await Prescription.findOne({
    _id: req.params.id,
    doctor: d._id,
  });

  if (!p) return res.status(404).json({ message: 'Prescription not found' });

  Object.assign(p, {
    diagnosis: req.body.diagnosis,
    notes: req.body.notes,
    medicines: req.body.medicines || [],
  });

  await p.save();
  res.json({ prescription: p });
}
