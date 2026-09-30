import bcrypt from "bcryptjs";
import { sendSms } from "../utils/sms.js";

import User from "../models/User.js";
import Doctor from "../models/Doctor.js";
import Hospital from "../models/Hospital.js";
import Appointment from "../models/Appointment.js";
import Payment from "../models/Payment.js";

import { notify, notifyAdmins } from "../utils/notify.js";

import { uploadBuffer } from "../utils/cloudinary.js";
import { uniqueSlug } from "../utils/slug.js";
import { BANGLADESH_CITIES, SPECIALTIES } from "../utils/cities.js";

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

// --------------------------------------------------
// Helpers
// --------------------------------------------------

function cityOk(city) {
  return !city || BANGLADESH_CITIES.includes(city);
}

async function syncHospitalCount(id) {
  const h = await Hospital.findById(id);

  if (h) {
    h.doctors = await Doctor.countDocuments({
      hospitals: id,
    });

    await h.save();
  }
}

// --------------------------------------------------
// Admin Stats
// --------------------------------------------------

export async function stats(req, res) {
  const [users, doctors, hospitals, appointments, completed] =
    await Promise.all([
      User.countDocuments(),
      Doctor.countDocuments(),
      Hospital.countDocuments(),
      Appointment.countDocuments(),
      Appointment.countDocuments({
        status: "completed",
      }),
    ]);

  const payments = await Payment.find().select("amount");

  const paid = payments.reduce((a, p) => a + (p.amount || 0), 0);

  res.json({
    users,
    doctors,
    hospitals,
    appointments,
    completed,
    paid,
  });
}

// --------------------------------------------------
// Hospital
// --------------------------------------------------

export async function createHospital(req, res) {
  const hospitalLoginUrl = `${process.env.DOCTORBD_WEB_URL}/login`;
  const {
    name,
    email,
    password,
    phone,
    address,
    city,
    location,
    departments = [],
    emergency = false,
    image,
    seo,
  } = req.body;

  const normalizedEmail = String(email || "")
    .trim()
    .toLowerCase();

  if (!String(name || "").trim() || !normalizedEmail || !password) {
    return res.status(400).json({
      message: "Hospital name, email and password are required",
    });
  }

  if (!cityOk(city)) {
    return res.status(400).json({
      message: "Select a valid Bangladesh city/district",
    });
  }

  const existing = await User.findOne({ email: normalizedEmail });
  if (existing) {
    return res.status(409).json({
      message: "Email already registered",
    });
  }

  const u = await User.create({
    name: String(name).trim(),
    email: normalizedEmail,
    phone,
    passwordHash: await bcrypt.hash(String(password), 12),
    role: "hospital",
  });

  try {
    const hospitalSlug = await uniqueSlug(Hospital, String(name).trim());
    const h = await Hospital.create({
      user: u._id,
      name: String(name).trim(),
      slug: hospitalSlug,
      email: normalizedEmail,
      phone,
      address,
      city,
      location,
      departments: Array.isArray(departments) ? departments : [],
      emergency: !!emergency,
      image: typeof image === "string" ? image : undefined,
      seo: seo && typeof seo === "object" ? seo : undefined,
      verified: true,
    });
    // Send SMS to hospital after successful creation
    if (phone) {
      const hospitalLoginUrl = `${process.env.DOCTORBD_WEB_URL}/login`;

      const smsMessage =
        `DoctorBD: আপনার Hospital Account তৈরি হয়েছে। ` +
        `Login: ${hospitalLoginUrl} ` +
        `Email: ${normalizedEmail} ` +
        `Password: ${String(password)} ` +
        `Login করার পর আপনার Hospital Profile আপডেট করুন। ` +
        `ধন্যবাদ - DoctorBD`;

      try {
        await sendSms(phone, smsMessage);
        console.log("Hospital account SMS sent:", phone);
      } catch (error) {
        console.error("Hospital account SMS failed:", error);
      }
    }
    await notifyAdmins(
      "NEW_HOSPITAL",
      "New Hospital Created",
      `${h.name} has been added by an admin.`,
      h._id,
      "Hospital",
    );

    return res.status(201).json({ hospital: h });
  } catch (error) {
    // Do not leave a login account behind when hospital creation fails.
    await User.deleteOne({ _id: u._id }).catch(() => {});
    throw error;
  }
}

