import bcrypt from "bcryptjs";
import crypto from "crypto";

import User from "../models/User.js";
import Hospital from "../models/Hospital.js";
import Doctor from "../models/Doctor.js";

import { signUser } from "../utils/auth.js";
import { uploadBuffer } from "../utils/cloudinary.js";
import { sendSms } from "../utils/sms.js";


/* =========================================================
   PUBLIC USER
   ========================================================= */

const publicUser = (u) => ({
  id: u._id,
  name: u.name,
  email: u.email,
  phone: u.phone,
  role: u.role,
  avatar: u.avatar,
  phoneVerified: u.phoneVerified,
});


/* =========================================================
   PHONE NORMALIZER
   Bangladesh numbers:
   01XXXXXXXXX
   +8801XXXXXXXXX
   8801XXXXXXXXX
   ========================================================= */

function normalizePhone(value) {
  let phone = String(value || "")
    .replace(/[^\d+]/g, "")
    .trim();

  if (phone.startsWith("+880")) {
    phone = phone.slice(1);
  }

  if (phone.startsWith("01")) {
    phone = `88${phone}`;
  }

  return phone;
}


/* =========================================================
   REGISTER
   Register user
   Generate OTP
   Save OTP hash
   Send SMS
   ========================================================= */

export async function register(req, res) {
  try {
    const {
      name,
      email,
      password,
      phone,
    } = req.body;

    const cleanName = String(name || "").trim();

    const cleanEmail = String(email || "")
      .toLowerCase()
      .trim();

    const cleanPassword = String(password || "");

    const cleanPhone = normalizePhone(phone);


    /* -----------------------------
       Validation
       ----------------------------- */

    if (!cleanName) {
      return res.status(400).json({
        message: "Name is required",
      });
    }

    if (!cleanEmail) {
      return res.status(400).json({
        message: "Email is required",
      });
    }

    if (cleanPassword.length < 6) {
      return res.status(400).json({
        message: "Password must be at least 6 characters",
      });
    }

    if (!cleanPhone) {
      return res.status(400).json({
        message: "Phone number is required",
      });
    }


    /* -----------------------------
       Check email
       ----------------------------- */

    const existingEmail = await User.findOne({
      email: cleanEmail,
    });

    if (existingEmail) {
      return res.status(409).json({
        message: "Email already registered",
      });
    }


    /* -----------------------------
       Check phone
       ----------------------------- */

    const existingPhone = await User.findOne({
      phone: cleanPhone,
    });

    if (existingPhone) {
      return res.status(409).json({
        message: "Phone number already registered",
      });
    }


    /* -----------------------------
       Generate OTP
       ----------------------------- */

    const code = String(
      crypto.randomInt(100000, 1000000)
    );


    /* -----------------------------
       Create patient
       ----------------------------- */

    const user = await User.create({
      name: cleanName,
      email: cleanEmail,
      phone: cleanPhone,

      passwordHash: await bcrypt.hash(
        cleanPassword,
        12
      ),

      role: "patient",

      phoneVerified: false,

      otpHash: await bcrypt.hash(
        code,
        10
      ),

      otpExpiresAt: new Date(
        Date.now() + 5 * 60 * 1000
      ),
    });


    /* -----------------------------
       Send SMS
       ----------------------------- */

    try {
      await sendSms(
        cleanPhone,
        `DoctorBD verification code: ${code}. It expires in 5 minutes.`
      );
    } catch (smsError) {
      /*
       * Registration should not leave a broken account
       * if SMS provider fails.
       */

      console.error(
        "Registration SMS failed:",
        smsError
      );

      await User.findByIdAndDelete(user._id);

      return res.status(502).json({
        message:
          "Unable to send verification SMS. Please try again.",
      });
    }


    /* -----------------------------
       Response
       ----------------------------- */

    return res.status(201).json({
      ok: true,

      message:
        "Registration successful. Verification code sent to your phone.",

      verificationId: String(user._id),

      phone: cleanPhone,
    });
  } catch (error) {
    console.error(
      "Register error:",
      error
    );

    return res.status(500).json({
      message:
        "Registration failed. Please try again.",
    });
  }
}


/* =========================================================
   VERIFY REGISTRATION PHONE
   This endpoint is used BEFORE login.
   ========================================================= */

