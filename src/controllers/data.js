import bcrypt from 'bcryptjs';
import Doctor from '../models/Doctor.js';
import Hospital from '../models/Hospital.js';
import Appointment from '../models/Appointment.js';
import Schedule from '../models/Schedule.js';
import Payment from '../models/Payment.js';
import User from '../models/User.js';
import Notification from '../models/Notification.js';

async function notify(recipient, type, title, message, relatedId, relatedType) {
  if (!recipient) return;
  await Notification.create({ recipient, type, title, message, relatedId, relatedType });
}

export async function doctors(req,res){
  const q={};
  for(const k of ['specialty','location','gender','availability']) if(req.query[k]) q[k]=new RegExp(req.query[k],'i');
  if(req.query.minExperience) q.experience={$gte:Number(req.query.minExperience)};
  if(req.query.maxFee) q.fee={$lte:Number(req.query.maxFee)};
  if(req.query.hospital){
    const h=await Hospital.findOne({_id:req.query.hospital});
    if(h) q.hospitals=h._id;
  }
  res.json({items:await Doctor.find(q).populate('hospitals','name location').sort({verified:-1,experience:-1})});
}
export async function doctor(req,res){
  const d=await Doctor.findById(req.params.id).populate('hospitals','name location phone address');
  if(!d)return res.status(404).json({message:'Doctor not found'});
  res.json({doctor:d});
}
export async function hospitals(req,res){
  const q=req.query.search?{$or:[{name:new RegExp(req.query.search,'i')},{location:new RegExp(req.query.search,'i')}]}:{};
  res.json({items:await Hospital.find(q).populate('user','name email phone').sort({verified:-1,name:1})});
}
export async function hospital(req,res){
  const h=await Hospital.findById(req.params.id).populate('user','name email phone');
  if(!h)return res.status(404).json({message:'Hospital not found'});
  res.json({hospital:h});
}
export async function schedules(req,res){
  let s=await Schedule.findOne({doctor:req.params.doctorId,date:req.query.date});
  if(!s)s=await Schedule.create({doctor:req.params.doctorId,date:req.query.date,serials:Array.from({length:20},(_,i)=>({number:i+1,available:i%5!==0}))});
  res.json({schedule:s});
}

export async function createAppointment(req,res){
  const {doctor,date,serial}=req.body;
  if(!doctor||!date||!serial)return res.status(400).json({message:'Doctor, date and serial are required'});
  const d=await Doctor.findById(doctor).populate('hospitals','name user');
  if(!d)return res.status(404).json({message:'Doctor not found'});
  let hospitalId=req.body.hospital;
  if(hospitalId && !d.hospitals.some(h=>h._id.toString()===hospitalId)) hospitalId=null;
  if(!hospitalId && d.hospitals.length===1) hospitalId=d.hospitals[0]._id;
  const h=hospitalId?await Hospital.findById(hospitalId):null;
  const ap=await Appointment.create({patient:req.user.id,doctor,hospital:h?._id,hospitalName:h?.name||d.hospital,date,serial,fee:d.fee});
  await ap.populate([{path:'doctor',select:'name specialty'},{path:'patient',select:'name email phone'},{path:'hospital',select:'name user'}]);
  const recipients=new Set([process.env.ADMIN_USER_ID].filter(Boolean));
  const adminUsers=await User.find({role:'admin',active:true}).select('_id');
  adminUsers.forEach(u=>recipients.add(u._id.toString()));
  if(h?.user) recipients.add(h.user.toString());
  if(d.user) recipients.add(d.user.toString());
  recipients.add(req.user.id.toString());
  await Promise.all([...recipients].map(id=>{
    const isPatient=id===req.user.id.toString();
    return notify(id,isPatient?'APPOINTMENT_CONFIRMED':'NEW_APPOINTMENT',
      isPatient?'Appointment Confirmed':'New Appointment',
      isPatient?`Your appointment with ${d.name} at ${h?.name||d.hospital||'the hospital'} is confirmed. Serial ${serial}.`:`New appointment: ${req.user.name||'Patient'} booked ${d.name} at ${h?.name||d.hospital||'the hospital'}, serial ${serial}.`,
      ap._id,'Appointment');
  }));
  res.status(201).json({appointment:ap});
}

export async function myAppointments(req,res){
  const filter={};
  if(req.user.role==='patient') filter.patient=req.user.id;
  if(req.user.role==='doctor'){
    const d=await Doctor.findOne({user:req.user.id});
    filter.doctor=d?._id||null;
  }
  if(req.user.role==='hospital'){
    const h=await Hospital.findOne({user:req.user.id});
    filter.hospital=h?._id||null;
  }
  const items=await Appointment.find(filter).populate('doctor','name specialty image').populate('patient','name email phone').populate('hospital','name location').sort({date:-1,createdAt:-1});
  res.json({items});
}