export async function listHospitals(req, res) {
  const q = req.query.search
    ? {
        $or: [
          {
            name: new RegExp(req.query.search, "i"),
          },
          {
            city: new RegExp(req.query.search, "i"),
          },
          {
            location: new RegExp(req.query.search, "i"),
          },
        ],
      }
    : {};

  res.json({
    items: await Hospital.find(q).populate("user", "name email phone").sort({
      name: 1,
    }),
  });
}

export async function getHospital(req, res) {
  const h = await Hospital.findById(req.params.id).populate(
    "user",
    "name email phone",
  );

  if (!h) {
    return res.status(404).json({
      message: "Hospital not found",
    });
  }

  res.json({
    hospital: h,
  });
}

export async function updateHospital(req, res) {
  const h = await Hospital.findById(req.params.id);

  if (!h) {
    return res.status(404).json({
      message: "Hospital not found",
    });
  }

  if (req.body.city && !cityOk(req.body.city)) {
    return res.status(400).json({
      message: "Invalid Bangladesh city/district",
    });
  }

  if (req.body.name && req.body.name !== h.name) {
    h.slug = await uniqueSlug(Hospital, req.body.name, h._id);
  }

  const fields = [
    "name",
    "email",
    "phone",
    "address",
    "city",
    "location",
    "departments",
    "emergency",
    "image",
    "seo",
  ];

  for (const k of fields) {
    if (req.body[k] !== undefined) {
      h[k] = req.body[k];
    }
  }

  if (req.body.email) {
    const email = req.body.email.toLowerCase();

    const x = await User.findOne({
      email,
      _id: {
        $ne: h.user,
      },
    });

    if (x) {
      return res.status(409).json({
        message: "Email already registered",
      });
    }

    h.email = email;

    await User.findByIdAndUpdate(h.user, {
      email,
      name: h.name,
      phone: h.phone,
    });
  }

  await h.save();

  res.json({
    hospital: h,
  });
}

export async function deleteHospital(req, res) {
  const h = await Hospital.findById(req.params.id);

  if (!h) {
    return res.status(404).json({
      message: "Hospital not found",
    });
  }

  const doctors = await Doctor.find({
    hospitals: h._id,
  }).select("_id user");

  await Doctor.updateMany(
    {
      hospitals: h._id,
    },
    {
      $pull: {
        hospitals: h._id,
      },
    },
  );

  await Appointment.deleteMany({
    hospital: h._id,
  });

  await Hospital.deleteOne({
    _id: h._id,
  });

  if (h.user) {
    await User.deleteOne({
      _id: h.user,
    });
  }

  for (const d of doctors) {
    await syncHospitalCount(d._id);
  }

  res.json({
    ok: true,
  });
}

export async function uploadHospitalImage(req, res) {
  if (!req.file) {
    return res.status(400).json({ message: "Image is required" });
  }

  const hospital = await Hospital.findById(req.params.id).select("slug");
  if (!hospital) {
    return res.status(404).json({ message: "Hospital not found" });
  }

  const r = await uploadBuffer(
    req.file.buffer,
    `doctorbd/hospitals/${hospital.slug || req.params.id}`,
    "image",
    "profile",
  );

  const h = await Hospital.findByIdAndUpdate(
    req.params.id,
    {
      image: r.secure_url,
    },
    {
      new: true,
    },
  );

  if (!h) {
    return res.status(404).json({
      message: "Hospital not found",
    });
  }

  res.json({
    hospital: h,
    url: r.secure_url,
  });
}

// --------------------------------------------------
// Doctors
// --------------------------------------------------

export async function listDoctors(req, res) {
  const q = {};

  if (req.query.specialty) {
    q.specialty = new RegExp(req.query.specialty, "i");
  }

  if (req.query.city) {
    q.city = new RegExp(req.query.city, "i");
  }

  if (req.query.hospital) {
    q.hospitals = req.query.hospital;
  }

  res.json({
    items: await Doctor.find(q)
      .populate("hospitals", "name city location")
      .populate("user", "name email phone")
      .sort({
        name: 1,
      }),
  });
}