export async function verifyRegistrationPhone(
  req,
  res
) {
  try {
    const {
      phone,
      otp,
      verificationId,
    } = req.body;


    if (!otp) {
      return res.status(400).json({
        message: "OTP is required",
      });
    }


    /* -----------------------------
       Find user
       ----------------------------- */

    let user = null;

    if (verificationId) {
      user = await User.findById(
        verificationId
      );
    }

    if (!user && phone) {
      const cleanPhone =
        normalizePhone(phone);

      user = await User.findOne({
        phone: cleanPhone,
      });
    }


    if (!user) {
      return res.status(404).json({
        message:
          "Registration account not found",
      });
    }


    /* -----------------------------
       Already verified
       ----------------------------- */

    if (user.phoneVerified) {
      return res.status(400).json({
        message:
          "Phone number is already verified",
      });
    }


    /* -----------------------------
       OTP exists?
       ----------------------------- */

    if (
      !user.otpHash ||
      !user.otpExpiresAt
    ) {
      return res.status(400).json({
        message:
          "No active verification code",
      });
    }


    /* -----------------------------
       OTP expired?
       ----------------------------- */

    if (
      new Date(user.otpExpiresAt).getTime() <
      Date.now()
    ) {
      user.otpHash = undefined;
      user.otpExpiresAt = undefined;

      await user.save();

      return res.status(400).json({
        message: "OTP expired",
      });
    }


    /* -----------------------------
       Compare OTP
       ----------------------------- */

    const valid = await bcrypt.compare(
      String(otp).trim(),
      user.otpHash
    );

    if (!valid) {
      return res.status(400).json({
        message: "Invalid OTP",
      });
    }


    /* -----------------------------
       Verify phone
       ----------------------------- */

    user.phoneVerified = true;

    user.otpHash = undefined;
    user.otpExpiresAt = undefined;

    await user.save();


    /* -----------------------------
       Create login token
       ----------------------------- */

    const token = signUser(user);


    /* -----------------------------
       Response
       ----------------------------- */

    return res.json({
      ok: true,

      phoneVerified: true,

      message:
        "Phone verified successfully",

      token,

      user: publicUser(user),
    });
  } catch (error) {
    console.error(
      "Verify registration phone error:",
      error
    );

    return res.status(500).json({
      message:
        "Phone verification failed. Please try again.",
    });
  }
}


/* =========================================================
   RESEND REGISTRATION OTP
   ========================================================= */

export async function resendRegistrationPhoneOtp(
  req,
  res
) {
  try {
    const {
      phone,
      verificationId,
    } = req.body;


    /* -----------------------------
       Find user
       ----------------------------- */

    let user = null;

    if (verificationId) {
      user = await User.findById(
        verificationId
      );
    }

    if (!user && phone) {
      const cleanPhone =
        normalizePhone(phone);

      user = await User.findOne({
        phone: cleanPhone,
      });
    }


    if (!user) {
      return res.status(404).json({
        message:
          "Registration account not found",
      });
    }


    /* -----------------------------
       Already verified
       ----------------------------- */

    if (user.phoneVerified) {
      return res.status(400).json({
        message:
          "Phone number is already verified",
      });
    }


    /* -----------------------------
       Generate new OTP
       ----------------------------- */

    const code = String(
      crypto.randomInt(100000, 1000000)
    );


    user.otpHash = await bcrypt.hash(
      code,
      10
    );

    user.otpExpiresAt = new Date(
      Date.now() + 5 * 60 * 1000
    );

    await user.save();


    /* -----------------------------
       Send SMS
       ----------------------------- */

    try {
      await sendSms(
        user.phone,
        `DoctorBD verification code: ${code}. It expires in 5 minutes.`
      );
    } catch (smsError) {
      console.error(
        "Resend SMS failed:",
        smsError
      );

      return res.status(502).json({
        message:
          "Unable to send verification SMS. Please try again.",
      });
    }


    return res.json({
      ok: true,

      message:
        "A new verification code has been sent.",

      verificationId: String(user._id),
    });
  } catch (error) {
    console.error(
      "Resend registration OTP error:",
      error
    );

    return res.status(500).json({
      message:
        "Unable to resend OTP. Please try again.",
    });
  }
}


