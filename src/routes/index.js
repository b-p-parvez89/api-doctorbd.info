import { Router } from "express";
import multer from "multer";

import {
  register,
  login,
  me,
  updateProfile,
  changePassword,
  uploadAvatar,

  // Existing logged-in phone OTP
  requestPhoneOtp,
  verifyPhoneOtp,

  // Registration phone OTP
  verifyRegistrationPhone,
  resendRegistrationPhoneOtp,
  requestPasswordResetOtp,
  verifyPasswordResetOtp,
  resetPasswordByPhone,
} from "../controllers/auth.js";

import * as pub from "../controllers/public.js";
import * as admin from "../controllers/admin.js";
import * as hosp from "../controllers/hospital.js";
import * as doc from "../controllers/doctor.js";
import * as patient from "../controllers/patient.js";
import * as comm from "../controllers/communication.js";
import * as notif from "../controllers/notifications.js";
import { auth, roles } from "../utils/auth.js";
import * as contact from "../controllers/contact.js";

const r = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024,
  },
});


/* =========================================================
   AUTH
   ========================================================= */

/*
 * Register
 */
r.post(
  "/auth/register",
  register
);


/*
 * Registration phone verification
 *
 * IMPORTANT:
 * এখানে auth middleware নেই।
 *
 * কারণ registration-এর পরে user এখনো login করেনি।
 */
r.post(
  "/auth/verify-phone",
  verifyRegistrationPhone
);


/*
 * Registration OTP resend
 *
 * IMPORTANT:
 * এখানেও auth middleware নেই।
 */
r.post(
  "/auth/resend-phone-otp",
  resendRegistrationPhoneOtp
);


/*
 * Login
 */
r.post(
  "/auth/login",
  login
);


/* =========================================================
   PASSWORD RESET BY PHONE OTP
   ========================================================= */

r.post(
  "/auth/forgot-password/request-otp",
  requestPasswordResetOtp
);

r.post(
  "/auth/forgot-password/verify-otp",
  verifyPasswordResetOtp
);

r.post(
  "/auth/forgot-password/reset",
  resetPasswordByPhone
);


/*
 * Current user
 */
r.get(
  "/auth/me",
  auth,
  me
);


/*
 * Update profile
 */
r.patch(
  "/auth/profile",
  auth,
  updateProfile
);


/*
 * Change password
 */
r.patch(
  "/auth/password",
  auth,
  changePassword
);


/*
 * Upload avatar
 */
r.post(
  "/auth/avatar",
  auth,
  upload.single("file"),
  uploadAvatar
);


/* =========================================================
   LOGGED-IN PATIENT PHONE VERIFICATION
   ========================================================= */

/*
 * Request OTP
 *
 * This is for an already logged-in patient.
 */
r.post(
  "/auth/phone/request-otp",
  auth,
  roles("patient"),
  requestPhoneOtp
);


/*
 * Verify OTP
 *
 * This is for an already logged-in patient.
 */
r.post(
  "/auth/phone/verify-otp",
  auth,
  roles("patient"),
  verifyPhoneOtp
);


/* =========================================================
   PUBLIC
   ========================================================= */

r.get(
  "/meta",
  pub.meta
);

r.get(
  "/doctors",
  pub.doctors
);

r.get(
  "/doctors/:id",
  pub.doctor
);

r.get(
  "/hospitals",
  pub.hospitals
);

r.get(
  "/hospitals/:id",
  pub.hospital
);

r.get(
  "/schedules/:doctorId",
  pub.schedule
);


/* =========================================================
   APPOINTMENTS
   ========================================================= */

r.get(
  "/appointments",
  auth,
  roles(
    "patient",
    "doctor",
    "hospital",
    "admin"
  ),
  async (req, res) => {
    if (req.user.role === "patient") {
      return patient.appointments(
        req,
        res
      );
    }

    if (req.user.role === "doctor") {
      return doc.appointments(
        req,
        res
      );
    }

    if (req.user.role === "hospital") {
      return hosp.appointments(
        req,
        res
      );
    }

    return admin.allAppointments(
      req,
      res
    );
  }
);