export async function getDoctor(req, res) {
  const d = await Doctor.findById(req.params.id)
    .populate("hospitals", "name city location phone")
    .populate("user", "name email phone");

  if (!d) {
    return res.status(404).json({
      message: "Doctor not found",
    });
  }

  const [appointments, patients] = await Promise.all([
    Appointment.countDocuments({
      doctor: d._id,
    }),

    Appointment.distinct("patient", {
      doctor: d._id,
      status: {
        $in: ["confirmed", "completed"],
      },
    }),
  ]);

  res.json({
    doctor: d,

    stats: {
      appointments,
      patients: patients.length,
    },
  });
}

async function createOrUpdateDoctor(req, id = null) {
   const isNewDoctor = !id;
  const body = req.body || {};
  const {
    name,
    email,
    password,
    specialty,
    qualification,
    experience,
    address,
    city,
    location,
    fee,
    image,
    gender,
    phone,
    bio,
    scheduleDays = [],
    scheduleStart,
    scheduleEnd,
    seo,
  } = body;

  const normalizedEmail = String(email || "")
    .trim()
    .toLowerCase();
  const hospitalIds = Array.isArray(body.hospitals)
    ? [...new Set(body.hospitals.map((x) => String(x).trim()).filter(Boolean))]
    : [];

  if (!String(name || "").trim() || !normalizedEmail || !specialty) {
    return { error: "Name, email and specialist are required" };
  }

  if (!SPECIALTIES.includes(specialty)) {
    return { error: "Invalid specialist" };
  }

  if (!cityOk(city)) {
    return { error: "Invalid Bangladesh city/district" };
  }

  // A doctor may only be assigned to real hospitals.
  let validHospitals = [];
  if (hospitalIds.length) {
    validHospitals = await Hospital.find({
      _id: { $in: hospitalIds },
    }).select("_id name");

    if (validHospitals.length !== hospitalIds.length) {
      return { error: "One or more selected hospitals do not exist" };
    }
  }

  let d = id ? await Doctor.findById(id) : null;
  if (id && !d) return { error: "Doctor not found" };
  const oldHospitalIds = d ? (d.hospitals || []).map((x) => x.toString()) : [];

  let u = d
    ? await User.findById(d.user)
    : await User.findOne({ email: normalizedEmail });

  if (u && u.role !== "doctor") {
    return { error: "Email belongs to another role" };
  }

  if (!u) {
    if (!password) {
      return { error: "Password is required for a new doctor" };
    }

    u = await User.create({
      name: String(name).trim(),
      email: normalizedEmail,
      phone,
      passwordHash: await bcrypt.hash(String(password), 12),
      role: "doctor",
    });
  } else {
    const emailOwner = await User.findOne({
      email: normalizedEmail,
      _id: { $ne: u._id },
    });

    if (emailOwner) {
      return { error: "Email already registered" };
    }

    if (!id && u.role === "doctor") {
      return { error: "A doctor already uses this email" };
    }

    u.name = String(name).trim();
    u.email = normalizedEmail;
    if (phone !== undefined) u.phone = phone;
    if (password) u.passwordHash = await bcrypt.hash(String(password), 12);
    await u.save();
  }

  if (!d) {
    d = new Doctor({ user: u._id, name: String(name).trim() });
    d.slug = await uniqueSlug(Doctor, String(name).trim());
  } else if (String(name).trim() !== d.name) {
    d.slug = await uniqueSlug(Doctor, String(name).trim(), d._id);
  }

  const days = Array.isArray(scheduleDays) ? scheduleDays : [];

  Object.assign(d, {
    user: u._id,
    name: String(name).trim(),
    specialty,
    qualification,
    experience:
      experience === "" || experience == null ? undefined : Number(experience),
    address,
    city,
    location,
    fee: fee === "" || fee == null ? 0 : Number(fee),
    image: typeof image === "string" ? image : d.image,
    gender,
    phone,
    bio,
    hospitals: validHospitals.map((h) => h._id),
    chamberHospital: validHospitals[0]?._id || undefined,
    hospital: validHospitals[0]?.name || "",
    scheduleDays: days,
    scheduleStart,
    scheduleEnd,
    availability: days.length
      ? `${days.join(", ")} ${scheduleStart || ""}-${scheduleEnd || ""}`.trim()
      : "Not scheduled",
    seo:
      seo && typeof seo === "object"
        ? {
            title: String(seo.title || ""),
            description: String(seo.description || ""),
            keywords: String(seo.keywords || ""),
            ogTitle: String(seo.ogTitle || ""),
            ogDescription: String(seo.ogDescription || ""),
            ogImage: String(seo.ogImage || ""),
            canonical: String(seo.canonical || ""),
            robots: String(seo.robots || "index,follow"),
          }
        : d.seo,
  });

  await d.save();

  // Keep both old and new hospital counters accurate when assignments change.
  const countHospitalIds = [...new Set([...oldHospitalIds, ...hospitalIds])];
  await Promise.all(countHospitalIds.map(syncHospitalCount));

  return { d };
}