/* =========================================================
   LOGIN
   ========================================================= */

export async function login(req, res) {
  try {
    const {
      email,
      password,
    } = req.body;

    const cleanEmail = String(
      email || ""
    )
      .toLowerCase()
      .trim();


    const user = await User.findOne({
      email: cleanEmail,
    });


    if (
      !user ||
      !user.passwordHash ||
      !(await bcrypt.compare(
        password || "",
        user.passwordHash
      ))
    ) {
      return res.status(401).json({
        message:
          "Invalid email or password",
      });
    }


    /* -----------------------------
       Active check
       ----------------------------- */

    if (!user.active) {
      return res.status(403).json({
        message: "Account suspended",
      });
    }


    /* -----------------------------
       Phone verification
       Only enforce for patients
       if you want registration
       verification to be mandatory.
       ----------------------------- */

    if (
      user.role === "patient" &&
      !user.phoneVerified
    ) {
      return res.status(403).json({
        message:
          "Please verify your phone number before signing in.",
        code: "PHONE_NOT_VERIFIED",
      });
    }


    /* -----------------------------
       Doctor approval
       ----------------------------- */

    if (user.role === "doctor") {
      const doctor =
        await Doctor.findOne({
          user: user._id,
        }).select("verified");

      if (!doctor) {
        return res.status(403).json({
          message:
            "Doctor profile is not available. Please contact the administrator.",
        });
      }

      if (!doctor.verified) {
        return res.status(403).json({
          message:
            "Doctor account is waiting for administrator approval.",
        });
      }
    }


    return res.json({
      token: signUser(user),
      user: publicUser(user),
    });
  } catch (error) {
    console.error(
      "Login error:",
      error
    );

    return res.status(500).json({
      message:
        "Login failed. Please try again.",
    });
  }
}


/* =========================================================
   CURRENT USER
   ========================================================= */

export async function me(req, res) {
  try {
    const user =
      await User.findById(
        req.user.id
      ).select(
        "-passwordHash -otpHash -otpExpiresAt -resetOtpHash -resetOtpExpiresAt -resetOtpVerifiedAt"
      );


    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }


    return res.json({
      user,
    });
  } catch (error) {
    console.error(
      "Me error:",
      error
    );

    return res.status(500).json({
      message:
        "Unable to load user.",
    });
  }
}


/* =========================================================
   UPDATE PROFILE
   ========================================================= */

export async function updateProfile(
  req,
  res
) {
  try {
    const allowed = [
      "name",
      "phone",
      "gender",
      "age",
      "address",
      "city",
    ];

    const updates = {};


    for (const key of allowed) {
      if (
        req.body[key] !== undefined
      ) {
        updates[key] =
          req.body[key];
      }
    }


    /* -----------------------------
       Email
       ----------------------------- */

    if (req.body.email) {
      const email =
        req.body.email
          .toLowerCase()
          .trim();

      const exists =
        await User.findOne({
          email,
          _id: {
            $ne: req.user.id,
          },
        });

      if (exists) {
        return res.status(409).json({
          message:
            "Email already registered",
        });
      }

      updates.email = email;
    }


    const user =
      await User.findByIdAndUpdate(
        req.user.id,
        updates,
        {
          new: true,
          runValidators: true,
        }
      ).select(
        "-passwordHash -otpHash -otpExpiresAt -resetOtpHash -resetOtpExpiresAt -resetOtpVerifiedAt"
      );


    if (!user) {
      return res.status(404).json({
        message:
          "User not found",
      });
    }


    return res.json({
      user,
    });
  } catch (error) {
    console.error(
      "Update profile error:",
      error
    );

    return res.status(500).json({
      message:
        "Unable to update profile.",
    });
  }
}


/* =========================================================
   PASSWORD RESET BY PHONE OTP
   ========================================================= */

