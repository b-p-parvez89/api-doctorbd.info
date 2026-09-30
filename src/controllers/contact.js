import ContactMessage from '../models/ContactMessage.js';
import User from '../models/User.js';
import { notify } from '../utils/notify.js';

const allowedCategories = [
  'general',
  'appointment',
  'account',
  'technical',
  'doctor',
  'hospital',
  'payment',
  'complaint',
  'other',
];

export async function createContact(req, res) {
  try {
    const {
      name,
      phone,
      email,
      category = 'general',
      subject,
      message,
    } = req.body;

    if (!name?.trim()) {
      return res.status(400).json({
        message: 'Name is required',
      });
    }

    if (!subject?.trim()) {
      return res.status(400).json({
        message: 'Subject is required',
      });
    }

    if (!message?.trim()) {
      return res.status(400).json({
        message: 'Message is required',
      });
    }

    if (!allowedCategories.includes(category)) {
      return res.status(400).json({
        message: 'Invalid contact category',
      });
    }

    let senderRole = 'guest';

    if (req.user) {
      senderRole = req.user.role || 'guest';
    }

    const contact = await ContactMessage.create({
      sender: req.user?.id || null,
      senderRole,
      name: name.trim(),
      phone: phone?.trim() || '',
      email: email?.trim() || '',
      category,
      subject: subject.trim(),
      message: message.trim(),
    });

    // Notify all admins
    const admins = await User.find({
      role: 'admin',
      status: { $ne: 'blocked' },
    }).select('_id');

    await Promise.all(
      admins.map(admin =>
        notify(
          admin._id,
          'CONTACT_MESSAGE',
          'New Contact Message',
          `${name.trim()} sent a new message to DoctorBD.`,
          contact._id,
          'ContactMessage'
        ).catch(() => {})
      )
    );

    return res.status(201).json({
      success: true,
      message:
        'Your message has been sent to DoctorBD support.',
      contact,
    });
  } catch (error) {
    console.error('createContact error:', error);

    return res.status(500).json({
      message: 'Failed to send contact message',
    });
  }
}


export async function myContacts(req, res) {
  try {
    const items = await ContactMessage.find({
      sender: req.user.id,
    })
      .sort({ createdAt: -1 })
      .lean();

    res.json({
      items,
    });
  } catch (error) {
    res.status(500).json({
      message: 'Failed to load your messages',
    });
  }
}


export async function adminContacts(req, res) {
  try {
    const {
      status,
      category,
      search,
    } = req.query;

    const filter = {};

    if (status) {
      filter.status = status;
    }

    if (category) {
      filter.category = category;
    }

    if (search?.trim()) {
      const regex = new RegExp(search.trim(), 'i');

      filter.$or = [
        { name: regex },
        { email: regex },
        { phone: regex },
        { subject: regex },
        { message: regex },
      ];
    }

    const items = await ContactMessage.find(filter)
      .populate('sender', 'name email phone role image')
      .sort({ createdAt: -1 })
      .lean();

    res.json({
      items,
    });
  } catch (error) {
    console.error('adminContacts error:', error);

    res.status(500).json({
      message: 'Failed to load contact messages',
    });
  }
}


export async function adminGetContact(req, res) {
  try {
    const item = await ContactMessage.findById(req.params.id)
      .populate('sender', 'name email phone role image')
      .lean();

    if (!item) {
      return res.status(404).json({
        message: 'Contact message not found',
      });
    }

    res.json({
      contact: item,
    });
  } catch (error) {
    res.status(500).json({
      message: 'Failed to load contact message',
    });
  }
}


export async function adminUpdateContact(req, res) {
  try {
    const contact = await ContactMessage.findById(
      req.params.id
    );

    if (!contact) {
      return res.status(404).json({
        message: 'Contact message not found',
      });
    }

    const {
      status,
      adminReply,
    } = req.body;

    if (
      status &&
      !['new', 'read', 'replied', 'closed'].includes(status)
    ) {
      return res.status(400).json({
        message: 'Invalid status',
      });
    }

    if (status) {
      contact.status = status;
    }

    if (adminReply !== undefined) {
      contact.adminReply = adminReply.trim();

      if (adminReply.trim()) {
        contact.status = 'replied';
        contact.repliedAt = new Date();
      }
    }

    await contact.save();

    // Notify sender
    if (contact.sender && contact.adminReply) {
      await notify(
        contact.sender,
        'CONTACT_REPLY',
        'DoctorBD Support Reply',
        'DoctorBD support has replied to your message.',
        contact._id,
        'ContactMessage'
      ).catch(() => {});
    }

    res.json({
      success: true,
      message: 'Contact message updated',
      contact,
    });
  } catch (error) {
    console.error('adminUpdateContact error:', error);

    res.status(500).json({
      message: 'Failed to update contact message',
    });
  }
}