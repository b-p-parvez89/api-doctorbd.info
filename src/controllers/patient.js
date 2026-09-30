import { notify } from "../utils/notify.js";
import { sendSms } from "../utils/sms.js";
import User from "../models/User.js";
import Appointment from "../models/Appointment.js";
import Prescription from "../models/Prescription.js";
import Doctor from "../models/Doctor.js";
import Hospital from "../models/Hospital.js";

export async function profile(req, res) {
  const u = await User.findById(req.user.id).select(
    "-passwordHash -otpHash -otpExpiresAt",
  );
  if (!u) return res.status(404).json({ message: "Patient not found" });
  res.json({ user: u });
}

export async function appointments(req, res) {
  const items = await Appointment.find({ patient: req.user.id })
    .populate({
      path: "doctor",
      select:
        "name specialty image fee scheduleDays scheduleStart scheduleEnd user",
      populate: { path: "user", select: "name" },
    })
    .populate("hospital", "name city location image")
    .sort({ date: -1, createdAt: -1 });

  res.json({ items });
}

export async function prescriptions(req, res) {
  const items = await Prescription.find({ patient: req.user.id })
    .populate("doctor", "name specialty qualification phone signature")
    .populate("appointment", "date serial problem")
    .sort({ createdAt: -1 });

  res.json({ items });
}

export async function book(req, res) {
  const {
    doctor,
    hospital,
    date,
    serial,
    name,
    age,
    phone,
    gender,
    address,
    problem,
  } = req.body;

  if (
    !doctor ||
    !date ||
    !serial ||
    !name ||
    age === undefined ||
    age === "" ||
    !phone ||
    !gender ||
    !address
  ) {
    return res.status(400).json({
      message:
        "Doctor, date, serial, patient name, age, phone, gender and address are required",
    });
  }

  const d = await Doctor.findOne({
    _id: doctor,
    verified: true,
  });

  if (!d) {
    return res.status(404).json({
      message: "Doctor not found",
    });
  }

  // ---------------------------------------
  // Hospital
  // ---------------------------------------

  let hId = null;
  let hName = "";

  if (hospital) {
    const allowed = await Hospital.findOne({
      _id: hospital,
      verified: true,
    });

    if (
      !allowed ||
      !(d.hospitals || []).some((x) => x.toString() === allowed._id.toString())
    ) {
      return res.status(400).json({
        message: "Selected hospital is not assigned to this doctor",
      });
    }

    hId = allowed._id;
    hName = allowed.name;
  } else if (d.chamberHospital) {
    const chamber = await Hospital.findById(d.chamberHospital).select(
      "name verified",
    );

    if (chamber?.verified) {
      hId = chamber._id;
      hName = chamber.name;
    }
  }

  // ---------------------------------------
  // Validate date
  // ---------------------------------------

  const [yy, mm, dd] = String(date).split("-").map(Number);

  const requested = new Date(Date.UTC(yy, mm - 1, dd));

  if (
    !yy ||
    !mm ||
    !dd ||
    requested.getUTCFullYear() !== yy ||
    requested.getUTCMonth() !== mm - 1 ||
    requested.getUTCDate() !== dd
  ) {
    return res.status(400).json({
      message: "Invalid appointment date",
    });
  }

  const day = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ][requested.getUTCDay()];

  if (!d.scheduleDays?.length || !d.scheduleDays.includes(day)) {
    return res.status(400).json({
      message: `Doctor is not available on ${day}`,
    });
  }

  // ---------------------------------------
  // Bangladesh today
  // ---------------------------------------

  const dh = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const today =
    `${dh.find((x) => x.type === "year").value}-` +
    `${dh.find((x) => x.type === "month").value}-` +
    `${dh.find((x) => x.type === "day").value}`;

  const max = new Date(
    Date.UTC(
      ...today.split("-").map((v, i) => (i === 1 ? Number(v) - 1 : Number(v))),
    ),
  );

  max.setUTCMonth(max.getUTCMonth() + 1);

  const maxStr =
    `${max.getUTCFullYear()}-` +
    `${String(max.getUTCMonth() + 1).padStart(2, "0")}-` +
    `${String(max.getUTCDate()).padStart(2, "0")}`;

  if (date < today || date > maxStr) {
    return res.status(400).json({
      message:
        "Appointment date must be between today and one month from today",
    });
  }

  // ---------------------------------------
  // Serial
  // ---------------------------------------

  const serialNumber = Number(serial);

  if (!Number.isInteger(serialNumber) || serialNumber < 1) {
    return res.status(400).json({
      message: "Invalid serial number",
    });
  }

  const exists = await Appointment.findOne({
    doctor: d._id,
    date,
    serial: serialNumber,
  });

  if (exists) {
    return res.status(409).json({
      message: "This serial is already booked",
    });
  }

  // ---------------------------------------
  // Create appointment
  // ---------------------------------------

  const ap = await Appointment.create({
    patient: req.user.id,

    doctor: d._id,

    hospital: hId || undefined,

    hospitalName: hName,

    date,

    serial: serialNumber,

    status: "waiting",

    fee: d.fee,

    patientName: name,

    patientAge: Number(age),

    patientPhone: phone,

    patientGender: gender,

    patientAddress: address,

    problem,

    approvedBy: null,

    approvedByRole: null,

    approvedAt: null,

    rejectedAt: null,
  });

  // ---------------------------------------
  // Update patient profile
  // ---------------------------------------

  await User.findByIdAndUpdate(req.user.id, {
    name,
    age: Number(age),
    phone,
    gender,
    address,
  });

  // ---------------------------------------
  // Notifications
  // ---------------------------------------

  if (d.user) {
    await notify(
      d.user,
      "NEW_APPOINTMENT",
      "New Appointment Request",
      `${name} requested an appointment for ${date}, serial ${serialNumber}.`,
      ap._id,
      "Appointment",
    );
  }

  await notify(
    req.user.id,
    "NEW_APPOINTMENT",
    "Appointment Submitted",
    `Your appointment with Dr. ${d.name} is waiting for approval.`,
    ap._id,
    "Appointment",
  );

  // ---------------------------------------
  // SMS to patient
  // ---------------------------------------

  const smsMessage =
    `DoctorBD: আপনার সিরিয়াল সফলভাবে বুকিং হয়েছে। ` +
    `${d.name}-এর কাছে ${date} তারিখে সিরিয়াল নম্বর ${serialNumber}। ` +
    `আপনাকে কনফার্মেশন মেসেজ পাঠানো হবে শীঘ্রই।`;
  // SMS failure should NOT cancel appointment
  try {
    await sendSms(phone, smsMessage);
  } catch (error) {
    console.error("Appointment booking SMS failed:", error);
  }

  res.status(201).json({
    appointment: ap,
  });
}

export async function cancel(req, res) {
  const ap = await Appointment.findOne({
    _id: req.params.id,
    patient: req.user.id,
  });

  if (!ap) return res.status(404).json({ message: "Appointment not found" });

  if (["completed", "cancelled", "rejected"].includes(ap.status)) {
    return res.status(400).json({
      message: `Appointment is already ${ap.status}`,
    });
  }

  ap.status = "cancelled";
  await ap.save();

  res.json({ appointment: ap });
}