export async function createDoctor(req, res) {
  const x = await createOrUpdateDoctor(req);

  if (x.error) {
    return res.status(400).json({
      message: x.error,
    });
  }

  await Promise.all((x.d.hospitals || []).map(syncHospitalCount));

  await notifyAdmins(
    "NEW_DOCTOR",
    "New Doctor Added",
    `${x.d.name} was created by an admin.`,
    x.d._id,
    "Doctor",
  );

  res.status(201).json({
    doctor: x.d,
  });
}

export async function updateDoctor(req, res) {
  const x = await createOrUpdateDoctor(req, req.params.id);

  if (x.error) {
    return res.status(400).json({
      message: x.error,
    });
  }

  res.json({
    doctor: x.d,
  });
}

export async function deleteDoctor(req, res) {
  const d = await Doctor.findById(req.params.id);

  if (!d) {
    return res.status(404).json({
      message: "Doctor not found",
    });
  }

  await Doctor.deleteOne({
    _id: d._id,
  });

  if (d.user) {
    await User.deleteOne({
      _id: d.user,
    });
  }

  await Promise.all((d.hospitals || []).map(syncHospitalCount));

  res.json({
    ok: true,
  });
}

export async function uploadDoctorImage(req, res) {
  if (!req.file) {
    return res.status(400).json({
      message: "Image is required",
    });
  }

  const doctor = await Doctor.findById(req.params.id).select("slug user");
  if (!doctor) {
    return res.status(404).json({ message: "Doctor not found" });
  }

  const r = await uploadBuffer(
    req.file.buffer,
    `doctorbd/doctors/${doctor.slug || req.params.id}`,
    "image",
    "profile",
  );

  const d = await Doctor.findByIdAndUpdate(
    req.params.id,
    {
      image: r.secure_url,
    },
    {
      new: true,
    },
  );

  if (!d) {
    return res.status(404).json({
      message: "Doctor not found",
    });
  }

  await User.findByIdAndUpdate(d.user, {
    avatar: r.secure_url,
  });

  res.json({
    doctor: d,
    url: r.secure_url,
  });
}

// --------------------------------------------------
// Doctor / Hospital Verification
// --------------------------------------------------

