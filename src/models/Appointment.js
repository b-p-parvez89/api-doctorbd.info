import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  patient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },

  doctor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Doctor',
    required: true,
  },

  hospital: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Hospital',
  },

  hospitalName: String,

  date: {
    type: String,
    required: true,
  },

  serial: {
    type: Number,
    required: true,
  },

  status: {
    type: String,
    enum: [
      'waiting',
      'confirmed',
      'rejected',
      'completed',
      'cancelled',
    ],
    default: 'waiting',
  },

  fee: Number,

  problem: String,

  patientName: String,
  patientAge: Number,
  patientGender: String,
  patientPhone: String,
  patientAddress: String,

  // Who approved/rejected this appointment
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },

  // doctor | hospital | admin
  approvedByRole: {
    type: String,
    enum: ['doctor', 'hospital', 'admin', null],
    default: null,
  },

  approvedAt: {
    type: Date,
    default: null,
  },

  rejectedAt: {
    type: Date,
    default: null,
  },

}, {
  timestamps: true,
});

schema.index(
  {
    doctor: 1,
    date: 1,
    serial: 1,
  },
  {
    unique: true,
  }
);

export default mongoose.model('Appointment', schema);