export async function cancelAppointment(req,res){
  const ap=await Appointment.findOne({_id:req.params.id,patient:req.user.id}).populate('doctor','name user').populate('hospital','name user');
  if(!ap)return res.status(404).json({message:'Appointment not found'});
  ap.status='cancelled';await ap.save();
  const ids=[req.user.id,ap.doctor?.user,ap.hospital?.user];
  const admins=await User.find({role:'admin',active:true}).select('_id');
  ids.push(...admins.map(x=>x._id));
  await Promise.all(ids.filter(Boolean).map(id=>notify(id.toString(),id.toString()===req.user.id.toString()?'APPOINTMENT_CANCELLED':'APPOINTMENT_CANCELLED','Appointment Cancelled',`Appointment with ${ap.doctor?.name||'doctor'} was cancelled.`,ap._id,'Appointment')));
  res.json({appointment:ap});
}

export async function completeAppointment(req,res){
  const ap=await Appointment.findById(req.params.id).populate('doctor','name user').populate('hospital','name user');
  if(!ap)return res.status(404).json({message:'Appointment not found'});
  if(req.user.role==='doctor'){
    const d=await Doctor.findOne({user:req.user.id});
    if(!d || d._id.toString()!==ap.doctor._id.toString()) return res.status(403).json({message:'Forbidden'});
  } else if(req.user.role==='hospital'){
    const h=await Hospital.findOne({user:req.user.id});
    if(!h || !ap.hospital || h._id.toString()!==ap.hospital._id.toString()) return res.status(403).json({message:'Forbidden'});
  } else if(req.user.role!=='admin') return res.status(403).json({message:'Forbidden'});
  ap.status='completed';await ap.save();
  await notify(ap.patient,'APPOINTMENT_COMPLETED','Appointment Completed',`Your appointment with ${ap.doctor?.name||'doctor'} has been marked completed.`,ap._id,'Appointment');
  res.json({appointment:ap});
}

export async function adminStats(req,res){
  const [users,doctors,hospitals,appointments,payments,completed]=await Promise.all([
    User.countDocuments(),Doctor.countDocuments(),Hospital.countDocuments(),Appointment.countDocuments(),
    Payment.find(),Appointment.countDocuments({status:'completed'})
  ]);
  const paid=payments.reduce((a,p)=>a+(p.amount||0),0);
  res.json({users,doctors,hospitals,appointments,completed,paid});
}

export async function recordPayment(req,res){
  if(req.user.role==='hospital'){
    const h=await Hospital.findOne({user:req.user.id});
    if(!h || req.body.hospital?.toString()!==h._id.toString()) return res.status(403).json({message:'You can only record your own hospital payment'});
  }
  const p=await Payment.create(req.body);res.status(201).json({payment:p});
}

export async function verifyDoctor(req,res){
  const d=await Doctor.findByIdAndUpdate(req.params.id,{verified:req.body.verified},{new:true});
  if(!d)return res.status(404).json({message:'Doctor not found'});
  if(d.user) await notify(d.user,req.body.verified?'DOCTOR_APPROVED':'DOCTOR_REJECTED',req.body.verified?'Doctor Approved':'Doctor Verification Update',req.body.verified?'Your doctor profile has been approved.':'Your doctor profile was not approved.',d._id,'Doctor');
  res.json({doctor:d});
}
export async function verifyHospital(req,res){
  const h=await Hospital.findByIdAndUpdate(req.params.id,{verified:req.body.verified},{new:true});
  if(!h)return res.status(404).json({message:'Hospital not found'});
  if(h.user) await notify(h.user,req.body.verified?'HOSPITAL_APPROVED':'HOSPITAL_REJECTED',req.body.verified?'Hospital Approved':'Hospital Verification Update',req.body.verified?'Your hospital account has been approved.':'Your hospital account was not approved.',h._id,'Hospital');
  res.json({hospital:h});
}