export async function verifyDoctor(req, res) {
  const doctorLoginUrl =
      `${process.env.DOCTORBD_WEB_URL}/login`;
  const d = await Doctor.findByIdAndUpdate(
    req.params.id,
    {
      verified: !!req.body.verified,
    },
    {
      new: true,
    },
  );
const u = await User.findById(d.user);
  if (!d) {
    return res.status(404).json({
      message: "Doctor not found",
    });
  }

  if (d.user) {
    await notify(
      d.user,

      req.body.verified ? "DOCTOR_APPROVED" : "DOCTOR_REJECTED",

      req.body.verified ? "Doctor Approved" : "Doctor Rejected",

      req.body.verified
        ? "Your doctor profile has been approved."
        : "Your doctor profile was rejected.",

      d._id,
      "Doctor",
    );
  }
if (d.phone || u?.phone) {
    const phone = d.phone || u.phone;

    const doctorLoginUrl =
      `${process.env.DOCTORBD_WEB_URL}/login`;

    const smsMessage =
      `DoctorBD: অভিনন্দন ${d.name}। ` +
      `আপনার Doctor Account অনুমোদিত হয়েছে। ` +
      `Login: ${doctorLoginUrl} ` +
      `Email: ${u?.email || d.email || ""} ` +
      `Password: ${u?.password || "your password"} ` +
      `আপনার Profile-এ Login করে প্রয়োজনীয় তথ্য আপডেট করুন। ` +
      `ধন্যবাদ - DoctorBD`;

    try {
      await sendSms(phone, smsMessage);

      console.log(
        "Doctor approval SMS sent:",
        phone
      );
    } catch (error) {
      console.error(
        "Doctor approval SMS failed:",
        error
      );
    }
  }
  res.json({
    doctor: d,
  });
}

export async function verifyHospital(req, res) {
  const h = await Hospital.findByIdAndUpdate(
    req.params.id,
    {
      verified: !!req.body.verified,
    },
    {
      new: true,
    },
  );

  if (!h) {
    return res.status(404).json({
      message: "Hospital not found",
    });
  }

  if (h.user) {
    await notify(
      h.user,

      req.body.verified ? "HOSPITAL_APPROVED" : "HOSPITAL_REJECTED",

      req.body.verified ? "Hospital Approved" : "Hospital Rejected",

      req.body.verified
        ? "Your hospital profile has been approved."
        : "Your hospital profile was rejected.",

      h._id,
      "Hospital",
    );
  }

  res.json({
    hospital: h,
  });
}

// --------------------------------------------------
// ALL APPOINTMENTS
// --------------------------------------------------

export async function allAppointments(req, res) {
  const items = await Appointment.find()
    .populate("patient", "name email phone")
    .populate("doctor", "name specialty")
    .populate("hospital", "name city")
    .sort({
      createdAt: -1,
    });

  res.json({
    items,
  });
}

// --------------------------------------------------
// ADMIN APPOINTMENT UPDATE
//
// Doctor / Hospital / Admin
// যেকোনো একজন approve/reject করতে পারবে.
//
// IMPORTANT:
// status: waiting condition থাকার কারণে
// FIRST ONE WINS.
// --------------------------------------------------