export async function requestPasswordResetOtp(req, res) {
  try {
    const cleanPhone = normalizePhone(req.body?.phone);

    if (!cleanPhone) {
      return res.status(400).json({ message: "Phone number is required" });
    }

    const user = await User.findOne({ phone: cleanPhone });

    // Do not reveal whether a phone number has an account.
    if (!user) {
      return res.json({
        ok: true,
        message: "If this phone number is registered, an OTP has been sent.",
      });
    }

    if (!user.active) {
      return res.status(403).json({ message: "Account suspended" });
    }

    const code = String(crypto.randomInt(100000, 1000000));

    user.resetOtpHash = await bcrypt.hash(code, 10);
    user.resetOtpExpiresAt = new Date(Date.now() + 5 * 60 * 1000);
    user.resetOtpVerifiedAt = undefined;
    await user.save();

    const sms = await sendSms(
      cleanPhone,
      `DoctorBD password reset code: ${code}. It expires in 5 minutes.`
    );

    if (!sms?.success) {
      user.resetOtpHash = undefined;
      user.resetOtpExpiresAt = undefined;
      await user.save();
      return res.status(502).json({ message: "Unable to send reset OTP. Please try again." });
    }

    return res.json({
      ok: true,
      message: "If this phone number is registered, an OTP has been sent.",
      phone: cleanPhone,
    });
  } catch (error) {
    console.error("Request password reset OTP error:", error);
    return res.status(500).json({ message: "Unable to request password reset OTP." });
  }
}

export async function verifyPasswordResetOtp(req, res) {
  try {
    const cleanPhone = normalizePhone(req.body?.phone);
    const otp = String(req.body?.otp || "").trim();

    if (!cleanPhone || !otp) {
      return res.status(400).json({ message: "Phone number and OTP are required" });
    }

    const user = await User.findOne({ phone: cleanPhone });

    if (!user || !user.resetOtpHash || !user.resetOtpExpiresAt) {
      return res.status(400).json({ message: "Invalid or expired OTP" });
    }

    if (new Date(user.resetOtpExpiresAt).getTime() < Date.now()) {
      user.resetOtpHash = undefined;
      user.resetOtpExpiresAt = undefined;
      user.resetOtpVerifiedAt = undefined;
      await user.save();
      return res.status(400).json({ message: "OTP expired" });
    }

    const valid = await bcrypt.compare(otp, user.resetOtpHash);
    if (!valid) {
      return res.status(400).json({ message: "Invalid OTP" });
    }

    user.resetOtpHash = undefined;
    user.resetOtpExpiresAt = undefined;
    user.resetOtpVerifiedAt = new Date();
    await user.save();

    return res.json({
      ok: true,
      message: "OTP verified successfully. You can now set a new password.",
      resetToken: String(user._id),
    });
  } catch (error) {
    console.error("Verify password reset OTP error:", error);
    return res.status(500).json({ message: "Unable to verify reset OTP." });
  }
}

export async function resetPasswordByPhone(req, res) {
  try {
    const cleanPhone = normalizePhone(req.body?.phone);
    const newPassword = String(req.body?.newPassword || "");

    if (!cleanPhone || !newPassword) {
      return res.status(400).json({ message: "Phone number and new password are required" });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ message: "New password must be at least 6 characters" });
    }

    const user = await User.findOne({ phone: cleanPhone });

    if (!user || !user.resetOtpVerifiedAt) {
      return res.status(403).json({ message: "Please verify the phone OTP first" });
    }

    // OTP verification is valid only for a short reset window.
    if (Date.now() - new Date(user.resetOtpVerifiedAt).getTime() > 10 * 60 * 1000) {
      user.resetOtpVerifiedAt = undefined;
      await user.save();
      return res.status(403).json({ message: "Password reset session expired. Please request a new OTP." });
    }

    user.passwordHash = await bcrypt.hash(newPassword, 12);
    user.resetOtpVerifiedAt = undefined;
    await user.save();

    return res.json({
      ok: true,
      message: "Password reset successfully. You can now log in with your new password.",
    });
  } catch (error) {
    console.error("Reset password error:", error);
    return res.status(500).json({ message: "Unable to reset password." });
  }
}


/* =========================================================
   CHANGE PASSWORD
   ========================================================= */

export async function changePassword(
  req,
  res
) {
  try {
    const {
      currentPassword,
      newPassword,
    } = req.body;


    if (
      !newPassword ||
      newPassword.length < 6
    ) {
      return res.status(400).json({
        message:
          "New password must be at least 6 characters",
      });
    }


    const user =
      await User.findById(
        req.user.id
      );


    if (
      !user ||
      !user.passwordHash ||
      !(await bcrypt.compare(
        currentPassword || "",
        user.passwordHash
      ))
    ) {
      return res.status(400).json({
        message:
          "Current password is incorrect",
      });
    }


    user.passwordHash =
      await bcrypt.hash(
        newPassword,
        12
      );

    await user.save();


    return res.json({
      ok: true,
    });
  } catch (error) {
    console.error(
      "Change password error:",
      error
    );

    return res.status(500).json({
      message:
        "Unable to change password.",
    });
  }
}