export async function createHospital(req,res){
  const {name,email,phone,address,location,departments=[],emergency=false,image,password}=req.body;
  if(!name||!email||!password)return res.status(400).json({message:'Hospital name, email and password are required'});
  const exists=await User.findOne({email:email.toLowerCase()});
  if(exists)return res.status(409).json({message:'Email already registered'});
  const u=await User.create({name,email:email.toLowerCase(),phone,passwordHash:await bcrypt.hash(password,12),role:'hospital',active:true});
  const h=await Hospital.create({user:u._id,name,email:email.toLowerCase(),phone,address,location,departments,emergency,image,verified:true});
  const admins=await User.find({role:'admin',active:true}).select('_id');
  await Promise.all(admins.map(a=>notify(a._id,'NEW_HOSPITAL','New Hospital Created',`${name} has been added by an admin.`,h._id,'Hospital')));
  res.status(201).json({hospital:h,user:{id:u._id,name:u.name,email:u.email,role:u.role}});
}

export async function hospitalDoctors(req,res){
  const h=await Hospital.findOne({user:req.user.id});
  if(!h)return res.status(404).json({message:'Hospital profile not found'});
  const items=await Doctor.find({$or:[{hospitals:h._id},{hospital:h.name}]}).populate('user','name email phone').sort({name:1});
  res.json({items});
}

export async function addDoctorToHospital(req,res){
  const h=await Hospital.findOne({user:req.user.id});
  if(!h)return res.status(404).json({message:'Hospital profile not found'});
  const {name,email,password,specialty,qualification,experience,fee,gender,image,bio}=req.body;
  if(!name||!email||!password)return res.status(400).json({message:'Name, email and password are required'});
  let u=await User.findOne({email:email.toLowerCase()});
  if(u && u.role!=='doctor')return res.status(409).json({message:'Email belongs to another role'});
  if(!u)u=await User.create({name,email:email.toLowerCase(),passwordHash:await bcrypt.hash(password,12),role:'doctor',active:true});
  let d=await Doctor.findOne({user:u._id});
  if(!d)d=await Doctor.create({user:u._id,name,specialty,qualification,experience,fee,gender,image,bio,hospital:h.name,hospitals:[h._id],location:h.location,verified:false,availability:'Pending Verification'});
  else { d.hospitals=[...new Set([...(d.hospitals||[]).map(String),h._id.toString()])];d.hospital=d.hospital||h.name;await d.save(); }
  h.doctors=await Doctor.countDocuments({$or:[{hospitals:h._id},{hospital:h.name}]});await h.save();
  const admins=await User.find({role:'admin',active:true}).select('_id');
  await Promise.all(admins.map(a=>notify(a._id,'NEW_DOCTOR','New Doctor Added',`${d.name} was added to ${h.name} and is awaiting verification.`,d._id,'Doctor')));
  res.status(201).json({doctor:d});
}

export async function hospitalStats(req,res){
  const h=await Hospital.findOne({user:req.user.id});
  if(!h)return res.status(404).json({message:'Hospital profile not found'});
  const filter={hospital:h._id};
  const [appointments,completed,pending,doctors]=await Promise.all([
    Appointment.countDocuments(filter),Appointment.countDocuments({...filter,status:'completed'}),
    Appointment.countDocuments({...filter,status:{$in:['confirmed','waiting']}}),
    Doctor.find({$or:[{hospitals:h._id},{hospital:h.name}]}).select('_id name specialty')
  ]);
  const doctorStats=await Promise.all(doctors.map(async d=>({
    doctor:d, appointments:await Appointment.countDocuments({hospital:h._id,doctor:d._id}),
    patients:(await Appointment.distinct('patient',{hospital:h._id,doctor:d._id})).length
  })));
  res.json({appointments,completed,pending,doctors:doctors.length,doctorStats});
}

export async function doctorHospitals(req,res){
  const d=await Doctor.findOne({user:req.user.id}).populate('hospitals','name location phone address');
  if(!d)return res.status(404).json({message:'Doctor profile not found'});
  const hospitals=d.hospitals?.length?d.hospitals:await Hospital.find({name:d.hospital});
  res.json({doctor:d,hospitals});
}

export async function notifications(req,res){
  const items=await Notification.find({recipient:req.user.id}).sort({createdAt:-1}).limit(Math.min(Number(req.query.limit)||30,100));
  const unread=await Notification.countDocuments({recipient:req.user.id,isRead:false});
  res.json({items,unread});
}
export async function markNotificationRead(req,res){
  const n=await Notification.findOneAndUpdate({_id:req.params.id,recipient:req.user.id},{isRead:true},{new:true});
  if(!n)return res.status(404).json({message:'Notification not found'});
  res.json({notification:n});
}
export async function markAllNotificationsRead(req,res){
  await Notification.updateMany({recipient:req.user.id,isRead:false},{$set:{isRead:true}});
  res.json({ok:true});
}