export async function updateAppointment(req, res) {
  const status = req.body.status;

  if (!["confirmed", "rejected", "completed", "cancelled"].includes(status)) {
    return res.status(400).json({
      message: "Invalid appointment status",
    });
  }

  // ==================================================
  // CONFIRM / REJECT
  // ==================================================

  if (status === "confirmed" || status === "rejected") {
    const update =
      status === "confirmed"
        ? {
            $set: {
              status: "confirmed",

              approvedBy: req.user.id,

              approvedByRole: "admin",

              approvedAt: new Date(),

              rejectedAt: null,
            },
          }
        : {
            $set: {
              status: "rejected",

              approvedBy: req.user.id,

              approvedByRole: "admin",

              rejectedAt: new Date(),

              approvedAt: null,
            },
          };

    // ----------------------------------------------
    // ATOMIC UPDATE
    // ----------------------------------------------

    const ap = await Appointment.findOneAndUpdate(
      {
        _id: req.params.id,

        // VERY IMPORTANT
        // only waiting appointment
        // can be processed
        status: "waiting",
      },

      update,

      {
        new: true,
      },
    )
      .populate("patient", "name phone")
      .populate("doctor", "name specialty user")
      .populate("hospital", "name city user");

    // ----------------------------------------------
    // Already processed by Doctor/Hospital/Admin
    // ----------------------------------------------

    if (!ap) {
      return res.status(409).json({
        message:
          "This appointment has already been processed by another person.",
      });
    }

    const type =
      status === "confirmed" ? "APPOINTMENT_CONFIRMED" : "APPOINTMENT_REJECTED";

    const doctorName = ap.doctor?.name || "Doctor";

    // ----------------------------------------------
    // Patient notification
    // ----------------------------------------------

    const patientMessage =
      status === "confirmed"
        ? `Admin confirmed your appointment with Dr. ${doctorName} for ${ap.date}, serial ${ap.serial}.`
        : `Admin rejected your appointment with Dr. ${doctorName} for ${ap.date}, serial ${ap.serial}.`;

    await notify(
      ap.patient._id,

      type,

      status === "confirmed" ? "Appointment Confirmed" : "Appointment Rejected",

      patientMessage,

      ap._id,

      "Appointment",
    );

    // ----------------------------------------------
    // Patient SMS
    // ----------------------------------------------

    try {
      const sms =
        status === "confirmed"
          ? `DoctorBD: Your appointment with Dr. ${doctorName} on ${ap.date}, serial ${ap.serial} has been confirmed by admin.`
          : `DoctorBD: Your appointment with Dr. ${doctorName} on ${ap.date}, serial ${ap.serial} has been rejected by admin.`;

      await sendSms(
        ap.patient?.phone || ap.patientPhone,

        sms,
      );
    } catch (error) {
      console.error("Admin appointment SMS failed:", error);
    }

    // ----------------------------------------------
    // Notify Doctor
    // ----------------------------------------------

    if (ap.doctor?.user) {
      await notify(
        ap.doctor.user,

        type,

        `Appointment ${status}`,

        `Admin ${status} ${ap.patient?.name || "patient"}'s appointment for ${ap.date}, serial ${ap.serial}.`,

        ap._id,

        "Appointment",
      );
    }

    // ----------------------------------------------
    // Notify Hospital
    // ----------------------------------------------

    if (ap.hospital?.user) {
      await notify(
        ap.hospital.user,

        type,

        `Appointment ${status}`,

        `Admin ${status} ${ap.patient?.name || "patient"}'s appointment for ${ap.date}, serial ${ap.serial}.`,

        ap._id,

        "Appointment",
      );
    }

    return res.json({
      appointment: ap,
    });
  }

  // ==================================================
  // COMPLETE / CANCEL
  // ==================================================

  const ap = await Appointment.findById(req.params.id)
    .populate("patient", "name phone")
    .populate("doctor", "name specialty")
    .populate("hospital", "name city");

  if (!ap) {
    return res.status(404).json({
      message: "Appointment not found",
    });
  }

  if (["cancelled", "rejected"].includes(ap.status) && status !== ap.status) {
    return res.status(400).json({
      message: `Appointment is already ${ap.status}`,
    });
  }

  ap.status = status;

  await ap.save();

  const type =
    status === "completed" ? "APPOINTMENT_COMPLETED" : "APPOINTMENT_CANCELLED";

  await notify(
    ap.patient._id,

    type,

    `Appointment ${status}`,

    `Your appointment with Dr. ${ap.doctor?.name || ""} is ${status}.`,

    ap._id,

    "Appointment",
  );

  return res.json({
    appointment: ap,
  });
}

// --------------------------------------------------
// Users
// --------------------------------------------------

export async function listUsers(req, res) {
  const q = {};

  if (req.query.role) {
    q.role = req.query.role;
  }

  if (req.query.search) {
    q.$or = [
      {
        name: new RegExp(req.query.search, "i"),
      },
      {
        email: new RegExp(req.query.search, "i"),
      },
      {
        phone: new RegExp(req.query.search, "i"),
      },
    ];
  }

  const items = await User.find(q)
    .select("-passwordHash -otpHash -otpExpiresAt")
    .sort({
      createdAt: -1,
    });

  res.json({
    items,
  });
}

// --------------------------------------------------
// User Status
// --------------------------------------------------

export async function updateUserStatus(req, res) {
  const user = await User.findById(req.params.id);

  if (!user) {
    return res.status(404).json({
      message: "User not found",
    });
  }

  if (user.role === "admin" && user._id.toString() === req.user.id.toString()) {
    return res.status(400).json({
      message: "You cannot suspend your own admin account",
    });
  }

  user.active = req.body.active !== false;

  await user.save();

  res.json({
    user: await User.findById(user._id).select(
      "-passwordHash -otpHash -otpExpiresAt",
    ),
  });
}