/* =========================================================
   UPLOAD AVATAR
   ========================================================= */

export async function uploadAvatar(
  req,
  res
) {
  try {
    if (!req.file) {
      return res.status(400).json({
        message: "Image is required",
      });
    }


    const result =
      await uploadBuffer(
        req.file.buffer,
        "doctorbd/profiles",
        "image"
      );


    const user =
      await User.findByIdAndUpdate(
        req.user.id,
        {
          avatar:
            result.secure_url,
        },
        {
          new: true,
        }
      ).select(
        "-passwordHash -otpHash -otpExpiresAt -resetOtpHash -resetOtpExpiresAt -resetOtpVerifiedAt"
      );


    if (
      req.user.role === "doctor"
    ) {
      await Doctor.findOneAndUpdate(
        {
          user: req.user.id,
        },
        {
          image:
            result.secure_url,
        }
      );
    }


    if (
      req.user.role === "hospital"
    ) {
      await Hospital.findOneAndUpdate(
        {
          user: req.user.id,
        },
        {
          image:
            result.secure_url,
        }
      );
    }


    return res.json({
      user,
      url: result.secure_url,
    });
  } catch (error) {
    console.error(
      "Upload avatar error:",
      error
    );

    return res.status(500).json({
      message:
        "Unable to upload image.",
    });
  }
}


/* =========================================================
   REQUEST PHONE OTP
   FOR ALREADY LOGGED-IN USERS
   ========================================================= */

export async function requestPhoneOtp(
  req,
  res
) {
  try {
    const {
      phone,
    } = req.body;


    if (!phone) {
      return res.status(400).json({
        message:
          "Phone is required",
      });
    }


    const cleanPhone =
      normalizePhone(phone);


    const user =
      await User.findById(
        req.user.id
      );


    if (!user) {
      return res.status(404).json({
        message:
          "User not found",
      });
    }


    const code = String(
      crypto.randomInt(
        100000,
        1000000
      )
    );


    user.phone = cleanPhone;

    user.phoneVerified = false;

    user.otpHash =
      await bcrypt.hash(
        code,
        10
      );

    user.otpExpiresAt =
      new Date(
        Date.now() +
          5 * 60 * 1000
      );


    await user.save();


    await sendSms(
      cleanPhone,
      `DoctorBD verification code: ${code}. It expires in 5 minutes.`
    );


    return res.json({
      ok: true,
      message: "OTP sent",
    });
  } catch (error) {
    console.error(
      "Request phone OTP error:",
      error
    );

    return res.status(500).json({
      message:
        "Unable to send OTP.",
    });
  }
}


/* =========================================================
   VERIFY PHONE OTP
   FOR ALREADY LOGGED-IN USERS
   ========================================================= */

export async function verifyPhoneOtp(
  req,
  res
) {
  try {
    const {
      code,
    } = req.body;


    const user =
      await User.findById(
        req.user.id
      );


    if (
      !user ||
      !user.otpHash ||
      !user.otpExpiresAt
    ) {
      return res.status(400).json({
        message:
          "OTP expired",
      });
    }


    if (
      new Date(
        user.otpExpiresAt
      ).getTime() <
      Date.now()
    ) {
      return res.status(400).json({
        message:
          "OTP expired",
      });
    }


    const valid =
      await bcrypt.compare(
        String(code || "").trim(),
        user.otpHash
      );


    if (!valid) {
      return res.status(400).json({
        message:
          "Invalid OTP",
      });
    }


    user.phoneVerified = true;

    user.otpHash = undefined;

    user.otpExpiresAt = undefined;


    await user.save();


    return res.json({
      ok: true,
      phoneVerified: true,
    });
  } catch (error) {
    console.error(
      "Verify phone OTP error:",
      error
    );

    return res.status(500).json({
      message:
        "Unable to verify phone.",
    });
  }
}