r.post(
  "/appointments",
  auth,
  roles("patient"),
  patient.book
);


r.patch(
  "/appointments/:id/cancel",
  auth,
  roles("patient"),
  patient.cancel
);


/* =========================================================
   ADMIN APPOINTMENTS
   ========================================================= */

r.patch(
  "/admin/appointments/:id",
  auth,
  roles("admin"),
  admin.updateAppointment
);


/* =========================================================
   DOCTORBD CONTACT / SUPPORT
   ========================================================= */

/*
 * Guest + logged-in user can contact DoctorBD
 */
r.post(
  "/contact",
  contact.createContact
);


/*
 * Logged-in user / doctor / hospital
 * can see own messages
 */
r.get(
  "/contact/my",
  auth,
  roles(
    "patient",
    "doctor",
    "hospital"
  ),
  contact.myContacts
);


/*
 * Admin contact management
 */
r.get(
  "/admin/contacts",
  auth,
  roles("admin"),
  contact.adminContacts
);

r.get(
  "/admin/contacts/:id",
  auth,
  roles("admin"),
  contact.adminGetContact
);

r.patch(
  "/admin/contacts/:id",
  auth,
  roles("admin"),
  contact.adminUpdateContact
);


/* =========================================================
   NOTIFICATIONS
   ========================================================= */

r.get(
  "/notifications",
  auth,
  notif.list
);

r.patch(
  "/notifications/:id/read",
  auth,
  notif.read
);

r.patch(
  "/notifications/read-all",
  auth,
  notif.readAll
);


/* =========================================================
   ADMIN
   ========================================================= */

r.get(
  "/admin/stats",
  auth,
  roles("admin"),
  admin.stats
);


r.get(
  "/admin/users",
  auth,
  roles("admin"),
  admin.listUsers
);


r.patch(
  "/admin/users/:id/status",
  auth,
  roles("admin"),
  admin.updateUserStatus
);


/* =========================================================
   ADMIN HOSPITALS
   ========================================================= */

r.get(
  "/admin/hospitals",
  auth,
  roles("admin"),
  admin.listHospitals
);


r.post(
  "/admin/hospitals",
  auth,
  roles("admin"),
  admin.createHospital
);


r.get(
  "/admin/hospitals/:id",
  auth,
  roles("admin"),
  admin.getHospital
);


r.patch(
  "/admin/hospitals/:id",
  auth,
  roles("admin"),
  admin.updateHospital
);


r.delete(
  "/admin/hospitals/:id",
  auth,
  roles("admin"),
  admin.deleteHospital
);


r.post(
  "/admin/hospitals/:id/image",
  auth,
  roles("admin"),
  upload.single("file"),
  admin.uploadHospitalImage
);


r.patch(
  "/admin/hospitals/:id/verify",
  auth,
  roles("admin"),
  admin.verifyHospital
);


/* =========================================================
   ADMIN DOCTORS
   ========================================================= */

r.get(
  "/admin/doctors",
  auth,
  roles("admin"),
  admin.listDoctors
);


r.post(
  "/admin/doctors",
  auth,
  roles("admin"),
  admin.createDoctor
);


r.get(
  "/admin/doctors/:id",
  auth,
  roles("admin"),
  admin.getDoctor
);


r.patch(
  "/admin/doctors/:id",
  auth,
  roles("admin"),
  admin.updateDoctor
);


r.delete(
  "/admin/doctors/:id",
  auth,
  roles("admin"),
  admin.deleteDoctor
);


r.post(
  "/admin/doctors/:id/image",
  auth,
  roles("admin"),
  upload.single("file"),
  admin.uploadDoctorImage
);


r.patch(
  "/admin/doctors/:id/verify",
  auth,
  roles("admin"),
  admin.verifyDoctor
);


/* =========================================================
   ADMIN ALL APPOINTMENTS
   ========================================================= */

r.get(
  "/admin/appointments",
  auth,
  roles("admin"),
  admin.allAppointments
);


/* =========================================================
   HOSPITAL
   ========================================================= */

r.get(
  "/hospital/profile",
  auth,
  roles("hospital"),
  hosp.profile
);


