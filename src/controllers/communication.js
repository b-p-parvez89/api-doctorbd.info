import Doctor from '../models/Doctor.js';import ChatMessage from '../models/ChatMessage.js';import Call from '../models/Call.js';import Appointment from '../models/Appointment.js';import User from '../models/User.js';import {uploadBuffer} from '../utils/cloudinary.js';import {notify} from '../utils/notify.js';
async function connected(a,b){
  const [doctorA, doctorB] = await Promise.all([
    Doctor.findOne({user:a}).select('_id'),
    Doctor.findOne({user:b}).select('_id'),
  ]);
  const pairs = [];
  if (doctorA) pairs.push({doctor:doctorA._id, patient:b});
  if (doctorB) pairs.push({doctor:doctorB._id, patient:a});
  if (!pairs.length) return false;
  return !!(await Appointment.findOne({
    $or:pairs,
    status:{$in:['waiting','confirmed','completed']}
  }));
}
export async function messages(req,res){const other=req.params.userId;if(!(await connected(req.user.id,other)))return res.status(403).json({message:'Chat is available only for connected doctor/patient appointments'});res.json({items:await ChatMessage.find({$or:[{sender:req.user.id,recipient:other},{sender:other,recipient:req.user.id}]}).sort({createdAt:1})});}
export async function sendMessage(req,res){const other=req.params.userId;if(!(await connected(req.user.id,other)))return res.status(403).json({message:'Chat is not available for these users'});let mediaUrl,mediaType;if(req.file){const resourceType=req.file.mimetype.startsWith('video/')?'video':'image';const r=await uploadBuffer(req.file.buffer,'doctorbd/chat',resourceType);mediaUrl=r.secure_url;mediaType=resourceType;}if(!req.body.text&&!mediaUrl)return res.status(400).json({message:'Text or media is required'});const m=await ChatMessage.create({sender:req.user.id,recipient:other,text:req.body.text,mediaUrl,mediaType});await notify(other,'NEW_MESSAGE','New Message','You have a new message in DoctorBD.',m._id,'User');res.status(201).json({message:m});}
export async function startCall(req,res){if(req.user.role!=='doctor')return res.status(403).json({message:'Only doctors can initiate calls'});const patient=await User.findOne({_id:req.body.patient,role:'patient'});if(!patient||!(await connected(req.user.id,patient._id)))return res.status(403).json({message:'Patient is not connected to this doctor'});const roomId=`lc-${req.user.id}-${patient._id}-${Date.now()}`;const call=await Call.create({doctor:req.user.id,patient:patient._id,type:req.body.type==='video'?'video':'audio',roomId});await notify(patient._id,'INCOMING_CALL',`Incoming ${call.type} call`,'Your doctor is calling you.',call._id,'Call');res.status(201).json({call});}
export async function updateCall(req,res){const call=await Call.findById(req.params.id);if(!call)return res.status(404).json({message:'Call not found'});if(req.user.id.toString()!==call.doctor.toString()&&req.user.id.toString()!==call.patient.toString())return res.status(403).json({message:'Forbidden'});if(req.user.role==='patient'&&!['accepted','rejected','ended'].includes(req.body.status))return res.status(403).json({message:'Forbidden'});call.status=req.body.status;await call.save();res.json({call});}
export async function incomingCalls(req,res){if(req.user.role!=='patient')return res.json({items:[]});res.json({items:await Call.find({patient:req.user.id,status:'ringing'}).populate('doctor','name specialty image').sort({createdAt:-1})});}
