import mongoose from 'mongoose';

const contactMessageSchema = new mongoose.Schema(
  {
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    senderRole: {
      type: String,
      enum: ['guest', 'patient', 'doctor', 'hospital'],
      default: 'guest',
    },

    name: {
      type: String,
      required: true,
      trim: true,
    },

    phone: {
      type: String,
      trim: true,
      default: '',
    },

    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: '',
    },

    category: {
      type: String,
      enum: [
        'general',
        'appointment',
        'account',
        'technical',
        'doctor',
        'hospital',
        'payment',
        'complaint',
        'other',
      ],
      default: 'general',
    },

    subject: {
      type: String,
      required: true,
      trim: true,
    },

    message: {
      type: String,
      required: true,
      trim: true,
    },

    status: {
      type: String,
      enum: ['new', 'read', 'replied', 'closed'],
      default: 'new',
    },

    adminReply: {
      type: String,
      default: '',
    },

    repliedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

contactMessageSchema.index({ status: 1, createdAt: -1 });
contactMessageSchema.index({ sender: 1, createdAt: -1 });

export default mongoose.model('ContactMessage', contactMessageSchema);