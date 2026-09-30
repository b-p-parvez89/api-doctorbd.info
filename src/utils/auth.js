import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Doctor from '../models/Doctor.js';

export function signUser(user) {
  return jwt.sign(
    {
      id: user._id.toString(),
      role: user.role,
      name: user.name,
      email: user.email,
    },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

export async function auth(req, res, next) {
  const header = req.headers.authorization || '';

  if (!header.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Authentication required' });
  }

  try {
    const payload = jwt.verify(
      header.slice(7),
      process.env.JWT_SECRET
    );

    const user = await User.findById(payload.id)
      .select('_id name email role active avatar phone phoneVerified');

    if (!user) {
      return res.status(401).json({ message: 'User account not found' });
    }

    if (!user.active) {
      return res.status(403).json({ message: 'Account suspended' });
    }

    if (user.role === 'doctor') {
      const doctor = await Doctor.findOne({ user: user._id }).select('verified');
      if (!doctor) {
        return res.status(403).json({ message: 'Doctor profile is not available.' });
      }
      if (!doctor.verified) {
        return res.status(403).json({ message: 'Doctor account is waiting for administrator approval.' });
      }
    }

    // Always use the current database role, not a stale JWT role.
    req.user = {
      id: user._id.toString(),
      role: user.role,
      name: user.name,
      email: user.email,
      avatar: user.avatar,
      phone: user.phone,
      phoneVerified: user.phoneVerified,
    };

    next();
  } catch {
    return res.status(401).json({
      message: 'Invalid or expired token',
    });
  }
}

export function roles(...allowed) {
  return (req, res, next) => {
    if (allowed.includes(req.user?.role)) return next();
    return res.status(403).json({ message: 'Forbidden' });
  };
}