r.patch(
  "/hospital/profile",
  auth,
  roles("hospital"),
  hosp.updateProfile
);


r.post(
  "/hospital/profile/image",
  auth,
  roles("hospital"),
  upload.single("file"),
  hosp.uploadImage
);


r.patch(
  "/hospital/password",
  auth,
  roles("hospital"),
  hosp.changePassword
);


r.get(
  "/hospital/stats",
  auth,
  roles("hospital"),
  hosp.stats
);


r.get(
  "/hospital/doctors",
  auth,
  roles("hospital"),
  hosp.doctors
);


r.post(
  "/hospital/doctors",
  auth,
  roles("hospital"),
  hosp.addDoctor
);


r.patch(
  "/hospital/doctors/:id",
  auth,
  roles("hospital"),
  hosp.updateDoctor
);


r.delete(
  "/hospital/doctors/:id",
  auth,
  roles("hospital"),
  hosp.deleteDoctor
);


r.post(
  "/hospital/doctors/:id/image",
  auth,
  roles("hospital"),
  upload.single("file"),
  hosp.uploadDoctorImage
);


r.get(
  "/hospital/appointments",
  auth,
  roles("hospital"),
  hosp.appointments
);


r.post(
  "/hospital/appointments",
  auth,
  roles("hospital"),
  hosp.createAppointment
);


r.patch(
  "/hospital/appointments/:id",
  auth,
  roles("hospital"),
  hosp.updateAppointment
);


/* =========================================================
   DOCTOR
   ========================================================= */

r.get(
  "/doctor/profile",
  auth,
  roles("doctor"),
  doc.profile
);


r.patch(
  "/doctor/profile",
  auth,
  roles("doctor"),
  doc.updateProfile
);


r.patch(
  "/doctor/password",
  auth,
  roles("doctor"),
  doc.changePassword
);


r.post(
  "/doctor/profile/image",
  auth,
  roles("doctor"),
  upload.single("file"),
  doc.uploadImage
);


/*
 * Doctor signature
 */
r.post(
  "/doctor/profile/signature",
  auth,
  roles("doctor"),
  upload.single("file"),
  doc.uploadSignature
);


r.get(
  "/doctor/hospitals",
  auth,
  roles("doctor"),
  doc.hospitals
);


r.get(
  "/doctor/appointments",
  auth,
  roles("doctor"),
  doc.appointments
);


r.patch(
  "/doctor/appointments/:id",
  auth,
  roles("doctor"),
  doc.updateAppointment
);


r.get(
  "/doctor/patients",
  auth,
  roles("doctor"),
  doc.patients
);


/* =========================================================
   DOCTOR PRESCRIPTIONS
   ========================================================= */

r.get(
  "/doctor/prescriptions",
  auth,
  roles("doctor"),
  doc.prescriptions
);


r.post(
  "/doctor/prescriptions",
  auth,
  roles("doctor"),
  doc.addPrescription
);


r.patch(
  "/doctor/prescriptions/:id",
  auth,
  roles("doctor"),
  doc.updatePrescription
);


/* =========================================================
   PATIENT
   ========================================================= */

r.get(
  "/patient/profile",
  auth,
  roles("patient"),
  patient.profile
);


r.get(
  "/patient/prescriptions",
  auth,
  roles("patient"),
  patient.prescriptions
);


/* =========================================================
   CHAT
   ========================================================= */

r.get(
  "/chat/:userId",
  auth,
  roles("doctor", "patient"),
  comm.messages
);


r.post(
  "/chat/:userId",
  auth,
  roles("doctor", "patient"),
  upload.single("file"),
  comm.sendMessage
);


/* =========================================================
   CALLS
   ========================================================= */

r.post(
  "/calls",
  auth,
  roles("doctor"),
  comm.startCall
);


r.patch(
  "/calls/:id",
  auth,
  roles("doctor", "patient"),
  comm.updateCall
);


r.get(
  "/calls/incoming",
  auth,
  roles("patient"),
  comm.incomingCalls
);


/* =========================================================
   EXPORT
   ========================================================= */

export default r;